import assert from 'node:assert/strict';
import test from 'node:test';

import { createBootstrapPackageArchive } from '../lambda/shared/bootstrap-package.js';

function storedEntries(archive: Buffer): Map<string, string> {
  const entries = new Map<string, string>();
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(archive.readUInt16LE(offset + 8), 0, 'package uses portable stored ZIP entries');
    const size = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = archive.subarray(nameStart, nameStart + nameLength).toString('utf8');
    entries.set(name, archive.subarray(dataStart, dataStart + size).toString('utf8'));
    offset = dataStart + size;
  }
  assert.equal(archive.readUInt32LE(offset), 0x02014b50, 'central directory follows local entries');
  assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50, 'ZIP has an end-of-directory record');
  return entries;
}

test('one-time bootstrap archive contains only the expected credential and metadata files', () => {
  const archive = createBootstrapPackageArchive({
    certificatePem: '-----BEGIN CERTIFICATE-----\ncertificate\n-----END CERTIFICATE-----',
    privateKey: '-----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----',
    metadata: {
      formatVersion: 1,
      issuedAt: '2026-08-19T12:00:00.000Z',
      serialNumber: 'CE-GW-00043',
      certificateId: 'a'.repeat(64),
      certificateArn: `arn:aws:iot:us-east-1:111122223333:cert/${'a'.repeat(64)}`,
      tenantId: 'tenant-a',
      modelId: 'ce-gateway-v1',
      siteId: 'lab-01',
      profileVersionId: 'pv-schema-v2',
      region: 'us-east-1',
      bootstrapPolicyName: 'ConnectedEnterpriseGatewayBootstrap-dev-v1',
      iotDataEndpoint: 'example-ats.iot.us-east-1.amazonaws.com',
      iotCredentialProviderEndpoint: 'example.credentials.iot.us-east-1.amazonaws.com',
      fleetProvisioningTemplateName: 'CEOnboarding-dev',
      gatewayConfigRoleAliasName: 'GatewayConfigPull-dev',
      claimClientIdPrefix: 'claim-',
      configurationUrlTemplate: 'https://api.example/device/v1/things/{thingName}/certificates/{certificateId}/configuration',
      statusUrlTemplate: 'https://api.example/device/v1/things/{thingName}/certificates/{certificateId}/status',
    },
  });
  const entries = storedEntries(archive);
  assert.deepEqual([...entries.keys()], [
    'bootstrap-certificate.pem',
    'bootstrap-private-key.pem',
    'AmazonRootCA1.pem',
    'bootstrap-metadata.json',
    'README.txt',
  ]);
  assert.match(entries.get('bootstrap-private-key.pem') ?? '', /BEGIN PRIVATE KEY/);
  assert.match(entries.get('AmazonRootCA1.pem') ?? '', /Amazon Root CA 1|BEGIN CERTIFICATE/);
  const metadata = JSON.parse(entries.get('bootstrap-metadata.json') ?? '{}') as Record<string, unknown>;
  assert.equal(metadata.serialNumber, 'CE-GW-00043');
  assert.equal(metadata.certificateId, 'a'.repeat(64));
  assert.equal(metadata.privateKey, undefined);
});
