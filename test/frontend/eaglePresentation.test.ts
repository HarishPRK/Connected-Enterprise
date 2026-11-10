import assert from 'node:assert/strict';
import test from 'node:test';
import { eagleHistorySegments, eagleSampleState, eagleSnapshotMood } from '../../src/ui/eaglePresentation';
import type { HardwareAnomalyPoint } from '../../src/ui/useHardwareAnomalies';

const sample: HardwareAnomalyPoint = { time: '2026-11-10T12:00:00Z', anomalyFlag: false, anomalyMse: .4, anomalyThreshold: 1.1 };
const reasons = [{ time: sample.time, code: 0, tags: { device_serial: 'gateway-a' } }];

test('status companion distinguishes healthy, incomplete, reported fault, flag and stale snapshots', () => {
  assert.equal(eagleSnapshotMood(reasons, sample, false), 'calm');
  assert.equal(eagleSnapshotMood([], sample, false), 'waiting');
  assert.equal(eagleSnapshotMood(reasons, null, false), 'waiting');
  assert.equal(eagleSnapshotMood(reasons, { ...sample, anomalyMse: null }, false), 'waiting');
  assert.equal(eagleSnapshotMood(reasons, sample, true), 'waiting');
  assert.equal(eagleSnapshotMood([{ ...reasons[0], code: 5 }], sample, false), 'alert');
  assert.equal(eagleSnapshotMood([{ ...reasons[0], code: 123 }], sample, false), 'alert');
  assert.equal(eagleSnapshotMood(reasons, { ...sample, anomalyFlag: true }, false), 'alert');
  assert.equal(eagleSnapshotMood(reasons, { ...sample, anomalyMse: 1.5 }, false), 'alert');
});

test('missing readings are never painted healthy, and boundary equality is not a crossing', () => {
  assert.equal(eagleSampleState({ ...sample, anomalyFlag: null }), 'unknown');
  assert.equal(eagleSampleState({ ...sample, anomalyMse: null }), 'unknown');
  assert.equal(eagleSampleState({ ...sample, anomalyThreshold: null }), 'unknown');
  assert.equal(eagleSampleState({ ...sample, anomalyMse: 1.1 }), 'normal');
  assert.equal(eagleSampleState({ ...sample, anomalyMse: 1.2 }), 'crossed');
  assert.equal(eagleSampleState({ ...sample, anomalyMse: null, anomalyFlag: true }), 'flagged');
});

test('compressed sample history preserves a brief flagged window and accounts for every sample', () => {
  const points = Array.from({ length: 289 }, (_, index) => ({ ...sample, time: new Date(Date.parse(sample.time) + index * 60000).toISOString(), anomalyFlag: index === 100 }));
  const segments = eagleHistorySegments(points);
  assert(segments.length <= 80);
  assert.equal(segments.reduce((total, segment) => total + segment.count, 0), points.length);
  assert.equal(segments.filter(segment => segment.state === 'flagged').length, 1);
  assert.equal(segments[0].start, points[0].time);
  assert.equal(segments.at(-1)!.end, points.at(-1)!.time);
  assert.deepEqual(eagleHistorySegments([]), []);
});
