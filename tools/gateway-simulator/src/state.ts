import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { AppliedState, VerifiedArtifacts } from './protocol.js';
import { isRecord, parseJsonObject } from './protocol.js';

const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;

export interface PersistedIdentity {
  version: 1 | 2;
  endpoint: string;
  templateName: string;
  serialNumber: string;
  hardwareId?: string;
  thingName: string;
  certificateId: string;
  certificateFile: string;
  privateKeyFile: string;
  createdAt: string;
  gatewayId?: string;
  tenantId?: string;
}

export interface SimulatorStatePaths {
  root: string;
  device: string;
  identity: string;
  certificate: string;
  privateKey: string;
  activeProfile: string;
  activeManifest: string;
  applied: string;
  profileDirectory: string;
}

export function statePaths(root: string, serialNumber: string): SimulatorStatePaths {
  if (!serialNumber.trim()) throw new Error('Serial number is required for simulator state');
  // --state-dir is the exact per-device directory. The unique, pre-flashed
  // bootstrap credential pair lives beside the generated operational state.
  const device = resolve(root);
  return {
    root: device,
    device,
    identity: join(device, 'identity.json'),
    certificate: join(device, 'device-certificate.pem'),
    privateKey: join(device, 'device-private-key.pem'),
    activeProfile: join(device, 'active-profile.json'),
    activeManifest: join(device, 'active-manifest.json'),
    applied: join(device, 'applied.json'),
    profileDirectory: join(device, 'profiles'),
  };
}

export async function initializeState(paths: SimulatorStatePaths): Promise<void> {
  await mkdir(paths.root, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await mkdir(paths.device, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await mkdir(paths.profileDirectory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await makePrivate(paths.root);
  await makePrivate(paths.device);
  await makePrivate(paths.profileDirectory);
}

export interface BootstrapCredentialPaths {
  certificate: string;
  privateKey: string;
}

/** Validates the unique pre-flashed bootstrap credential pair without copying it. */
export async function assertBootstrapCredentials(
  paths: SimulatorStatePaths,
  credentials: BootstrapCredentialPaths,
): Promise<void> {
  const associated = associatedBootstrapCredentials(paths, credentials);
  await Promise.all([
    assertSafeBootstrapFile(paths, associated.certificate, 'bootstrap certificate', false),
    assertSafeBootstrapFile(paths, associated.privateKey, 'bootstrap private key', false),
  ]);
  await Promise.all([
    requirePem(associated.certificate, 'CERTIFICATE'),
    requirePrivateKey(associated.privateKey),
    makePrivate(associated.certificate),
    makePrivate(associated.privateKey),
  ]);
}

/**
 * Retires the exact simulator-scoped bootstrap credential pair. Callers invoke
 * this only after the permanent identity has authenticated and its signed
 * configuration response has been accepted.
 */
export async function retireBootstrapCredentials(
  paths: SimulatorStatePaths,
  credentials: BootstrapCredentialPaths,
): Promise<boolean> {
  const associated = associatedBootstrapCredentials(paths, credentials);
  // Retire the secret first. If deletion fails, leave the public certificate in
  // place rather than risk retaining a reusable private key by deleting in parallel.
  const privateKeyPresent = await assertSafeBootstrapFile(
    paths,
    associated.privateKey,
    'bootstrap private key',
    true,
  );
  const privateKeyRemoved = privateKeyPresent ? await unlinkIfPresent(associated.privateKey) : false;
  const certificatePresent = await assertSafeBootstrapFile(
    paths,
    associated.certificate,
    'bootstrap certificate',
    true,
  );
  const certificateRemoved = certificatePresent ? await unlinkIfPresent(associated.certificate) : false;
  return privateKeyRemoved || certificateRemoved;
}

export async function loadIdentity(paths: SimulatorStatePaths): Promise<PersistedIdentity | undefined> {
  const text = await readOptional(paths.identity);
  if (text === undefined) return undefined;
  const value = parseJsonObject(text, 'Simulator identity state');
  const version = value.version === 1 || value.version === 2
    ? value.version
    : fail('Unsupported simulator identity version');
  const identity: PersistedIdentity = {
    version,
    endpoint: storedString(value.endpoint, 'identity endpoint'),
    templateName: storedString(value.templateName, 'identity templateName'),
    serialNumber: storedString(value.serialNumber, 'identity serialNumber'),
    ...(version === 1 ? { hardwareId: storedString(value.hardwareId, 'identity hardwareId') } : {}),
    thingName: storedString(value.thingName, 'identity thingName'),
    certificateId: storedString(value.certificateId, 'identity certificateId'),
    certificateFile: storedString(value.certificateFile, 'identity certificateFile'),
    privateKeyFile: storedString(value.privateKeyFile, 'identity privateKeyFile'),
    createdAt: storedString(value.createdAt, 'identity createdAt'),
    ...(typeof value.gatewayId === 'string' ? { gatewayId: value.gatewayId } : {}),
    ...(typeof value.tenantId === 'string' ? { tenantId: value.tenantId } : {}),
  };
  if (identity.certificateFile !== 'device-certificate.pem' || identity.privateKeyFile !== 'device-private-key.pem') {
    throw new Error('Simulator identity references an unexpected credential path');
  }
  await Promise.all([
    requirePem(paths.certificate, 'CERTIFICATE'),
    requirePrivateKey(paths.privateKey),
    makePrivate(paths.identity),
    makePrivate(paths.certificate),
    makePrivate(paths.privateKey),
  ]);
  return identity;
}

export async function createProvisioningStaging(
  paths: SimulatorStatePaths,
  privateKeyPem: string,
): Promise<{ directory: string; privateKey: string; certificate: string }> {
  const directory = join(paths.device, `.provisioning-${randomUUID()}`);
  const privateKey = join(directory, 'device-private-key.pem');
  const certificate = join(directory, 'device-certificate.pem');
  await mkdir(directory, { mode: PRIVATE_DIRECTORY_MODE });
  await makePrivate(directory);
  await writePrivate(privateKey, privateKeyPem, true);
  return { directory, privateKey, certificate };
}

/**
 * Persists the issued operational certificate before RegisterThing is attempted.
 * The certificate ownership token is deliberately not accepted by this state API.
 */
export async function stageIssuedCertificate(
  staging: { certificate: string },
  certificatePem: string,
): Promise<void> {
  assertPemText(certificatePem, 'CERTIFICATE', 'Issued operational certificate');
  await writePrivate(staging.certificate, certificatePem, true);
}

/** Writes the identity document last, so its existence means both credential files are durable. */
export async function commitProvisionedIdentity(
  paths: SimulatorStatePaths,
  staging: { privateKey: string; certificate: string },
  identity: Omit<PersistedIdentity, 'version' | 'certificateFile' | 'privateKeyFile'>,
): Promise<PersistedIdentity> {
  // Validate both staged credentials before moving either one. A failure leaves
  // the recoverable key/certificate pair together in the protected staging area.
  await Promise.all([
    requirePrivateKey(staging.privateKey),
    requirePem(staging.certificate, 'CERTIFICATE'),
  ]);
  await rename(staging.privateKey, paths.privateKey);
  await rename(staging.certificate, paths.certificate);
  await Promise.all([makePrivate(paths.privateKey), makePrivate(paths.certificate)]);
  const persisted: PersistedIdentity = {
    version: 2,
    ...identity,
    certificateFile: 'device-certificate.pem',
    privateKeyFile: 'device-private-key.pem',
  };
  await writePrivate(paths.identity, `${JSON.stringify(persisted, null, 2)}\n`, true);
  return persisted;
}

export async function enrichIdentity(
  paths: SimulatorStatePaths,
  identity: PersistedIdentity,
  values: { gatewayId: string; tenantId: string },
): Promise<PersistedIdentity> {
  if (identity.gatewayId && identity.gatewayId !== values.gatewayId) throw new Error('Gateway identity changed unexpectedly');
  if (identity.tenantId && identity.tenantId !== values.tenantId) throw new Error('Tenant identity changed unexpectedly');
  const next = { ...identity, ...values };
  await replacePrivate(paths.identity, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function loadAppliedState(paths: SimulatorStatePaths): Promise<AppliedState | undefined> {
  const text = await readOptional(paths.applied);
  if (text === undefined) return undefined;
  const value = parseJsonObject(text, 'Applied profile state');
  if (typeof value.generation !== 'number' || !Number.isSafeInteger(value.generation) || value.generation < 1
    || typeof value.profileVersionId !== 'string' || !value.profileVersionId
    || typeof value.profileChecksum !== 'string' || !/^[a-f0-9]{64}$/.test(value.profileChecksum)
    || typeof value.appliedAt !== 'string' || !Number.isFinite(Date.parse(value.appliedAt))) {
    throw new Error('Applied profile state is invalid');
  }
  return {
    generation: value.generation,
    profileVersionId: value.profileVersionId,
    profileChecksum: value.profileChecksum,
    appliedAt: value.appliedAt,
  };
}

export async function stageVerifiedArtifacts(
  paths: SimulatorStatePaths,
  artifacts: VerifiedArtifacts,
): Promise<{ profile: string; manifest: string }> {
  const generation = String(artifacts.assignment.generation).padStart(10, '0');
  const version = safePathSegment(artifacts.assignment.profileVersionId);
  const directory = join(paths.profileDirectory, `generation-${generation}-${version}`);
  const profile = join(directory, 'profile.json');
  const manifest = join(directory, 'manifest.json');
  await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await makePrivate(directory);
  await replacePrivate(profile, artifacts.profileText);
  await replacePrivate(manifest, artifacts.manifestText);
  return { profile, manifest };
}

export async function commitAppliedProfile(
  paths: SimulatorStatePaths,
  artifacts: VerifiedArtifacts,
): Promise<AppliedState> {
  await replacePrivate(paths.activeProfile, artifacts.profileText);
  await replacePrivate(paths.activeManifest, artifacts.manifestText);
  const reread = await readFile(paths.activeProfile, 'utf8');
  const { sha256Hex } = await import('./protocol.js');
  if (sha256Hex(reread) !== artifacts.checksum) {
    throw new Error('Persisted active profile did not pass the post-apply checksum health check');
  }
  const applied: AppliedState = {
    generation: artifacts.assignment.generation,
    profileVersionId: artifacts.assignment.profileVersionId,
    profileChecksum: artifacts.checksum,
    appliedAt: new Date().toISOString(),
  };
  await replacePrivate(paths.applied, `${JSON.stringify(applied, null, 2)}\n`);
  return applied;
}

export async function assertActiveProfile(paths: SimulatorStatePaths, expected: AppliedState): Promise<void> {
  const [profile, appliedText] = await Promise.all([
    readFile(paths.activeProfile, 'utf8'),
    readFile(paths.applied, 'utf8'),
  ]);
  const { sha256Hex } = await import('./protocol.js');
  if (sha256Hex(profile) !== expected.profileChecksum) throw new Error('Active profile checksum health check failed');
  const applied = JSON.parse(appliedText) as unknown;
  if (!isRecord(applied)
    || applied.generation !== expected.generation
    || applied.profileVersionId !== expected.profileVersionId
    || applied.profileChecksum !== expected.profileChecksum) {
    throw new Error('Applied profile journal does not match the active profile');
  }
}

async function replacePrivate(path: string, contents: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writePrivate(temporary, contents, true);
  try {
    await rename(temporary, path);
  } catch {
    // Windows does not replace an existing destination atomically. Directly
    // overwrite only this exact simulator-scoped file, never a caller path.
    await writePrivate(path, contents, false);
  }
  await makePrivate(path);
}

async function writePrivate(path: string, contents: string, exclusive: boolean): Promise<void> {
  await writeFile(path, contents, { encoding: 'utf8', mode: PRIVATE_FILE_MODE, flag: exclusive ? 'wx' : 'w' });
  await makePrivate(path);
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function requirePem(path: string, label: string): Promise<void> {
  const value = await readFile(path, 'utf8');
  assertPemText(value, label, `Credential file ${path}`);
}

async function requirePrivateKey(path: string): Promise<void> {
  const value = await readFile(path, 'utf8');
  if (!/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(value)
    || !/-----END (?:RSA |EC )?PRIVATE KEY-----/.test(value)) {
    throw new Error(`Credential file ${path} is not a PRIVATE KEY PEM`);
  }
}

async function unlinkIfPresent(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false;
    throw error;
  }
}

function associatedBootstrapCredentials(
  paths: SimulatorStatePaths,
  credentials: BootstrapCredentialPaths,
): BootstrapCredentialPaths {
  const certificate = associatedFile(paths.device, credentials.certificate, 'bootstrap certificate');
  const privateKey = associatedFile(paths.device, credentials.privateKey, 'bootstrap private key');
  if (samePath(certificate, privateKey)) throw new Error('Bootstrap certificate and private key must be different files');
  const protectedPaths = [
    paths.identity,
    paths.certificate,
    paths.privateKey,
    paths.activeProfile,
    paths.activeManifest,
    paths.applied,
  ];
  if (protectedPaths.some((path) => samePath(path, certificate) || samePath(path, privateKey))) {
    throw new Error('Bootstrap credentials overlap protected operational simulator state');
  }
  return { certificate, privateKey };
}

function associatedFile(deviceDirectory: string, value: string, label: string): string {
  const path = resolve(value);
  const child = relative(deviceDirectory, path);
  if (!child || isAbsolute(child) || child.startsWith('..') || dirname(child) !== '.') {
    throw new Error(`${label} is not directly associated with this per-device state directory`);
  }
  return path;
}

async function assertSafeBootstrapFile(
  paths: SimulatorStatePaths,
  path: string,
  label: string,
  allowMissing: boolean,
): Promise<boolean> {
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (allowMissing && isNodeError(error) && error.code === 'ENOENT') return false;
    throw error;
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${label} must be a regular file, not a symlink, junction, or directory`);
  }
  if (metadata.nlink !== 1) {
    throw new Error(`${label} must not be a hard-linked file`);
  }
  const [realDeviceDirectory, realCredential] = await Promise.all([
    realpath(paths.device),
    realpath(path),
  ]);
  const child = relative(realDeviceDirectory, realCredential);
  if (!child || isAbsolute(child) || child.startsWith('..') || dirname(child) !== '.') {
    throw new Error(`${label} resolves outside this per-device state directory`);
  }
  return true;
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function assertPemText(value: string, label: string, source: string): void {
  if (!value.includes(`-----BEGIN ${label}-----`) || !value.includes(`-----END ${label}-----`)) {
    throw new Error(`${source} is not a ${label} PEM`);
  }
}

async function makePrivate(path: string): Promise<void> {
  try {
    await chmod(path, path.endsWith('.pem') || path.endsWith('.json') || path.endsWith('.tmp') ? PRIVATE_FILE_MODE : PRIVATE_DIRECTORY_MODE);
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  }
}

function safePathSegment(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!normalized || normalized === '.' || normalized === '..') throw new Error('Value cannot be used as a simulator state path');
  return normalized.slice(0, 120);
}

function storedString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Missing ${label}`);
  return value;
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value;
}

function fail(message: string): never {
  throw new Error(message);
}
