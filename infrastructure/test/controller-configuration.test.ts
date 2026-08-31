import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  controllerConfigurationDocument,
  ControllerConfigurationError,
  storedControllerConfiguration,
  validateControllerConfiguration,
} from '../lambda/shared/controller-configuration.js';

const USER_CONTROLLER_BODY = '{"usp":{"controller_endpoint_id":"proto::Controller-ip-172-31-2-12","mtp":"MQTT","mqtt":{"broker":"broker.hivemq.com","port":1883,"protocol_version":"5.0","transport":"TCP/IP","controller_topic":"controller/proto::Controller-ip-172-31-2-12"}}}';
const USER_CONTROLLER_CONFIGURATION = JSON.parse(USER_CONTROLLER_BODY) as Record<string, unknown>;
const USER_CONTROLLER_CHECKSUM = createHash('sha256').update(USER_CONTROLLER_BODY).digest('hex');

test('Controller schema serializes the representative USP/MQTT payload deterministically', () => {
  const document = controllerConfigurationDocument(USER_CONTROLLER_CONFIGURATION);

  assert.deepEqual(document.configuration, USER_CONTROLLER_CONFIGURATION);
  assert.equal(document.configurationBody, USER_CONTROLLER_BODY,
    'schema ordering produces the exact compact body returned by the device API');
  assert.equal(document.configurationChecksum, USER_CONTROLLER_CHECKSUM);
});

test('Controller serialization is independent of caller key order and whitespace', () => {
  const reordered = {
    usp: {
      mqtt: {
        controller_topic: 'controller/proto::Controller-ip-172-31-2-12',
        transport: 'TCP/IP',
        protocol_version: '5.0',
        port: 1883,
        broker: 'broker.hivemq.com',
      },
      mtp: 'MQTT',
      controller_endpoint_id: 'proto::Controller-ip-172-31-2-12',
    },
  };

  assert.equal(controllerConfigurationDocument(reordered).configurationBody, USER_CONTROLLER_BODY);
});

test('Controller schema rejects unknown, missing, and unsupported USP/MQTT values', () => {
  const invalid = [
    null,
    [],
    {},
    { ...USER_CONTROLLER_CONFIGURATION, unknown: true },
    { usp: { ...(USER_CONTROLLER_CONFIGURATION.usp as object), mtp: 'HTTP' } },
    {
      usp: {
        ...(USER_CONTROLLER_CONFIGURATION.usp as Record<string, unknown>),
        mqtt: {
          ...((USER_CONTROLLER_CONFIGURATION.usp as Record<string, unknown>).mqtt as object),
          protocol_version: '3.1.1',
        },
      },
    },
    {
      usp: {
        ...(USER_CONTROLLER_CONFIGURATION.usp as Record<string, unknown>),
        mqtt: {
          ...((USER_CONTROLLER_CONFIGURATION.usp as Record<string, unknown>).mqtt as object),
          transport: 'WebSocket',
        },
      },
    },
    {
      usp: {
        ...(USER_CONTROLLER_CONFIGURATION.usp as Record<string, unknown>),
        mqtt: {
          ...((USER_CONTROLLER_CONFIGURATION.usp as Record<string, unknown>).mqtt as object),
          port: 0,
        },
      },
    },
    {
      usp: {
        ...(USER_CONTROLLER_CONFIGURATION.usp as Record<string, unknown>),
        mqtt: {
          ...((USER_CONTROLLER_CONFIGURATION.usp as Record<string, unknown>).mqtt as object),
          broker: 'mqtts://broker.hivemq.com:8883/path',
        },
      },
    },
    {
      usp: {
        ...(USER_CONTROLLER_CONFIGURATION.usp as Record<string, unknown>),
        mqtt: {
          ...((USER_CONTROLLER_CONFIGURATION.usp as Record<string, unknown>).mqtt as object),
          broker: 'mqtt.-bad.example.com',
        },
      },
    },
    {
      usp: {
        ...(USER_CONTROLLER_CONFIGURATION.usp as Record<string, unknown>),
        mqtt: {
          ...((USER_CONTROLLER_CONFIGURATION.usp as Record<string, unknown>).mqtt as object),
          broker: 'mqtt.bad-.example.com',
        },
      },
    },
  ];

  for (const candidate of invalid) {
    assert.throws(() => validateControllerConfiguration(candidate), ControllerConfigurationError);
  }
});

test('stored Controller records must bind structure, exact body, checksum, and revision', () => {
  const document = controllerConfigurationDocument(USER_CONTROLLER_CONFIGURATION);
  const record = {
    ...document,
    revision: `controller_${'a'.repeat(32)}`,
    updatedAt: '2026-08-27T12:00:00.000Z',
    updatedBy: 'tenant-admin-a',
  };

  assert.deepEqual(storedControllerConfiguration(record), record);
  for (const corrupt of [
    { ...record, configurationBody: '{}'},
    { ...record, configurationChecksum: 'f'.repeat(64) },
    { ...record, revision: 'controller-invalid' },
    { ...record, updatedAt: 'not-a-timestamp' },
  ]) assert.throws(() => storedControllerConfiguration(corrupt), ControllerConfigurationError);
});
