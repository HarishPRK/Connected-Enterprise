import assert from 'node:assert/strict';
import test from 'node:test';
import {
  controllerProvisioningBody,
  normalizeControllerProvisioning,
} from './controllerConfiguration.js';

const input = {
  usp: {
    controller_endpoint_id: ' proto::Controller-ip-172-31-2-12 ',
    mtp: 'MQTT',
    mqtt: {
      broker: 'Broker.HiveMQ.com',
      port: 1883,
      protocol_version: '5.0',
      transport: 'TCP/IP',
      controller_topic: ' controller/proto::Controller-ip-172-31-2-12 ',
    },
  },
};

test('normalizes and serializes the exact USP/MQTT gateway payload shape', () => {
  const normalized = normalizeControllerProvisioning(input);
  assert.deepEqual(normalized, {
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
  assert.equal(
    controllerProvisioningBody(normalized),
    '{"usp":{"controller_endpoint_id":"proto::Controller-ip-172-31-2-12","mtp":"MQTT","mqtt":{"broker":"broker.hivemq.com","port":1883,"protocol_version":"5.0","transport":"TCP/IP","controller_topic":"controller/proto::Controller-ip-172-31-2-12"}}}',
  );
});

test('rejects unknown fields, invalid enum values, ports, broker schemes, and topic wildcards', () => {
  for (const value of [
    { ...input, ignored: true },
    { usp: { ...input.usp, mtp: 'HTTP' } },
    { usp: { ...input.usp, mqtt: { ...input.usp.mqtt, port: 65_536 } } },
    { usp: { ...input.usp, mqtt: { ...input.usp.mqtt, protocol_version: '4.0' } } },
    { usp: { ...input.usp, mqtt: { ...input.usp.mqtt, broker: 'mqtt://broker.hivemq.com' } } },
    { usp: { ...input.usp, mqtt: { ...input.usp.mqtt, broker: 'mqtt.-bad.example.com' } } },
    { usp: { ...input.usp, mqtt: { ...input.usp.mqtt, broker: 'mqtt.bad-.example.com' } } },
    { usp: { ...input.usp, mqtt: { ...input.usp.mqtt, broker: '2001:db8::1' } } },
    { usp: { ...input.usp, mqtt: { ...input.usp.mqtt, controller_topic: 'controller/+' } } },
    { usp: { ...input.usp, controller_endpoint_id: 'é'.repeat(129) } },
  ]) assert.throws(() => normalizeControllerProvisioning(value));
});
