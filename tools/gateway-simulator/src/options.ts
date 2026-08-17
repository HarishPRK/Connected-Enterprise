import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Options {
  endpoint: string;
  templateName: string;
  serialNumber: string;
  generation: number;
  stateDirectory: string;
  bootstrapCertificate: string;
  bootstrapPrivateKey: string;
  signingPublicKey: string;
  signingKeyId: string;
  expectedThingName?: string;
  rootCa?: string;
  stopAfterIdentity: boolean;
  stepDelayMs: number;
  responseTimeoutMs: number;
}

export function parseOptions(
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
  simulatorDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
): Options {
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
    'endpoint', 'template', 'serial', 'generation', 'state-dir', 'bootstrap-cert', 'bootstrap-key',
    'signing-public-key', 'signing-key-id', 'expected-thing-name', 'root-ca', 'step-delay-ms', 'timeout-ms',
  ]);
  for (const name of values.keys()) if (!known.has(name)) throw new Error(`Unknown option --${name}`);

  const endpoint = endpointName(requiredOption(values, 'endpoint', 'CE_SIM_IOT_ENDPOINT', environment));
  const templateName = safeIdentifier(
    requiredOption(values, 'template', 'CE_SIM_TEMPLATE_NAME', environment),
    'template name',
  );
  const serialNumber = canonicalSerial(requiredOption(values, 'serial', 'CE_SIM_SERIAL_NUMBER', environment));
  const defaultStateDirectory = join(simulatorDirectory, '.state', serialNumber.toLowerCase());
  const stateDirectory = resolve(option(values, 'state-dir', 'CE_SIM_STATE_DIR', environment) ?? defaultStateDirectory);
  const bootstrapCertificate = credentialPath(
    option(values, 'bootstrap-cert', 'CE_SIM_BOOTSTRAP_CERT', environment)
      ?? join(stateDirectory, 'bootstrap-certificate.pem'),
    stateDirectory,
    'bootstrap certificate',
  );
  const bootstrapPrivateKey = credentialPath(
    option(values, 'bootstrap-key', 'CE_SIM_BOOTSTRAP_KEY', environment)
      ?? join(stateDirectory, 'bootstrap-private-key.pem'),
    stateDirectory,
    'bootstrap private key',
  );
  if (samePath(bootstrapCertificate, bootstrapPrivateKey)) {
    throw new Error('Bootstrap certificate and private key must be different files');
  }
  const signingPublicKey = resolve(
    option(values, 'signing-public-key', 'CE_SIM_SIGNING_PUBLIC_KEY', environment)
      ?? join(stateDirectory, 'profile-signing-public-key.der'),
  );
  const signingKeyId = requiredOption(values, 'signing-key-id', 'CE_SIM_SIGNING_KEY_ID', environment);
  const expectedThingNameValue = option(values, 'expected-thing-name', 'CE_SIM_EXPECTED_THING_NAME', environment);
  const rootCaValue = option(values, 'root-ca', 'CE_SIM_ROOT_CA', environment);
  const rootCa = rootCaValue ? resolve(rootCaValue) : undefined;
  if (samePath(bootstrapCertificate, signingPublicKey)
    || samePath(bootstrapPrivateKey, signingPublicKey)
    || (rootCa && (samePath(bootstrapCertificate, rootCa) || samePath(bootstrapPrivateKey, rootCa)))) {
    throw new Error('Bootstrap credentials must not overlap another persistent simulator credential');
  }
  return {
    endpoint,
    templateName,
    serialNumber,
    generation: positiveInteger(option(values, 'generation', 'CE_SIM_GENERATION', environment) ?? '1', 'generation'),
    stateDirectory,
    bootstrapCertificate,
    bootstrapPrivateKey,
    signingPublicKey,
    signingKeyId,
    ...(expectedThingNameValue ? { expectedThingName: safeIdentifier(expectedThingNameValue, 'expected Thing name') } : {}),
    ...(rootCa ? { rootCa } : {}),
    stopAfterIdentity: flags.has('stop-after-identity'),
    stepDelayMs: boundedInteger(
      option(values, 'step-delay-ms', 'CE_SIM_STEP_DELAY_MS', environment) ?? '2500',
      'step delay',
      250,
      30_000,
    ),
    responseTimeoutMs: boundedInteger(
      option(values, 'timeout-ms', 'CE_SIM_TIMEOUT_MS', environment) ?? '90000',
      'timeout',
      5_000,
      300_000,
    ),
  };
}

export function helpText(): string {
  return [
    'Connected Enterprise AWS IoT gateway simulator',
    '',
    'Usage:',
    '  npm run sim:gateway -- --endpoint <host> --template <name> --serial <serial> \\',
    '    --state-dir <directory> --signing-key-id <KMS-key-arn> \\',
    '    [--bootstrap-cert <path> --bootstrap-key <path>] [--stop-after-identity]',
    '',
    'Value options may also use CE_SIM_* environment variables. The state directory',
    'defaults to tools/gateway-simulator/.state/<serial>. A fresh device state must',
    'contain its unique pre-flashed bootstrap-certificate.pem and bootstrap-private-key.pem.',
    'Explicit paths may use --bootstrap-cert/CE_SIM_BOOTSTRAP_CERT and',
    '--bootstrap-key/CE_SIM_BOOTSTRAP_KEY, but both must be files directly inside the',
    'per-device state directory. The KMS public key defaults to',
    'profile-signing-public-key.der. RegisterThing sends only the canonical serial.',
    '',
    '--stop-after-identity requires fresh device state. It proves the pre-flashed',
    'bootstrap connection, provisions and persists the permanent identity, reconnects',
    'with that identity, verifies the signed assignment, retires the bootstrap pair,',
    'and stops before artifact download, profile application, or status publication.',
    '',
  ].join('\n');
}

function requiredOption(
  values: Map<string, string>,
  name: string,
  environmentName: string,
  environment: NodeJS.ProcessEnv,
): string {
  const value = option(values, name, environmentName, environment);
  if (!value) throw new Error(`Missing --${name} (or ${environmentName})`);
  return value;
}

function option(
  values: Map<string, string>,
  name: string,
  environmentName: string,
  environment: NodeJS.ProcessEnv,
): string | undefined {
  return values.get(name) ?? (environment[environmentName]?.trim() || undefined);
}

function credentialPath(value: string, stateDirectory: string, label: string): string {
  const path = resolve(value);
  const child = relative(stateDirectory, path);
  if (!child || isAbsolute(child) || child.startsWith('..') || dirname(child) !== '.') {
    throw new Error(`${label} must be a file directly inside the per-device state directory`);
  }
  const fileName = basename(path).toLowerCase();
  if (!fileName.endsWith('.pem') || fileName === 'device-certificate.pem' || fileName === 'device-private-key.pem') {
    throw new Error(`${label} must use a dedicated .pem file that is not an operational credential path`);
  }
  return path;
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
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
