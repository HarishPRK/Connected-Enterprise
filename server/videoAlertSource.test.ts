import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_VIDEO_ALERT_TOPIC,
  VideoAlertSource,
  parseVideoRelayPayload,
  resolveVideoAlertTopic,
  type VideoRelayCode,
} from './videoAlertSource.js';

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

test('parses every supported raw relay state and preserves channel semantics', () => {
  const expectedLevels = ['attention', 'warning', 'clear', 'critical'] as const;
  for (const state of ['ON', 'OFF'] as const) {
    for (const channel of [1, 2, 3, 4] as const) {
      const code = `${state}_${channel}` as VideoRelayCode;
      assert.deepEqual(parseVideoRelayPayload(encode(code)), {
        code,
        state,
        channel,
        level: expectedLevels[channel - 1],
        encoding: 'raw',
      });
    }
  }
});

test('accepts whitespace, BOM, JSON strings, and explicit JSON command fields', () => {
  assert.equal(parseVideoRelayPayload(encode(' \uFEFF ON_4\r\n')).code, 'ON_4');
  assert.equal(parseVideoRelayPayload(encode('"ON_2"')).encoding, 'json-string');

  for (const field of ['command', 'cmd', 'message', 'value', 'state', 'payload']) {
    const parsed = parseVideoRelayPayload(encode(JSON.stringify({ [field]: 'OFF_3' })));
    assert.equal(parsed.code, 'OFF_3');
    assert.equal(parsed.encoding, 'json-object');
  }

  assert.equal(
    parseVideoRelayPayload(encode('{"state":"ON_1","command":"ON_1"}')).code,
    'ON_1',
  );
});

test('rejects malformed, ambiguous, and out-of-contract relay payloads', () => {
  const invalidPayloads: Uint8Array[] = [
    encode(''),
    encode('on_1'),
    encode('ON_0'),
    encode('ON_5'),
    encode('ON_1 now'),
    encode('["ON_1"]'),
    encode('{"nested":{"command":"ON_1"}}'),
    encode('{"command":1}'),
    encode('{"command":"ON_1","state":"ON_2"}'),
    encode('ON_1\0'),
    new Uint8Array([0xc3, 0x28]),
    new Uint8Array(1_025).fill(0x41),
  ];

  for (const payload of invalidPayloads) {
    assert.throws(() => parseVideoRelayPayload(payload));
  }
});

test('uses relay/control by default and rejects wildcard subscriptions', () => {
  assert.equal(resolveVideoAlertTopic(''), DEFAULT_VIDEO_ALERT_TOPIC);
  assert.equal(resolveVideoAlertTopic(' site/relay/control '), 'site/relay/control');
  assert.throws(() => resolveVideoAlertTopic('relay/#'));
  assert.throws(() => resolveVideoAlertTopic('relay/+'));
});

test('retains per-channel state, emits real events, and preserves the last valid event', () => {
  const source = new VideoAlertSource('relay/control');
  const events: string[] = [];
  source.onAlert((event) => events.push(event.code));

  const on4 = encode('ON_4');
  assert.equal(source.ingest('other/topic', asArrayBuffer(on4)), false);
  assert.equal(source.ingest('relay/control', asArrayBuffer(on4)), true);

  const afterOn = source.getSnapshot();
  assert.equal(afterOn.connected, true);
  assert.equal(afterOn.channels[4].active, true);
  assert.equal(afterOn.lastEvent?.code, 'ON_4');
  assert.deepEqual(events, ['ON_4']);

  const invalid = encode('UNKNOWN');
  source.ingest('relay/control', asArrayBuffer(invalid));
  const afterInvalid = source.getSnapshot();
  assert.equal(afterInvalid.decodeErrors, 1);
  assert.equal(afterInvalid.lastEvent?.code, 'ON_4');
  assert.deepEqual(events, ['ON_4']);

  const off4 = encode('OFF_4');
  source.ingest('relay/control', asArrayBuffer(off4));
  const afterOff = source.getSnapshot();
  assert.equal(afterOff.channels[4].active, false);
  assert.equal(afterOff.lastEvent?.code, 'OFF_4');
  assert.deepEqual(events, ['ON_4', 'OFF_4']);
});

test('suppresses an explicit QoS redelivery and marks retained observations', () => {
  const source = new VideoAlertSource('relay/control');
  const events: { code: string; retained: boolean }[] = [];
  source.onAlert(({ code, retained }) => events.push({ code, retained }));

  const bytes = encode('ON_1');
  source.ingest('relay/control', asArrayBuffer(bytes), false, true);
  source.ingest('relay/control', asArrayBuffer(bytes), true, true);

  assert.deepEqual(events, [{ code: 'ON_1', retained: true }]);
  assert.equal(source.getSnapshot().duplicateDeliveries, 1);
});
