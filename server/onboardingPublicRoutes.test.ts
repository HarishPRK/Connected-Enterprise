import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { createPublicOnboardingRouter, publicOnboardingConfig } from './onboardingPublicRoutes.js';
import type { createOnboardingAwsBridge, OnboardingAwsResponse } from './onboardingAwsBridge.js';

const initialTime = Date.parse('2026-10-12T20:00:00Z');
const origin = 'https://connectedenterprise.app';
const configuredEnv = {
  ONBOARDING_PUBLIC_AWS_ENABLED: 'true',
  ONBOARDING_PUBLIC_AWS_REGION: 'us-east-1',
  ONBOARDING_PUBLIC_AWS_FUNCTION_ARN: 'arn:aws:lambda:us-east-1:123456789012:function:connected-enterprise-onboarding-dev-api',
  ONBOARDING_PUBLIC_AWS_TENANT_ID: 'tenant-test',
  ONBOARDING_PUBLIC_AWS_EXPIRES_AT: new Date(initialTime + 60_000).toISOString(),
  ONBOARDING_PUBLIC_AWS_ORIGINS: origin,
};

describe('temporary anonymous live onboarding router', () => {
  let server: Server;
  let baseUrl: string;
  let clock = initialTime;
  const calls: Array<Parameters<ReturnType<typeof createOnboardingAwsBridge>['forward']>[0]> = [];
  let upstreamFailure = false;
  before(async () => {
    const app = express();
    app.use(express.json());
    const factory: typeof createOnboardingAwsBridge = (config) => ({
      resolvePrincipal: () => ({ subject: config.fixedSubject, tenantId: config.fixedTenantId, role: 'tenant_admin' }),
      forward: async (input): Promise<OnboardingAwsResponse> => {
        calls.push(input);
        if (upstreamFailure) throw new Error('Upstream secret diagnostic must never reach the browser');
        return input.path === '/bootstrap-packages'
          ? { statusCode: 201, headers: { 'content-type': 'application/zip', 'x-certificate-id': 'certificate-test' }, body: Buffer.from([80, 75, 0, 255]) }
          : { statusCode: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from('{"mode":"aws"}') };
      },
    });
    app.use('/enabled', createPublicOnboardingRouter({ env: configuredEnv, now: () => clock, bridgeFactory: factory }));
    app.use('/disabled', createPublicOnboardingRouter({ env: {}, now: () => clock, bridgeFactory: () => { throw new Error('Must not create AWS client'); } }));
    server = await new Promise<Server>((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

  it('is disabled by default and never falls through a live route to the simulator', async () => {
    assert.deepEqual(await (await fetch(`${baseUrl}/disabled/access-mode`)).json(), { mode: 'cognito' });
    assert.equal((await fetch(`${baseUrl}/disabled/live/snapshot`)).status, 503);
    assert.equal(calls.length, 0);
  });

  it('opens a configured AWS tenant without a token, cookie, or sign-in exchange', async () => {
    const response = await fetch(`${baseUrl}/enabled/access-mode`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(await response.json(), {
      mode: 'temporary-public-aws',
      user: { subject: 'anonymous-ec2-onboarding-dev', tenantId: 'tenant-test', tenantRole: 'tenant_admin' },
      expiresAt: configuredEnv.ONBOARDING_PUBLIC_AWS_EXPIRES_AT,
    });
    const snapshot = await fetch(`${baseUrl}/enabled/live/snapshot`);
    assert.equal(snapshot.status, 200);
    assert.deepEqual(await snapshot.json(), { mode: 'aws' });
  });

  it('rejects cross-origin and form mutations without calling AWS', async () => {
    const previous = calls.length;
    for (const suppliedOrigin of [undefined, 'https://another.example']) {
      const response = await fetch(`${baseUrl}/enabled/live/profiles`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(suppliedOrigin ? { Origin: suppliedOrigin } : {}) }, body: '{}',
      });
      assert.equal(response.status, 403);
    }
    const form = await fetch(`${baseUrl}/enabled/live/profiles`, { method: 'POST', headers: { Origin: origin }, body: 'name=test' });
    assert.equal(form.status, 415);
    assert.equal(calls.length, previous);
  });

  it('preserves live package bytes, status, certificate metadata, and retry key', async () => {
    const response = await fetch(`${baseUrl}/enabled/live/bootstrap-packages`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': 'package-request-1' },
      body: JSON.stringify({ serialNumber: 'SERIAL-1' }),
    });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('x-certificate-id'), 'certificate-test');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([80, 75, 0, 255]));
    assert.equal(calls.at(-1)?.idempotencyKey, 'package-request-1');
  });

  it('does not forward unsupported methods or expose internal errors', async () => {
    const previous = calls.length;
    assert.equal((await fetch(`${baseUrl}/enabled/live/profiles`, { method: 'DELETE' })).status, 405);
    assert.equal(calls.length, previous);
    upstreamFailure = true;
    const response = await fetch(`${baseUrl}/enabled/live/snapshot`);
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /secret diagnostic/);
    upstreamFailure = false;
  });

  it('revokes anonymous reads and writes at expiry without a restart', async () => {
    clock = initialTime + 60_000;
    const previous = calls.length;
    assert.deepEqual(await (await fetch(`${baseUrl}/enabled/access-mode`)).json(), { mode: 'cognito' });
    assert.equal((await fetch(`${baseUrl}/enabled/live/snapshot`)).status, 503);
    assert.equal((await fetch(`${baseUrl}/enabled/live/operations`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' })).status, 503);
    assert.equal(calls.length, previous);
  });
});

it('requires bounded expiry, fixed development Lambda and explicit origins', () => {
  for (const invalid of [
    { ONBOARDING_PUBLIC_AWS_EXPIRES_AT: '' },
    { ONBOARDING_PUBLIC_AWS_EXPIRES_AT: new Date(initialTime + 8 * 86400_000).toISOString() },
    { ONBOARDING_PUBLIC_AWS_ORIGINS: '*' },
    { ONBOARDING_PUBLIC_AWS_ORIGINS: 'https://connectedenterprise.app/path' },
    { ONBOARDING_PUBLIC_AWS_FUNCTION_ARN: 'arn:aws:lambda:us-east-1:123456789012:function:any-other-function' },
    { ONBOARDING_PUBLIC_AWS_REGION: 'us-west-2' },
    { ONBOARDING_PUBLIC_AWS_TENANT_ID: 'tenant#other' },
  ]) assert.throws(() => publicOnboardingConfig({ ...configuredEnv, ...invalid }, initialTime));
});
