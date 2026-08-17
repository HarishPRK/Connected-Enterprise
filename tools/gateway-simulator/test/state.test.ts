import assert from 'node:assert/strict';
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  assertBootstrapCredentials,
  commitProvisionedIdentity,
  createProvisioningStaging,
  initializeState,
  loadIdentity,
  retireBootstrapCredentials,
  stageIssuedCertificate,
  statePaths,
} from '../src/state.js';

const PRIVATE_KEY_PEM = [
  '-----BEGIN PRIVATE KEY-----',
  'test-private-key',
  '-----END PRIVATE KEY-----',
  '',
].join('\n');

const CERTIFICATE_PEM = [
  '-----BEGIN CERTIFICATE-----',
  'test-certificate',
  '-----END CERTIFICATE-----',
  '',
].join('\n');

test('pre-flashed bootstrap credentials remain until explicitly retired after handoff', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'ce-gateway-simulator-'));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const paths = statePaths(root, 'CE-TEST-GW-BOOTSTRAP');
  const bootstrap = bootstrapPaths(root);
  await initializeState(paths);
  await Promise.all([
    writeFile(bootstrap.certificate, CERTIFICATE_PEM),
    writeFile(bootstrap.privateKey, PRIVATE_KEY_PEM),
  ]);

  await assertBootstrapCredentials(paths, bootstrap);
  assert.equal(await readFile(bootstrap.certificate, 'utf8'), CERTIFICATE_PEM);
  assert.equal(await readFile(bootstrap.privateKey, 'utf8'), PRIVATE_KEY_PEM);

  assert.equal(await retireBootstrapCredentials(paths, bootstrap), true);
  await Promise.all([
    assertMissing(bootstrap.certificate),
    assertMissing(bootstrap.privateKey),
  ]);
  assert.equal(await retireBootstrapCredentials(paths, bootstrap), false);
});

test('fresh provisioning fails closed when either bootstrap credential is missing', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'ce-gateway-simulator-'));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const paths = statePaths(root, 'CE-TEST-GW-MISSING-BOOTSTRAP');
  const bootstrap = bootstrapPaths(root);
  await initializeState(paths);
  await writeFile(bootstrap.certificate, CERTIFICATE_PEM);

  await assert.rejects(assertBootstrapCredentials(paths, bootstrap), /ENOENT/);
  assert.equal(await readFile(bootstrap.certificate, 'utf8'), CERTIFICATE_PEM);
});

test('bootstrap retirement does not delete the certificate when private-key deletion fails', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'ce-gateway-simulator-'));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const paths = statePaths(root, 'CE-TEST-GW-RETIRE-KEY-FAILS');
  const bootstrap = bootstrapPaths(root);
  await writeFile(bootstrap.certificate, CERTIFICATE_PEM);
  await mkdir(bootstrap.privateKey);

  await assert.rejects(retireBootstrapCredentials(paths, bootstrap));
  assert.equal(await readFile(bootstrap.certificate, 'utf8'), CERTIFICATE_PEM);
});

test('bootstrap retirement leaves no reusable private key when certificate deletion fails', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'ce-gateway-simulator-'));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const paths = statePaths(root, 'CE-TEST-GW-RETIRE-CERT-FAILS');
  const bootstrap = bootstrapPaths(root);
  await mkdir(bootstrap.certificate);
  await writeFile(bootstrap.privateKey, PRIVATE_KEY_PEM);

  await assert.rejects(retireBootstrapCredentials(paths, bootstrap));
  await assertMissing(bootstrap.privateKey);
});

test('bootstrap credentials reject a symlink before reading or changing its outside target', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'ce-gateway-simulator-'));
  const outsideRoot = await mkdtemp(join(tmpdir(), 'ce-gateway-outside-'));
  context.after(async () => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outsideRoot, { recursive: true, force: true }),
  ]).then(() => undefined));
  const paths = statePaths(root, 'CE-TEST-GW-SYMLINK-USE');
  const bootstrap = bootstrapPaths(root);
  const outsideCertificate = join(outsideRoot, 'outside-certificate.pem');
  await initializeState(paths);
  await Promise.all([
    writeFile(outsideCertificate, CERTIFICATE_PEM),
    writeFile(bootstrap.privateKey, PRIVATE_KEY_PEM),
  ]);
  if (!await createFileSymlinkOrSkip(context, outsideCertificate, bootstrap.certificate)) return;

  await assert.rejects(
    assertBootstrapCredentials(paths, bootstrap),
    /regular file, not a symlink/,
  );
  assert.equal(await readFile(outsideCertificate, 'utf8'), CERTIFICATE_PEM);
});

test('retirement removes the private key but never follows a certificate symlink outside state', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'ce-gateway-simulator-'));
  const outsideRoot = await mkdtemp(join(tmpdir(), 'ce-gateway-outside-'));
  context.after(async () => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outsideRoot, { recursive: true, force: true }),
  ]).then(() => undefined));
  const paths = statePaths(root, 'CE-TEST-GW-SYMLINK-RETIRE');
  const bootstrap = bootstrapPaths(root);
  const outsideCertificate = join(outsideRoot, 'outside-certificate.pem');
  await Promise.all([
    writeFile(outsideCertificate, CERTIFICATE_PEM),
    writeFile(bootstrap.privateKey, PRIVATE_KEY_PEM),
  ]);
  if (!await createFileSymlinkOrSkip(context, outsideCertificate, bootstrap.certificate)) return;

  await assert.rejects(
    retireBootstrapCredentials(paths, bootstrap),
    /regular file, not a symlink/,
  );
  await assertMissing(bootstrap.privateKey);
  assert.equal((await lstat(bootstrap.certificate)).isSymbolicLink(), true);
  assert.equal(await readFile(outsideCertificate, 'utf8'), CERTIFICATE_PEM);
});

test('bootstrap validation rejects hard links that could expose an outside target', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'ce-gateway-simulator-'));
  const outsideRoot = await mkdtemp(join(tmpdir(), 'ce-gateway-outside-'));
  context.after(async () => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outsideRoot, { recursive: true, force: true }),
  ]).then(() => undefined));
  const paths = statePaths(root, 'CE-TEST-GW-HARDLINK');
  const bootstrap = bootstrapPaths(root);
  const outsideCertificate = join(outsideRoot, 'outside-certificate.pem');
  await initializeState(paths);
  await Promise.all([
    writeFile(outsideCertificate, CERTIFICATE_PEM),
    writeFile(bootstrap.privateKey, PRIVATE_KEY_PEM),
  ]);
  await link(outsideCertificate, bootstrap.certificate);

  await assert.rejects(assertBootstrapCredentials(paths, bootstrap), /must not be a hard-linked file/);
  assert.equal(await readFile(outsideCertificate, 'utf8'), CERTIFICATE_PEM);
});

test('issued operational certificate is protected in staging before identity commit', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'ce-gateway-simulator-'));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const paths = statePaths(root, 'CE-TEST-GW-STATE');
  await initializeState(paths);
  const staging = await createProvisioningStaging(paths, PRIVATE_KEY_PEM);

  await stageIssuedCertificate(staging, CERTIFICATE_PEM);

  await Promise.all([
    assertMissing(paths.identity),
    assertMissing(paths.certificate),
    assertMissing(paths.privateKey),
  ]);
  assert.equal(await readFile(staging.privateKey, 'utf8'), PRIVATE_KEY_PEM);
  assert.equal(await readFile(staging.certificate, 'utf8'), CERTIFICATE_PEM);
  await assert.rejects(stageIssuedCertificate(staging, CERTIFICATE_PEM), /EEXIST/);
  assert.equal(await readFile(staging.certificate, 'utf8'), CERTIFICATE_PEM);
  assert.deepEqual((await readdir(staging.directory)).sort(), [
    'device-certificate.pem',
    'device-private-key.pem',
  ]);
  if (process.platform !== 'win32') {
    assert.equal((await stat(staging.directory)).mode & 0o777, 0o700);
    assert.equal((await stat(staging.certificate)).mode & 0o777, 0o600);
  }
});

test('identity commit consumes the already-staged credential pair only after acceptance', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'ce-gateway-simulator-'));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const paths = statePaths(root, 'CE-TEST-GW-COMMIT');
  await initializeState(paths);
  const staging = await createProvisioningStaging(paths, PRIVATE_KEY_PEM);
  await stageIssuedCertificate(staging, CERTIFICATE_PEM);

  const identity = await commitProvisionedIdentity(paths, staging, {
    endpoint: 'example-ats.iot.us-east-1.amazonaws.com',
    templateName: 'CEOnboarding-dev',
    serialNumber: 'CE-TEST-GW-COMMIT',
    thingName: 'gw-test',
    certificateId: 'certificate-test',
    createdAt: '2026-08-16T20:00:00.000Z',
  });

  assert.equal(identity.certificateFile, 'device-certificate.pem');
  assert.equal(identity.privateKeyFile, 'device-private-key.pem');
  assert.equal(await readFile(paths.certificate, 'utf8'), CERTIFICATE_PEM);
  assert.equal(await readFile(paths.privateKey, 'utf8'), PRIVATE_KEY_PEM);
  const identityText = await readFile(paths.identity, 'utf8');
  assert.equal(JSON.parse(identityText).version, 2);
  assert.equal(JSON.parse(identityText).certificateId, 'certificate-test');
  assert.doesNotMatch(identityText, /ownership|hardwareId|hardwareProof|privateKeyPem/i);
  assert.deepEqual(await readdir(staging.directory), []);
  const reloaded = await loadIdentity(paths);
  assert.equal(reloaded?.thingName, 'gw-test');
  assert.equal(reloaded?.certificateId, 'certificate-test');
  if (process.platform !== 'win32') {
    assert.equal((await stat(paths.identity)).mode & 0o777, 0o600);
    assert.equal((await stat(paths.certificate)).mode & 0o777, 0o600);
    assert.equal((await stat(paths.privateKey)).mode & 0o777, 0o600);
  }
});

test('identity commit leaves the staged key untouched when no issued certificate was persisted', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'ce-gateway-simulator-'));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const paths = statePaths(root, 'CE-TEST-GW-MISSING-CERT');
  await initializeState(paths);
  const staging = await createProvisioningStaging(paths, PRIVATE_KEY_PEM);

  await assert.rejects(
    commitProvisionedIdentity(paths, staging, {
      endpoint: 'example-ats.iot.us-east-1.amazonaws.com',
      templateName: 'CEOnboarding-dev',
      serialNumber: 'CE-TEST-GW-MISSING-CERT',
      thingName: 'gw-test',
      certificateId: 'certificate-test',
      createdAt: '2026-08-16T20:00:00.000Z',
    }),
    /ENOENT/,
  );
  assert.equal(await readFile(staging.privateKey, 'utf8'), PRIVATE_KEY_PEM);
  await Promise.all([
    assertMissing(paths.identity),
    assertMissing(paths.certificate),
    assertMissing(paths.privateKey),
  ]);
});

test('identity loader remains compatible with legacy version 1 state containing hardwareId', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'ce-gateway-simulator-'));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const paths = statePaths(root, 'CE-TEST-GW-LEGACY');
  await initializeState(paths);
  await Promise.all([
    writeFile(paths.certificate, CERTIFICATE_PEM),
    writeFile(paths.privateKey, PRIVATE_KEY_PEM),
    writeFile(paths.identity, JSON.stringify({
      version: 1,
      endpoint: 'example-ats.iot.us-east-1.amazonaws.com',
      templateName: 'CEOnboarding-dev',
      serialNumber: 'CE-TEST-GW-LEGACY',
      hardwareId: 'legacy-device-value',
      thingName: 'gw-legacy',
      certificateId: 'certificate-legacy',
      certificateFile: 'device-certificate.pem',
      privateKeyFile: 'device-private-key.pem',
      createdAt: '2026-08-16T20:00:00.000Z',
    })),
  ]);

  const identity = await loadIdentity(paths);
  assert.equal(identity?.version, 1);
  assert.equal(identity?.hardwareId, 'legacy-device-value');
  assert.equal(identity?.thingName, 'gw-legacy');
});

async function assertMissing(path: string): Promise<void> {
  await assert.rejects(readFile(path, 'utf8'), /ENOENT/);
}

function bootstrapPaths(root: string): { certificate: string; privateKey: string } {
  return {
    certificate: join(root, 'bootstrap-certificate.pem'),
    privateKey: join(root, 'bootstrap-private-key.pem'),
  };
}

async function createFileSymlinkOrSkip(
  context: TestContext,
  target: string,
  path: string,
): Promise<boolean> {
  try {
    await symlink(target, path, 'file');
    return true;
  } catch (error) {
    if (isNodeError(error) && (error.code === 'EPERM' || error.code === 'EACCES')) {
      context.skip('File symlink creation is not permitted on this host');
      return false;
    }
    throw error;
  }
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value;
}
