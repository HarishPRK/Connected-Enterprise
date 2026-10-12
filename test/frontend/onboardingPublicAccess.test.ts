import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  completeOnboardingSignIn,
  currentOnboardingUser,
  discoverOnboardingAccessMode,
  onboardingApiUrl,
  onboardingAuthorizationHeaders,
  onboardingRequestCredentials,
  onboardingSseEnabled,
} from '../../src/features/onboarding/auth';
import { fetchOnboardingSnapshot, generateBootstrapPackage, verifyFactorySerial } from '../../src/features/onboarding/api';
import type { BootstrapPackageInput } from '../../src/features/onboarding/types';

const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const principal = { subject: 'anonymous-ec2-onboarding-dev', tenantId: 'ce-test', tenantRole: 'tenant_admin' };
const enabled = () => ({ mode: 'temporary-public-aws', user: principal, expiresAt: new Date(Date.now() + 60_000).toISOString() });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(async () => {
  Date.now = originalNow;
  globalThis.fetch = async () => json({ mode: 'cognito' });
  await discoverOnboardingAccessMode();
  globalThis.fetch = originalFetch;
});

test('server-selected public AWS access works without browser globals, tokens, cookies, or SSE', async () => {
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    assert.equal(input, '/api/onboarding/access-mode');
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('authorization'), null);
    return json(enabled());
  };
  const access = await discoverOnboardingAccessMode();
  assert.equal(access.mode, 'temporary-public-aws');
  assert.deepEqual(currentOnboardingUser(), principal);
  assert.deepEqual(await onboardingAuthorizationHeaders(), {});
  assert.equal(await completeOnboardingSignIn(), true);
  assert.equal(calls, 1, 'Public mode must not call an OAuth token endpoint');
  assert.equal(onboardingApiUrl('/api/onboarding/snapshot'), '/api/onboarding/live/snapshot');
  assert.equal(onboardingApiUrl('/api/onboarding/operations/op-1'), '/api/onboarding/live/operations/op-1');
  assert.throws(() => onboardingApiUrl('/other-api'), /unavailable/);
  assert.equal(onboardingRequestCredentials(), 'omit');
  assert.equal(onboardingSseEnabled(), false);
});

test('public API reads and mutations preserve business input and idempotency without Bearer headers', async () => {
  globalThis.fetch = async () => json(enabled());
  await discoverOnboardingAccessMode();
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return json({ data: String(input).endsWith('/snapshot') ? { mode: 'aws' } : { verificationId: 'verification-1' } });
  };
  assert.deepEqual(await fetchOnboardingSnapshot(), { mode: 'aws' });
  assert.deepEqual(await verifyFactorySerial('SERIAL-001', 'verify-key-001', undefined, 'model-1'), { verificationId: 'verification-1' });
  assert.equal(requests[0]?.url, '/api/onboarding/live/snapshot');
  assert.equal(requests[1]?.url, '/api/onboarding/live/claims/verify');
  assert.equal(requests[1]?.init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), { serialNumber: 'SERIAL-001', modelId: 'model-1' });
  assert.equal(new Headers(requests[1]?.init?.headers).get('idempotency-key'), 'verify-key-001');
  for (const request of requests) {
    assert.equal(request.init?.credentials, 'omit');
    assert.equal(new Headers(request.init?.headers).get('authorization'), null);
  }
});

test('public package download retains binary response and certificate metadata', async () => {
  globalThis.fetch = async () => json(enabled());
  await discoverOnboardingAccessMode();
  globalThis.fetch = async (input, init) => {
    assert.equal(input, '/api/onboarding/live/bootstrap-packages');
    assert.equal(new Headers(init?.headers).get('idempotency-key'), 'package-key-001');
    assert.equal(init?.credentials, 'omit');
    assert.equal(new Headers(init?.headers).get('authorization'), null);
    return new Response(new Uint8Array([80, 75, 3, 4]), {
      headers: { 'Content-Type': 'application/zip', 'x-certificate-id': 'a'.repeat(64) },
    });
  };
  const input = { serialNumber: 'SERIAL-001', modelId: 'model-1', siteId: 'site-1' } as BootstrapPackageInput;
  const result = await generateBootstrapPackage(input, 'package-key-001');
  assert.equal(result.certificateId, 'a'.repeat(64));
  assert.equal(result.archive.size, 4);
  assert.equal(result.archive.type, 'application/zip');
});

test('explicit disabled mode and missing endpoint restore the existing authentication path', async () => {
  for (const fallback of [json({ mode: 'cognito' }), json({}, 404), json({ error: { code: 'ONBOARDING_AUTH_REQUIRED' } }, 503)]) {
    globalThis.fetch = async () => json(enabled());
    await discoverOnboardingAccessMode();
    globalThis.fetch = async () => fallback;
    assert.deepEqual(await discoverOnboardingAccessMode(), { mode: 'cognito' });
    assert.equal(currentOnboardingUser(), undefined);
    assert.equal(onboardingApiUrl('/api/onboarding/snapshot'), '/api/onboarding/snapshot');
    assert.equal(onboardingRequestCredentials(), 'same-origin');
  }
});

test('public configuration errors and unknown 503 responses never restore Cognito access', async () => {
  for (const unavailable of [
    json({ error: { code: 'ONBOARDING_CONFIGURATION_ERROR', message: 'Temporary onboarding access is not configured correctly.' } }, 503),
    json({}, 503),
    new Response('Service unavailable', { status: 503 }),
  ]) {
    globalThis.fetch = async () => json(enabled());
    await discoverOnboardingAccessMode();
    globalThis.fetch = async () => unavailable;
    await assert.rejects(discoverOnboardingAccessMode(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /sign.?in/i);
      return true;
    });
    assert.equal(currentOnboardingUser(), undefined);
    await assert.rejects(onboardingAuthorizationHeaders());
    await assert.rejects(completeOnboardingSignIn());
    assert.equal(onboardingSseEnabled(), false);
  }
});

test('malformed, expired, or elevated public principals fail closed instead of enabling access', async () => {
  const valid = enabled();
  const invalid = [
    { ...valid, expiresAt: new Date(Date.now() - 1).toISOString() },
    { ...valid, expiresAt: 'next week' },
    { ...valid, user: { ...principal, tenantRole: 'platform_admin' } },
    { ...valid, user: { ...principal, tenantId: '../another-tenant' } },
    { ...valid, user: { ...principal, subject: '' } },
    { ...valid, user: undefined },
    { mode: 'unknown' },
  ];
  for (const payload of invalid) {
    globalThis.fetch = async () => json(payload);
    await assert.rejects(discoverOnboardingAccessMode());
    assert.equal(currentOnboardingUser(), undefined);
    await assert.rejects(onboardingAuthorizationHeaders());
    await assert.rejects(completeOnboardingSignIn());
    assert.equal(onboardingSseEnabled(), false);
  }
});

test('an expired enabled mode blocks a later business request before fetch', async () => {
  const start = Date.now();
  globalThis.fetch = async () => json(enabled());
  await discoverOnboardingAccessMode();
  Date.now = () => start + 120_000;
  globalThis.fetch = async () => { throw new Error('Expired access must not make a request'); };
  await assert.rejects(fetchOnboardingSnapshot(), /expired/);
  assert.equal(currentOnboardingUser(), undefined);
});

test('a disabled live bridge surfaces its service error and never requests sign-in', async () => {
  globalThis.fetch = async () => json(enabled());
  await discoverOnboardingAccessMode();
  globalThis.fetch = async () => json({ error: { code: 'TEMPORARY_ACCESS_DISABLED', message: 'Temporary live onboarding access is unavailable.' } }, 503);
  await assert.rejects(fetchOnboardingSnapshot(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'Temporary live onboarding access is unavailable.');
    assert.doesNotMatch(error.message, /sign.?in/i);
    return true;
  });
  assert.equal(onboardingApiUrl('/api/onboarding/snapshot'), '/api/onboarding/live/snapshot');
});
