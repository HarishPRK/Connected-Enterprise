import assert from 'node:assert/strict';
import test from 'node:test';
import type { IpsecMetrics } from '../src/types.js';
import { bandwidthSeries, recordBandwidth } from './bandwidthHistory.js';

const now = Date.now();
function sample(t: number, bytes: number): IpsecMetrics {
  return {
    timestamp_ms: now + t,
    gateway: { name: 'test-gateway', mac: 'AA:BB:CC:DD:EE:FF' },
    tunnels: [
      { ifname: 'xfrm0-fiber', present: true, rx_bytes: bytes, tx_bytes: bytes },
      { ifname: 'xfrm1-cell', present: true, rx_bytes: bytes / 2, tx_bytes: bytes / 2 },
    ],
  } as IpsecMetrics;
}

test('bandwidth is collected without an open dashboard and isolated by topic', () => {
  recordBandwidth('test/bandwidth/a', sample(-10_000, 1000), now - 10_000);
  recordBandwidth('test/bandwidth/b', sample(-10_000, 9000), now - 10_000);
  recordBandwidth('test/bandwidth/a', sample(0, 626000), now);
  const points = bandwidthSeries('test/bandwidth/a', now - 60_000, 360, now);
  assert.equal(points.length, 1);
  assert.equal(points[0].fiber, 1);
  assert.equal(points[0].fiveg, 0.5);
  assert.equal(bandwidthSeries('test/bandwidth/b', now - 60_000, 360, now).length, 0);
});

test('duplicates, absent tunnel sections and counter resets cannot fabricate bandwidth', () => {
  const topic = 'test/bandwidth/reset';
  recordBandwidth(topic, sample(-30_000, 1000), now - 30_000);
  recordBandwidth(topic, sample(-20_000, 2000), now - 20_000);
  recordBandwidth(topic, sample(-20_000, 2000), now - 19_000);
  recordBandwidth(topic, { ...sample(-15_000, 2000), tunnels: [] }, now - 15_000);
  recordBandwidth(topic, sample(-10_000, 100), now - 10_000);
  recordBandwidth(topic, sample(0, 200), now);
  const points = bandwidthSeries(topic, now - 60_000, 360, now);
  assert.equal(points.length, 2);
  assert.equal(points[0].t, now - 20_000);
  assert.ok(points.every((p) => p.fiber >= 0 && p.fiber < 0.01));
  assert.equal(bandwidthSeries(topic, now - 5_000, 360, now).length, 1);
});
