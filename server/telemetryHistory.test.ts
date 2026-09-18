import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLIENT_RATE_IDLE_AFTER_MS,
  currentRates,
  recordTelemetry,
  historySeries,
} from './telemetryHistory.js';

test('unchanged inventory republishes do not erase the latest measured client rate', () => {
  const mac = 'TEST:CLIENT:RATE:01';
  const t0 = 1_786_000_000_000;
  recordTelemetry(mac, { rxBytes: 1_000 }, t0);
  recordTelemetry(mac, { rxBytes: 1_000 }, t0 + 10_000);
  recordTelemetry(mac, { rxBytes: 1_000 }, t0 + 20_000);
  recordTelemetry(mac, { rxBytes: 7_501_000 }, t0 + 60_000);
  recordTelemetry(mac, { rxBytes: 7_501_000 }, t0 + 70_000);

  const rates = currentRates(mac);
  assert.equal(rates.rxMbps, 1);
  assert.equal(rates.txMbps, undefined);
});

test('range history includes a single observation and keeps traffic across counter resets', () => {
  const mac = 'TEST:HISTORY:RESET';
  const now = Date.now();
  recordTelemetry(mac, { rxBytes: 100, txBytes: 1000, rssiDbm: -60 }, now - 40_000);
  recordTelemetry(mac, { rxBytes: 1100, txBytes: 1500, rssiDbm: -62 }, now - 30_000);
  recordTelemetry(mac, { rxBytes: 10, txBytes: 20, rssiDbm: -65 }, now - 20_000);
  recordTelemetry(mac, { rxBytes: 510, txBytes: 520, rssiDbm: -64 }, now - 10_000);
  const points = historySeries(360, now - 60_000, now, new Set([mac]))[mac];
  assert.deepEqual(points.map((p) => p.transferredMB), [0, 0.0015, 0.0015, 0.0025]);
  assert.equal(historySeries(360, now - 15_000, now, new Set([mac]))[mac].length, 1);
  assert.deepEqual(historySeries(360, now - 5_000, now, new Set([mac])), {});
});

test('missing counter directions do not erase previous measured traffic', () => {
  const mac = 'TEST:HISTORY:PARTIAL';
  const now = Date.now();
  recordTelemetry(mac, { rxBytes: 100, txBytes: 1000 }, now - 30_000);
  recordTelemetry(mac, { rxBytes: 200 }, now - 20_000);
  recordTelemetry(mac, { rxBytes: 300, txBytes: 2000 }, now - 10_000);
  assert.equal(historySeries(360, now - 60_000, now, new Set([mac]))[mac].at(-1)?.transferredMB, 0.0012);
});

test('a client with no counter change beyond the producer cadence becomes idle', () => {
  const mac = 'TEST:CLIENT:RATE:02';
  const t0 = 1_786_100_000_000;
  recordTelemetry(mac, { rxBytes: 1_000 }, t0);
  recordTelemetry(mac, { rxBytes: 7_501_000 }, t0 + 60_000);
  recordTelemetry(mac, { rxBytes: 7_501_000 }, t0 + 60_000 + CLIENT_RATE_IDLE_AFTER_MS + 1);

  assert.equal(currentRates(mac).rxMbps, 0);
});

test('a counter reset is unavailable until another clean change is observed', () => {
  const mac = 'TEST:CLIENT:RATE:03';
  const t0 = 1_786_200_000_000;
  recordTelemetry(mac, { rxBytes: 5_000 }, t0);
  recordTelemetry(mac, { rxBytes: 100 }, t0 + 60_000);

  assert.equal(currentRates(mac).rxMbps, undefined);
});
