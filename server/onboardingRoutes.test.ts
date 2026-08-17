import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { createOnboardingRouter } from './onboardingRoutes.js';
import { MemoryOnboardingRepository } from './onboardingStore.js';

describe('onboarding HTTP API', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    const app = express();
    app.use(express.json({ limit: '256kb' }));
    app.use('/api/onboarding', await createOnboardingRouter({
      repository: new MemoryOnboardingRepository(),
      simulateDevice: false,
      activationPepper: 'route-test-pepper',
      allowDevelopmentOperator: true,
    }));
    server = await new Promise<Server>((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/onboarding`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('uses a server-fixed tenant context and sends no-store responses', async () => {
    const response = await fetch(`${baseUrl}/snapshot`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const snapshot = await response.json() as { tenant: { id: string }; gateways: unknown[] };
    assert.equal(snapshot.tenant.id, 'tenant_demo');
    assert.deepEqual(snapshot.gateways, []);
  });

  it('rejects requests that arrived through a forwarding proxy', async () => {
    const response = await fetch(`${baseUrl}/snapshot`, {
      headers: { 'X-Forwarded-For': '203.0.113.10' },
    });
    assert.equal(response.status, 403);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, 'LOCAL_SIMULATOR_ONLY');
  });

  it('requires idempotency keys on mutations', async () => {
    const response = await fetch(`${baseUrl}/claims/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serialNumber: 'CE-GW-840021', activationCode: 'LOCAL-ONBOARD-2026' }),
    });
    assert.equal(response.status, 428);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  });

  it('ignores payload tenant assertions and returns authoritative identity', async () => {
    const response = await fetch(`${baseUrl}/claims/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'route-verify-0001',
      },
      body: JSON.stringify({
        tenantId: 'tenant_other',
        serialNumber: 'CE-GW-840021',
        activationCode: 'LOCAL-ONBOARD-2026',
      }),
    });
    assert.equal(response.status, 201);
    const body = await response.json() as { identity: { serialNumber: string; modelId: string }; allowedSites: unknown[] };
    assert.equal(body.identity.serialNumber, 'CE-GW-840021');
    assert.equal(body.identity.modelId, 'edge-pro');
    assert.ok(body.allowedSites.length > 0);
  });
});
