import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { WebSocket } from 'ws';
import type { ServerMessage } from '../shared/telemetry.js';
import { readConfig } from './config.js';
import { createTelemetryService } from './service.js';

function inbox(ws: WebSocket) {
  const queue: ServerMessage[] = [];
  const waiters: Array<{ match: (message: ServerMessage) => boolean; resolve: (message: ServerMessage) => void }> = [];
  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString()) as ServerMessage;
    const index = waiters.findIndex((waiter) => waiter.match(message));
    if (index >= 0) waiters.splice(index, 1)[0]!.resolve(message);
    else queue.push(message);
  });
  return (match: (message: ServerMessage) => boolean = () => true) => {
    const index = queue.findIndex(match);
    if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]!);
    return new Promise<ServerMessage>((resolve, reject) => {
      const waiter = { match, resolve: (message: ServerMessage) => { clearTimeout(timer); resolve(message); } };
      const timer = setTimeout(() => { const index = waiters.indexOf(waiter); if (index >= 0) waiters.splice(index, 1); reject(new Error('Packet timed out')); }, 3000);
      waiters.push(waiter);
    });
  };
}

test('HTTP and WebSocket serve the same state, reject invalid commands, broadcast door state and deduplicate commands', async (context) => {
  const service = createTelemetryService({ ...readConfig({}), port: 0 });
  const port = await service.start();
  context.after(async () => { await service.stop(); });
  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).source, 'simulator');
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'http://localhost:5180' });
  const next = inbox(ws);
  await once(ws, 'open');
  const initial = await next((message) => message.type === 'telemetry');
  assert.equal(initial.type, 'telemetry');
  if (initial.type !== 'telemetry') throw new Error('Expected initial telemetry');
  assert.equal(initial.data.doorOpen, false);

  ws.send(JSON.stringify({ type: 'command', id: 'invalid-setpoint', command: 'set-setpoint', value: 0 }));
  const rejected = await next((message) => message.type === 'ack' && message.id === 'invalid-setpoint');
  assert.equal(rejected.type === 'ack' && rejected.ok, false);
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/telemetry`)).json()).temperature.setpoint, 3);

  ws.send(JSON.stringify({ type: 'command', id: 'door-1', command: 'set-door', value: true }));
  const changed = await next((message) => message.type === 'telemetry' && message.data.doorOpen);
  assert.equal(changed.type === 'telemetry' && changed.data.doorOpen, true);
  const ack = await next((message) => message.type === 'ack' && message.id === 'door-1');
  assert.equal(ack.type === 'ack' && ack.ok, true);
  // Reusing the ID does not perform a second mutation, even if the payload differs.
  ws.send(JSON.stringify({ type: 'command', id: 'door-1', command: 'set-door', value: false }));
  await next((message) => message.type === 'ack' && message.id === 'door-1');
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/telemetry`)).json()).doorOpen, true);

  const denied = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { Origin: 'https://untrusted.example' } });
  assert.equal(denied.status, 403);
  const close = once(ws, 'close');
  ws.send(Buffer.from([1, 2, 3]));
  const [code] = await close;
  assert.equal(code, 1003);
});

test('unknown paths and untrusted browser origins cannot upgrade', async (context) => {
  const service = createTelemetryService({ ...readConfig({}), port: 0 });
  const port = await service.start();
  context.after(async () => { await service.stop(); });
  for (const [path, origin, status] of [['/bad', 'http://localhost:5180', 404], ['/ws', 'https://untrusted.example', 403]] as const) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { origin });
    const result = await new Promise<number>((resolve, reject) => {
      ws.on('unexpected-response', (_request, response) => { const status = response.statusCode!; response.resume(); ws.terminate(); resolve(status); });
      ws.on('open', () => reject(new Error('Unexpected accepted upgrade')));
      ws.on('error', () => {});
    });
    assert.equal(result, status);
  }
});

test('built frontend is served on the telemetry origin with correct fallback and asset caching', { skip: !existsSync(new URL('../dist/index.html', import.meta.url)) }, async (context) => {
  const service = createTelemetryService({ ...readConfig({}), port: 0 });
  const port = await service.start();
  context.after(async () => { await service.stop(); });
  const origin = `http://127.0.0.1:${port}`;
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type')!, /text\/html/);
  const html = await page.text();
  const script = html.match(/src="([^" ]+\.js)"/);
  assert.ok(script, 'Vite entry script is present');
  const asset = await fetch(`${origin}${script[1]}`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('cache-control')!, /immutable/);
  const route = await fetch(`${origin}/device/GDM-001`);
  assert.equal(route.status, 200);
  assert.match(route.headers.get('content-type')!, /text\/html/);
  assert.equal((await fetch(`${origin}/api/missing`)).status, 404);
  assert.equal((await fetch(`${origin}/models/missing.glb`)).status, 404);
});
