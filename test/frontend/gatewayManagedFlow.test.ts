import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { gatewayFlowPresentation, isManagedGatewaySerial } from '../../src/features/onboarding/gatewayFlowPresentation';
import { OnboardingApiError, startGatewaySimulator, type GatewaySimulatorJob } from '../../src/features/onboarding/api';
import type { OnboardingOperation } from '../../src/features/onboarding/types';

const operation: OnboardingOperation = {
  id: 'op-managed-1', type: 'ONBOARD', status: 'IN_PROGRESS', state: 'CLAIM_ACCEPTED',
  gatewayId: 'gateway-1', serialNumber: 'MOCK-REVIEW-001', siteId: 'site-1', profileVersionId: 'profile-1',
  deploymentGeneration: 5, timeline: [], createdAt: '2026-10-12T12:00:00Z', updatedAt: '2026-10-12T12:00:00Z',
};
const job: GatewaySimulatorJob = { operationId: operation.id, state: 'running', phase: 'Submitting certificate request', startedAt: operation.createdAt };
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('a managed request sends empty JSON and preserves the per-operation key across retries', async () => {
  const requests: RequestInit[] = [];
  const controller = new AbortController();
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), '/api/onboarding/simulator/op-managed-1');
    requests.push(init!);
    return new Response(JSON.stringify({ job }), { status: 202, headers: { 'Content-Type': 'application/json' } });
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.deepEqual(await startGatewaySimulator(operation.id, `ce-simulator-${operation.id}`, controller.signal), { job });
  }
  for (const request of requests) {
    assert.equal(request.method, 'POST');
    assert.deepEqual(JSON.parse(String(request.body)), {});
    assert.equal(new Headers(request.headers).get('Idempotency-Key'), 'ce-simulator-op-managed-1');
    assert.equal(request.signal, controller.signal);
    assert.doesNotMatch(String(request.body), /archive|private|certificate/i);
  }
});

test('legacy package custody errors remain actionable without offering a credential upload', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: {
    code: 'FLOW_PACKAGE_NOT_RETAINED', message: 'This legacy private key is unavailable. Create a new MOCK- gateway ID.',
  } }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(startGatewaySimulator(operation.id, 'ce-simulator-op-managed-1'), error => {
    assert.ok(error instanceof OnboardingApiError);
    assert.equal(error.code, 'FLOW_PACKAGE_NOT_RETAINED');
    assert.match(error.message, /new MOCK-/);
    return true;
  });
});

test('simulator completion waits for authoritative operation confirmation', () => {
  assert.equal(gatewayFlowPresentation(operation, null).canInitiate, true);
  assert.equal(gatewayFlowPresentation(operation, null, true).canInitiate, false);
  assert.equal(gatewayFlowPresentation(operation, job).state, 'running');
  const completed = { ...job, state: 'completed' as const };
  assert.equal(gatewayFlowPresentation(operation, completed).state, 'awaiting-confirmation');
  assert.equal(gatewayFlowPresentation(operation, completed).canInitiate, false);
  const confirmed = { ...operation, status: 'SUCCEEDED' as const, state: 'APPLIED_HEALTHY' as const };
  assert.equal(gatewayFlowPresentation(confirmed, completed).state, 'confirmed');
  assert.equal(gatewayFlowPresentation({ ...confirmed, state: 'PROFILE_STAGED' }, completed).state, 'closed');
});

test('failure wins over a successful process exit and authenticated retrieval never claims application health', () => {
  const failed = { ...operation, status: 'FAILED' as const, state: 'FAILED' as const, failure: { code: 'HEALTH_FAILED', message: 'The reported health check failed.', rolledBack: true } };
  assert.equal(gatewayFlowPresentation(failed, { ...job, state: 'completed' }).state, 'failed');
  assert.equal(gatewayFlowPresentation(failed, job).detail, failed.failure.message);
  assert.equal(gatewayFlowPresentation(operation, { ...job, state: 'failed' }).canInitiate, false);
  const pullConfirmed = { ...operation, status: 'SUCCEEDED' as const, state: 'APPLIED_HEALTHY' as const,
    configurationSource: 'CONTROLLER' as const, configurationConfirmationMethod: 'AUTHENTICATED_CONFIGURATION_PULL' as const };
  const result = gatewayFlowPresentation(pullConfirmed, job);
  assert.equal(result.title, 'Configuration retrieval confirmed');
  assert.doesNotMatch(result.detail, /health.*passed|healthy|applied/i);
});

test('managed registration accepts only bounded MOCK- identifiers', () => {
  assert.equal(isManagedGatewaySerial('MOCK-GW_001.A'), true);
  assert.equal(isManagedGatewaySerial(`MOCK-${'A'.repeat(91)}`), true);
  for (const value of ['', 'MOCK-', 'REAL-GW-001', 'mock-GW-001', 'MOCK-../GW', `MOCK-${'A'.repeat(92)}`]) {
    assert.equal(isManagedGatewaySerial(value), false, value);
  }
});
