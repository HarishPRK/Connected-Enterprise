import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { parseOptions } from '../src/options.js';

test('bootstrap credential options default to dedicated files in the device state directory', async (context) => {
  const stateDirectory = await temporaryStateDirectory(context);
  const options = parseOptions(requiredArgs(stateDirectory), {});

  assert.equal(options.bootstrapCertificate, join(stateDirectory, 'bootstrap-certificate.pem'));
  assert.equal(options.bootstrapPrivateKey, join(stateDirectory, 'bootstrap-private-key.pem'));
});

test('explicit bootstrap credential flags resolve files associated with this device state', async (context) => {
  const stateDirectory = await temporaryStateDirectory(context);
  const certificate = join(stateDirectory, 'factory-bootstrap-certificate.pem');
  const privateKey = join(stateDirectory, 'factory-bootstrap-private-key.pem');
  const options = parseOptions([
    ...requiredArgs(stateDirectory),
    '--bootstrap-cert', certificate,
    '--bootstrap-key', privateKey,
  ], {});

  assert.equal(options.bootstrapCertificate, certificate);
  assert.equal(options.bootstrapPrivateKey, privateKey);
});

test('bootstrap credential environment variables map to the same explicit contract', async (context) => {
  const stateDirectory = await temporaryStateDirectory(context);
  const certificate = join(stateDirectory, 'environment-bootstrap-certificate.pem');
  const privateKey = join(stateDirectory, 'environment-bootstrap-private-key.pem');
  const options = parseOptions([], {
    CE_SIM_IOT_ENDPOINT: 'example-ats.iot.us-east-1.amazonaws.com',
    CE_SIM_TEMPLATE_NAME: 'CEOnboarding-dev',
    CE_SIM_SERIAL_NUMBER: 'SNA8C2463D4248',
    CE_SIM_STATE_DIR: stateDirectory,
    CE_SIM_BOOTSTRAP_CERT: certificate,
    CE_SIM_BOOTSTRAP_KEY: privateKey,
    CE_SIM_SIGNING_KEY_ID: 'arn:aws:kms:us-east-1:111122223333:key/test',
  });

  assert.equal(options.bootstrapCertificate, certificate);
  assert.equal(options.bootstrapPrivateKey, privateKey);
});

test('bootstrap credential paths cannot escape or collide inside device state', async (context) => {
  const stateDirectory = await temporaryStateDirectory(context);
  const common = requiredArgs(stateDirectory);
  assert.throws(
    () => parseOptions([...common, '--bootstrap-cert', resolve(stateDirectory, '..', 'outside.pem')], {}),
    /inside the per-device state directory/,
  );
  assert.throws(
    () => parseOptions([...common, '--bootstrap-key', join(stateDirectory, 'device-private-key.pem')], {}),
    /not an operational credential path/,
  );
  assert.throws(
    () => parseOptions([
      ...common,
      '--bootstrap-cert', join(stateDirectory, 'same.pem'),
      '--bootstrap-key', join(stateDirectory, 'same.pem'),
    ], {}),
    /must be different files/,
  );
});

test('legacy claim credential options are rejected', async (context) => {
  const stateDirectory = await temporaryStateDirectory(context);
  assert.throws(
    () => parseOptions([...requiredArgs(stateDirectory), '--claim-cert', join(stateDirectory, 'claim.pem')], {}),
    /Unknown option --claim-cert/,
  );
});

function requiredArgs(stateDirectory: string): string[] {
  return [
    '--endpoint', 'example-ats.iot.us-east-1.amazonaws.com',
    '--template', 'CEOnboarding-dev',
    '--serial', 'SNA8C2463D4248',
    '--state-dir', stateDirectory,
    '--signing-key-id', 'arn:aws:kms:us-east-1:111122223333:key/test',
  ];
}

async function temporaryStateDirectory(context: { after: (callback: () => Promise<void>) => void }): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ce-gateway-options-'));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  return directory;
}
