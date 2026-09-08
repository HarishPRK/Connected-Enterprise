import assert from 'node:assert/strict';
import test from 'node:test';
import { commandSchema, telemetrySchema } from '../shared/telemetry.js';
import { readConfig } from './config.js';
import { MqttHardwareAdapter, validateHardwareTelemetry } from './hardware.js';
import { CoolerSimulator } from './simulator.js';

test('door opening warms stratified air, raises humidity and triggers a duration alarm', () => {
  const closed = new CoolerSimulator();
  const opened = new CoolerSimulator();
  opened.command({ type: 'command', id: 'door', command: 'set-door', value: true });
  const a = closed.tick(60);
  const b = opened.tick(60);
  assert.ok(b.temperature.middle > a.temperature.middle + 3);
  assert.ok(b.temperature.top > b.temperature.middle && b.temperature.middle > b.temperature.bottom);
  assert.ok(b.humidity > a.humidity + 10);
  assert.ok(b.alarms.some((alarm) => alarm.id === 'door-open'));
  opened.command({ type: 'command', id: 'close', command: 'set-door', value: false });
  const recovered = opened.tick(600);
  assert.ok(recovered.temperature.middle < b.temperature.middle);
  assert.ok(!recovered.alarms.some((alarm) => alarm.id === 'door-open'));
});

test('elapsed time integration is independent of frame size and cumulative energy increases', () => {
  const batched = new CoolerSimulator();
  const stepped = new CoolerSimulator();
  const a = batched.tick(60);
  let b = stepped.snapshot();
  for (let i = 0; i < 60; i++) b = stepped.tick(1);
  assert.deepEqual(a.temperature, b.temperature);
  assert.equal(a.energyKwh, b.energyKwh);
  assert.equal(a.compressor.running, b.compressor.running);
  assert.ok(a.energyKwh > 0);
  assert.throws(() => batched.tick(Number.NaN), RangeError);
  assert.throws(() => batched.tick(-1), RangeError);
});

test('hysteresis cycles compressor without per-second short cycling; payloads remain valid', () => {
  const simulator = new CoolerSimulator();
  let prior = simulator.snapshot();
  let lastSwitch = -100;
  let transitions = 0;
  for (let second = 1; second <= 1800; second++) {
    const current = simulator.tick();
    assert.equal(telemetrySchema.safeParse(current).success, true);
    if (current.compressor.running !== prior.compressor.running) {
      assert.ok(second - lastSwitch >= 60);
      transitions++;
      lastSwitch = second;
    }
    assert.ok(current.temperature.middle > 2.3 && current.temperature.middle < 3.7);
    assert.ok(current.energyKwh >= prior.energyKwh);
    if (!current.compressor.running) { assert.equal(current.compressor.currentAmps, 0); assert.equal(current.compressor.vibrationHz, 0); }
    prior = current;
  }
  assert.ok(transitions > 3);
});

test('stock commands preserve a 5×8 matrix and reset preserves increasing packet sequence', () => {
  const simulator = new CoolerSimulator();
  const snapshot = simulator.snapshot();
  snapshot.stock[0]![0] = false;
  assert.equal(simulator.snapshot().stock[0]![0], true);
  simulator.command({ type: 'command', id: 'remove', command: 'set-stock', value: { row: 0, col: 0, filled: false } });
  assert.equal(simulator.snapshot().stock[0]![0], false);
  const full = simulator.command({ type: 'command', id: 'full', command: 'restock' });
  assert.equal(full.stock.flat().filter(Boolean).length, 40);
  const reset = simulator.command({ type: 'command', id: 'reset', command: 'reset' });
  assert.ok(reset.sequence > full.sequence);
  assert.equal(reset.stock.flat().filter(Boolean).length, 34);
});

test('invalid commands and dangerous configuration fail closed', () => {
  const base = { type: 'command', id: 'bad' };
  assert.equal(commandSchema.safeParse({ ...base, command: 'set-setpoint', value: 1 }).success, false);
  assert.equal(commandSchema.safeParse({ ...base, command: 'set-door', value: 'false' }).success, false);
  assert.equal(commandSchema.safeParse({ ...base, command: 'set-stock', value: { row: 5, col: 0, filled: true } }).success, false);
  assert.throws(() => readConfig({ TELEMETRY_SOURCE: 'hardware' }), /MQTT_URL/);
  assert.throws(() => readConfig({ HOST: '0.0.0.0' }));
  assert.throws(() => readConfig({ SIMULATION_TIME_SCALE: '-1' }));
  assert.equal(readConfig({}).host, '127.0.0.1');
});

test('hardware ingestion rejects simulator packets, invalid ranges, stale, future and wrong-device packets', () => {
  const simulator = new CoolerSimulator();
  const now = Date.now();
  const candidate = { ...simulator.snapshot(), source: 'hardware' as const, timestamp: new Date(now).toISOString() };
  assert.ok(validateHardwareTelemetry(candidate, 'GDM-001', 0, now));
  assert.equal(validateHardwareTelemetry(simulator.snapshot(), 'GDM-001', 0, now), null);
  assert.equal(validateHardwareTelemetry(candidate, 'other-device', 0, now), null);
  assert.equal(validateHardwareTelemetry(candidate, 'GDM-001', now, now), null);
  assert.equal(validateHardwareTelemetry({ ...candidate, humidity: 101 }, 'GDM-001', 0, now), null);
  assert.equal(validateHardwareTelemetry({ ...candidate, timestamp: new Date(now - 121_000).toISOString() }, 'GDM-001', 0, now), null);
  assert.equal(validateHardwareTelemetry({ ...candidate, timestamp: new Date(now + 11_000).toISOString() }, 'GDM-001', 0, now), null);
});

test('hardware control is disabled by default, simulation actions never alter device truth', async () => {
  const hardware = new MqttHardwareAdapter({ url: 'mqtt://127.0.0.1:1883', deviceId: 'GDM-001', commandsEnabled: false, onTelemetry: () => assert.fail('Must not create synthetic physical state') });
  assert.equal((await hardware.command({ type: 'command', id: '1', command: 'set-setpoint', value: 4 })).ok, false);
  const enabled = new MqttHardwareAdapter({ url: 'mqtt://127.0.0.1:1883', deviceId: 'GDM-001', commandsEnabled: true, onTelemetry: () => assert.fail('Must not create synthetic physical state') });
  assert.match((await enabled.command({ type: 'command', id: '2', command: 'set-door', value: true })).error!, /simulation-only/);
  assert.match((await enabled.command({ type: 'command', id: '3', command: 'set-setpoint', value: 4 })).error!, /offline/);
});
