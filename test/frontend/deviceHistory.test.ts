import assert from 'node:assert/strict';
import test from 'node:test';
import { deviceHistoryRows } from '../../src/ui/deviceHistory';
import { HISTORY_RANGES, historyRangeMs } from '../../src/ui/historyRange';

test('all requested ranges map to distinct trailing durations', () => {
  assert.deepEqual(HISTORY_RANGES.map((r) => r.value), ['1m', '5m', '1h', '1d', '7d']);
  assert.equal(historyRangeMs('7d'), 7 * 86400000);
});

test('single observations render and duplicate display names remain independent MAC series', () => {
  const data = deviceHistoryRows({
    AA: [{ t: 10_000, rssiDbm: -60 }],
    BB: [{ t: 10_010, rssiDbm: -80 }],
    CC: [{ t: 10_000, rssiDbm: -40 }],
  }, new Set(['AA', 'BB']), 'rssiDbm', '1m', 0, 60_000);
  assert.equal(data.rows.length, 1);
  assert.equal(data.rows[0].AA, -60);
  assert.equal(data.rows[0].BB, -80);
  assert.equal(data.rows[0].CC, undefined);
  assert.equal(data.counts.get('AA'), 1);
});

test('device chart rows stay bounded, ordered and inside the selected window', () => {
  const points = Array.from({ length: 5000 }, (_, i) => ({ t: i * 100, rssiDbm: -50 }));
  const result = deviceHistoryRows({ AA: points }, new Set(['AA']), 'rssiDbm', '5m', 30_000, 330_000);
  assert.ok(result.rows.length <= 361);
  assert.ok(result.rows.every((row, index) => row.ts >= 30000 && row.ts <= 330000
    && (!index || row.ts > result.rows[index - 1].ts)));
});

test('transfer rows preserve measured zeros and do not invent a baseline before a device reports', () => {
  const result = deviceHistoryRows({
    AA: [{ t: 10_000, transferredMB: 0 }, { t: 20_000, transferredMB: 1 }],
    BB: [{ t: 30_000, transferredMB: 0 }],
  }, new Set(['AA', 'BB']), 'transferredMB', '1m', 0, 60000);
  assert.equal(result.rows[0].AA, 0);
  assert.equal(result.rows[0].BB, undefined);
  assert.equal(result.rows.at(-1)?.AA, 1);
});
