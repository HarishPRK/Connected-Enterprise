import { isIP } from 'node:net';
import type { ControllerProvisioning } from './onboardingTypes.js';

const MAX_ENDPOINT_ID_LENGTH = 256;
const MAX_BROKER_LENGTH = 253;
const MAX_TOPIC_LENGTH = 512;

export function normalizeControllerProvisioning(value: unknown): ControllerProvisioning {
  const root = exactObject(value, ['usp'], 'Controller configuration');
  const usp = exactObject(root.usp, ['controller_endpoint_id', 'mtp', 'mqtt'], 'USP configuration');
  const mqtt = exactObject(
    usp.mqtt,
    ['broker', 'port', 'protocol_version', 'transport', 'controller_topic'],
    'MQTT configuration',
  );

  const controllerEndpointId = boundedText(
    usp.controller_endpoint_id,
    'Controller Endpoint ID',
    MAX_ENDPOINT_ID_LENGTH,
  );
  const mtp = exactValue(usp.mtp, 'MQTT', 'MTP');
  const broker = normalizeBroker(mqtt.broker);
  const port = mqttPort(mqtt.port);
  const protocolVersion = exactValue(mqtt.protocol_version, '5.0', 'Protocol version');
  const transport = exactValue(mqtt.transport, 'TCP/IP', 'Transport');
  const controllerTopic = boundedText(mqtt.controller_topic, 'Controller topic', MAX_TOPIC_LENGTH);
  if (/[#+]/.test(controllerTopic)) {
    throw new Error('Controller topic must be a concrete MQTT topic without wildcards.');
  }

  return {
    usp: {
      controller_endpoint_id: controllerEndpointId,
      mtp,
      mqtt: {
        broker,
        port,
        protocol_version: protocolVersion,
        transport,
        controller_topic: controllerTopic,
      },
    },
  };
}

export function controllerProvisioningBody(value: ControllerProvisioning): string {
  return JSON.stringify({
    usp: {
      controller_endpoint_id: value.usp.controller_endpoint_id,
      mtp: value.usp.mtp,
      mqtt: {
        broker: value.usp.mqtt.broker,
        port: value.usp.mqtt.port,
        protocol_version: value.usp.mqtt.protocol_version,
        transport: value.usp.mqtt.transport,
        controller_topic: value.usp.mqtt.controller_topic,
      },
    },
  });
}

function exactObject(
  value: unknown,
  allowedKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  const object = value as Record<string, unknown>;
  const actualKeys = Object.keys(object);
  const unknown = actualKeys.find((key) => !allowedKeys.includes(key));
  const missing = allowedKeys.find((key) => !(key in object));
  if (unknown) throw new Error(`${label} contains unsupported field ${unknown}.`);
  if (missing) throw new Error(`${label} is missing ${missing}.`);
  return object;
}

function boundedText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  const normalized = value.trim();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > maxLength || hasControlCharacter(normalized)) {
    throw new Error(`${label} must be 1-${maxLength} printable UTF-8 bytes.`);
  }
  return normalized;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function exactValue<const T extends string>(value: unknown, expected: T, label: string): T {
  if (value !== expected) throw new Error(`${label} must be ${expected}.`);
  return expected;
}

function normalizeBroker(value: unknown): string {
  const broker = boundedText(value, 'MQTT broker', MAX_BROKER_LENGTH).toLowerCase();
  if (isIP(broker) !== 4
    && (broker.length > 253
      || broker.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))) {
    throw new Error('MQTT broker must be a hostname or IPv4 address without a scheme or port.');
  }
  return broker;
}

function mqttPort(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new Error('MQTT port must be an integer from 1 to 65535.');
  }
  return value;
}
