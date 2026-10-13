import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, realpath, unlink } from 'node:fs/promises';
import { createHash, createPrivateKey, randomUUID, X509Certificate } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { MOCK_SERIAL, readSimulatorPackage } from './onboardingSimulator.js';

const MAX_ARCHIVE_BYTES = 64 * 1024;
const MAX_ARCHIVES = 50;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ENDPOINT = 'alht1i2bx8tzt-ats.iot.us-east-1.amazonaws.com';
const TEMPLATE = 'CEOnboarding-dev';

export interface ManagedBootstrapMetadata {
  formatVersion: 1;
  tenantId: 'ce-test';
  serialNumber: string;
  modelId: string;
  siteId: string;
  profileVersionId: string;
  initialGeneration: number;
  certificateId: string;
  certificateArn: string;
  issuedAt: string;
  region: 'us-east-1';
  iotDataEndpoint: string;
  fleetProvisioningTemplateName: string;
}

export interface ManagedBootstrapStore {
  /** Check storage and capacity before requesting a new one-time AWS key. */
  prepare(): Promise<void>;
  /** Retain only a trusted API's original bootstrap archive. Never accepts a path. */
  retain(archive: Buffer, expected?: Partial<ManagedBootstrapMetadata>): Promise<ManagedBootstrapMetadata>;
  load(serialNumber: string): Promise<Buffer | undefined>;
}

export interface ManagedBootstrapStoreOptions {
  /** Server-owned test/deployment setting, never taken from a browser request. */
  directory?: string;
  now?: () => number;
}

export class ManagedBootstrapError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ManagedBootstrapError';
  }
}

function invalidArchive(): never {
  throw new ManagedBootstrapError('BOOTSTRAP_ARTIFACT_INVALID', 'The managed bootstrap package is invalid or no longer usable. Contact the operator before retrying.');
}

function storageUnavailable(): never {
  throw new ManagedBootstrapError('BOOTSTRAP_STORAGE_UNAVAILABLE', 'Protected bootstrap storage is unavailable. No new package should be issued.');
}

function canonicalSerial(value: string): string {
  if (typeof value !== 'string' || !MOCK_SERIAL.test(value)) {
    throw new ManagedBootstrapError('MOCK_GATEWAY_REQUIRED', 'Managed bootstrap packages are available only for canonical MOCK- gateway IDs.');
  }
  return value;
}

function parseArchive(archive: Buffer, now: number, checkValidity = true): ManagedBootstrapMetadata {
  try {
    if (!Buffer.isBuffer(archive) || archive.length > MAX_ARCHIVE_BYTES) return invalidArchive();
    const files = readSimulatorPackage(archive);
    const value: unknown = JSON.parse(files.get('bootstrap-metadata.json')!.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidArchive();
    const metadata = value as Record<string, unknown>;
    if (metadata.formatVersion !== 1 || metadata.tenantId !== 'ce-test'
      || typeof metadata.serialNumber !== 'string' || !MOCK_SERIAL.test(metadata.serialNumber)
      || metadata.region !== 'us-east-1' || metadata.iotDataEndpoint !== ENDPOINT
      || metadata.fleetProvisioningTemplateName !== TEMPLATE
      || typeof metadata.certificateId !== 'string' || !/^[a-f0-9]{64}$/.test(metadata.certificateId)
      || metadata.certificateArn !== `arn:aws:iot:us-east-1:841019700679:cert/${metadata.certificateId}`
      || typeof metadata.issuedAt !== 'string' || !Number.isFinite(Date.parse(metadata.issuedAt))
      || !Number.isSafeInteger(metadata.initialGeneration) || Number(metadata.initialGeneration) <= 0) return invalidArchive();
    for (const field of ['modelId', 'siteId', 'profileVersionId']) {
      if (typeof metadata[field] !== 'string' || !IDENTIFIER.test(metadata[field] as string)) return invalidArchive();
    }
    const certificate = new X509Certificate(files.get('bootstrap-certificate.pem')!);
    if (createHash('sha256').update(certificate.raw).digest('hex') !== metadata.certificateId
      || !certificate.checkPrivateKey(createPrivateKey(files.get('bootstrap-private-key.pem')!))) return invalidArchive();
    const validFrom = Date.parse(certificate.validFrom);
    const validTo = Date.parse(certificate.validTo);
    if (checkValidity && (!Number.isFinite(now) || !Number.isFinite(validFrom) || !Number.isFinite(validTo)
      || now < validFrom || now >= validTo)) return invalidArchive();
    // Only non-secret assignment/identity fields leave this helper.
    return {
      formatVersion: 1, tenantId: 'ce-test', serialNumber: metadata.serialNumber,
      modelId: metadata.modelId as string, siteId: metadata.siteId as string,
      profileVersionId: metadata.profileVersionId as string,
      initialGeneration: metadata.initialGeneration as number,
      certificateId: metadata.certificateId, certificateArn: metadata.certificateArn as string,
      issuedAt: metadata.issuedAt, region: 'us-east-1', iotDataEndpoint: ENDPOINT,
      fleetProvisioningTemplateName: TEMPLATE,
    };
  } catch {
    return invalidArchive();
  }
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** Protected, bounded storage for one-time lab credentials, outside the repository. */
export function createManagedBootstrapStore(options: ManagedBootstrapStoreOptions = {}): ManagedBootstrapStore {
  const directory = resolve(options.directory ?? join(homedir(), '.local', 'share', 'connected-enterprise', 'managed-bootstrap'));
  const now = options.now ?? Date.now;
  let mutation: Promise<void> = Promise.resolve();
  function locked<T>(task: () => Promise<T>): Promise<T> {
    const result = mutation.then(task, task);
    mutation = result.then(() => undefined, () => undefined);
    return result;
  }

  async function checkDirectory(create: boolean): Promise<boolean> {
    try {
      if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(await realpath(directory), directory)) return storageUnavailable();
      await chmod(directory, 0o700);
      return true;
    } catch (error) {
      if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      return storageUnavailable();
    }
  }

  async function archiveNames(): Promise<string[]> {
    const names = await readdir(directory);
    if (names.some(name => !name.endsWith('.zip') || !MOCK_SERIAL.test(name.slice(0, -4)))) return storageUnavailable();
    return names;
  }

  async function readArchive(serial: string): Promise<Buffer | undefined> {
    const path = join(directory, `${canonicalSerial(serial)}.zip`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const before = await lstat(path);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > MAX_ARCHIVE_BYTES
        || !samePath(await realpath(path), path)) return storageUnavailable();
      handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_ARCHIVE_BYTES
        || stat.ino !== before.ino || stat.dev !== before.dev) return storageUnavailable();
      await handle.chmod(0o600);
      const bytes = Buffer.alloc(MAX_ARCHIVE_BYTES + 1);
      let length = 0;
      while (length < bytes.length) {
        const result = await handle.read(bytes, length, bytes.length - length, length);
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      if (length > MAX_ARCHIVE_BYTES || length !== stat.size) return invalidArchive();
      return bytes.subarray(0, length);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      if (error instanceof ManagedBootstrapError) throw error;
      return storageUnavailable();
    } finally {
      await handle?.close();
    }
  }

  return {
    prepare: () => locked(async () => {
      await checkDirectory(true);
      const names = await archiveNames();
      if (names.length >= MAX_ARCHIVES) {
        throw new ManagedBootstrapError('BOOTSTRAP_STORAGE_FULL', 'Protected bootstrap storage is full. Ask the operator to review retained mock packages before issuing another.');
      }
      // Catch corrupt/unreadable existing storage before requesting a key that
      // AWS cannot export again. Expiry of another serial is not replacement.
      for (const name of names) {
        const previous = await readArchive(name.slice(0, -4));
        if (!previous || parseArchive(previous, now(), false).serialNumber !== name.slice(0, -4)) return invalidArchive();
      }
      const probe = join(directory, `MOCK-PROBE-${randomUUID()}.zip`);
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        handle = await open(probe, 'wx', 0o600);
        await handle.writeFile(Buffer.from('storage-check'));
        await handle.sync();
      } catch {
        return storageUnavailable();
      } finally {
        await handle?.close();
        await unlink(probe).catch(error => { if (error.code !== 'ENOENT') return storageUnavailable(); });
      }
    }),
    retain: (archive, expected) => locked(async () => {
      // Validate before touching storage or retaining any secret bytes.
      const metadata = parseArchive(archive, now());
      for (const [key, value] of Object.entries(expected ?? {})) {
        if (!Object.hasOwn(metadata, key) || metadata[key as keyof ManagedBootstrapMetadata] !== value) return invalidArchive();
      }
      await checkDirectory(true);
      const existing = await readArchive(metadata.serialNumber);
      if (existing) {
        const previous = parseArchive(existing, now());
        if (existing.equals(archive) && previous.certificateId === metadata.certificateId) return metadata;
        throw new ManagedBootstrapError('BOOTSTRAP_IDENTITY_CONFLICT', 'This mock gateway already has a different retained package. Its identity will not be replaced automatically.');
      }
      const names = await archiveNames();
      if (names.length >= MAX_ARCHIVES) {
        throw new ManagedBootstrapError('BOOTSTRAP_STORAGE_FULL', 'Protected bootstrap storage is full. No additional mock package was retained.');
      }
      for (const name of names) {
        const previous = await readArchive(name.slice(0, -4));
        if (previous && parseArchive(previous, now(), false).certificateId === metadata.certificateId) {
          throw new ManagedBootstrapError('BOOTSTRAP_IDENTITY_CONFLICT', 'One bootstrap certificate cannot be retained for multiple mock gateways.');
        }
      }
      const path = join(directory, `${metadata.serialNumber}.zip`);
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        handle = await open(path, 'wx', 0o600);
        await handle.writeFile(archive);
        await handle.sync();
      } catch (error) {
        // Do not delete/replace a partial credential file automatically. Its
        // presence makes subsequent issuance fail closed for this identity.
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new ManagedBootstrapError('BOOTSTRAP_IDENTITY_CONFLICT', 'This mock package was retained by another request. Review the existing identity before retrying.');
        }
        return storageUnavailable();
      } finally {
        await handle?.close();
      }
      return metadata;
    }),
    load: serial => locked(async () => {
      canonicalSerial(serial);
      if (!await checkDirectory(false)) return undefined;
      const archive = await readArchive(serial);
      if (!archive) return undefined;
      if (parseArchive(archive, now()).serialNumber !== serial) return invalidArchive();
      return archive;
    }),
  };
}
