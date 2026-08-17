import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  commitProvisionedIdentity,
  createProvisioningStaging,
  initializeState,
  loadIdentity,
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
    hardwareId: 'tpm-ekhash-test',
    thingName: 'gw-test',
    certificateId: 'certificate-test',
    createdAt: '2026-08-16T20:00:00.000Z',
  });

  assert.equal(identity.certificateFile, 'device-certificate.pem');
  assert.equal(identity.privateKeyFile, 'device-private-key.pem');
  assert.equal(await readFile(paths.certificate, 'utf8'), CERTIFICATE_PEM);
  assert.equal(await readFile(paths.privateKey, 'utf8'), PRIVATE_KEY_PEM);
  const identityText = await readFile(paths.identity, 'utf8');
  assert.equal(JSON.parse(identityText).certificateId, 'certificate-test');
  assert.doesNotMatch(identityText, /ownership|hardwareProof|privateKeyPem/i);
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
      hardwareId: 'tpm-ekhash-test',
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

async function assertMissing(path: string): Promise<void> {
  await assert.rejects(readFile(path, 'utf8'), /ENOENT/);
}
