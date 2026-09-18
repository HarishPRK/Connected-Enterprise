import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ChartHistoryStore, compactHistory, HISTORY_RETENTION_MS, sampleHistory } from './chartHistoryStore.js';

test('history survives a server restart with its original timestamps and values', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ce-history-'));
  const file = path.join(dir, 'history.json');
  const now = Date.now();
  const first = new ChartHistoryStore<{ t: number; value: number }>();
  const restored = new ChartHistoryStore<{ t: number; value: number }>();
  try {
    first.start(file, now);
    first.record('device-a', { t: now - 10_000, value: -64 });
    first.record('device-a', { t: now, value: -61 });
    await first.flush();
    restored.start(file, now);
    assert.deepEqual(restored.buffers.get('device-a'), first.buffers.get('device-a'));
  } finally {
    first.close();
    restored.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('seven-day retention preserves detailed recent samples and compacts older ones', () => {
  const now = 1_789_000_000_000;
  const points = Array.from({ length: 8 * 8640 }, (_, i) => ({ t: now - i * 10_000, value: i })).reverse();
  const retained = compactHistory(points, now);
  assert.equal(retained.at(-1)?.t, now);
  assert.ok(retained.every((p) => p.t >= now - HISTORY_RETENTION_MS));
  assert.equal(retained.filter((p) => p.t >= now - 3_600_000).length, 361);
  assert.ok(retained.length < 2400);
});

test('downsampling is strictly bounded and preserves the first and latest observations', () => {
  const points = Array.from({ length: 2000 }, (_, t) => ({ t }));
  for (const limit of [0, 2, 10, 360, 720, Infinity, NaN]) {
    const sampled = sampleHistory(points, limit);
    assert.ok(sampled.length <= 720);
    assert.equal(sampled[0], points[0]);
    assert.equal(sampled.at(-1), points.at(-1));
  }
});
