import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import {
  createOnboardingAwsBridge,
  OnboardingAwsBridgeError,
  type OnboardingAwsBridgeConfig,
  type OnboardingAwsInvocationResult,
  type OnboardingAwsInvoke,
  type OnboardingAwsRequest,
} from './onboardingAwsBridge.js';

const CONFIG: OnboardingAwsBridgeConfig = {
  apiFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:connected-enterprise-onboarding-dev-api',
  region: 'us-east-1', fixedTenantId: 'tenant-demo', fixedSubject: 'anonymous-ec2-onboarding-dev',
};

function invocation(value: unknown): OnboardingAwsInvocationResult {
  return { StatusCode: 200, Payload: Buffer.from(JSON.stringify(value)) };
}

function jsonResponse(statusCode = 200, value: unknown = { mode: 'aws' }): OnboardingAwsInvocationResult {
  return invocation({ statusCode, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(value) });
}

function expectedError(status: number, code: string) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof OnboardingAwsBridgeError);
    assert.equal(error.status, status);
    assert.equal(error.statusCode, status);
    assert.equal(error.code, code);
    return true;
  };
}

test('constructs fixed service claims instead of trusting request identity or later configuration changes', async () => {
  const config = { ...CONFIG };
  const calls: Parameters<OnboardingAwsInvoke>[0][] = [];
  const bridge = createOnboardingAwsBridge(config, { invoke: async (input) => {
    calls.push(input);
    return jsonResponse(202, { id: 'operation-one' });
  } });
  config.fixedTenantId = 'attacker-tenant';
  config.fixedSubject = 'attacker';
  config.apiFunctionArn = 'arn:aws:lambda:us-east-1:123456789012:function:other';
  const disclosed = bridge.resolvePrincipal();
  disclosed.tenantId = 'another-tenant';
  assert.deepEqual(bridge.resolvePrincipal(), { subject: CONFIG.fixedSubject, tenantId: 'tenant-demo', role: 'tenant_admin' });
  const forged = {
    method: 'POST', path: '/operations', idempotencyKey: 'create-operation-one',
    requestContext: { authorizer: { jwt: { claims: { tenant_id: 'attacker', tenant_role: 'platform_admin' } } } },
    functionName: 'another-function', subject: 'another-user', tenantId: 'another-tenant',
    body: { verificationId: 'v1', siteId: 's1', tenant_id: 'attacker', role: 'platform_admin' },
  };
  const response = await bridge.forward(forged);
  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body.toString()), { id: 'operation-one' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].FunctionName, CONFIG.apiFunctionArn);
  assert.equal(calls[0].InvocationType, 'RequestResponse');
  assert.equal(calls[0].LogType, 'None');
  const payload = calls[0].Payload;
  assert.ok(payload instanceof Uint8Array);
  const event = JSON.parse(Buffer.from(payload).toString());
  assert.deepEqual(event.requestContext.authorizer.jwt.claims, {
    token_use: 'access', sub: CONFIG.fixedSubject, tenant_id: 'tenant-demo', tenant_role: 'tenant_admin',
  });
  assert.equal(event.routeKey, 'POST /api/onboarding/operations');
  assert.equal(event.headers['idempotency-key'], 'create-operation-one');
  assert.equal(event.functionName, undefined);
  assert.equal(event.subject, undefined);
  assert.equal(JSON.parse(event.body).tenant_id, 'attacker'); // Data is never promoted into authorization.
});

test('forwards all nine UI routes with exact Lambda route keys and decoded resource identifiers', async () => {
  const events: Record<string, unknown>[] = [];
  const bridge = createOnboardingAwsBridge(CONFIG, { invoke: async (input) => {
    assert.ok(input.Payload instanceof Uint8Array);
    events.push(JSON.parse(Buffer.from(input.Payload).toString()));
    return jsonResponse();
  } });
  const cases = [
    ['GET', '/snapshot', 'GET /api/onboarding/snapshot'],
    ['POST', '/claims/verify', 'POST /api/onboarding/claims/verify'],
    ['POST', '/bootstrap-packages', 'POST /api/onboarding/bootstrap-packages'],
    ['POST', '/profiles', 'POST /api/onboarding/profiles'],
    ['POST', '/controller', 'POST /api/onboarding/controller'],
    ['POST', '/operations', 'POST /api/onboarding/operations'],
    ['GET', '/operations/op%3Aone', 'GET /api/onboarding/operations/{operationId}'],
    ['POST', '/gateways/gw-one/decommission', 'POST /api/onboarding/gateways/{gatewayId}/decommission'],
    ['POST', '/gateways/gw-one/assignments', 'POST /api/onboarding/gateways/{gatewayId}/assignments'],
  ];
  for (const [method, path, routeKey] of cases) {
    await bridge.forward({ method, path, ...(method === 'POST' ? { body: {}, idempotencyKey: 'route-test-01' } : {}) });
    assert.equal(events.at(-1)?.routeKey, routeKey);
  }
  assert.deepEqual(events[6].pathParameters, { operationId: 'op:one' });
  assert.deepEqual(events[7].pathParameters, { gatewayId: 'gw-one' });
  assert.equal(events[0].body, undefined);
});

test('blocks unmapped routes and malformed resource paths before AWS invocation', async () => {
  let calls = 0;
  const bridge = createOnboardingAwsBridge(CONFIG, { invoke: async () => { calls++; return jsonResponse(); } });
  for (const [method, path] of [
    ['PUT', '/profiles'], ['GET', '/profiles'], ['POST', '/profiles/a/versions'],
    ['GET', '/events'], ['POST', '/device-status'], ['GET', '/api/onboarding/snapshot'],
    ['GET', 'https://example.com/snapshot'], ['GET', '/snapshot?tenant=other'],
    ['POST', '/gateways/gateway-a/assignments/'], ['GET', '/operations/../../snapshot'],
  ]) {
    await assert.rejects(bridge.forward({ method, path, body: {} }), expectedError(404, 'ONBOARDING_ROUTE_NOT_FOUND'));
  }
  for (const path of ['/operations/bad%2Fid', '/operations/%ZZ', '/operations/%2e%2e', '/operations/x%00y']) {
    await assert.rejects(bridge.forward({ method: 'GET', path }), expectedError(400, 'ONBOARDING_PATH_INVALID'));
  }
  assert.equal(calls, 0);
});

test('requires bounded JSON object bodies and valid idempotency keys before mutation', async () => {
  let calls = 0;
  const bridge = createOnboardingAwsBridge(CONFIG, { invoke: async () => { calls++; return jsonResponse(); } });
  for (const key of [undefined, 'short', 'a'.repeat(129), 'validkey\r\ninjected']) {
    await assert.rejects(bridge.forward({ method: 'POST', path: '/profiles', body: {}, idempotencyKey: key }), expectedError(428, 'IDEMPOTENCY_KEY_REQUIRED'));
  }
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  for (const body of [undefined, null, [], 'text', circular, { value: BigInt(1) }]) {
    await assert.rejects(bridge.forward({ method: 'POST', path: '/controller', body, idempotencyKey: 'valid-key-01' }), expectedError(400, 'ONBOARDING_BODY_INVALID'));
  }
  await assert.rejects(bridge.forward({ method: 'POST', path: '/controller', body: { text: 'x'.repeat(256 * 1024) }, idempotencyKey: 'valid-key-01' }), expectedError(413, 'ONBOARDING_BODY_TOO_LARGE'));
  await assert.rejects(bridge.forward({ method: 'GET', path: '/snapshot', body: {} }), expectedError(400, 'ONBOARDING_BODY_INVALID'));
  assert.equal(calls, 0);
});

test('rejects non-dev function targets, cross-region configuration and unsafe fixed identifiers', () => {
  const invalid: Partial<OnboardingAwsBridgeConfig>[] = [
    { apiFunctionArn: 'connected-enterprise-onboarding-dev-api' },
    { apiFunctionArn: CONFIG.apiFunctionArn.replace('-dev-api', '-prod-api') },
    { apiFunctionArn: `${CONFIG.apiFunctionArn}:alias` },
    { apiFunctionArn: CONFIG.apiFunctionArn.replace('123456789012', '*') },
    { region: 'us-west-2' }, { fixedTenantId: '../other' }, { fixedSubject: '' },
    { fixedSubject: undefined as unknown as string },
  ];
  for (const change of invalid) {
    assert.throws(() => createOnboardingAwsBridge({ ...CONFIG, ...change }), expectedError(503, 'ONBOARDING_AWS_CONFIGURATION_INVALID'));
  }
  for (const timeoutMs of [0, -1, Infinity, 60_001]) {
    assert.throws(() => createOnboardingAwsBridge(CONFIG, { timeoutMs }), expectedError(503, 'ONBOARDING_AWS_CONFIGURATION_INVALID'));
  }
});

test('preserves AWS application error status while removing cookies, redirects and cacheable headers', async () => {
  const bridge = createOnboardingAwsBridge(CONFIG, { invoke: async () => invocation({
    statusCode: 409,
    headers: {
      'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600',
      'Set-Cookie': 'upstream-cookie=discard', Location: 'https://example.com',
      Authorization: 'discard', 'X-Request-Id': 'aws-request-id', 'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ error: 'Idempotency-Key was already used with a different request' }),
  }) });
  const result = await bridge.forward({ method: 'GET', path: '/snapshot' });
  assert.equal(result.statusCode, 409);
  assert.equal(result.headers['cache-control'], 'no-store, private');
  assert.equal(result.headers['x-content-type-options'], 'nosniff');
  assert.equal(result.headers['x-request-id'], 'aws-request-id');
  assert.equal(result.headers['set-cookie'], undefined);
  assert.equal(result.headers.location, undefined);
  assert.equal(result.headers.authorization, undefined);
  assert.equal(result.headers['access-control-allow-origin'], undefined);
});

test('decodes bootstrap ZIP bytes and retains download metadata without logging bodies', async () => {
  const bytes = Buffer.from([0x50, 0x4b, 3, 4, 0, 255, 127, 10]);
  const certificateId = 'ab'.repeat(32);
  const bridge = createOnboardingAwsBridge(CONFIG, { invoke: async () => invocation({
    statusCode: 201, isBase64Encoded: true,
    headers: {
      'content-type': 'application/zip', 'x-certificate-id': certificateId,
      'content-disposition': 'attachment; filename="bootstrap.zip"',
    }, body: bytes.toString('base64'),
  }) });
  const result = await bridge.forward({ method: 'POST', path: '/bootstrap-packages', body: {}, idempotencyKey: 'bootstrap-01' });
  assert.deepEqual(result.body, bytes);
  assert.equal(result.statusCode, 201);
  assert.equal(result.headers['x-certificate-id'], certificateId);
  assert.equal(result.headers['content-disposition'], 'attachment; filename="bootstrap.zip"');
});

test('rejects malformed AWS responses and binary responses on other routes', async () => {
  const valid = { statusCode: 200, headers: { 'content-type': 'application/json' }, body: '{}' };
  const cases: OnboardingAwsInvocationResult[] = [
    { StatusCode: 202, Payload: Buffer.from('{}') }, { StatusCode: 200 },
    { StatusCode: 200, Payload: Buffer.from('not JSON') }, invocation([]),
    invocation({ ...valid, statusCode: 99 }), invocation({ ...valid, statusCode: '200' }),
    invocation({ ...valid, body: {} }), invocation({ ...valid, isBase64Encoded: 'true' }),
    invocation({ ...valid, headers: { 'content-type': 'text/html' } }),
    invocation({ ...valid, headers: { 'content-type': 'application/json\r\nInjected: yes' } }),
    invocation({ ...valid, isBase64Encoded: true, body: 'bad$$base64' }),
    invocation({ ...valid, statusCode: 201, isBase64Encoded: true, headers: { 'content-type': 'application/zip', 'x-certificate-id': 'ab'.repeat(32) }, body: 'UEsDBA==' }),
  ];
  for (const result of cases) {
    const bridge = createOnboardingAwsBridge(CONFIG, { invoke: async () => result });
    await assert.rejects(bridge.forward({ method: 'GET', path: '/snapshot' }), expectedError(502, 'ONBOARDING_AWS_RESPONSE_INVALID'));
  }
});

test('sanitizes AWS function and transport failures rather than exposing their payload or credentials', async () => {
  const functions: OnboardingAwsInvoke[] = [
    async () => ({ StatusCode: 200, FunctionError: 'Unhandled', Payload: Buffer.from('sensitive-upstream-detail') }),
    async () => { throw new Error('sensitive-upstream-detail'); },
  ];
  for (const [index, invoke] of functions.entries()) {
    const bridge = createOnboardingAwsBridge(CONFIG, { invoke });
    await assert.rejects(bridge.forward({ method: 'GET', path: '/snapshot' }), (error: unknown) => {
      assert.ok(error instanceof OnboardingAwsBridgeError);
      assert.equal(error.status, index === 0 ? 502 : 503);
      assert.equal(error.message.includes('sensitive-upstream-detail'), false);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test('times out and aborts a stalled invocation without hanging the request', async () => {
  let signal: AbortSignal | undefined;
  const bridge = createOnboardingAwsBridge(CONFIG, {
    timeoutMs: 10,
    invoke: async (_input, options) => {
      signal = options.abortSignal;
      return new Promise(() => {});
    },
  });
  await assert.rejects(bridge.forward({ method: 'GET', path: '/snapshot' }), expectedError(504, 'ONBOARDING_AWS_TIMEOUT'));
  assert.equal(signal?.aborted, true);
});

test('POST requests preserve idempotency on repeated forwarding and use independent request IDs', async () => {
  const events: Array<{ headers: Record<string, string>; requestContext: { requestId: string } }> = [];
  const bridge = createOnboardingAwsBridge(CONFIG, { invoke: async (input) => {
    assert.ok(input.Payload instanceof Uint8Array);
    events.push(JSON.parse(Buffer.from(input.Payload).toString()));
    return jsonResponse(202);
  } });
  const request: OnboardingAwsRequest = { method: 'POST', path: '/operations', body: { verificationId: 'same' }, idempotencyKey: 'same-request-key' };
  await bridge.forward(request);
  await bridge.forward(request);
  assert.equal(events[0].headers['idempotency-key'], events[1].headers['idempotency-key']);
  assert.notEqual(events[0].requestContext.requestId, events[1].requestContext.requestId);
});
