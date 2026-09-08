import assert from 'node:assert/strict';
import test from 'node:test';
import { serverMessageSchema } from '../shared/telemetry.js';
import { classifyTelemetry } from '../src/useCoolerTelemetry.js';
import { CoolerSimulator } from './simulator.js';

test('client treats newly delivered old readings as stale and duplicate reconnect packets do not extend freshness', () => {
  const now = Date.now();
  const data = { ...new CoolerSimulator().snapshot(), timestamp: new Date(now - 6000).toISOString() };
  const first = classifyTelemetry(null, data, now);
  assert.equal(first.disposition, 'append');
  assert.equal(first.fresh, false);
  assert.equal(first.sensorTime, now - 6000);
  const reconnect = classifyTelemetry(data, data, now + 1000);
  assert.equal(reconnect.disposition, 'duplicate');
  assert.equal(reconnect.fresh, false);
  assert.equal(reconnect.sensorTime, first.sensorTime);
});

test('client rejects out-of-order/future readings and separates device restarts from simulator reset', () => {
  const now = Date.now();
  const prior = { ...new CoolerSimulator().snapshot(), sequence: 100, timestamp: new Date(now - 1000).toISOString() };
  const next = { ...prior, sequence: 101, timestamp: new Date(now).toISOString() };
  assert.equal(classifyTelemetry(prior, next, now).resetHistory, false);
  assert.equal(classifyTelemetry(next, prior, now).disposition, 'ignore');
  assert.equal(classifyTelemetry(prior, { ...next, sequence: 0 }, now).resetHistory, true);
  assert.equal(classifyTelemetry(prior, { ...next, source: 'hardware' }, now).resetHistory, true);
  assert.equal(classifyTelemetry(prior, { ...next, timestamp: new Date(now + 11_000).toISOString() }, now).disposition, 'ignore');
  const simultaneousCommand = { ...next, sequence: 102 };
  assert.equal(classifyTelemetry(next, simultaneousCommand, now).disposition, 'append');
});

test('wire schema rejects truthy nonboolean acknowledgements', () => {
  assert.equal(serverMessageSchema.safeParse({ type: 'ack', id: 'command-1', ok: 'false' }).success, false);
  assert.equal(serverMessageSchema.safeParse({ type: 'ack', id: 'command-1', ok: true, error: 12 }).success, false);
  assert.equal(serverMessageSchema.safeParse({ type: 'ack', id: 'command-1', ok: false, error: 'Device rejected setpoint' }).success, true);
});
