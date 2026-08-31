import assert from 'node:assert/strict';
import test from 'node:test';
import {
  automaticControllerAssignmentProfile,
  canSupersedeUnconfirmedProfileAssignment,
  compatibleProfileVersions,
  isAuthenticatedPullConfirmedAssignment,
  isAuthenticatedPullConfirmedOperation,
  isLegacyHttpCompletedProfileAssignment,
  profileAssignmentOperationFor,
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

const legacyHttpCompletedOperation: OnboardingOperation = {
  ...operation,
  status: 'SUCCEEDED',
  state: 'APPLIED_HEALTHY',
  timeline: [
    ...operation.timeline,
    {
      state: 'APPLIED_HEALTHY',
      at: '2026-08-19T13:09:37.000Z',
      detail: 'Signed profile generation 2 was applied and health-validated via HTTPS fetch.',
    },
  ],
};

const pullConfirmedOperation: OnboardingOperation = {
  ...operation,
  status: 'SUCCEEDED',
  state: 'APPLIED_HEALTHY',
  configurationSource: 'CONTROLLER',
  configurationConfirmationMethod: 'AUTHENTICATED_CONFIGURATION_PULL',
  configurationConfirmedAt: '2026-08-19T13:09:37.000Z',
  timeline: [
    ...operation.timeline,
    {
      state: 'APPLIED_HEALTHY',
      at: '2026-08-19T13:09:37.000Z',
      detail: 'Authenticated gateway retrieval confirmed the Controller generation. Apply and health were not reported separately.',
    },
  ],
};

test('recognizes only explicit authenticated Controller pull confirmation', () => {
  const pullConfirmedGateway: Gateway = {
    ...gateway,
    health: 'UNKNOWN',
    profileVersionId: gateway.desiredProfileVersionId,
    configurationSource: 'CONTROLLER',
    configurationConfirmationMethod: 'AUTHENTICATED_CONFIGURATION_PULL',
    configurationConfirmedAt: pullConfirmedOperation.configurationConfirmedAt,
  };
  assert.equal(isAuthenticatedPullConfirmedOperation(pullConfirmedOperation), true);
  assert.equal(isAuthenticatedPullConfirmedAssignment(pullConfirmedGateway, pullConfirmedOperation), true);
  assert.equal(isAuthenticatedPullConfirmedOperation({
    ...pullConfirmedOperation,
    configurationConfirmationMethod: undefined,
  }), false);
  assert.equal(isAuthenticatedPullConfirmedAssignment({
    ...pullConfirmedGateway,
    configurationSource: 'S3',
  }, {
    ...pullConfirmedOperation,
    configurationSource: 'S3',
  }), false);
});

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

test('recognizes and supersedes only the exact legacy HTTPS completion residue', () => {
  const wedgedGateway: Gateway = {
    ...gateway,
    profileVersionId: undefined,
    desiredProfileVersionId: operation.profileVersionId,
  };
  assert.equal(isLegacyHttpCompletedProfileAssignment(wedgedGateway, legacyHttpCompletedOperation), true);
  assert.equal(canSupersedeUnconfirmedProfileAssignment(wedgedGateway, legacyHttpCompletedOperation), true);

  const rejectedCases: Array<[Gateway, OnboardingOperation | undefined]> = [
    [{ ...wedgedGateway, certificateState: 'INACTIVE' }, legacyHttpCompletedOperation],
    [{ ...wedgedGateway, state: 'PENDING' }, legacyHttpCompletedOperation],
    [{ ...wedgedGateway, health: 'DEGRADED' }, legacyHttpCompletedOperation],
    [{ ...wedgedGateway, profileVersionId: operation.profileVersionId }, legacyHttpCompletedOperation],
    [{ ...wedgedGateway, appliedProfileChecksum: 'a'.repeat(64) }, legacyHttpCompletedOperation],
    [wedgedGateway, undefined],
    [wedgedGateway, { ...legacyHttpCompletedOperation, status: 'IN_PROGRESS' }],
    [wedgedGateway, { ...legacyHttpCompletedOperation, state: 'HEALTH_CHECK' }],
    [wedgedGateway, { ...legacyHttpCompletedOperation, gatewayId: 'gateway-racing' }],
    [wedgedGateway, { ...legacyHttpCompletedOperation, deploymentGeneration: 3 }],
    [wedgedGateway, { ...legacyHttpCompletedOperation, profileVersionId: 'profile-racing' }],
    [wedgedGateway, {
      ...legacyHttpCompletedOperation,
      timeline: legacyHttpCompletedOperation.timeline.map((entry) => ({
        ...entry,
        detail: entry.detail.replace('health-validated via HTTPS fetch', 'reported healthy by the device'),
      })),
    }],
  ];

  for (const [candidateGateway, candidateOperation] of rejectedCases) {
    assert.equal(isLegacyHttpCompletedProfileAssignment(candidateGateway, candidateOperation), false);
    assert.equal(canSupersedeUnconfirmedProfileAssignment(candidateGateway, candidateOperation), false);
  }
});

test('selects the exact current profile assignment instead of an unrelated active operation', () => {
  const wedgedGateway: Gateway = {
    ...gateway,
    profileVersionId: undefined,
    desiredProfileVersionId: operation.profileVersionId,
  };
  const unrelatedActiveOperation: OnboardingOperation = {
    ...operation,
    id: 'operation-decommissioning',
    type: 'DECOMMISSION',
    profileVersionId: undefined,
    updatedAt: '2026-08-20T16:05:00.000Z',
  };
  assert.equal(
    profileAssignmentOperationFor(
      wedgedGateway,
      [unrelatedActiveOperation, legacyHttpCompletedOperation],
    )?.id,
    legacyHttpCompletedOperation.id,
  );
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

  const wedgedGateway: Gateway = {
    ...gateway,
    profileVersionId: undefined,
    desiredProfileVersionId: gateway.desiredProfileVersionId,
  };
  assert.deepEqual(
    compatibleProfileVersions([
      profile('profile-v2', gateway.modelId, 2),
      profile('other-model-v9', 'other-model', 9),
    ], wedgedGateway, legacyHttpCompletedOperation).map((candidate) => candidate.id),
    ['profile-v2'],
    'the exact legacy HTTPS completion can create generation N+1 with its assigned profile',
  );

  const stableGateway: Gateway = {
    ...gateway,
    health: 'HEALTHY',
    desiredProfileVersionId: gateway.profileVersionId,
  };
  assert.deepEqual(
    compatibleProfileVersions([
      profile('profile-v1', gateway.modelId, 1),
      profile('other-model-v9', 'other-model', 9),
    ], stableGateway).map((candidate) => candidate.id),
    ['profile-v1'],
    'a healthy gateway can create generation N+1 with its current profile after Controller changes',
  );
});

test('automatically preserves the existing profile baseline for Controller deployment', () => {
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
  const profiles = [
    profile('profile-v1', gateway.modelId, 1),
    profile('profile-v2', gateway.modelId, 2),
    profile('profile-v3', gateway.modelId, 3),
  ];

  assert.equal(
    automaticControllerAssignmentProfile(profiles, gateway)?.id,
    'profile-v1',
    'the applied profile wins over both the desired and newer profiles',
  );
  assert.equal(
    automaticControllerAssignmentProfile(
      profiles,
      { ...gateway, profileVersionId: undefined },
    )?.id,
    'profile-v2',
    'the desired profile preserves legacy or unconfirmed assignment lineage',
  );
});

test('blocks automatic Controller deployment without an existing compatible profile baseline', () => {
  const wrongModelProfile: ProfileVersion = {
    id: 'profile-v1',
    profileId: 'profile-family-1',
    name: 'Wrong model profile',
    description: 'Test profile',
    modelId: 'other-model',
    version: 1,
    schemaVersion: 2,
    parameters: {},
    contentHash: 'wrong-model-profile-v1',
    immutable: true,
    createdAt: gateway.createdAt,
    createdBy: 'operator-1',
    changeNote: 'Test version',
  };

  assert.equal(automaticControllerAssignmentProfile([wrongModelProfile], gateway), undefined);
  assert.equal(
    automaticControllerAssignmentProfile(
      [{ ...wrongModelProfile, modelId: gateway.modelId, id: 'profile-v3', version: 3 }],
      { ...gateway, profileVersionId: undefined, desiredProfileVersionId: undefined },
    ),
    undefined,
    'a newer compatible profile is never silently substituted for missing lineage',
  );
});
