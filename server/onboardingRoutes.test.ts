import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { createOnboardingRouter } from './onboardingRoutes.js';
import { MemoryOnboardingRepository } from './onboardingStore.js';

const schemaV2CoreParameters = {
  lanIpAddress: '10.30.40.1',
  lanPrefixLength: 24,
  lanMtu: 1500,
  wanMtu: 1500,
  dhcpServerEnabled: false,
  dhcpPoolStart: '',
  dhcpPoolEnd: '',
  wanMode: 'DHCP',
  wanVlanId: 0,
  dnsMode: 'WAN_DHCP',
  dnsCacheEnabled: true,
  timezone: 'America/Chicago',
  ntpPrimaryServer: 'time.cloudflare.com',
  ntpSecondaryServer: 'time.google.com',
  ipv4ForwardingEnabled: true,
  natMode: 'MASQUERADE',
  defaultRouteMetric: 100,
};

describe('onboarding HTTP API', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    const app = express();
    app.use(express.json({ limit: '256kb' }));
    app.use('/api/onboarding', await createOnboardingRouter({
      repository: new MemoryOnboardingRepository(),
      simulateDevice: false,
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
      body: JSON.stringify({ serialNumber: 'CE-GW-840021' }),
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
      }),
    });
    assert.equal(response.status, 201);
    const body = await response.json() as { identity: { serialNumber: string; modelId: string }; allowedSites: unknown[] };
    assert.equal(body.identity.serialNumber, 'CE-GW-840021');
    assert.equal(body.identity.modelId, 'edge-pro');
    assert.ok(body.allowedSites.length > 0);
  });

  it('passes explicit profile schema v2 through and defaults legacy requests to v1', async () => {
    const schemaTwoResponse = await fetch(`${baseUrl}/profiles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'route-profile-v2-01',
      },
      body: JSON.stringify({
        name: 'Route Schema Two',
        modelId: 'edge-pro',
        schemaVersion: 2,
        parameters: {
          ...schemaV2CoreParameters,
        },
        changeNote: 'Exercise the schema-v2 route contract',
      }),
    });
    assert.equal(schemaTwoResponse.status, 201);
    const schemaTwo = await schemaTwoResponse.json() as { schemaVersion: number; parameters: Record<string, unknown> };
    assert.equal(schemaTwo.schemaVersion, 2);
    assert.equal(schemaTwo.parameters.wanMode, 'DHCP');

    const legacyResponse = await fetch(`${baseUrl}/profiles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'route-profile-v1-01',
      },
      body: JSON.stringify({
        name: 'Route Legacy Profile',
        modelId: 'edge-pro',
        parameters: { wanMtu: 1492 },
        changeNote: 'Exercise the legacy default schema',
      }),
    });
    assert.equal(legacyResponse.status, 201);
    const legacy = await legacyResponse.json() as { schemaVersion: number };
    assert.equal(legacy.schemaVersion, 1);
  });
});
