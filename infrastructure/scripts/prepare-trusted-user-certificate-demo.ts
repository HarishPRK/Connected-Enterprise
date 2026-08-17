import { createHmac, createPublicKey, randomBytes } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { access, chmod, mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetPublicKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { requireSafeIdentifier } from '../lambda/shared/identifiers.js';
import {
  HARDWARE_PROOF_KEY_VERSION,
  HARDWARE_PROOF_SCHEME,
  requireActivationCode,
  requireCanonicalSerial,
  requireHardwareId,
} from '../lambda/shared/manufacturing-credentials.js';

const TRUSTED_USER_PENDING = 'TRUSTED_USER_PENDING';
const execFile = promisify(execFileCallback);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..', '..');

const args = process.argv.slice(2);
const required = (name: string): string => {
  const index = args.indexOf(name);
  const value = args[index + 1];
  if (index < 0 || !value || value.startsWith('--')) throw new Error(`Missing ${name}`);
  return value;
};
const apply = args.includes('--apply');
const region = requireRegion(required('--region'));
const tableName = requireSafeIdentifier(required('--table'), 'table', 255);
const secretArn = requiredText(required('--secret-arn'), 'secret-arn', 2048);
const signingKeyId = requiredText(required('--signing-key-id'), 'signing-key-id', 2048);
const endpoint = requireEndpoint(required('--endpoint'));
const templateName = requireSafeIdentifier(required('--template'), 'template');
const tenantId = requireSafeIdentifier(required('--tenant-id'), 'tenant-id');
const serialNumber = requireCanonicalSerial(required('--serial'));
const hardwareId = requireHardwareId(required('--hardware-id'));
const modelId = requireSafeIdentifier(required('--model-id'), 'model-id');
const siteId = requireSafeIdentifier(required('--site-id'), 'site-id');
const profileVersionId = requireSafeIdentifier(required('--profile-version-id'), 'profile-version-id');
const deliveryMode = requireDeliveryMode(required('--delivery-mode'));
const hardwareRevision = requiredText(required('--hardware-revision'), 'hardware-revision', 128);
const manufacturingBatch = requiredText(required('--manufacturing-batch'), 'manufacturing-batch', 128);
const stateDirectory = await validateStateDirectory(required('--state-dir'), serialNumber);

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
  marshallOptions: { removeUndefinedValues: true },
});
const tenantKey = `TENANT#${tenantId}`;
const [existing, tenant, site, model, profile] = await Promise.all([
  ddb.send(new GetCommand({
    TableName: tableName,
    Key: { PK: `SERIAL#${serialNumber}`, SK: 'MANUFACTURING' },
    ConsistentRead: true,
  })),
  ddb.send(new GetCommand({ TableName: tableName, Key: { PK: tenantKey, SK: 'METADATA' }, ConsistentRead: true })),
  ddb.send(new GetCommand({ TableName: tableName, Key: { PK: tenantKey, SK: `SITE#${siteId}` }, ConsistentRead: true })),
  ddb.send(new GetCommand({ TableName: tableName, Key: { PK: tenantKey, SK: `MODEL#${modelId}` }, ConsistentRead: true })),
  ddb.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'GSI2',
    KeyConditionExpression: 'GSI2PK = :profile AND GSI2SK = :tenant',
    ExpressionAttributeValues: { ':profile': `PROFILEVERSION#${profileVersionId}`, ':tenant': tenantKey },
    Limit: 1,
  })),
]);
if (existing.Item) throw new Error(`Manufacturing identity ${serialNumber} already exists`);
if (await exists(stateDirectory)) throw new Error(`Demo state directory already exists: ${stateDirectory}`);
if (tenant.Item?.entityType !== 'TENANT' || tenant.Item.tenantId !== tenantId) throw new Error(`Tenant ${tenantId} is unavailable`);
if (site.Item?.entityType !== 'SITE' || site.Item.tenantId !== tenantId || site.Item.siteId !== siteId) {
  throw new Error(`Site ${siteId} is unavailable for tenant ${tenantId}`);
}
if (model.Item?.entityType !== 'GATEWAY_MODEL' || model.Item.tenantId !== tenantId || model.Item.modelId !== modelId) {
  throw new Error(`Gateway model ${modelId} is unavailable for tenant ${tenantId}`);
}
const profileItem = profile.Items?.[0];
if (!profileItem || profileItem.entityType !== 'PROFILE_VERSION' || profileItem.tenantId !== tenantId
  || profileItem.profileVersionId !== profileVersionId || profileItem.modelId !== modelId) {
  throw new Error(`Profile version ${profileVersionId} is unavailable or incompatible with ${modelId}`);
}

if (!apply) {
  console.log(`Validated fresh trusted-user demo identity ${serialNumber}; re-run with --apply to create it.`);
  process.exit(0);
}

const activationCode = requireActivationCode(`TU-${randomBytes(32).toString('hex')}`);
const [secretResult, keyResult] = await Promise.all([
  new SecretsManagerClient({ region }).send(new GetSecretValueCommand({ SecretId: secretArn })),
  new KMSClient({ region }).send(new GetPublicKeyCommand({ KeyId: signingKeyId })),
]);
const rawSecret = secretResult.SecretString
  ?? (secretResult.SecretBinary ? Buffer.from(secretResult.SecretBinary).toString('utf8') : '');
if (!rawSecret) throw new Error('Hardware proof pepper secret is empty');
const secretDocument = JSON.parse(rawSecret) as { pepper?: unknown };
if (typeof secretDocument.pepper !== 'string' || secretDocument.pepper.length < 32) {
  throw new Error('Hardware proof pepper is missing or too short');
}
if (!keyResult.PublicKey?.byteLength) throw new Error('KMS signing public key is unavailable');
try {
  createPublicKey({ key: Buffer.from(keyResult.PublicKey), format: 'der', type: 'spki' });
} catch {
  throw new Error('KMS signing public key is not valid SPKI DER');
}
const hardwareProofDigest = createHmac('sha256', Buffer.from(secretDocument.pepper, 'utf8'))
  .update(serialNumber)
  .update('\0')
  .update(activationCode)
  .digest('hex');

let createdStateDirectory = false;
try {
  await mkdir(stateDirectory, { recursive: false, mode: 0o700 });
  createdStateDirectory = true;
  await makePrivate(stateDirectory, true);
  const metadata = {
    version: 2,
    mechanism: 'AWS_IOT_TRUSTED_USER_FIVE_MINUTE_CLAIM',
    region,
    tableName,
    tenantId,
    serialNumber,
    hardwareId,
    modelId,
    siteId,
    profileVersionId,
    deliveryMode,
    hardwareRevision,
    manufacturingBatch,
    endpoint,
    templateName,
    signingKeyId,
    generation: 1,
    claimPlaceholder: TRUSTED_USER_PENDING,
    createdAt: new Date().toISOString(),
  };
  await Promise.all([
    writeFile(resolve(stateDirectory, 'activation-code.txt'), activationCode, { flag: 'wx', mode: 0o600 }),
    writeFile(resolve(stateDirectory, 'profile-signing-public-key.der'), keyResult.PublicKey, { flag: 'wx', mode: 0o600 }),
    writeFile(resolve(stateDirectory, 'trusted-user-demo.json'), `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx', mode: 0o600 }),
  ]);
  await makePrivate(stateDirectory, true);

  const now = new Date().toISOString();
  await ddb.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `SERIAL#${serialNumber}`,
      SK: 'MANUFACTURING',
      entityType: 'MANUFACTURING',
      serialNumber,
      tenantId,
      modelId,
      hardwareId,
      hardwareRevision,
      manufacturingBatch,
      allowedSiteIds: [siteId],
      demoExpectedProfileVersionId: profileVersionId,
      demoExpectedDeliveryMode: deliveryMode,
      claimCertificateId: TRUSTED_USER_PENDING,
      claimMechanism: 'TRUSTED_USER_FIVE_MINUTE',
      hardwareProofDigest,
      credentialScheme: HARDWARE_PROOF_SCHEME,
      credentialKeyVersion: HARDWARE_PROOF_KEY_VERSION,
      state: 'CLAIMABLE',
      createdAt: now,
      updatedAt: now,
    },
    ConditionExpression: 'attribute_not_exists(PK)',
  }));
} catch (error) {
  if (createdStateDirectory) await rm(stateDirectory, { recursive: true, force: true });
  throw error;
}

console.log(`Prepared ${serialNumber} for AWS IoT trusted-user certificate handoff.`);
console.log(`Activation code (not printed) is stored at ${resolve(stateDirectory, 'activation-code.txt')}`);
console.log('The temporary provisioning certificate is intentionally not created until the UI operation is ENROLLMENT_PENDING.');

function requiredText(value: string, label: string, maxLength: number): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) throw new Error(`${label} is required and must be at most ${maxLength} characters`);
  return trimmed;
}

function requireRegion(value: string): string {
  const region = value.trim();
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region)) throw new Error('region is invalid');
  return region;
}

function requireEndpoint(value: string): string {
  const endpointName = value.trim().replace(/^https:\/\//i, '').replace(/\/$/, '');
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(endpointName)) throw new Error('endpoint must be a DNS hostname');
  return endpointName;
}

function requireDeliveryMode(value: string): 'SHADOW' {
  if (value !== 'SHADOW') throw new Error('delivery-mode must be SHADOW for the certificate-handoff demo');
  return value;
}

async function validateStateDirectory(value: string, serial: string): Promise<string> {
  const target = resolve(value);
  if (basename(target).toLowerCase() !== serial.toLowerCase()) {
    throw new Error(`State directory must end with the lowercase or canonical serial ${serial}`);
  }
  const [repositoryRealPath, parentRealPath] = await Promise.all([
    realpath(repositoryRoot),
    realpath(dirname(target)).catch(() => { throw new Error('State-directory parent must already exist'); }),
  ]);
  const candidate = resolve(parentRealPath, basename(target));
  if (isContainedBy(repositoryRealPath, candidate)) throw new Error('Trusted-user demo state must be stored outside the repository');
  return candidate;
}

function isContainedBy(parent: string, candidate: string): boolean {
  const fromParent = relative(parent, candidate);
  return fromParent === '' || (fromParent !== '..' && !fromParent.startsWith(`..${sep}`) && !isAbsolute(fromParent));
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function makePrivate(path: string, recursive: boolean): Promise<void> {
  await chmod(path, path === stateDirectory ? 0o700 : 0o600).catch((error: unknown) => {
    if (process.platform !== 'win32') throw error;
  });
  if (process.platform !== 'win32') return;
  const principal = await currentWindowsPrincipal();
  await protectWindowsPath(path, `${principal}:(OI)(CI)F`, principal);
  if (!recursive) return;
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error('Demo credential directory must not contain symbolic links');
    const child = resolve(path, entry.name);
    await protectWindowsPath(child, entry.isDirectory() ? `${principal}:(OI)(CI)F` : `${principal}:F`, principal);
  }
}

async function protectWindowsPath(path: string, grant: string, principal: string): Promise<void> {
  const result = await execFile('icacls.exe', [path, '/inheritance:r', '/grant:r', grant], { windowsHide: true });
  if (/failed processing\s+[1-9]/i.test(`${result.stdout}\n${result.stderr}`)) throw new Error('Failed to protect demo credential files');
  const verification = await execFile('icacls.exe', [path], { windowsHide: true });
  if (!verification.stdout.toLowerCase().includes(principal.toLowerCase())) throw new Error('Demo credential ACL verification failed');
}

async function currentWindowsPrincipal(): Promise<string> {
  const result = await execFile('whoami.exe', [], { windowsHide: true });
  const principal = result.stdout.trim();
  if (!principal || !principal.includes('\\')) throw new Error('Unable to resolve the current Windows principal');
  return principal;
}
