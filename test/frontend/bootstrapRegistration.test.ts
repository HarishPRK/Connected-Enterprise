import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completeBootstrapRegistration, registrationFromMetadata, restoreRegistration, serializeRegistration,
  type BootstrapRegistration,
} from '../../src/features/onboarding/bootstrapRegistration';
import type { OnboardingOperation, VerificationResult } from '../../src/features/onboarding/types';

const metadata = {
  formatVersion: 1, tenantId: 'tenant-a', serialNumber: 'GW-001', modelId: 'model-a',
  siteId: 'site-chosen', profileVersionId: 'profile-v2', certificateId: 'a'.repeat(64),
};
const now = Date.parse('2026-09-18T10:00:00Z');
const verified: VerificationResult = {
  verificationId: 'ver-1', expiresAt: '2026-09-18T10:15:00Z',
  identity: { serialNumber: metadata.serialNumber, modelId: metadata.modelId, hardwareRevision: 'UNKNOWN', manufacturingBatch: 'UNKNOWN' },
  allowedSites: [{ id: metadata.siteId, name: 'Chosen site', location: 'Test' }],
};
const operation: OnboardingOperation = {
  id: 'op-1', type: 'ONBOARD', status: 'IN_PROGRESS', state: 'CLAIM_ACCEPTED',
  gatewayId: 'gateway-1', serialNumber: metadata.serialNumber, siteId: metadata.siteId,
  profileVersionId: metadata.profileVersionId, deploymentGeneration: 1,
  timeline: [], createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
};

function setup() {
  let nextKey = 0;
  const createKey = (scope: string) => `${scope}-${++nextKey}`;
  let saved = registrationFromMetadata(metadata, 'tenant-a', createKey);
  const calls: unknown[][] = [];
  const actions = {
    verify: async (...args: [string, string, string]) => { calls.push(['verify', ...args]); return verified; },
    activate: async (...args: [string, string, string, string]) => { calls.push(['activate', ...args]); return operation; },
    save: (progress: BootstrapRegistration) => { saved = restoreRegistration(serializeRegistration(progress), 'tenant-a', createKey)!; },
    createKey, now: () => now,
  };
  return { actions, calls, get saved() { return saved; } };
}

test('downloaded assignments pass through verification and activation without choosing a newer profile or another site', async () => {
  const flow = setup();
  const original = flow.saved;
  assert.equal(await completeBootstrapRegistration(original, flow.actions), operation);
  assert.deepEqual(flow.calls, [
    ['verify', 'GW-001', original.verifyKey, 'model-a'],
    ['activate', 'ver-1', 'site-chosen', 'profile-v2', original.operationKey],
  ]);
  assert.equal(original.verification, undefined);
  assert.equal(flow.saved.activationAttempted, true);
});

test('refresh and retry recover a lost activation response with the same key and no new reservation', async () => {
  const flow = setup();
  let attempts = 0;
  const keys: string[] = [];
  flow.actions.activate = async (_verification, _site, _profile, key) => {
    keys.push(key);
    if (++attempts === 1) throw new Error('Network response lost');
    return operation;
  };
  await assert.rejects(completeBootstrapRegistration(flow.saved, flow.actions), /Network response lost/);
  // The saved record survives a page reload, even after the reservation expires.
  flow.actions.now = () => now + 60 * 60 * 1000;
  assert.equal(await completeBootstrapRegistration(flow.saved, flow.actions), operation);
  assert.equal(flow.calls.filter(([kind]) => kind === 'verify').length, 1);
  assert.equal(keys[0], keys[1]);
});

test('an expired unsuccessful activation gets a new reservation and request key before retrying', async () => {
  const flow = setup();
  const stale = { ...flow.saved, activationAttempted: true,
    verification: { verificationId: 'ver-old', expiresAt: '2026-09-18T09:00:00Z' } };
  const keys: string[] = [];
  flow.actions.activate = async (verification, _site, _profile, key) => {
    keys.push(key);
    if (verification === 'ver-old') throw Object.assign(new Error('Gateway verification expired'), { status: 409 });
    return operation;
  };
  assert.equal(await completeBootstrapRegistration(stale, flow.actions), operation);
  assert.notEqual(keys[0], keys[1]);
  assert.notEqual(flow.saved.verifyKey, stale.verifyKey);
});

test('an expired verification replay renews once and still keeps the downloaded assignment', async () => {
  const flow = setup();
  let attempts = 0;
  flow.actions.verify = async () => ++attempts === 1
    ? { ...verified, expiresAt: '2026-09-18T09:00:00Z' } : verified;
  await completeBootstrapRegistration(flow.saved, flow.actions);
  assert.equal(attempts, 2);
  assert.equal(flow.saved.profileVersionId, 'profile-v2');
});

test('verification cannot activate a mismatched identity, model, or unauthorized site', async () => {
  for (const result of [
    { ...verified, identity: { ...verified.identity, serialNumber: 'GW-OTHER' } },
    { ...verified, identity: { ...verified.identity, modelId: 'model-other' } },
    { ...verified, allowedSites: [] },
  ]) {
    const flow = setup();
    flow.actions.verify = async () => result;
    await assert.rejects(completeBootstrapRegistration(flow.saved, flow.actions), /does not match/);
    assert.equal(flow.calls.length, 0);
  }
});

test('metadata import and persisted progress exclude secrets and reject another tenant or malformed assignments', () => {
  const createKey = (scope: string) => `${scope}-key`;
  const raw = { ...metadata, privateKey: 'secret-value', certificatePem: 'pem-value', downloadUrl: 'blob:private' };
  const progress = registrationFromMetadata(raw, 'tenant-a', createKey);
  const serialized = serializeRegistration({ ...progress, ...raw });
  for (const forbidden of ['privateKey', 'secret-value', 'certificatePem', 'pem-value', 'downloadUrl', 'blob:']) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.deepEqual(restoreRegistration(serialized, 'tenant-a', createKey), { ...progress, activationAttempted: false });
  assert.equal(restoreRegistration(serialized, 'tenant-b', createKey), undefined);
  assert.equal(restoreRegistration('{bad', 'tenant-a', createKey), undefined);
  assert.throws(() => registrationFromMetadata({ ...metadata, siteId: '' }, 'tenant-a', createKey));
  assert.throws(() => registrationFromMetadata({ ...metadata, certificateId: '' }, 'tenant-a', createKey));
  assert.throws(() => registrationFromMetadata(metadata, 'tenant-b', createKey));
});
