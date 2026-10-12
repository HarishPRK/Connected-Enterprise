import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBootstrapPackageArchive, type BootstrapPackageMetadata } from '../infrastructure/lambda/shared/bootstrap-package.js';
import { MOCK_SERIAL, readSimulatorPackage, validateSimulatorAssignment } from './onboardingSimulator.js';
import type { OnboardingOperation } from '../src/features/onboarding/types.js';

const operation = { id: 'op-test', serialNumber: 'MOCK-TEST-001', type: 'ONBOARD', status: 'IN_PROGRESS', siteId: 'site-test', profileVersionId: 'profile-test', deploymentGeneration: 5 } as OnboardingOperation;
const metadata = {
  formatVersion: 1, initialGeneration: 5, issuedAt: '2026-10-12T00:00:00Z', serialNumber: operation.serialNumber,
  certificateId: 'a'.repeat(64), tenantId: 'ce-test', siteId: operation.siteId, profileVersionId: operation.profileVersionId,
  region: 'us-east-1', iotDataEndpoint: 'alht1i2bx8tzt-ats.iot.us-east-1.amazonaws.com', fleetProvisioningTemplateName: 'CEOnboarding-dev',
};
function archive() { return createBootstrapPackageArchive({ certificatePem: 'fixture certificate', privateKey: 'fixture private key', metadata: metadata as BootstrapPackageMetadata }); }
test('reads the exact bootstrap archive without extracting paths', () => {
  const files = readSimulatorPackage(archive());
  assert.equal(files.size, 5);
  assert.equal(files.get('bootstrap-private-key.pem')?.toString(), 'fixture private key\n');
  assert.equal(JSON.parse(files.get('bootstrap-metadata.json')!.toString()).serialNumber, operation.serialNumber);
});
test('rejects corrupted, truncated, oversized, compressed and path-substituted archives', () => {
  const changedData = archive(); changedData[65] ^= 1;
  const compressed = archive(); compressed.writeUInt16LE(8, 8);
  const path = archive(); path.write('../', 30);
  const directory = archive(); directory.writeUInt32LE(0, directory.length - 6);
  for (const invalid of [changedData, compressed, path, directory, archive().subarray(0, 100), Buffer.alloc(70_000), Buffer.alloc(0)]) {
    assert.throws(() => readSimulatorPackage(invalid));
  }
});
test('permits only the matching activating MOCK device and pinned development environment', () => {
  assert.doesNotThrow(() => validateSimulatorAssignment(metadata, operation, 'ce-test'));
  for (const [key, value] of Object.entries({ tenantId: 'other', serialNumber: 'MOCK-OTHER', siteId: 'other', profileVersionId: 'other', initialGeneration: 6, iotDataEndpoint: 'attacker.example', fleetProvisioningTemplateName: 'other', region: 'other', certificateId: 'invalid' })) {
    assert.throws(() => validateSimulatorAssignment({ ...metadata, [key]: value }, operation, 'ce-test'));
  }
  for (const patch of [{ serialNumber: 'REAL-001' }, { type: 'DECOMMISSION' }, { status: 'SUCCEEDED' }]) {
    assert.throws(() => validateSimulatorAssignment(metadata, { ...operation, ...patch } as OnboardingOperation, 'ce-test'));
  }
  assert.throws(() => validateSimulatorAssignment(metadata, operation, 'other'));
  for (const unsafe of ['MOCK-../path', 'mock-lowercase', 'MOCK-', '../MOCK-X']) assert.equal(MOCK_SERIAL.test(unsafe), false);
});
