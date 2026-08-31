import assert from 'node:assert/strict';
import test from 'node:test';
import { parseVideoAlertSnapshot, parseVideoRelayEvent } from '../../src/ui/useVideoAlerts';

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
