import { createPublicKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateOperationalCsr } from './csr.js';
import {
  fleetProvision,
  publishDeviceStatus,
  requestAssignment,
  withOperationalConnection,
  type FleetProvisioningProgress,
} from './mqtt.js';
import {
  appliedStateDisposition,
  sha256Hex,
  statusPayloads,
  verifyDownloadedArtifacts,
} from './protocol.js';
import {
  assertActiveProfile,
  commitAppliedProfile,
  commitProvisionedIdentity,
  createProvisioningStaging,
  enrichIdentity,
  initializeState,
  loadAppliedState,
  loadIdentity,
  stageIssuedCertificate,
  stageVerifiedArtifacts,
  statePaths,
  type PersistedIdentity,
} from './state.js';

interface Options {
  endpoint: string;
  templateName: string;
  serialNumber: string;
  hardwareId: string;
  generation: number;
  stateDirectory: string;
  claimCertificate: string;
  claimPrivateKey: string;
  hardwareProofFile?: string;
  signingPublicKey: string;
  signingKeyId: string;
  expectedThingName?: string;
  rootCa?: string;
  stopAfterIdentity: boolean;
  stepDelayMs: number;
  responseTimeoutMs: number;
}

const simulatorDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const paths = statePaths(options.stateDirectory, options.serialNumber);
  await initializeState(paths);
  let identity = await loadIdentity(paths);
  if (identity) {
    if (options.stopAfterIdentity) {
      throw new Error('--stop-after-identity requires a fresh per-device state directory without identity.json');
    }
    validatePersistedIdentity(identity, options);
    log('resume', `Using permanent identity ${identity.thingName} (${identity.certificateId})`);
  } else {
    identity = await provisionIdentity(options, paths);
  }

  if (options.expectedThingName && identity.thingName !== options.expectedThingName) {
    throw new Error(`Provisioned Thing ${identity.thingName} does not match expected ${options.expectedThingName}`);
  }

  const signingPublicKeyPem = await readSigningPublicKey(options.signingPublicKey);
  let activeIdentity: PersistedIdentity = identity;
  const operationalCredentials = {
    certificate: paths.certificate,
    privateKey: paths.privateKey,
    ...(options.rootCa ? { rootCa: options.rootCa } : {}),
  };

  await withOperationalConnection(options.endpoint, activeIdentity.thingName, operationalCredentials, async (connection) => {
    log('connected', `Permanent mTLS session established as ${activeIdentity.thingName}`);
    const assignment = await requestAssignment(connection, {
      thingName: activeIdentity.thingName,
      generation: options.generation,
      signingKeyId: options.signingKeyId,
      signingPublicKeyPem,
      timeoutMs: options.responseTimeoutMs,
    });
    log('verified', `Assignment descriptor signature verified for ${assignment.profileVersionId}`);

    activeIdentity = await enrichIdentity(paths, activeIdentity, {
      gatewayId: assignment.gatewayId,
      tenantId: assignment.descriptor.tenantId,
    });
    if (options.stopAfterIdentity) {
      log('identity', 'Permanent mTLS identity authenticated and signed assignment accepted by the control plane');
      log('stopped', 'Identity-transition demo complete; no profile artifacts downloaded or device statuses published');
      // The config response is published before the asynchronous handler records
      // permanent-identity activation. Give that bookkeeping time to commit.
      await delay(options.stepDelayMs);
      return;
    }

    const [profileText, manifestText] = await Promise.all([
      downloadArtifact(assignment.artifacts.profile.url, options.responseTimeoutMs, 'profile'),
      downloadArtifact(assignment.artifacts.manifest.url, options.responseTimeoutMs, 'manifest'),
    ]);
    const artifacts = verifyDownloadedArtifacts(
      assignment,
      profileText,
      manifestText,
      signingPublicKeyPem,
      options.signingKeyId,
    );
    log('verified', `Profile and manifest signatures/checksum verified (${artifacts.checksum})`);

    const nextApplied = {
      generation: assignment.generation,
      profileVersionId: assignment.profileVersionId,
      profileChecksum: artifacts.checksum,
    };
    const previousApplied = await loadAppliedState(paths);
    const disposition = appliedStateDisposition(previousApplied, nextApplied);
    const payloads = statusPayloads(
      assignment.generation,
      assignment.profileVersionId,
      artifacts.checksum,
    );

    if (disposition === 'REACK' && previousApplied) {
      await assertActiveProfile(paths, previousApplied);
      await publishDeviceStatus(connection, activeIdentity.thingName, payloads[2] ?? fail('Missing healthy status payload'));
      log('healthy', `Re-acknowledged generation ${assignment.generation} as APPLIED_HEALTHY`);
      await delay(options.stepDelayMs);
      return;
    }

    await stageVerifiedArtifacts(paths, artifacts);
    log('staged', `Persisted candidate generation ${assignment.generation}`);
    // Let the asynchronous config handler commit PROFILE_DELIVERED before its
    // first device status reaches the status handler.
    await delay(options.stepDelayMs);
    await publishDeviceStatus(connection, activeIdentity.thingName, payloads[0] ?? fail('Missing APPLYING status payload'));
    log('status', 'APPLYING');
    await delay(options.stepDelayMs);

    const applied = await commitAppliedProfile(paths, artifacts);
    await publishDeviceStatus(connection, activeIdentity.thingName, payloads[1] ?? fail('Missing HEALTH_CHECK status payload'));
    log('status', 'HEALTH_CHECK');
    await delay(options.stepDelayMs);

    await assertActiveProfile(paths, applied);
    await publishDeviceStatus(connection, activeIdentity.thingName, payloads[2] ?? fail('Missing APPLIED_HEALTHY status payload'));
    log('healthy', `APPLIED_HEALTHY generation ${assignment.generation}; checksum ${artifacts.checksum}`);
    // QoS 1 confirms broker receipt; this final delay gives the asynchronous IoT
    // Rule/Lambda path time to update the demo UI before disconnecting.
    await delay(options.stepDelayMs);
  });

  log('complete', `Simulator state is stored at ${paths.device}`);
}

async function provisionIdentity(options: Options, paths: ReturnType<typeof statePaths>): Promise<PersistedIdentity> {
  const hardwareProof = await hardwareProofFromFileEnvironmentOrPrompt(options.hardwareProofFile);
  validateHardwareProof(hardwareProof);
  const commonName = `ce-sim-${sha256Hex(options.serialNumber).slice(0, 24)}`;
  const generated = generateOperationalCsr(commonName);
  const staging = await createProvisioningStaging(paths, generated.privateKeyPem);
  log('provision', 'Generated a local RSA-2048 operational key and PKCS#10 CSR');
  const result = await fleetProvision({
    endpoint: options.endpoint,
    templateName: options.templateName,
    serialNumber: options.serialNumber,
    hardwareId: options.hardwareId,
    hardwareProof,
    claimCredentials: {
      certificate: options.claimCertificate,
      privateKey: options.claimPrivateKey,
      ...(options.rootCa ? { rootCa: options.rootCa } : {}),
    },
    csrPem: generated.csrPem,
    persistIssuedCertificate: async (certificatePem) => {
      await stageIssuedCertificate(staging, certificatePem);
    },
    onProgress: logProvisioningProgress,
  });
  // Do not retain the one-time proof in a longer-lived process environment.
  delete process.env.CE_SIM_HARDWARE_PROOF;
  const identity = await commitProvisionedIdentity(paths, staging, {
    endpoint: options.endpoint,
    templateName: options.templateName,
    serialNumber: options.serialNumber,
    hardwareId: options.hardwareId,
    thingName: result.thingName,
    certificateId: result.certificateId,
    createdAt: new Date().toISOString(),
  });
  log('provisioned', `Fleet Provisioning registered ${identity.thingName} (${identity.certificateId})`);
  return identity;
}

function logProvisioningProgress(event: FleetProvisioningProgress): void {
  switch (event.phase) {
    case 'BOOTSTRAP_CONNECTED':
      log('bootstrap', `Temporary trusted-user provisioning claim mTLS session established as ${event.clientId}`);
      return;
    case 'CSR_SUBMITTED':
      log('csr', 'Submitting the locally generated CSR; the operational private key remains local');
      return;
    case 'CERTIFICATE_ISSUED':
      log('issued', `AWS IoT issued operational certificate ${event.certificateId}; protected staging is complete`);
      return;
    case 'REGISTER_THING_ACCEPTED':
      log('registered', `RegisterThing accepted and assigned ${event.thingName}`);
      return;
    case 'BOOTSTRAP_DISCONNECTED':
      log('bootstrap', 'Temporary trusted-user provisioning claim mTLS session disconnected; the ownership token was not persisted');
  }
}

async function downloadArtifact(url: string, timeoutMs: number, label: string): Promise<string> {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Failed to download ${label} artifact: HTTP ${response.status}`);
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 2 * 1024 * 1024) throw new Error(`${label} artifact is too large`);
  const text = await response.text();
  if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error(`${label} artifact is too large`);
  return text;
}

async function readSigningPublicKey(path: string): Promise<string> {
  const value = await readFile(path);
  if (value.toString('utf8').includes('BEGIN PUBLIC KEY')) return value.toString('utf8');
  try {
    return createPublicKey({ key: value, format: 'der', type: 'spki' })
      .export({ format: 'pem', type: 'spki' })
      .toString();
  } catch {
    throw new Error('Signing public key must be a PEM public key or KMS GetPublicKey SPKI DER file');
  }
}

function parseOptions(args: string[]): Options {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(helpText());
    process.exit(0);
  }
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const booleanOptions = new Set(['stop-after-identity']);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token?.startsWith('--')) throw new Error(`Unexpected argument ${token ?? ''}`);
    const separator = token.indexOf('=');
    const name = separator >= 0 ? token.slice(2, separator) : token.slice(2);
    if (booleanOptions.has(name)) {
      if (separator >= 0) throw new Error(`Flag --${name} does not take a value`);
      if (flags.has(name)) throw new Error(`Flag --${name} was specified more than once`);
      flags.add(name);
      continue;
    }
    const value = separator >= 0 ? token.slice(separator + 1) : args[index + 1];
    if (!value || (separator < 0 && value.startsWith('--'))) throw new Error(`Option --${name} requires a value`);
    if (values.has(name)) throw new Error(`Option --${name} was specified more than once`);
    values.set(name, value);
    if (separator < 0) index += 1;
  }
  const known = new Set([
    'endpoint', 'template', 'serial', 'hardware-id', 'generation', 'state-dir', 'claim-cert', 'claim-key',
    'signing-public-key', 'signing-key-id', 'expected-thing-name', 'root-ca', 'step-delay-ms', 'timeout-ms',
    'hardware-proof-file',
  ]);
  for (const name of values.keys()) if (!known.has(name)) throw new Error(`Unknown option --${name}`);

  const endpoint = endpointName(requiredOption(values, 'endpoint', 'CE_SIM_IOT_ENDPOINT'));
  const templateName = safeIdentifier(requiredOption(values, 'template', 'CE_SIM_TEMPLATE_NAME'), 'template name');
  const serialNumber = canonicalSerial(requiredOption(values, 'serial', 'CE_SIM_SERIAL_NUMBER'));
  const hardwareId = safeIdentifier(requiredOption(values, 'hardware-id', 'CE_SIM_HARDWARE_ID'), 'hardware ID');
  const defaultStateDirectory = join(simulatorDirectory, '.state', serialNumber.toLowerCase());
  const stateDirectory = resolve(option(values, 'state-dir', 'CE_SIM_STATE_DIR') ?? defaultStateDirectory);
  const claimCertificate = resolve(option(values, 'claim-cert', 'CE_SIM_CLAIM_CERT') ?? join(stateDirectory, 'claim-certificate.pem'));
  const claimPrivateKey = resolve(option(values, 'claim-key', 'CE_SIM_CLAIM_KEY') ?? join(stateDirectory, 'claim-private-key.pem'));
  const signingPublicKey = resolve(option(values, 'signing-public-key', 'CE_SIM_SIGNING_PUBLIC_KEY') ?? join(stateDirectory, 'profile-signing-public-key.der'));
  const signingKeyId = requiredOption(values, 'signing-key-id', 'CE_SIM_SIGNING_KEY_ID');
  const hardwareProofFileValue = option(values, 'hardware-proof-file', 'CE_SIM_HARDWARE_PROOF_FILE');
  const expectedThingNameValue = option(values, 'expected-thing-name', 'CE_SIM_EXPECTED_THING_NAME');
  const rootCaValue = option(values, 'root-ca', 'CE_SIM_ROOT_CA');
  return {
    endpoint,
    templateName,
    serialNumber,
    hardwareId,
    generation: positiveInteger(option(values, 'generation', 'CE_SIM_GENERATION') ?? '1', 'generation'),
    stateDirectory,
    claimCertificate,
    claimPrivateKey,
    signingPublicKey,
    signingKeyId,
    ...(hardwareProofFileValue ? { hardwareProofFile: resolve(hardwareProofFileValue) } : {}),
    ...(expectedThingNameValue ? { expectedThingName: safeIdentifier(expectedThingNameValue, 'expected Thing name') } : {}),
    ...(rootCaValue ? { rootCa: resolve(rootCaValue) } : {}),
    stopAfterIdentity: flags.has('stop-after-identity'),
    stepDelayMs: boundedInteger(option(values, 'step-delay-ms', 'CE_SIM_STEP_DELAY_MS') ?? '2500', 'step delay', 250, 30_000),
    responseTimeoutMs: boundedInteger(option(values, 'timeout-ms', 'CE_SIM_TIMEOUT_MS') ?? '90000', 'timeout', 5_000, 300_000),
  };
}

function validatePersistedIdentity(identity: PersistedIdentity, options: Options): void {
  if (identity.endpoint !== options.endpoint
    || identity.templateName !== options.templateName
    || identity.serialNumber !== options.serialNumber
    || identity.hardwareId !== options.hardwareId) {
    throw new Error('Persisted permanent identity does not match the requested endpoint/template/device');
  }
}

async function hardwareProofFromFileEnvironmentOrPrompt(path?: string): Promise<string> {
  if (path) {
    const value = await readFile(path, 'utf8');
    if (!value) throw new Error('Hardware proof file is empty');
    if (value !== value.trim()) {
      throw new Error('Hardware proof file must contain only the exact proof with no leading/trailing whitespace or newline');
    }
    return value;
  }
  const fromEnvironment = process.env.CE_SIM_HARDWARE_PROOF;
  if (fromEnvironment) return fromEnvironment;
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Set CE_SIM_HARDWARE_PROOF for first-time provisioning (it is never persisted or logged)');
  }
  process.stdout.write('One-time hardware proof (input hidden): ');
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return await new Promise<string>((resolvePromise, rejectPromise) => {
    let value = '';
    const cleanup = (): void => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(Boolean(wasRaw));
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onData = (chunk: Buffer): void => {
      const text = chunk.toString('utf8');
      if (text.includes('\u0003')) {
        cleanup();
        rejectPromise(new Error('Hardware proof input cancelled'));
        return;
      }
      if (text.includes('\r') || text.includes('\n')) {
        cleanup();
        resolvePromise(value);
        return;
      }
      if (text.includes('\u007f') || text.includes('\b')) {
        value = value.slice(0, -1);
        return;
      }
      value += text;
      if (value.length > 256) {
        cleanup();
        rejectPromise(new Error('Hardware proof is too long'));
      }
    };
    process.stdin.on('data', onData);
  });
}

function validateHardwareProof(value: string): void {
  if (!/^[A-Za-z0-9._:-]{16,256}$/.test(value)) {
    throw new Error('Hardware proof must be 16-256 characters using letters, digits, dot, underscore, colon, or hyphen');
  }
}

function requiredOption(values: Map<string, string>, name: string, environmentName: string): string {
  const value = option(values, name, environmentName);
  if (!value) throw new Error(`Missing --${name} (or ${environmentName})`);
  return value;
}

function option(values: Map<string, string>, name: string, environmentName: string): string | undefined {
  return values.get(name) ?? (process.env[environmentName]?.trim() || undefined);
}

function endpointName(value: string): string {
  const endpoint = value.trim().replace(/^https:\/\//i, '').replace(/\/$/, '');
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(endpoint)) throw new Error('IoT endpoint must be a DNS hostname');
  return endpoint;
}

function canonicalSerial(value: string): string {
  const serial = value.trim().toUpperCase();
  if (serial !== value || !/^[A-Z0-9][A-Z0-9._-]{2,127}$/.test(serial)) {
    throw new Error('Serial number must be canonical uppercase using letters, digits, dot, underscore, or hyphen');
  }
  return serial;
}

function safeIdentifier(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function positiveInteger(value: string, label: string): number {
  return boundedInteger(value, label, 1, Number.MAX_SAFE_INTEGER);
}

function boundedInteger(value: string, label: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return parsed;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function log(stage: string, message: string): void {
  process.stdout.write(`[${new Date().toISOString()}] ${stage.padEnd(11)} ${message}\n`);
}

function helpText(): string {
  return [
    'Connected Enterprise AWS IoT gateway simulator',
    '',
    'Usage:',
    '  npm run sim:gateway -- --endpoint <host> --template <name> --serial <serial> \\',
    '    --hardware-id <id> --state-dir <directory> --signing-key-id <KMS-key-arn> \\',
    '    [--stop-after-identity]',
    '',
    'Value options may also use CE_SIM_* environment variables. The state directory',
    'defaults to tools/gateway-simulator/.state/<serial>. Temporary trusted-user',
    'provisioning claim files default to claim-certificate.pem and claim-private-key.pem',
    'inside that directory. The KMS public key defaults to profile-signing-public-key.der.',
    'A first run reads the hardware proof from --hardware-proof-file,',
    'CE_SIM_HARDWARE_PROOF, or a hidden terminal prompt.',
    '',
    '--stop-after-identity requires fresh device state. It proves the temporary',
    'trusted-user provisioning claim connection, provisions and persists the permanent',
    'identity, reconnects with that identity, verifies the signed assignment, and stops',
    'before artifact download, profile application, or device-status publication.',
    '',
  ].join('\n');
}

function fail(message: string): never {
  throw new Error(message);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Gateway simulator failed: ${message}\n`);
  process.exitCode = 1;
});
