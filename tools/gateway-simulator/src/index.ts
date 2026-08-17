import { createPublicKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { generateOperationalCsr } from './csr.js';
import {
  fleetProvision,
  publishDeviceStatus,
  requestAssignment,
  withOperationalConnection,
  type FleetProvisioningProgress,
} from './mqtt.js';
import { helpText, parseOptions, type Options } from './options.js';
import {
  appliedStateDisposition,
  sha256Hex,
  statusPayloads,
  verifyDownloadedArtifacts,
} from './protocol.js';
import {
  assertBootstrapCredentials,
  assertActiveProfile,
  commitAppliedProfile,
  commitProvisionedIdentity,
  createProvisioningStaging,
  enrichIdentity,
  initializeState,
  loadAppliedState,
  loadIdentity,
  retireBootstrapCredentials,
  stageIssuedCertificate,
  stageVerifiedArtifacts,
  statePaths,
  type PersistedIdentity,
} from './state.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(helpText());
    return;
  }
  const options = parseOptions(args);
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
    if (await retireBootstrapCredentials(paths, {
      certificate: options.bootstrapCertificate,
      privateKey: options.bootstrapPrivateKey,
    })) {
      log('bootstrap', 'Pre-flashed bootstrap credentials retired after permanent identity and configuration verification');
    }
    if (options.stopAfterIdentity) {
      log('identity', 'Permanent mTLS identity authenticated and signed assignment accepted by the control plane');
      log('stopped', 'Bootstrap-to-operational identity transition complete; no profile artifacts downloaded or device statuses published');
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
  const bootstrapCredentials = {
    certificate: options.bootstrapCertificate,
    privateKey: options.bootstrapPrivateKey,
  };
  await assertBootstrapCredentials(paths, bootstrapCredentials);
  const commonName = `ce-sim-${sha256Hex(options.serialNumber).slice(0, 24)}`;
  const generated = generateOperationalCsr(commonName);
  const staging = await createProvisioningStaging(paths, generated.privateKeyPem);
  log('provision', 'Generated a local RSA-2048 operational key and PKCS#10 CSR');
  const result = await fleetProvision({
    endpoint: options.endpoint,
    templateName: options.templateName,
    serialNumber: options.serialNumber,
    bootstrapCredentials: {
      ...bootstrapCredentials,
      ...(options.rootCa ? { rootCa: options.rootCa } : {}),
    },
    csrPem: generated.csrPem,
    persistIssuedCertificate: async (certificatePem) => {
      await stageIssuedCertificate(staging, certificatePem);
    },
    onProgress: logProvisioningProgress,
  });
  const identity = await commitProvisionedIdentity(paths, staging, {
    endpoint: options.endpoint,
    templateName: options.templateName,
    serialNumber: options.serialNumber,
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
      log('bootstrap', `Unique pre-flashed bootstrap mTLS session established as ${event.clientId}`);
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
      log('bootstrap', 'Pre-flashed bootstrap mTLS session disconnected; the ownership token was not persisted');
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

function validatePersistedIdentity(identity: PersistedIdentity, options: Options): void {
  if (identity.endpoint !== options.endpoint
    || identity.templateName !== options.templateName
    || identity.serialNumber !== options.serialNumber) {
    throw new Error('Persisted permanent identity does not match the requested endpoint/template/device');
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function log(stage: string, message: string): void {
  process.stdout.write(`[${new Date().toISOString()}] ${stage.padEnd(11)} ${message}\n`);
}

function fail(message: string): never {
  throw new Error(message);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Gateway simulator failed: ${message}\n`);
  process.exitCode = 1;
});
