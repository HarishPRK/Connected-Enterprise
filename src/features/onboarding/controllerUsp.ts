import type { ControllerConfiguration, ControllerProvisioning } from './types';

export const CONTROLLER_ENDPOINT_ID_MAX_LENGTH = 256;
export const CONTROLLER_BROKER_MAX_LENGTH = 253;
export const CONTROLLER_TOPIC_MAX_LENGTH = 512;
export const CONTROLLER_PORT_MIN = 1;
export const CONTROLLER_PORT_MAX = 65_535;

export type ControllerUspField =
  | 'controller_endpoint_id'
  | 'mtp'
  | 'broker'
  | 'port'
  | 'protocol_version'
  | 'transport'
  | 'controller_topic';

export interface ControllerUspDraft {
  controller_endpoint_id: string;
  mtp: string;
  broker: string;
  port: string;
  protocol_version: string;
  transport: string;
  controller_topic: string;
}

export type ControllerUspValidation =
  | { provisioning: ControllerProvisioning }
  | { field: ControllerUspField; error: string };

const BROKER_LABEL_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/i;
const REVISION_PATTERN = /^controller_[a-f0-9]{32}$/;

export function emptyControllerUspDraft(): ControllerUspDraft {
  return {
    controller_endpoint_id: '',
    mtp: 'MQTT',
    broker: '',
    port: '1883',
    protocol_version: '5.0',
    transport: 'TCP/IP',
    controller_topic: '',
  };
}

export function controllerUspDraftFromProvisioning(
  provisioning?: ControllerProvisioning,
): ControllerUspDraft {
  if (!provisioning) return emptyControllerUspDraft();
  return {
    controller_endpoint_id: provisioning.usp.controller_endpoint_id,
    mtp: provisioning.usp.mtp,
    broker: provisioning.usp.mqtt.broker,
    port: String(provisioning.usp.mqtt.port),
    protocol_version: provisioning.usp.mqtt.protocol_version,
    transport: provisioning.usp.mqtt.transport,
    controller_topic: provisioning.usp.mqtt.controller_topic,
  };
}

export function controllerUspDraftFingerprint(draft: ControllerUspDraft): string {
  return JSON.stringify(draft);
}

export function validateControllerUspDraft(draft: ControllerUspDraft): ControllerUspValidation {
  const controllerEndpointId = draft.controller_endpoint_id.trim();
  const endpointError = boundedTextError(
    controllerEndpointId,
    'Controller Endpoint ID',
    CONTROLLER_ENDPOINT_ID_MAX_LENGTH,
  );
  if (endpointError) return { field: 'controller_endpoint_id', error: endpointError };

  if (draft.mtp !== 'MQTT') {
    return { field: 'mtp', error: 'MTP must be MQTT.' };
  }

  const broker = draft.broker.trim().toLowerCase();
  const brokerTextError = boundedTextError(broker, 'MQTT broker', CONTROLLER_BROKER_MAX_LENGTH);
  if (brokerTextError) return { field: 'broker', error: brokerTextError };
  if (
    broker.includes('://')
    || broker.split('.').some((label) => !BROKER_LABEL_PATTERN.test(label))
  ) {
    return {
      field: 'broker',
      error: 'Enter a plain MQTT broker hostname or IPv4 address without a scheme, path, or port.',
    };
  }

  const portText = draft.port.trim();
  if (!/^\d+$/.test(portText)) {
    return { field: 'port', error: 'MQTT port must be a whole number from 1 to 65535.' };
  }
  const port = Number(portText);
  if (!Number.isSafeInteger(port) || port < CONTROLLER_PORT_MIN || port > CONTROLLER_PORT_MAX) {
    return { field: 'port', error: 'MQTT port must be a whole number from 1 to 65535.' };
  }

  if (draft.protocol_version !== '5.0') {
    return { field: 'protocol_version', error: 'Protocol version must be 5.0.' };
  }
  if (draft.transport !== 'TCP/IP') {
    return { field: 'transport', error: 'Transport must be TCP/IP.' };
  }

  const controllerTopic = draft.controller_topic.trim();
  const topicError = boundedTextError(controllerTopic, 'Controller topic', CONTROLLER_TOPIC_MAX_LENGTH);
  if (topicError) return { field: 'controller_topic', error: topicError };
  if (/[#+]/.test(controllerTopic)) {
    return {
      field: 'controller_topic',
      error: 'Controller topic must be a concrete MQTT topic without + or # wildcards.',
    };
  }

  return {
    provisioning: {
      usp: {
        controller_endpoint_id: controllerEndpointId,
        mtp: 'MQTT',
        mqtt: {
          broker,
          port,
          protocol_version: '5.0',
          transport: 'TCP/IP',
          controller_topic: controllerTopic,
        },
      },
    },
  };
}

export function isControllerProvisioning(value: unknown): value is ControllerProvisioning {
  if (!isRecord(value)) return false;
  const usp = value.usp;
  if (!isRecord(usp)) return false;
  const mqtt = usp.mqtt;
  if (!isRecord(mqtt)) return false;
  if (
    typeof usp.controller_endpoint_id !== 'string'
    || typeof usp.mtp !== 'string'
    || typeof mqtt.broker !== 'string'
    || typeof mqtt.port !== 'number'
    || typeof mqtt.protocol_version !== 'string'
    || typeof mqtt.transport !== 'string'
    || typeof mqtt.controller_topic !== 'string'
  ) return false;

  return 'provisioning' in validateControllerUspDraft({
    controller_endpoint_id: usp.controller_endpoint_id,
    mtp: usp.mtp,
    broker: mqtt.broker,
    port: String(mqtt.port),
    protocol_version: mqtt.protocol_version,
    transport: mqtt.transport,
    controller_topic: mqtt.controller_topic,
  });
}

export function isControllerConfiguration(value: unknown): value is ControllerConfiguration {
  if (!isRecord(value)) return false;
  return isControllerProvisioning(value.configuration)
    && typeof value.configurationChecksum === 'string'
    && CHECKSUM_PATTERN.test(value.configurationChecksum)
    && typeof value.revision === 'string'
    && REVISION_PATTERN.test(value.revision)
    && typeof value.updatedAt === 'string'
    && Number.isFinite(Date.parse(value.updatedAt));
}

function boundedTextError(value: string, label: string, maximumLength: number): string | undefined {
  if (!value) return `Enter the ${label}.`;
  if (new TextEncoder().encode(value).byteLength > maximumLength) {
    return `${label} must be ${maximumLength} UTF-8 bytes or fewer.`;
  }
  if (hasControlCharacter(value)) return `${label} cannot contain control characters.`;
  return undefined;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
