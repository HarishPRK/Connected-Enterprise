import { createPrivateKey, createPublicKey, X509Certificate, timingSafeEqual } from 'node:crypto';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  DescribeCertificateCommand,
  IoTClient,
  ListAttachedPoliciesCommand,
  ListPrincipalThingsV2Command,
} from '@aws-sdk/client-iot';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { requireSafeIdentifier } from '../lambda/shared/identifiers.js';
import { requireCanonicalSerial } from '../lambda/shared/manufacturing-credentials.js';

const CERTIFICATE_ID_PATTERN = /^[a-f0-9]{64}$/i;
const BOOTSTRAP_MECHANISM = 'PRELOADED_UNIQUE_BOOTSTRAP';
const BOOTSTRAP_STATUS = 'ACTIVE';
const args = process.argv.slice(2);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..', '..');
const execFile = promisify(execFileCallback);
let cachedWindowsPrincipal: string | undefined;

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Preloaded bootstrap demo failed: ${message.replace(/[\r\n]+/g, ' ').slice(0, 500)}`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const region = requireRegion(required('--region'));
  const tableName = requireSafeIdentifier(required('--table'), 'table', 255);
  const endpoint = requireEndpoint(required('--endpoint'));
  const templateName = requireSafeIdentifier(required('--template'), 'template');
  const serialNumber = requireCanonicalSerial(required('--serial'));
  const bootstrapCertificateId = requireCertificateId(required('--bootstrap-certificate-id'));
  const bootstrapPolicyName = requireSafeIdentifier(required('--bootstrap-policy'), 'bootstrap-policy', 128);
  const stateDirectory = await validateStateDirectory(required('--state-dir'), serialNumber);
  const bootstrapCertificatePath = requireDirectStateFile(
    resolve(optional('--bootstrap-cert') ?? resolve(stateDirectory, 'bootstrap-certificate.pem')),
    stateDirectory,
    'bootstrap certificate',
  );
  const bootstrapPrivateKeyPath = requireDirectStateFile(
    resolve(optional('--bootstrap-key') ?? resolve(stateDirectory, 'bootstrap-private-key.pem')),
    stateDirectory,
    'bootstrap private key',
  );
  const signingPublicKeyPath = resolve(optional('--signing-public-key') ?? resolve(stateDirectory, 'profile-signing-public-key.der'));
  const signingKeyId = required('--signing-key-id');
  const rootCaPath = optional('--root-ca');

  await assertPathOutsideRepository(bootstrapPrivateKeyPath, 'bootstrap private key');
  const localCertificate = await validateLocalCredentialPair(bootstrapCertificatePath, bootstrapPrivateKeyPath);
  await validateSigningPublicKey(signingPublicKeyPath);
  await assertFreshPermanentState(stateDirectory);

  const iot = new IoTClient({ region });
  const bootstrapCertificateArn = await validateAwsBootstrapCertificate(
    iot,
    bootstrapCertificateId,
    bootstrapPolicyName,
    localCertificate,
  );

  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const manufacturing = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { PK: `SERIAL#${serialNumber}`, SK: 'MANUFACTURING' },
    ConsistentRead: true,
  }));
  const record = manufacturing.Item;
  if (!record || record.entityType !== 'MANUFACTURING') throw new Error('Manufacturing inventory record is unavailable');
  assertEqual(record.serialNumber, serialNumber, 'manufacturing serial');
  assertEqual(record.claimMechanism, BOOTSTRAP_MECHANISM, 'bootstrap mechanism');
  assertEqual(record.bootstrapCertificateId, bootstrapCertificateId, 'bootstrap certificate ID');
  assertEqual(record.bootstrapCertificateArn, bootstrapCertificateArn, 'bootstrap certificate ARN');
  assertEqual(record.bootstrapCertificateStatus, BOOTSTRAP_STATUS, 'bootstrap certificate status');
  assertEqual(record.bootstrapPolicyName, bootstrapPolicyName, 'bootstrap policy');
  if (record.state !== 'ENROLLMENT_PENDING') {
    throw new Error('Finish the onboarding UI through Start secure activation before starting the gateway');
  }

  const tenantId = requireSafeIdentifier(requireString(record.tenantId, 'manufacturing tenantId'), 'manufacturing tenantId');
  const gatewayId = requireSafeIdentifier(requireString(record.gatewayId, 'manufacturing gatewayId'), 'manufacturing gatewayId');
  const operationId = requireSafeIdentifier(requireString(record.operationId, 'manufacturing operationId'), 'manufacturing operationId');
  const thingName = requireSafeIdentifier(requireString(record.thingName, 'manufacturing thingName'), 'manufacturing thingName');
  const siteId = requireSafeIdentifier(requireString(record.siteId, 'manufacturing siteId'), 'manufacturing siteId');
  const profileVersionId = requireSafeIdentifier(
    requireString(record.profileVersionId, 'manufacturing profileVersionId'),
    'manufacturing profileVersionId',
  );
  const deliveryMode = requireDeliveryMode(record.deliveryMode);
  assertEqual(record.demoExpectedProfileVersionId, profileVersionId, 'prepared profile version');
  assertEqual(record.demoExpectedDeliveryMode, deliveryMode, 'prepared delivery mode');
  const verificationId = requireSafeIdentifier(requireString(record.verificationId, 'manufacturing verificationId'), 'manufacturing verificationId');
  const verificationExpiry = requirePositiveInteger(record.verificationExpiresAtEpoch, 'manufacturing verification expiry');
  const generation = requirePositiveInteger(record.generation ?? 1, 'manufacturing generation');
  if (generation !== 1) throw new Error('Initial onboarding must use generation 1');
  if (verificationExpiry <= Math.floor(Date.now() / 1000)) throw new Error('The UI enrollment reservation has expired');

  const tenantKey = `TENANT#${tenantId}`;
  const [gateway, operation, deployment, verification, bootstrapBinding] = await Promise.all([
    ddb.send(new GetCommand({ TableName: tableName, Key: { PK: tenantKey, SK: `GATEWAY#${gatewayId}` }, ConsistentRead: true })),
    ddb.send(new GetCommand({ TableName: tableName, Key: { PK: tenantKey, SK: `OPERATION#${operationId}` }, ConsistentRead: true })),
    ddb.send(new GetCommand({
      TableName: tableName,
      Key: { PK: tenantKey, SK: `DEPLOYMENT#${gatewayId}#${String(generation).padStart(12, '0')}` },
      ConsistentRead: true,
    })),
    ddb.send(new GetCommand({ TableName: tableName, Key: { PK: tenantKey, SK: `VERIFICATION#${verificationId}` }, ConsistentRead: true })),
    ddb.send(new GetCommand({
      TableName: tableName,
      Key: { PK: `BOOTSTRAPCERT#${bootstrapCertificateId}`, SK: 'BINDING' },
      ConsistentRead: true,
    })),
  ]);
  validateEnrollmentState({
    ...(gateway.Item ? { gateway: gateway.Item } : {}),
    ...(operation.Item ? { operation: operation.Item } : {}),
    ...(deployment.Item ? { deployment: deployment.Item } : {}),
    ...(verification.Item ? { verification: verification.Item } : {}),
  }, {
    tenantId, gatewayId, operationId, serialNumber, thingName, siteId, profileVersionId,
    verificationId, verificationExpiry, generation, deliveryMode,
  });
  validateBootstrapBinding(bootstrapBinding.Item, {
    bootstrapCertificateId, bootstrapCertificateArn, serialNumber, tenantId,
  });

  console.log(`Validated UI authorization and unique bootstrap certificate for ${serialNumber}.`);
  console.log(`Starting gateway provisioning against template ${templateName}; no certificate or key contents will be logged.`);
  const exitCode = await spawnSimulator({
    endpoint,
    templateName,
    serialNumber,
    generation,
    stateDirectory,
    bootstrapCertificatePath,
    bootstrapPrivateKeyPath,
    signingPublicKeyPath,
    signingKeyId,
    thingName,
    ...(rootCaPath ? { rootCaPath: resolve(rootCaPath) } : {}),
  });
  if (exitCode !== 0) throw new Error(`Gateway simulator exited with code ${exitCode}`);
  console.log(`Preloaded bootstrap exchange completed for ${thingName}.`);
}

async function spawnSimulator(input: {
  endpoint: string;
  templateName: string;
  serialNumber: string;
  generation: number;
  stateDirectory: string;
  bootstrapCertificatePath: string;
  bootstrapPrivateKeyPath: string;
  signingPublicKeyPath: string;
  signingKeyId: string;
  thingName: string;
  rootCaPath?: string;
}): Promise<number> {
  const tsxCli = resolve(repositoryRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const simulatorEntry = resolve(repositoryRoot, 'tools', 'gateway-simulator', 'src', 'index.ts');
  await Promise.all([requireRegularFile(tsxCli, 'tsx runtime'), requireRegularFile(simulatorEntry, 'simulator entry')]);
  const childArgs = [
    tsxCli,
    simulatorEntry,
    '--endpoint', input.endpoint,
    '--template', input.templateName,
    '--serial', input.serialNumber,
    '--generation', String(input.generation),
    '--state-dir', input.stateDirectory,
    '--bootstrap-cert', input.bootstrapCertificatePath,
    '--bootstrap-key', input.bootstrapPrivateKeyPath,
    '--signing-public-key', input.signingPublicKeyPath,
    '--signing-key-id', input.signingKeyId,
    '--expected-thing-name', input.thingName,
    '--stop-after-identity',
  ];
  if (input.rootCaPath) childArgs.push('--root-ca', input.rootCaPath);
  return await new Promise<number>((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, childArgs, {
      cwd: repositoryRoot,
      env: sanitizedDeviceEnvironment(),
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', rejectPromise);
    child.once('exit', (code) => resolvePromise(code ?? 1));
  });
}

async function validateLocalCredentialPair(certificatePath: string, privateKeyPath: string): Promise<X509Certificate> {
  await Promise.all([
    requireRegularFile(certificatePath, 'bootstrap certificate'),
    requirePrivateFile(privateKeyPath, 'bootstrap private key'),
  ]);
  const certificateValue = await readFile(certificatePath, 'utf8');
  if (/PRIVATE KEY/.test(certificateValue)) throw new Error('Bootstrap certificate file must not contain private key material');
  const certificate = parseCertificate(certificateValue, 'bootstrap certificate');
  const privateKeyValue = await readFile(privateKeyPath);
  try {
    const privateKey = createPrivateKey(privateKeyValue);
    const certificatePublicKey = certificate.publicKey.export({ format: 'der', type: 'spki' });
    const privatePublicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
    if (certificatePublicKey.length !== privatePublicKey.length || !timingSafeEqual(certificatePublicKey, privatePublicKey)) {
      throw new Error('Bootstrap private key does not match the bootstrap certificate');
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('does not match')) throw error;
    throw new Error('Bootstrap private key is invalid', { cause: error });
  } finally {
    privateKeyValue.fill(0);
  }
  return certificate;
}

async function validateSigningPublicKey(path: string): Promise<void> {
  await requireRegularFile(path, 'profile signing public key');
  const value = await readFile(path);
  try {
    if (value.toString('utf8').includes('BEGIN PUBLIC KEY')) createPublicKey(value);
    else createPublicKey({ key: value, format: 'der', type: 'spki' });
  } catch {
    throw new Error('Profile signing public key is invalid');
  }
}

async function validateAwsBootstrapCertificate(
  iot: IoTClient,
  certificateId: string,
  expectedPolicyName: string,
  localCertificate: X509Certificate,
): Promise<string> {
  const description = await iot.send(new DescribeCertificateCommand({ certificateId }));
  const certificate = description.certificateDescription;
  if (!certificate || certificate.certificateId !== certificateId || !certificate.certificateArn || !certificate.certificatePem) {
    throw new Error('AWS IoT returned an incomplete or mismatched bootstrap certificate');
  }
  if (certificate.status !== 'ACTIVE') throw new Error('Bootstrap certificate must still be ACTIVE in AWS IoT');
  const awsCertificate = parseCertificate(certificate.certificatePem, 'AWS IoT bootstrap certificate');
  if (localCertificate.raw.length !== awsCertificate.raw.length || !timingSafeEqual(localCertificate.raw, awsCertificate.raw)) {
    throw new Error('Local bootstrap certificate does not match the bound AWS IoT certificate ID');
  }
  const now = Date.now();
  if (new Date(localCertificate.validFrom).getTime() > now || new Date(localCertificate.validTo).getTime() <= now) {
    throw new Error('Bootstrap certificate is outside its validity period');
  }
  const policies = await listAttachedPolicies(iot, certificate.certificateArn);
  if (policies.length !== 1 || policies[0] !== expectedPolicyName) {
    throw new Error(`Bootstrap certificate must have only the ${expectedPolicyName} policy attached`);
  }
  const things = await listPrincipalThings(iot, certificate.certificateArn);
  if (things.length > 0) throw new Error('Bootstrap certificate is already attached to an AWS IoT Thing');
  return certificate.certificateArn;
}

async function listAttachedPolicies(iot: IoTClient, target: string): Promise<string[]> {
  const result: string[] = [];
  let marker: string | undefined;
  do {
    const page = await iot.send(new ListAttachedPoliciesCommand({ target, marker, pageSize: 100 }));
    for (const policy of page.policies ?? []) if (policy.policyName) result.push(policy.policyName);
    marker = page.nextMarker;
  } while (marker);
  return result.sort();
}

async function listPrincipalThings(iot: IoTClient, principal: string): Promise<string[]> {
  const result: string[] = [];
  let nextToken: string | undefined;
  do {
    const page = await iot.send(new ListPrincipalThingsV2Command({ principal, nextToken, maxResults: 250 }));
    for (const thing of page.principalThingObjects ?? []) if (thing.thingName) result.push(thing.thingName);
    nextToken = page.nextToken;
  } while (nextToken);
  return result;
}

function validateEnrollmentState(
  records: {
    gateway?: Record<string, unknown>;
    operation?: Record<string, unknown>;
    deployment?: Record<string, unknown>;
    verification?: Record<string, unknown>;
  },
  expected: {
    tenantId: string;
    gatewayId: string;
    operationId: string;
    serialNumber: string;
    thingName: string;
    siteId: string;
    profileVersionId: string;
    verificationId: string;
    verificationExpiry: number;
    generation: number;
    deliveryMode: 'SHADOW';
  },
): void {
  const gateway = records.gateway;
  if (!gateway || gateway.entityType !== 'GATEWAY' || gateway.state !== 'PENDING' || gateway.certificateState !== 'PENDING') {
    throw new Error('Gateway record is not waiting for its initial identity');
  }
  assertCommon(gateway, expected, ['tenantId', 'gatewayId', 'operationId', 'serialNumber', 'thingName', 'siteId']);
  assertEqual(gateway.desiredProfileVersionId, expected.profileVersionId, 'gateway desired profile');
  assertEqual(gateway.desiredGeneration, expected.generation, 'gateway desired generation');

  const operation = records.operation;
  if (!operation || operation.entityType !== 'OPERATION' || operation.type !== 'ONBOARD'
    || operation.operationStatus !== 'IN_PROGRESS' || operation.state !== 'CLAIM_ACCEPTED'
    || operation.status !== 'WAITING_FOR_DEVICE') {
    throw new Error('Onboarding operation is not waiting for the gateway');
  }
  assertCommon(operation, expected, ['tenantId', 'gatewayId', 'operationId', 'serialNumber', 'siteId', 'profileVersionId']);
  assertEqual(operation.deploymentGeneration, expected.generation, 'operation generation');
  assertEqual(operation.deliveryMode, expected.deliveryMode, 'operation delivery mode');

  const deployment = records.deployment;
  if (!deployment || deployment.entityType !== 'DEPLOYMENT' || deployment.status !== 'WAITING_FOR_DEVICE') {
    throw new Error('Initial deployment is not waiting for the gateway');
  }
  assertCommon(deployment, expected, ['tenantId', 'gatewayId', 'operationId', 'profileVersionId', 'generation']);
  assertEqual(deployment.deliveryMode, expected.deliveryMode, 'deployment delivery mode');

  const verification = records.verification;
  if (!verification || verification.entityType !== 'VERIFICATION' || verification.state !== 'CONSUMED') {
    throw new Error('UI verification was not consumed by the activation operation');
  }
  assertCommon(verification, expected, ['tenantId', 'verificationId', 'serialNumber']);
  assertEqual(verification.expiresAtEpoch, expected.verificationExpiry, 'verification expiry');
}

function validateBootstrapBinding(
  binding: Record<string, unknown> | undefined,
  expected: { bootstrapCertificateId: string; bootstrapCertificateArn: string; serialNumber: string; tenantId: string },
): void {
  if (!binding || binding.entityType !== 'BOOTSTRAP_CERTIFICATE_BINDING') {
    throw new Error('Authoritative bootstrap certificate binding is unavailable');
  }
  assertEqual(binding.bootstrapCertificateId, expected.bootstrapCertificateId, 'binding certificate ID');
  assertEqual(binding.certificateArn, expected.bootstrapCertificateArn, 'binding certificate ARN');
  assertEqual(binding.serialNumber, expected.serialNumber, 'binding serial');
  assertEqual(binding.tenantId, expected.tenantId, 'binding tenant');
  assertEqual(binding.status, BOOTSTRAP_STATUS, 'binding status');
}

function assertCommon(actual: Record<string, unknown>, expected: Record<string, unknown>, fields: string[]): void {
  for (const field of fields) assertEqual(actual[field], expected[field], field);
}

async function assertFreshPermanentState(stateDirectory: string): Promise<void> {
  for (const file of ['identity.json', 'device-certificate.pem', 'device-private-key.pem']) {
    try {
      await lstat(resolve(stateDirectory, file));
      throw new Error(`${file} already exists; use a fresh simulator identity or the recovery workflow`);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') continue;
      throw error;
    }
  }
}

async function requireRegularFile(path: string, label: string): Promise<void> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
}

async function requirePrivateFile(path: string, label: string): Promise<void> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error(`${label} must not be readable or writable by group/other users`);
  }
  if (process.platform === 'win32') await assertWindowsPrivateAcl(path, label);
}

async function validateStateDirectory(value: string, serialNumber: string): Promise<string> {
  const target = await realpath(resolve(value));
  if (basename(target).toLowerCase() !== serialNumber.toLowerCase()) {
    throw new Error(`State directory must end with ${serialNumber}`);
  }
  await assertPathOutsideRepository(target, 'simulator state directory');
  if (process.platform === 'win32') await assertWindowsPrivateAcl(target, 'simulator state directory');
  return target;
}

async function assertWindowsPrivateAcl(path: string, label: string): Promise<void> {
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot) throw new Error(`Unable to validate ${label} Windows ACL`);
  const windowsPowerShellModulePath = resolve(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules');
  const aclScript = [
    "$ErrorActionPreference = 'Stop'",
    '$items = (Get-Acl -LiteralPath $env:CE_BOOTSTRAP_ACL_TARGET).Access | ForEach-Object {',
    '[pscustomobject]@{ Identity = $_.IdentityReference.Value; Type = $_.AccessControlType.ToString(); Rights = $_.FileSystemRights.ToString() }',
    '}',
    '$items | ConvertTo-Json -Compress',
  ].join('\n');
  const { stdout } = await execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(aclScript, 'utf16le').toString('base64')],
    {
      windowsHide: true,
      env: {
        ...process.env,
        PSModulePath: windowsPowerShellModulePath,
        CE_BOOTSTRAP_ACL_TARGET: path,
      },
    },
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim() || '[]') as unknown;
  } catch {
    throw new Error(`Unable to validate ${label} Windows ACL`);
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const currentPrincipal = await currentWindowsPrincipal();
  const allowed = new Set([
    currentPrincipal.toLowerCase(),
    'nt authority\\system',
    'builtin\\administrators',
  ]);
  let currentUserAllowed = false;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') throw new Error(`Unable to validate ${label} Windows ACL`);
    const candidate = entry as Record<string, unknown>;
    if (candidate.Type !== 'Allow') continue;
    const identity = typeof candidate.Identity === 'string' ? candidate.Identity.toLowerCase() : '';
    if (!allowed.has(identity)) throw new Error(`${label} grants access to an unauthorized Windows principal`);
    if (identity === currentPrincipal.toLowerCase()) currentUserAllowed = true;
  }
  if (!currentUserAllowed) throw new Error(`${label} does not grant the current Windows user access`);
}

async function currentWindowsPrincipal(): Promise<string> {
  if (cachedWindowsPrincipal) return cachedWindowsPrincipal;
  const { stdout } = await execFile('whoami.exe', [], { windowsHide: true });
  const principal = stdout.trim();
  if (!principal || !principal.includes('\\')) throw new Error('Unable to resolve the current Windows principal');
  cachedWindowsPrincipal = principal;
  return principal;
}

async function assertPathOutsideRepository(path: string, label: string): Promise<void> {
  const [repositoryRealPath, targetRealPath] = await Promise.all([realpath(repositoryRoot), realpath(path)]);
  if (isContainedBy(repositoryRealPath, targetRealPath)) throw new Error(`${label} must be outside the repository`);
}

function isContainedBy(parent: string, candidate: string): boolean {
  const fromParent = relative(parent, candidate);
  return fromParent === '' || (fromParent !== '..' && !fromParent.startsWith(`..${sep}`) && !isAbsolute(fromParent));
}

function requireDirectStateFile(path: string, stateDirectory: string, label: string): string {
  const child = relative(stateDirectory, path);
  if (!child || isAbsolute(child) || child.startsWith('..') || dirname(child) !== '.') {
    throw new Error(`${label} must be a file directly inside the per-device state directory`);
  }
  return path;
}

function sanitizedDeviceEnvironment(): NodeJS.ProcessEnv {
  const allowed = new Set([
    'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA',
    'USERPROFILE', 'USERNAME', 'USERDOMAIN', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)',
    'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS', 'HOME', 'TMPDIR', 'LD_LIBRARY_PATH',
  ]);
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && allowed.has(key.toUpperCase())) result[key] = value;
  }
  return result;
}

function parseCertificate(value: string, label: string): X509Certificate {
  try {
    return new X509Certificate(value);
  } catch {
    throw new Error(`${label} is not a valid X.509 certificate`);
  }
}

function required(name: string): string {
  const index = args.indexOf(name);
  const value = args[index + 1];
  if (index < 0 || !value || value.startsWith('--')) throw new Error(`Missing ${name}`);
  return value;
}

function optional(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
  return value;
}

function requireCertificateId(value: string): string {
  if (!CERTIFICATE_ID_PATTERN.test(value)) throw new Error('bootstrap-certificate-id must be a 64-character hexadecimal ID');
  return value.toLowerCase();
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Missing ${label}`);
  return value;
}

function requirePositiveInteger(value: unknown, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`Missing or invalid ${label}`);
  return result;
}

function requireDeliveryMode(value: unknown): 'SHADOW' {
  if (value !== 'SHADOW') throw new Error('Initial onboarding delivery mode must be SHADOW');
  return value;
}

function requireRegion(value: string): string {
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(value)) throw new Error('region is invalid');
  return value;
}

function requireEndpoint(value: string): string {
  const endpoint = value.trim().replace(/^https:\/\//i, '').replace(/\/$/, '');
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(endpoint)) throw new Error('endpoint must be a DNS hostname');
  return endpoint;
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label} does not match the authorized enrollment`);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value;
}
