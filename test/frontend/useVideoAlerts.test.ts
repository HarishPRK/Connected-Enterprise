import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeVideoAlertSnapshot,
  parseVideoAlertSnapshot,
  parseVideoRelayEvent,
  type UseVideoAlertsResult,
} from '../../src/ui/useVideoAlerts';

test('parses the relay snapshot without replaying its last event as live', () => {
  const snapshot = parseVideoAlertSnapshot(JSON.stringify({
    topic: 'relay/control',
    connected: true,
    lastError: null,
    receivedAt: 1_786_640_400_000,
    lastEvent: { code: 'ON_4' },
    channels: {
      4: { active: true, updatedAt: 1_786_640_400_000, lastCode: 'ON_4' },
    },
  }));

  assert.equal(snapshot.connected, true);
  assert.equal(snapshot.topic, 'relay/control');
  assert.equal(snapshot.channels?.[4]?.active, true);
  assert.ok(!Object.hasOwn(snapshot, 'lastEvent'));
});

test('validates a canonical live relay event', () => {
  const event = parseVideoRelayEvent(JSON.stringify({
    id: 1_786_640_400_000,
    topic: 'relay/control',
    code: 'ON_4',
    state: 'ON',
    channel: 4,
    level: 'critical',
    encoding: 'raw',
    receivedAt: 1_786_640_400_000,
    retained: false,
  }));

  assert.equal(event.code, 'ON_4');
  assert.equal(event.retained, false);
});

test('uses the native SSE lastEventId when the payload omits its id', () => {
  const event = parseVideoRelayEvent(JSON.stringify({
    topic: 'relay/control',
    code: 'ON_4',
    state: 'ON',
    channel: 4,
    level: 'critical',
    encoding: 'raw',
    receivedAt: 1_786_640_400_000,
    retained: false,
  }), '42');

  assert.equal(event.id, 42);
});

test('accepts an explicit replay marker and rejects malformed replay metadata', () => {
  const payload = {
    id: 43,
    topic: 'relay/control',
    code: 'ON_4',
    state: 'ON',
    channel: 4,
    level: 'critical',
    encoding: 'raw',
    receivedAt: 1_786_640_400_000,
    retained: false,
  };
  assert.equal(parseVideoRelayEvent(JSON.stringify({ ...payload, replayed: true })).replayed, true);
  assert.throws(() => parseVideoRelayEvent(JSON.stringify({ ...payload, replayed: 'yes' })));
});

test('does not let an older snapshot roll back newer live channel state', () => {
  const liveEvent = parseVideoRelayEvent(JSON.stringify({
    id: 9,
    topic: 'relay/control',
    code: 'ON_4',
    state: 'ON',
    channel: 4,
    level: 'critical',
    encoding: 'raw',
    receivedAt: 200,
    retained: false,
  }));
  const existing: UseVideoAlertsResult = {
    topic: 'relay/control',
    connected: true,
    channels: {
      1: { active: null, updatedAt: null, lastCode: null },
      2: { active: null, updatedAt: null, lastCode: null },
      3: { active: null, updatedAt: null, lastCode: null },
      4: { active: true, updatedAt: 200, lastCode: 'ON_4' },
    },
    lastLiveEvent: liveEvent,
    lastReceivedAt: 200,
    transport: 'open',
  };

  const merged = mergeVideoAlertSnapshot(existing, {
    topic: 'relay/control',
    connected: true,
    receivedAt: 100,
    channels: {
      4: { active: false, updatedAt: 100, lastCode: 'OFF_4' },
    },
  });

  assert.deepEqual(merged.channels[4], existing.channels[4]);
  assert.equal(merged.lastReceivedAt, 200);
  assert.equal(merged.lastLiveEvent, liveEvent);
});

test('rejects mismatched and malformed live events', () => {
  assert.throws(() => parseVideoRelayEvent(JSON.stringify({
    id: 1,
    topic: 'relay/control',
    code: 'ON_1',
    state: 'ON',
    channel: 4,
    level: 'critical',
    encoding: 'raw',
    receivedAt: 1,
    retained: false,
  })));
  assert.throws(() => parseVideoRelayEvent(JSON.stringify({
    id: 1,
    topic: 'relay/control',
    code: 'ON_4',
    state: 'ON',
    channel: 4,
    level: 'critical',
    encoding: 'raw',
    receivedAt: 1,
    retained: 'false',
  })));
});
