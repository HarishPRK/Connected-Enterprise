import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createRoutingConfigRouter } from './routingConfigRoutes.js';
import { defaultRoutingConfig, ROUTING_TEMPLATES, type RoutingConfig } from '../shared/routing-config.js';
import { validateProfileControls } from '../src/features/onboarding/profileFormValidation.js';
import { defaultProfileParameters } from '../src/features/onboarding/profileCatalog.js';
import { mergeAarSnapshot, type AarRoutingState } from '../src/ui/useAarRouting.js';

describe('routing configuration HTTP API', () => {
  let directory: string;
  let server: Server;
  let baseUrl: string;
  let dataFile: string;
  const start = async () => {
    const app = express();
    app.use(express.json());
    app.use('/config', createRoutingConfigRouter({ dataFile }));
    server = await new Promise<Server>((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/config`;
  };
  const close = async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  const put = (branchId: string, config: RoutingConfig) => fetch(`${baseUrl}/${branchId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
  before(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'ce-routing-test-'));
    dataFile = path.join(directory, 'routing.json');
    await start();
  });
  after(async () => { await close(); await rm(directory, { recursive: true, force: true }); });

  it('starts with enterprise examples marked as sample traffic and default SLA bounds', async () => {
    const response = await fetch(`${baseUrl}/b-mck-03`);
    assert.equal(response.status, 200);
    const config = await response.json() as RoutingConfig;
    assert.equal(config.revision, 0);
    assert.equal(config.policies.length, 10);
    assert.ok(config.policies.every((policy) => policy.trafficSource === 'sample'));
    assert.equal(config.policies[0].app, 'Microsoft Teams');
    assert.equal(config.policies[0].throughputMbps, 88);
    assert.equal(config.thresholds.length, 4);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
  it('saves, trims, and reloads branch-specific policies and thresholds after a restart', async () => {
    const next = defaultRoutingConfig('b-mck-03');
    next.policies = [{ ...ROUTING_TEMPLATES[0], id: 'saved-policy', app: '  Teams  ', match: '  DSCP EF  ' }];
    next.thresholds[0].fiber.warn = 42;
    const response = await put('b-mck-03', next);
    assert.equal(response.status, 200);
    const saved = await response.json() as RoutingConfig;
    assert.equal(saved.revision, 1);
    assert.equal(saved.policies[0].app, 'Teams');
    assert.equal(saved.policies[0].match, 'DSCP EF');
    await close();
    await start();
    assert.deepEqual(await (await fetch(`${baseUrl}/b-mck-03`)).json(), saved);
    assert.deepEqual((await (await fetch(`${baseUrl}/b-pln-01`)).json()).policies, defaultRoutingConfig('b-pln-01').policies);
    assert.equal(JSON.parse(await readFile(dataFile, 'utf8'))['b-mck-03'].thresholds[0].fiber.warn, 42);
  });
  it('persists example edits and their sample provenance without changing another branch', async () => {
    const next = defaultRoutingConfig('examples-edited');
    next.policies[0].preferredPath = '5G';
    next.policies[0].backupPath = 'Fiber';
    const response = await put('examples-edited', next);
    assert.equal(response.status, 200);
    await close();
    await start();
    const saved = await (await fetch(`${baseUrl}/examples-edited`)).json() as RoutingConfig;
    assert.equal(saved.policies[0].preferredPath, '5G');
    assert.equal(saved.policies[0].trafficSource, 'sample');
    assert.equal(defaultRoutingConfig('another-branch').policies[0].preferredPath, 'Fiber');
  });
  it('preserves an explicitly saved empty policy list across reloads', async () => {
    const next = { ...defaultRoutingConfig('deliberately-empty'), policies: [] };
    assert.equal((await put('deliberately-empty', next)).status, 200);
    await close();
    await start();
    const saved = await (await fetch(`${baseUrl}/deliberately-empty`)).json() as RoutingConfig;
    assert.equal(saved.revision, 1);
    assert.deepEqual(saved.policies, []);
  });
  it('rejects stale concurrent writes and keeps the accepted revision', async () => {
    const first = defaultRoutingConfig('concurrent');
    const [a, b] = await Promise.all([put('concurrent', first), put('concurrent', first)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal((await (await fetch(`${baseUrl}/concurrent`)).json()).revision, 1);
  });
  it('rejects invalid policy paths, duplicate identifiers, and invalid MOS ordering', async () => {
    const config = defaultRoutingConfig('invalid');
    config.policies = [{ ...ROUTING_TEMPLATES[0], backupPath: 'Fiber' }];
    assert.equal((await put('invalid', config)).status, 400);
    config.policies = [ROUTING_TEMPLATES[0], ROUTING_TEMPLATES[0]];
    assert.equal((await put('invalid', config)).status, 400);
    config.policies = [];
    config.thresholds[3].fiber.warn = 2;
    assert.equal((await put('invalid', config)).status, 400);
    assert.equal((await (await fetch(`${baseUrl}/invalid`)).json()).revision, 0);
  });
  it('does not treat inherited object keys as saved branches', async () => {
    assert.equal((await (await fetch(`${baseUrl}/constructor`)).json()).revision, 0);
    const response = await put('__proto__', defaultRoutingConfig('__proto__'));
    assert.equal(response.status, 200);
    assert.equal((await (await fetch(`${baseUrl}/__proto__`)).json()).revision, 1);
  });
  it('reports a persistence failure without mutating in-memory state', async () => {
    const blockingPath = path.join(directory, 'blocked');
    await writeFile(blockingPath, 'not a directory');
    const app = express();
    app.use(express.json());
    app.use('/config', createRoutingConfigRouter({ dataFile: path.join(blockingPath, 'routing.json') }));
    const failedServer = await new Promise<Server>((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
    try {
      const url = `http://127.0.0.1:${(failedServer.address() as AddressInfo).port}/config/failure`;
      const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(defaultRoutingConfig('failure')) });
      assert.equal(response.status, 503);
      assert.match((await response.json()).error, /not applied/);
    } finally { await new Promise<void>((resolve) => failedServer.close(() => resolve())); }
  });
});

describe('onboarding profile field validation', () => {
  it('rejects empty, out-of-range and fractional integer inputs before submitting', () => {
    assert.match(validateProfileControls({ lanMtu: '' }) ?? '', /requires a number/);
    assert.match(validateProfileControls({ lanMtu: 99999 }) ?? '', /at most/);
    assert.match(validateProfileControls({ wanVlanId: 2.5 }) ?? '', /increments/);
    assert.equal(validateProfileControls(defaultProfileParameters()), undefined);
    assert.match(validateProfileControls({ wanMode: 'unsupported' }) ?? '', /supported/);
  });
});

describe('AAR feed reconciliation', () => {
  const previous: AarRoutingState = { tunnels: [{ iface: 'fiber1', latency_ms: 10, updatedAt: 2 }], decisions: [], flows: [], routes: [], connected: true, receivedAt: 200 };
  it('preserves routing data on partial status and ignores malformed or older responses', () => {
    assert.deepEqual(mergeAarSnapshot(previous, { connected: false }), { ...previous, connected: false });
    assert.equal(mergeAarSnapshot(previous, { error: 'service unavailable' }), previous);
    assert.equal(mergeAarSnapshot(previous, { tunnels: 'invalid' }), previous);
    assert.equal(mergeAarSnapshot(previous, { receivedAt: 100, tunnels: [] }), previous);
    assert.deepEqual(mergeAarSnapshot(previous, { receivedAt: 201, tunnels: [] }).tunnels, []);
  });
});
