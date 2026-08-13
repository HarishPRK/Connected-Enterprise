import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLIENT_RATE_IDLE_AFTER_MS,
  currentRates,
  recordTelemetry,
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
