import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createManagedOnboardingFlow, withManagedBootstrapIssuance } from './onboardingManagedFlow.js';
import type { OnboardingAwsRequest, OnboardingAwsResponse } from './onboardingAwsBridge.js';
import type { OnboardingOperation } from '../src/features/onboarding/types.js';
import type { SimulatorJob } from './onboardingSimulator.js';
import { ManagedBootstrapError, type ManagedBootstrapMetadata } from './onboardingManagedBootstrap.js';

const operation = { id: 'op-managed', type: 'ONBOARD', status: 'IN_PROGRESS', serialNumber: 'MOCK-MANAGED', gatewayId: 'gw-managed',
  siteId: 'site-one', profileVersionId: 'profile-one', deploymentGeneration: 5 } as OnboardingOperation;
const job: SimulatorJob = { operationId: operation.id, state: 'running', phase: 'Connecting to AWS IoT', startedAt: '2026-10-12T00:00:00Z' };
const archive = Buffer.from('private bootstrap bytes');
const json = (value: unknown, statusCode = 200): OnboardingAwsResponse => ({ statusCode, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(value)) });

function fixture(options: { cached?: boolean; cachedModelId?: string; operation?: Partial<OnboardingOperation>; tenantId?: string; stale?: boolean; issuedStatus?: number } = {}) {
  const calls: OnboardingAwsRequest[] = [];
  const retentionChecks: Array<Partial<ManagedBootstrapMetadata> | undefined> = [];
  let retained: Buffer | undefined = options.cached ? archive : undefined;
  let retainedModelId = options.cachedModelId ?? 'model-from-aws';
  let savedJob: SimulatorJob | undefined;
  let starts = 0;
  const flow = createManagedOnboardingFlow({
    tenantId: options.tenantId ?? 'ce-test',
    bridge: {
      resolvePrincipal: () => ({ subject: 'test', tenantId: 'ce-test', role: 'tenant_admin' }),
      forward: async request => {
        calls.push(request);
        if (request.path.startsWith('/operations/')) return json({ operation: { ...operation, ...options.operation } });
        if (request.path === '/snapshot') return json({ tenant: { id: 'ce-test' }, gateways: [{ id: operation.gatewayId, serialNumber: operation.serialNumber,
          state: 'PENDING', siteId: operation.siteId, modelId: 'model-from-aws', desiredProfileVersionId: options.stale ? 'other' : operation.profileVersionId, deploymentGeneration: 5 }] });
        assert.equal(request.path, '/bootstrap-packages');
        return { statusCode: options.issuedStatus ?? 201, headers: { 'content-type': 'application/zip', 'x-certificate-id': 'a'.repeat(64) }, body: archive };
      },
    },
    packages: { prepare: async () => {}, load: async () => retained, retain: async (bytes, expected) => {
      retentionChecks.push(expected);
      if (retained && expected?.modelId && retainedModelId !== expected.modelId) {
        throw new ManagedBootstrapError('BOOTSTRAP_ARTIFACT_INVALID', 'Cached bootstrap model does not match the authoritative assignment.');
      }
      retained = bytes;
      retainedModelId = expected?.modelId ?? retainedModelId;
    } },
    simulator: { status: () => savedJob, prepare: async () => {}, start: async (actualOperation, tenant, encoded) => {
      starts++; assert.deepEqual(actualOperation, operation); assert.equal(tenant, 'ce-test');
      assert.equal(encoded, archive.toString('base64')); savedJob = job; return job;
    } },
  });
  return { flow, calls, starts: () => starts, retained: () => retained, retentionChecks };
}

test('one click prepares and retains a server-side identity from the authoritative assignment', async () => {
  const f = fixture();
  assert.deepEqual(await f.flow.start(operation.id), job);
  assert.deepEqual(f.calls.map(call => call.path), [`/operations/${operation.id}`, '/snapshot', '/bootstrap-packages', `/operations/${operation.id}`, '/snapshot']);
  assert.deepEqual(f.calls[2]?.body, { serialNumber: operation.serialNumber, modelId: 'model-from-aws', siteId: operation.siteId,
    profileVersionId: operation.profileVersionId, acknowledgeOneTimePrivateKey: true });
  assert.match(f.calls[2]!.idempotencyKey!, /^managed-flow-[a-f0-9]{64}$/);
  assert.equal(f.retained(), archive);
  assert.equal(f.retentionChecks.length, 2);
  assert.equal(f.retentionChecks.at(-1)?.modelId, 'model-from-aws');
  assert.equal(JSON.stringify(job).includes('private bootstrap'), false);
});

test('a retained bootstrap and duplicate clicks never mint or launch twice', async () => {
  const f = fixture({ cached: true });
  const first = f.flow.start(operation.id); const second = f.flow.start(operation.id);
  assert.equal(first, second);
  await Promise.all([first, second]);
  await f.flow.start(operation.id);
  assert.equal(f.starts(), 1);
  assert.equal(f.calls.some(call => call.path === '/bootstrap-packages'), false);
  assert.equal(f.retentionChecks.length, 1);
});

test('a cached package for a different model cannot launch or trigger replacement issuance', async () => {
  const f = fixture({ cached: true, cachedModelId: 'different-model' });
  await assert.rejects(f.flow.start(operation.id), (error: unknown) => error instanceof ManagedBootstrapError
    && error.code === 'BOOTSTRAP_ARTIFACT_INVALID');
  assert.equal(f.starts(), 0);
  assert.equal(f.calls.some(call => call.path === '/bootstrap-packages'), false);
  assert.equal(f.retained(), archive);
  assert.deepEqual(f.retentionChecks, [{
    tenantId: 'ce-test', serialNumber: operation.serialNumber, modelId: 'model-from-aws',
    siteId: operation.siteId, profileVersionId: operation.profileVersionId, initialGeneration: operation.deploymentGeneration,
  }]);
});

test('rejects real devices, other tenants and finished operations before issuing any credential', async () => {
  for (const options of [{ operation: { serialNumber: 'REAL-1' } }, { tenantId: 'other' }, { operation: { status: 'SUCCEEDED' as const } }, { operation: { id: 'wrong' } }]) {
    const f = fixture(options); await assert.rejects(f.flow.start(operation.id));
    assert.equal(f.calls.length, 1); assert.equal(f.starts(), 0);
  }
});

test('a changed assignment cannot mint or apply a package', async () => {
  for (const cached of [true, false]) {
    const f = fixture({ stale: true, cached });
    await assert.rejects(f.flow.start(operation.id), /assignment changed/);
    assert.equal(f.calls.length, 2); assert.equal(f.starts(), 0);
  }
});

test('legacy one-time packages and upstream issuance failures stay incomplete with recoverable guidance', async () => {
  for (const issuedStatus of [409, 502]) {
    const f = fixture({ issuedStatus });
    await assert.rejects(f.flow.start(operation.id), issuedStatus === 409 ? /new MOCK-/ : /could not prepare/);
    assert.equal(f.starts(), 0); assert.equal(f.retained(), undefined);
  }
});

test('concurrent issuance cannot consume the last storage slot twice', async () => {
  const store = {};
  let retainedCount = 49;
  let issuedCount = 0;
  const issue = () => withManagedBootstrapIssuance(store, async () => {
    if (retainedCount >= 50) throw new Error('Storage full before issuance');
    issuedCount++;
    await new Promise<void>(resolve => setImmediate(resolve));
    retainedCount++;
  });
  const results = await Promise.allSettled([issue(), issue()]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(issuedCount, 1);
  assert.equal(retainedCount, 50);
});
