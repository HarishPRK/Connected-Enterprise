import assert from 'node:assert/strict';
import test from 'node:test';
import { canNotifyVideoAlert, videoAlertEventKey } from '../../src/features/videoAnalytics/videoAlertNotifications';
import type { VideoRelayEvent } from '../../src/ui/useVideoAlerts';

const event: VideoRelayEvent = {
  id: 42, topic: 'relay/control', channel: 4, code: 'ON_4', state: 'ON',
  level: 'critical', encoding: 'raw', receivedAt: 200, retained: false,
};

test('pause suppresses every relay popup level while live events remain usable', () => {
  for (const channel of [1, 2, 3, 4] as const) {
    const candidate = { ...event, channel, code: `ON_${channel}` as const };
    assert.equal(canNotifyVideoAlert(candidate, true, 0), false);
    assert.equal(canNotifyVideoAlert(candidate, false, 100), true);
  }
});

test('resume excludes historical replay without losing newer recovered alerts', () => {
  assert.equal(canNotifyVideoAlert({ ...event, replayed: true }, false, 300), false);
  assert.equal(canNotifyVideoAlert({ ...event, replayed: true }, false, 200), true);
  assert.equal(canNotifyVideoAlert({ ...event, replayed: true }, false, 100), true);
  assert.equal(canNotifyVideoAlert({ ...event, retained: true }, false, 0), false);
  assert.equal(canNotifyVideoAlert({ ...event, state: 'OFF', code: 'OFF_4' }, false, 0), false);
});

test('reparsed SSE events share an identity while different topics stay distinct', () => {
  assert.equal(videoAlertEventKey(event), videoAlertEventKey({ ...event }));
  assert.notEqual(videoAlertEventKey(event), videoAlertEventKey({ ...event, topic: 'other/relay' }));
  assert.notEqual(videoAlertEventKey(event), videoAlertEventKey({ ...event, id: 43 }));
  assert.equal(videoAlertEventKey(), undefined);
});
