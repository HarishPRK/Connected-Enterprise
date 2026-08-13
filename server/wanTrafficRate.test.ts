import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceWanTrafficRate,
  type WanCounterSample,
} from './wanTrafficRate.js';

function sample(
  seconds: number,
  rxBytes: number,
  txBytes: number,
  key = 'prpl/ipsec/metrics:gateway:eth1',
): WanCounterSample {
  return {
    key,
    sourceTimestampMs: 1_786_000_000_000 + seconds * 1_000,
    observedAt: 1_786_000_000_100 + seconds * 1_000,
    rxBytes,
    txBytes,
  };
}

test('calculates independent RX and TX rates from a five-second source interval', () => {
  const first = sample(0, 10_000_000, 20_000_000);
  const update = advanceWanTrafficRate(first, sample(5, 10_625_000, 21_250_000));

  assert.ok(update.rate);
  assert.equal(update.rate.rxMbps, 1);
  assert.equal(update.rate.txMbps, 2);
  assert.equal(update.rate.spanSeconds, 5);
  assert.equal(update.rate.sampleCount, 2);
});

test('uses the actual gateway interval rather than claiming a fixed window', () => {
  const first = sample(0, 1_000, 2_000);
  const update = advanceWanTrafficRate(first, sample(10, 1_251_000, 627_000));

  assert.ok(update.rate);
  assert.equal(update.rate.spanSeconds, 10);
  assert.equal(update.rate.rxMbps, 1);
  assert.equal(update.rate.txMbps, 0.5);
});

test('counter reset starts a new baseline instead of producing a spike', () => {
  const first = sample(0, 10_000_000, 20_000_000);
  const update = advanceWanTrafficRate(first, sample(10, 100, 200));

  assert.equal(update.reset, true);
  assert.equal(update.rate, null);
  assert.deepEqual(update.baseline, sample(10, 100, 200));
});

test('topic or interface change cannot share a counter interval', () => {
  const first = sample(0, 100, 200);
  const other = sample(10, 1_000_000, 2_000_000, 'prplhome/ipsec/metrics:gateway:eth1');
  const update = advanceWanTrafficRate(first, other);

  assert.equal(update.reset, true);
  assert.equal(update.rate, null);
  assert.deepEqual(update.baseline, other);
});

test('identical duplicate and out-of-order observations are ignored', () => {
  const first = sample(10, 100, 200);
  const duplicate = advanceWanTrafficRate(first, { ...first, observedAt: first.observedAt + 500 });
  const older = advanceWanTrafficRate(first, sample(5, 9_000_000, 9_000_000));

  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reset, false);
  assert.deepEqual(duplicate.baseline, first);
  assert.equal(older.accepted, false);
  assert.deepEqual(older.baseline, first);
});

test('a revised counter at the same timestamp invalidates the old rate', () => {
  const first = sample(10, 100, 200);
  const revised = sample(10, 150, 250);
  const update = advanceWanTrafficRate(first, revised);

  assert.equal(update.accepted, true);
  assert.equal(update.reset, true);
  assert.equal(update.rate, null);
  assert.deepEqual(update.baseline, revised);
});

test('a gap over thirty seconds resets while zero deltas remain a valid idle rate', () => {
  const first = sample(0, 100, 200);
  const gap = advanceWanTrafficRate(first, sample(31, 200, 300));
  const idle = advanceWanTrafficRate(first, sample(10, 100, 200));

  assert.equal(gap.reset, true);
  assert.equal(gap.rate, null);
  assert.ok(idle.rate);
  assert.equal(idle.rate.rxMbps, 0);
  assert.equal(idle.rate.txMbps, 0);
});
