import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createBootstrapPackageArchive, type BootstrapPackageMetadata } from '../infrastructure/lambda/shared/bootstrap-package.js';
import { createManagedBootstrapStore, ManagedBootstrapError } from './onboardingManagedBootstrap.js';

const NOW = Date.parse('2026-10-12T20:00:00Z');
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
let certificateSequence = 0;

function der(tag: number, bytes: Buffer): Buffer {
  let length: Buffer;
  if (bytes.length < 128) length = Buffer.from([bytes.length]);
  else {
    const octets: number[] = [];
    for (let remaining = bytes.length; remaining; remaining >>>= 8) octets.unshift(remaining & 255);
    length = Buffer.from([128 | octets.length, ...octets]);
  }
  return Buffer.concat([Buffer.from([tag]), length, bytes]);
}

/** A local self-signed test certificate; never issued by or submitted to AWS. */
function certificate(expired = false): string {
  const serial = ++certificateSequence;
  const algorithm = Buffer.from('300d06092a864886f70d01010b0500', 'hex');
  const cn = der(0x30, der(0x31, der(0x30, Buffer.concat([
    Buffer.from('0603550403', 'hex'), der(0x0c, Buffer.from('LOCAL MOCK BOOTSTRAP TEST')),
  ]))));
  const serialBytes = Buffer.from([serial]);
  const positiveSerial = serial >= 128 ? Buffer.concat([Buffer.from([0]), serialBytes]) : serialBytes;
  const validity = der(0x30, Buffer.concat([
    der(0x17, Buffer.from('200101000000Z')),
    der(0x17, Buffer.from(expired ? '210101000000Z' : '400101000000Z')),
  ]));
  const tbs = der(0x30, Buffer.concat([
    der(0xa0, der(0x02, Buffer.from([2]))), der(0x02, positiveSerial), algorithm,
    cn, validity, cn, keys.publicKey.export({ type: 'spki', format: 'der' }),
  ]));
  const signature = sign('RSA-SHA256', tbs, keys.privateKey);
  const raw = der(0x30, Buffer.concat([tbs, algorithm, der(0x03, Buffer.concat([Buffer.from([0]), signature]))]));
  return `-----BEGIN CERTIFICATE-----\n${raw.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
}

function archive(serial = 'MOCK-CACHE-001', overrides: Partial<BootstrapPackageMetadata> = {}, certificatePem = certificate(), key = privateKey): Buffer {
  const raw = Buffer.from(certificatePem.replace(/-----[^-]+-----|\s/g, ''), 'base64');
  const certificateId = createHash('sha256').update(raw).digest('hex');
  return createBootstrapPackageArchive({
    certificatePem, privateKey: key,
    metadata: {
      formatVersion: 1, initialGeneration: 5, issuedAt: new Date(NOW).toISOString(), serialNumber: serial,
      certificateId, certificateArn: `arn:aws:iot:us-east-1:841019700679:cert/${certificateId}`,
      tenantId: 'ce-test', modelId: 'model-test', siteId: 'site-test', profileVersionId: 'profile-test',
      region: 'us-east-1', bootstrapPolicyName: 'ConnectedEnterpriseBootstrap-dev',
      iotDataEndpoint: 'alht1i2bx8tzt-ats.iot.us-east-1.amazonaws.com',
      iotCredentialProviderEndpoint: 'test.credentials.iot.us-east-1.amazonaws.com',
      fleetProvisioningTemplateName: 'CEOnboarding-dev', gatewayConfigRoleAliasName: 'GatewayConfig-dev',
      claimClientIdPrefix: 'claim-', configurationUrlTemplate: 'https://example.test/configuration',
      statusUrlTemplate: 'https://example.test/status', ...overrides,
    },
  });
}

async function temporary(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ce-managed-bootstrap-test-'));
  t.after(async () => {
    // Verify the exact recursive-delete target remains our named test directory.
    const target = resolve(directory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith('ce-managed-bootstrap-test-'));
    await rm(target, { recursive: true, force: true });
  });
  return directory;
}

const errorCode = (code: string) => (error: unknown) => error instanceof ManagedBootstrapError && error.code === code;

test('retains the exact package privately and reloads it after a server restart', async t => {
  const root = await temporary(t);
  const directory = join(root, 'protected');
  const store = createManagedBootstrapStore({ directory, now: () => NOW });
  await store.prepare();
  const original = archive();
  const metadata = await store.retain(original);
  assert.equal(metadata.serialNumber, 'MOCK-CACHE-001');
  assert.equal(metadata.tenantId, 'ce-test');
  assert.equal(metadata.modelId, 'model-test');
  assert.equal(metadata.initialGeneration, 5);
  assert.equal(Object.hasOwn(metadata, 'privateKey'), false);
  const restarted = createManagedBootstrapStore({ directory, now: () => NOW });
  assert.deepEqual(await restarted.load(metadata.serialNumber), original);
  assert.deepEqual(await readFile(join(directory, 'MOCK-CACHE-001.zip')), original);
  if (process.platform !== 'win32') {
    assert.equal((await lstat(directory)).mode & 0o777, 0o700);
    assert.equal((await lstat(join(directory, 'MOCK-CACHE-001.zip'))).mode & 0o777, 0o600);
  }
});

test('loads missing artifacts without issuance and rejects unsafe or physical serials', async t => {
  const directory = join(await temporary(t), 'protected');
  const store = createManagedBootstrapStore({ directory, now: () => NOW });
  assert.equal(await store.load('MOCK-MISSING'), undefined);
  for (const serial of ['REAL-001', 'MOCK-../outside', 'mock-lowercase', '../MOCK-X']) {
    await assert.rejects(store.load(serial), errorCode('MOCK_GATEWAY_REQUIRED'));
  }
});

test('validates assignment metadata, CRC, certificate identity and matching private key before retaining', async t => {
  const directory = join(await temporary(t), 'protected');
  const store = createManagedBootstrapStore({ directory, now: () => NOW });
  const corrupt = archive(); corrupt[65] ^= 1;
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const invalid = [
    corrupt, Buffer.alloc(70_000), archive('REAL-001'), archive('MOCK-CACHE-001', { tenantId: 'other' }),
    archive('MOCK-CACHE-001', { initialGeneration: 0 }), archive('MOCK-CACHE-001', { siteId: '../site' }),
    archive('MOCK-CACHE-001', { iotDataEndpoint: 'attacker.example' }), archive('MOCK-CACHE-001', { fleetProvisioningTemplateName: 'other' }),
    archive('MOCK-CACHE-001', { certificateId: 'a'.repeat(64), certificateArn: `arn:aws:iot:us-east-1:841019700679:cert/${'a'.repeat(64)}` }),
    archive('MOCK-CACHE-001', {}, certificate(), other), archive('MOCK-CACHE-001', {}, certificate(true)),
  ];
  for (const value of invalid) await assert.rejects(store.retain(value), errorCode('BOOTSTRAP_ARTIFACT_INVALID'));
  assert.equal(await store.load('MOCK-CACHE-001'), undefined);
});

test('identical retries reuse bytes and different identities never replace retained credentials', async t => {
  const directory = join(await temporary(t), 'protected');
  const store = createManagedBootstrapStore({ directory, now: () => NOW });
  const original = archive();
  const retained = await store.retain(original);
  assert.deepEqual(await store.retain(original), retained);
  await assert.rejects(store.retain(archive()), errorCode('BOOTSTRAP_IDENTITY_CONFLICT'));
  assert.deepEqual(await store.load('MOCK-CACHE-001'), original);
  const sharedCertificate = certificate();
  await store.retain(archive('MOCK-SHARED-001', {}, sharedCertificate));
  await assert.rejects(store.retain(archive('MOCK-SHARED-002', {}, sharedCertificate)), errorCode('BOOTSTRAP_IDENTITY_CONFLICT'));
});

test('expected authoritative assignment and certificate mismatches fail before storage is touched', async t => {
  const directory = join(await temporary(t), 'protected');
  const store = createManagedBootstrapStore({ directory, now: () => NOW });
  const original = archive();
  for (const expected of [
    { serialNumber: 'MOCK-OTHER' }, { modelId: 'other-model' }, { siteId: 'other-site' },
    { profileVersionId: 'other-profile' }, { initialGeneration: 6 }, { certificateId: 'a'.repeat(64) },
  ]) await assert.rejects(store.retain(original, expected), errorCode('BOOTSTRAP_ARTIFACT_INVALID'));
  await assert.rejects(lstat(directory), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
  await store.retain(original, {
    serialNumber: 'MOCK-CACHE-001', modelId: 'model-test', siteId: 'site-test', profileVersionId: 'profile-test', initialGeneration: 5,
  });
  assert.deepEqual(await store.load('MOCK-CACHE-001'), original);
});

test('expired retained identities fail closed and are not silently replaced', async t => {
  const directory = join(await temporary(t), 'protected');
  let clock = NOW;
  const store = createManagedBootstrapStore({ directory, now: () => clock });
  await store.retain(archive());
  clock = Date.parse('2041-01-01T00:00:00Z');
  await assert.rejects(store.load('MOCK-CACHE-001'), errorCode('BOOTSTRAP_ARTIFACT_INVALID'));
  await assert.rejects(store.retain(archive()), errorCode('BOOTSTRAP_ARTIFACT_INVALID'));
});

test('preflight catches corrupt storage before a new one-time credential is requested', async t => {
  const directory = join(await temporary(t), 'protected');
  const store = createManagedBootstrapStore({ directory, now: () => NOW });
  await store.prepare();
  await writeFile(join(directory, 'MOCK-BROKEN.zip'), 'not a bootstrap archive', { mode: 0o600 });
  await assert.rejects(store.prepare(), errorCode('BOOTSTRAP_ARTIFACT_INVALID'));
});

test('concurrent same-serial retention never overwrites the first identity', async t => {
  const directory = join(await temporary(t), 'protected');
  const store = createManagedBootstrapStore({ directory, now: () => NOW });
  const first = archive();
  const results = await Promise.allSettled([store.retain(first), store.retain(archive())]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  if (results[1].status === 'rejected') assert.ok(errorCode('BOOTSTRAP_IDENTITY_CONFLICT')(results[1].reason));
  assert.deepEqual(await store.load('MOCK-CACHE-001'), first);
});

test('rejects hard-linked archives and symlinked roots rather than following them', async t => {
  const root = await temporary(t);
  const directory = join(root, 'protected');
  const store = createManagedBootstrapStore({ directory, now: () => NOW });
  await store.prepare();
  const outside = join(root, 'outside.zip');
  await writeFile(outside, archive(), { mode: 0o600 });
  await link(outside, join(directory, 'MOCK-CACHE-001.zip'));
  await assert.rejects(store.load('MOCK-CACHE-001'), errorCode('BOOTSTRAP_STORAGE_UNAVAILABLE'));
  const actual = join(root, 'actual');
  await mkdir(actual);
  const linked = join(root, 'linked');
  try { await symlink(actual, linked, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (['EPERM', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) { t.diagnostic('Directory link unavailable on this platform; hard-link assertion still passed.'); return; }
    throw error;
  }
  await assert.rejects(createManagedBootstrapStore({ directory: linked, now: () => NOW }).prepare(), errorCode('BOOTSTRAP_STORAGE_UNAVAILABLE'));
});

test('enforces the 50-archive capacity and preserves existing packages at the limit', async t => {
  const directory = join(await temporary(t), 'protected');
  const store = createManagedBootstrapStore({ directory, now: () => NOW });
  for (let index = 0; index < 50; index++) await store.retain(archive(`MOCK-CAPACITY-${index}`));
  await assert.rejects(store.prepare(), errorCode('BOOTSTRAP_STORAGE_FULL'));
  await assert.rejects(store.retain(archive('MOCK-CAPACITY-EXTRA')), errorCode('BOOTSTRAP_STORAGE_FULL'));
  assert.ok(await store.load('MOCK-CAPACITY-0'));
});
