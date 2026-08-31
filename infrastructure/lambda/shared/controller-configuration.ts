import { sha256 } from './crypto.js';

const MAX_CONTROLLER_ENDPOINT_ID_BYTES = 256;
const MAX_BROKER_LENGTH = 253;
const MAX_CONTROLLER_TOPIC_BYTES = 512;
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;
const REVISION_PATTERN = /^controller_[a-f0-9]{32}$/;
const BROKER_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export interface ControllerConfiguration {
  usp: {
    controller_endpoint_id: string;
    mtp: 'MQTT';
    mqtt: {
      broker: string;
      port: number;
      protocol_version: '5.0';
      transport: 'TCP/IP';
      controller_topic: string;
    };
  };
}

export interface ControllerConfigurationDocument {
  configuration: ControllerConfiguration;
  configurationBody: string;
  configurationChecksum: string;
}

export interface StoredControllerConfiguration extends ControllerConfigurationDocument {
  revision: string;
  updatedAt: string;
  updatedBy: string;
}

export class ControllerConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ControllerConfigurationError';
  }
}

export function controllerConfigurationDocument(value: unknown): ControllerConfigurationDocument {
  const configuration = validateControllerConfiguration(value);
  const configurationBody = serializeControllerConfiguration(configuration);
  return {
    configuration,
    configurationBody,
    configurationChecksum: sha256(configurationBody),
  };
}

export function validateControllerConfiguration(value: unknown): ControllerConfiguration {
  const root = exactRecord(value, ['usp'], 'Controller configuration');
  const usp = exactRecord(root.usp, ['controller_endpoint_id', 'mtp', 'mqtt'], 'usp');
  const mqtt = exactRecord(
    usp.mqtt,
    ['broker', 'port', 'protocol_version', 'transport', 'controller_topic'],
    'usp.mqtt',
  );

  const controllerEndpointId = boundedText(
    usp.controller_endpoint_id,
    'usp.controller_endpoint_id',
    MAX_CONTROLLER_ENDPOINT_ID_BYTES,
  );
  if (usp.mtp !== 'MQTT') throw invalid('usp.mtp must be MQTT');
  const broker = brokerHostname(mqtt.broker);
  if (typeof mqtt.port !== 'number'
    || !Number.isSafeInteger(mqtt.port)
    || mqtt.port < 1
    || mqtt.port > 65_535) {
    throw invalid('usp.mqtt.port must be an integer from 1 through 65535');
  }
  if (mqtt.protocol_version !== '5.0') throw invalid('usp.mqtt.protocol_version must be 5.0');
  if (mqtt.transport !== 'TCP/IP') throw invalid('usp.mqtt.transport must be TCP/IP');
  const controllerTopic = boundedText(
    mqtt.controller_topic,
    'usp.mqtt.controller_topic',
    MAX_CONTROLLER_TOPIC_BYTES,
  );
  if (/[#+]/.test(controllerTopic)) {
    throw invalid('usp.mqtt.controller_topic must be a concrete MQTT topic without wildcards');
  }

  // Rebuild in the published contract order. JSON.stringify of this value is
  // the deterministic byte representation stored, hashed, and returned to a
  // gateway; caller key order and whitespace cannot alter delivery authority.
  return {
    usp: {
      controller_endpoint_id: controllerEndpointId,
      mtp: 'MQTT',
      mqtt: {
        broker,
        port: mqtt.port,
        protocol_version: '5.0',
        transport: 'TCP/IP',
        controller_topic: controllerTopic,
      },
    },
  };
}

export function serializeControllerConfiguration(configuration: ControllerConfiguration): string {
  return JSON.stringify(configuration);
}

export function storedControllerConfiguration(value: Record<string, unknown>): StoredControllerConfiguration {
  const document = controllerConfigurationDocument(value.configuration);
  if (value.configurationBody !== document.configurationBody
    || typeof value.configurationChecksum !== 'string'
    || !CHECKSUM_PATTERN.test(value.configurationChecksum)
    || value.configurationChecksum !== document.configurationChecksum
    || typeof value.revision !== 'string'
    || !REVISION_PATTERN.test(value.revision)
    || typeof value.updatedAt !== 'string'
    || !Number.isFinite(Date.parse(value.updatedAt))
    || typeof value.updatedBy !== 'string'
    || value.updatedBy.length === 0
    || value.updatedBy.length > 512) {
    throw invalid('Stored Controller configuration is inconsistent');
  }
  return {
    ...document,
    revision: value.revision,
    updatedAt: value.updatedAt,
    updatedBy: value.updatedBy,
  };
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) throw invalid(`${label} must be a JSON object`);
  const actualKeys = Object.keys(value);
  const unexpected = actualKeys.find((key) => !expectedKeys.includes(key));
  if (unexpected) throw invalid(`${label} contains unsupported field ${unexpected}`);
  const missing = expectedKeys.find((key) => !Object.hasOwn(value, key));
  if (missing) throw invalid(`${label} is missing required field ${missing}`);
  return value;
}

function boundedText(value: unknown, label: string, maximumBytes: number): string {
  if (typeof value !== 'string') {
    throw invalid(`${label} must be a non-empty bounded string without control characters`);
  }
  const normalized = value.trim();
  if (normalized.length === 0
    || Buffer.byteLength(normalized, 'utf8') > maximumBytes
    || hasControlCharacter(normalized)) {
    throw invalid(`${label} must be a non-empty bounded string without control characters`);
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

function brokerHostname(value: unknown): string {
  if (typeof value !== 'string') {
    throw invalid('usp.mqtt.broker must be a plain hostname without a URL scheme, path, or port');
  }
  const broker = value.trim().toLowerCase();
  if (broker.length === 0
    || broker.length > MAX_BROKER_LENGTH
    || broker.includes('://')
    || broker.split('.').some((label) => !BROKER_LABEL_PATTERN.test(label))) {
    throw invalid('usp.mqtt.broker must be a plain hostname without a URL scheme, path, or port');
  }
  return broker;
}

function invalid(message: string): ControllerConfigurationError {
  return new ControllerConfigurationError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
