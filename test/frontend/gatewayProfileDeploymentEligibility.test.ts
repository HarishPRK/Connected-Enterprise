import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canSupersedeUnconfirmedProfileAssignment,
  compatibleProfileVersions,
} from '../../src/features/onboarding/gatewayProfileDeploymentEligibility';
import type { Gateway, OnboardingOperation, ProfileVersion } from '../../src/features/onboarding/types';

const gateway: Gateway = {
  id: 'gateway-1',
  thingName: 'gw-device-1',
  serialNumber: 'SERIAL-1',
  modelId: 'model-1',
  hardwareRevision: 'rev-a',
  siteId: 'site-1',
  state: 'ACTIVE',
  certificateState: 'ACTIVE',
  health: 'APPLYING',
  deploymentGeneration: 2,
  profileVersionId: 'profile-v1',
  desiredProfileVersionId: 'profile-v2',
  createdAt: '2026-08-18T16:00:00.000Z',
  updatedAt: '2026-08-18T16:05:00.000Z',
};

const operation: OnboardingOperation = {
  id: 'operation-2',
  type: 'PROFILE_DEPLOY',
  status: 'IN_PROGRESS',
  state: 'PROFILE_STAGED',
  gatewayId: gateway.id,
  serialNumber: gateway.serialNumber,
  siteId: gateway.siteId,
  profileVersionId: gateway.desiredProfileVersionId,
  previousProfileVersionId: gateway.profileVersionId,
  deploymentGeneration: gateway.deploymentGeneration,
  timeline: [{
    state: 'PROFILE_STAGED',
    at: '2026-08-18T16:05:00.000Z',
    detail: 'Signed profile generation 2 delivered over authenticated HTTPS.',
  }],
  createdAt: '2026-08-18T16:00:00.000Z',
  updatedAt: '2026-08-18T16:05:00.000Z',
};

test('allows an exact in-flight profile-delivery projection to be superseded', () => {
  assert.equal(canSupersedeUnconfirmedProfileAssignment(gateway, operation), true);
  const { desiredProfileVersionId: localDesiredProfileVersionId, ...localGateway } = gateway;
  assert.equal(canSupersedeUnconfirmedProfileAssignment(
    { ...localGateway, profileVersionId: localDesiredProfileVersionId },
    operation,
  ), true);
});

test('does not broaden supersession to other in-flight public states', () => {
  const rejectedCases: Array<[Gateway, OnboardingOperation | undefined]> = [
    [{ ...gateway, certificateState: 'INACTIVE' }, operation],
    [{ ...gateway, health: 'HEALTHY' }, operation],
    [{ ...gateway, state: 'PENDING' }, operation],
    [{ ...gateway, desiredProfileVersionId: 'profile-v3' }, operation],
    [{ ...gateway, deploymentGeneration: 3 }, operation],
    [gateway, { ...operation, type: 'ONBOARD' }],
    [gateway, { ...operation, status: 'SUCCEEDED' }],
    [gateway, { ...operation, state: 'APPLYING' }],
    [gateway, undefined],
  ];

  for (const [candidateGateway, candidateOperation] of rejectedCases) {
    assert.equal(
      canSupersedeUnconfirmedProfileAssignment(candidateGateway, candidateOperation),
      false,
    );
  }
});

test('offers the newest compatible unapplied profile first', () => {
  const profile = (id: string, modelId: string, version: number): ProfileVersion => ({
    id,
    profileId: 'profile-family-1',
    name: 'UI test baseline',
    description: 'Test profile',
    modelId,
    version,
    schemaVersion: 2,
    parameters: {},
    contentHash: id,
    immutable: true,
    createdAt: gateway.createdAt,
    createdBy: 'operator-1',
    changeNote: 'Test version',
  });

  assert.deepEqual(
    compatibleProfileVersions([
      profile('profile-v2', gateway.modelId, 2),
      profile('profile-v3', gateway.modelId, 3),
      profile('profile-v1', gateway.modelId, 1),
      profile('other-model-v9', 'other-model', 9),
    ], gateway).map((candidate) => candidate.id),
    ['profile-v3'],
  );
});
