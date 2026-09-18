import assert from 'node:assert/strict';
import test from 'node:test';
import { currentGatewayOperation, gatewayJourney } from '../../src/features/onboarding/gatewayLifecycle';
import type { Gateway, OnboardingOperation } from '../../src/features/onboarding/types';

const gateway: Gateway = {
  id: 'gateway-1', thingName: 'gateway-1', serialNumber: 'MCK-001', modelId: 'gateway',
  hardwareRevision: 'rev-a', siteId: 'mck', state: 'PENDING', certificateState: 'PENDING',
  health: 'UNKNOWN', deploymentGeneration: 5, desiredProfileVersionId: 'profile-3',
  createdAt: '2026-09-18T10:00:00Z', updatedAt: '2026-09-18T10:00:00Z',
};
const operation: OnboardingOperation = {
  id: 'operation-1', type: 'ONBOARD', status: 'IN_PROGRESS', state: 'CLAIM_ACCEPTED',
  gatewayId: gateway.id, serialNumber: gateway.serialNumber, siteId: gateway.siteId,
  deploymentGeneration: 5, profileVersionId: 'profile-3',
  timeline: [{ state: 'CLAIM_ACCEPTED', at: gateway.createdAt, detail: 'Registered' }],
  createdAt: gateway.createdAt, updatedAt: gateway.updatedAt,
};

test('pending certificate focuses identity without claiming configuration or health', () => {
  const journey = gatewayJourney(gateway, operation);
  assert.equal(journey.focus, 'identity');
  assert.equal(journey.group, 'activating');
  assert.deepEqual(journey.stages.map(stage => stage.state), ['complete', 'current', 'pending', 'pending']);
});

test('a past reset cannot make a new generation appear failed', () => {
  const old = { ...operation, deploymentGeneration: 4, status: 'FAILED' as const,
    failure: { code: 'GATEWAY_RESET', message: 'Reset', rolledBack: false } };
  assert.equal(currentGatewayOperation(gateway, [old, operation]), operation);
  assert.equal(currentGatewayOperation(gateway, [old]), undefined);
  assert.equal(gatewayJourney(gateway, old).group, 'activating');
});

test('operational identity advances focus to configuration', () => {
  const journey = gatewayJourney({ ...gateway, state: 'ACTIVE', certificateState: 'ACTIVE', health: 'APPLYING' },
    { ...operation, state: 'PROFILE_STAGED', type: 'PROFILE_DEPLOY' });
  assert.equal(journey.focus, 'configuration');
  assert.deepEqual(journey.stages.map(stage => stage.state), ['complete', 'complete', 'current', 'pending']);
});

test('a healthy gateway finishes all four stages', () => {
  const journey = gatewayJourney({ ...gateway, state: 'ACTIVE', certificateState: 'ACTIVE', health: 'HEALTHY', profileVersionId: 'profile-3' },
    { ...operation, status: 'SUCCEEDED', state: 'APPLIED_HEALTHY' });
  assert.equal(journey.group, 'ready');
  assert.ok(journey.stages.every(stage => stage.state === 'complete'));
});

test('authenticated retrieval never manufactures a healthy validation result', () => {
  const journey = gatewayJourney({
    ...gateway, state: 'ACTIVE', certificateState: 'ACTIVE', health: 'HEALTHY', profileVersionId: 'profile-3',
    configurationSource: 'CONTROLLER', configurationConfirmationMethod: 'AUTHENTICATED_CONFIGURATION_PULL',
  }, { ...operation, status: 'SUCCEEDED', state: 'APPLIED_HEALTHY', type: 'PROFILE_DEPLOY' });
  assert.equal(journey.group, 'attention');
  assert.equal(journey.focus, 'validation');
  assert.equal(journey.stages[2].state, 'complete');
  assert.equal(journey.stages[3].state, 'unconfirmed');
});

test('a new deployment does not inherit the prior healthy status', () => {
  const journey = gatewayJourney({ ...gateway, state: 'ACTIVE', certificateState: 'ACTIVE', health: 'HEALTHY', profileVersionId: 'old-profile' },
    { ...operation, state: 'PROFILE_STAGED', type: 'PROFILE_DEPLOY' });
  assert.equal(journey.group, 'activating');
  assert.equal(journey.stages[3].state, 'pending');
});

test('decommissioning and retired devices do not show an active onboarding stage', () => {
  for (const state of ['DECOMMISSIONING', 'DECOMMISSIONED'] as const) {
    const journey = gatewayJourney({ ...gateway, state, certificateState: 'INACTIVE' },
      { ...operation, type: 'DECOMMISSION', state, status: state === 'DECOMMISSIONED' ? 'SUCCEEDED' : 'IN_PROGRESS' });
    assert.equal(journey.group, 'retired');
    assert.equal(journey.stages.some(stage => stage.state === 'current'), false);
  }
});

test('reported failure and rollback are actionable without inventing an error cause', () => {
  const failure = { code: 'APPLY_FAILED', message: 'Gateway rejected the assigned configuration.', rolledBack: true };
  const journey = gatewayJourney({ ...gateway, state: 'ROLLED_BACK', certificateState: 'ACTIVE' },
    { ...operation, status: 'FAILED', state: 'ROLLED_BACK', failure });
  assert.equal(journey.group, 'attention');
  assert.equal(journey.detail, failure.message);
  assert.equal(journey.stages[2].state, 'attention');
});

test('successful retirement takes precedence over retained degraded health', () => {
  const journey = gatewayJourney({ ...gateway, state: 'DECOMMISSIONED', health: 'DEGRADED', certificateState: 'INACTIVE' },
    { ...operation, type: 'DECOMMISSION', state: 'DECOMMISSIONED', status: 'SUCCEEDED' });
  assert.equal(journey.group, 'retired');
  assert.equal(journey.title, 'Gateway decommissioned');
});

test('an apply report distinguishes received configuration from pending delivery', () => {
  const journey = gatewayJourney({ ...gateway, state: 'ACTIVE', certificateState: 'ACTIVE', health: 'APPLYING' },
    { ...operation, type: 'PROFILE_DEPLOY', state: 'APPLYING' });
  assert.equal(journey.focus, 'configuration');
  assert.equal(journey.title, 'Applying gateway configuration');
});

test('legacy HTTPS retrieval focuses unconfirmed health instead of pending delivery', () => {
  const journey = gatewayJourney({ ...gateway, state: 'ACTIVE', certificateState: 'ACTIVE', health: 'APPLYING' },
    { ...operation, type: 'PROFILE_DEPLOY', status: 'SUCCEEDED', state: 'APPLIED_HEALTHY',
      timeline: [{ state: 'APPLIED_HEALTHY', at: gateway.updatedAt, detail: 'health-validated via HTTPS fetch' }] });
  assert.equal(journey.focus, 'validation');
  assert.equal(journey.stages[2].state, 'complete');
  assert.equal(journey.stages[2].title, 'Configuration retrieved');
  assert.equal(journey.stages[3].state, 'unconfirmed');
});

test('quarantine preserves registration and identity while exposing the failure', () => {
  const journey = gatewayJourney({ ...gateway, state: 'QUARANTINED', certificateState: 'ACTIVE' },
    { ...operation, status: 'FAILED', state: 'FAILED',
      failure: { code: 'ROLLBACK_ATTESTATION_FAILED', message: 'Rollback attestation failed.', rolledBack: false } });
  assert.equal(journey.group, 'attention');
  assert.equal(journey.stages[0].state, 'complete');
  assert.equal(journey.stages[1].state, 'complete');
  assert.equal(journey.stages[0].title, 'Gateway registration accepted');
});
