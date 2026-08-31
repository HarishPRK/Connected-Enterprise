import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTROLLER_BROKER_MAX_LENGTH,
  CONTROLLER_ENDPOINT_ID_MAX_LENGTH,
  CONTROLLER_TOPIC_MAX_LENGTH,
  controllerUspDraftFromProvisioning,
  isControllerConfiguration,
  isControllerProvisioning,
  validateControllerUspDraft,
  type ControllerUspDraft,
  type ControllerUspField,
} from '../../src/features/onboarding/controllerUsp';
import type { ControllerProvisioning } from '../../src/features/onboarding/types';

function validDraft(overrides: Partial<ControllerUspDraft> = {}): ControllerUspDraft {
  return {
    controller_endpoint_id: 'proto::Controller-ip-172-31-2-12',
    mtp: 'MQTT',
    broker: 'broker.hivemq.com',
    port: '1883',
    protocol_version: '5.0',
    transport: 'TCP/IP',
    controller_topic: 'controller/proto::Controller-ip-172-31-2-12',
    ...overrides,
  };
}

function expectError(
  draft: ControllerUspDraft,
  field: ControllerUspField,
  pattern: RegExp,
): void {
  const result = validateControllerUspDraft(draft);
  assert.ok('error' in result, `expected ${field} validation to fail`);
  assert.equal(result.field, field);
  assert.match(result.error, pattern);
}

test('normalizes form fields into the exact nested USP/MQTT provisioning body', () => {
  const result = validateControllerUspDraft(validDraft({
    controller_endpoint_id: '  proto::Controller-ip-172-31-2-12  ',
    broker: '  Broker.HiveMQ.COM  ',
    port: '01883',
    controller_topic: '  controller/proto::Controller-ip-172-31-2-12  ',
  }));

  assert.ok('provisioning' in result);
  assert.deepEqual(result.provisioning, {
    usp: {
      controller_endpoint_id: 'proto::Controller-ip-172-31-2-12',
      mtp: 'MQTT',
      mqtt: {
        broker: 'broker.hivemq.com',
        port: 1883,
        protocol_version: '5.0',
        transport: 'TCP/IP',
        controller_topic: 'controller/proto::Controller-ip-172-31-2-12',
      },
    },
  });
});

test('requires bounded printable endpoint IDs and Controller topics', () => {
  expectError(validDraft({ controller_endpoint_id: '   ' }), 'controller_endpoint_id', /Enter the Controller Endpoint ID/);
  expectError(
    validDraft({ controller_endpoint_id: 'a'.repeat(CONTROLLER_ENDPOINT_ID_MAX_LENGTH + 1) }),
    'controller_endpoint_id',
    /256 UTF-8 bytes or fewer/,
  );
  expectError(
    validDraft({ controller_endpoint_id: 'é'.repeat(129) }),
    'controller_endpoint_id',
    /256 UTF-8 bytes or fewer/,
  );
  expectError(validDraft({ controller_endpoint_id: 'controller\u0000id' }), 'controller_endpoint_id', /control characters/);
  expectError(validDraft({ controller_topic: '' }), 'controller_topic', /Enter the Controller topic/);
  expectError(
    validDraft({ controller_topic: 'a'.repeat(CONTROLLER_TOPIC_MAX_LENGTH + 1) }),
    'controller_topic',
    /512 UTF-8 bytes or fewer/,
  );

  assert.ok('provisioning' in validateControllerUspDraft(validDraft({
    controller_endpoint_id: 'a'.repeat(CONTROLLER_ENDPOINT_ID_MAX_LENGTH),
    controller_topic: 't'.repeat(CONTROLLER_TOPIC_MAX_LENGTH),
  })));
});

test('accepts a plain broker hostname or IPv4 address and rejects URL-shaped broker values', () => {
  assert.ok('provisioning' in validateControllerUspDraft(validDraft({ broker: '10.20.30.40' })));
  expectError(validDraft({ broker: 'mqtt://broker.example.com' }), 'broker', /without a scheme, path, or port/);
  expectError(validDraft({ broker: 'broker.example.com:1883' }), 'broker', /without a scheme, path, or port/);
  expectError(validDraft({ broker: 'broker.example.com/path' }), 'broker', /without a scheme, path, or port/);
  expectError(validDraft({ broker: 'broker..example.com' }), 'broker', /without a scheme, path, or port/);
  expectError(validDraft({ broker: 'mqtt.-bad.example.com' }), 'broker', /without a scheme, path, or port/);
  expectError(validDraft({ broker: 'mqtt.bad-.example.com' }), 'broker', /without a scheme, path, or port/);
  expectError(
    validDraft({ broker: 'b'.repeat(CONTROLLER_BROKER_MAX_LENGTH + 1) }),
    'broker',
    /253 UTF-8 bytes or fewer/,
  );
});

test('requires an integer MQTT port in the complete TCP port range', () => {
  for (const port of ['', '0', '65536', '1.5', '-1', 'not-a-port']) {
    expectError(validDraft({ port }), 'port', /whole number from 1 to 65535/);
  }

  assert.equal(
    'provisioning' in validateControllerUspDraft(validDraft({ port: '1' })),
    true,
  );
  assert.equal(
    'provisioning' in validateControllerUspDraft(validDraft({ port: '65535' })),
    true,
  );
});

test('keeps MTP, protocol version, and transport on the supported fixed contract', () => {
  expectError(validDraft({ mtp: 'STOMP' }), 'mtp', /MTP must be MQTT/);
  expectError(validDraft({ protocol_version: '3.1.1' }), 'protocol_version', /must be 5\.0/);
  expectError(validDraft({ transport: 'WebSocket' }), 'transport', /must be TCP\/IP/);
});

test('rejects MQTT wildcard topics and embedded control characters', () => {
  expectError(validDraft({ controller_topic: 'controller/+' }), 'controller_topic', /without \+ or # wildcards/);
  expectError(validDraft({ controller_topic: 'controller/#' }), 'controller_topic', /without \+ or # wildcards/);
  expectError(validDraft({ controller_topic: 'controller/\u0000device' }), 'controller_topic', /control characters/);
});

test('round-trips saved provisioning into form fields without response metadata', () => {
  const provisioning: ControllerProvisioning = {
    usp: {
      controller_endpoint_id: 'controller-01',
      mtp: 'MQTT',
      mqtt: {
        broker: 'mqtt.example.com',
        port: 8883,
        protocol_version: '5.0',
        transport: 'TCP/IP',
        controller_topic: 'controllers/controller-01',
      },
    },
  };

  assert.deepEqual(controllerUspDraftFromProvisioning(provisioning), {
    controller_endpoint_id: 'controller-01',
    mtp: 'MQTT',
    broker: 'mqtt.example.com',
    port: '8883',
    protocol_version: '5.0',
    transport: 'TCP/IP',
    controller_topic: 'controllers/controller-01',
  });
  assert.equal(isControllerProvisioning(provisioning), true);
});

test('accepts only the nested Controller snapshot record with checksum and revision metadata', () => {
  const configuration = validateControllerUspDraft(validDraft());
  assert.ok('provisioning' in configuration);
  const record = {
    configuration: configuration.provisioning,
    configurationChecksum: 'a'.repeat(64),
    revision: `controller_${'1'.repeat(32)}`,
    updatedAt: '2026-08-27T16:30:00.000Z',
  };

  assert.equal(isControllerConfiguration(record), true);
  assert.equal(isControllerConfiguration({ ...record, revision: 1 }), false);
  assert.equal(isControllerConfiguration({ ...record, configurationChecksum: 'not-a-checksum' }), false);
  assert.equal(isControllerConfiguration({ ...record, updatedAt: 'not-a-date' }), false);
  assert.equal(isControllerConfiguration({ endpoint: 'https://obsolete.example' }), false);
});
