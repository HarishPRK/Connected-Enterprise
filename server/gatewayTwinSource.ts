/**
 * Gateway Twin live-data source.
 *
 * This module deliberately owns no MQTT client. `ipsecSource` already has the
 * process-wide AWS IoT WebSocket/SigV4 connection, so it subscribes to the
 * topics exported here and forwards each delivery to `ingest()`.
 *
 * The public event shapes mirror the GW Operational Twin's standalone bridge:
 *   state            -> upstream connection/decode status
 *   device-telemetry -> latest prplOS DeviceInfo/Ethernet/Wi-Fi JSON sample
 *   log-batch        -> decoded gateway LogBatch protobuf with a replay id
 */

import { EventEmitter } from 'node:events';
import protobuf from 'protobufjs';

export const GATEWAY_TWIN_EVENTS_TOPIC = 'gw/mygw/events' as const;
export const GATEWAY_TWIN_STATUS_TOPIC = 'gw/mygw/status' as const;

export const GATEWAY_TWIN_DEVICE_INFO_TOPICS = [
  'prplos/deviceinfo/uptime',
  'prplos/deviceinfo/softwareversion',
  'prplos/deviceinfo/hardwareversion',
  'prplos/deviceinfo/serialnumber',
  'prplos/deviceinfo/memorystatus',
  'prplos/deviceinfo/cpuutilization',
  'prplos/deviceinfo/temperaturesensor',
  'prplos/deviceinfo/processes',
] as const;

export const GATEWAY_TWIN_ETHERNET_TOPICS = [
  'prplos/ethernet/eth1',
  'prplos/ethernet/eth0_1',
  'prplos/ethernet/eth0_4',
  'prplos/ethernet/eth0_3',
  'prplos/ethernet/eth0_2',
] as const;

export const GATEWAY_TWIN_WIFI_TOPICS = [
  'prplos/wifi/wlan0',
  'prplos/wifi/wlan2',
  'prplos/wifi/wlan4',
] as const;

export const GATEWAY_TWIN_TELEMETRY_TOPICS = [
  ...GATEWAY_TWIN_DEVICE_INFO_TOPICS,
  ...GATEWAY_TWIN_ETHERNET_TOPICS,
  ...GATEWAY_TWIN_WIFI_TOPICS,
] as const;

export type GatewayTwinLogTopic =
  | typeof GATEWAY_TWIN_EVENTS_TOPIC
  | typeof GATEWAY_TWIN_STATUS_TOPIC;
export type GatewayTwinTelemetryTopic = (typeof GATEWAY_TWIN_TELEMETRY_TOPICS)[number];
export type GatewayTwinTopic = GatewayTwinLogTopic | GatewayTwinTelemetryTopic;

export interface GatewayTwinLogEntry {
  processName: string;
  message: string;
}

export interface GatewayTwinLogBatch {
  id: number;
  topic: GatewayTwinLogTopic;
  receivedAt: number;
  entries: GatewayTwinLogEntry[];
}

export interface GatewayTwinTelemetry {
  topic: GatewayTwinTelemetryTopic;
  receivedAt: number;
  payload: Record<string, unknown>;
}

export type GatewayTwinConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline'
  | 'error';

export interface GatewayTwinUpstreamState {
  state: GatewayTwinConnectionState;
  endpoint: string;
  connectedAt: number | null;
  lastMessageAt: number | null;
  lastStatusAt: number | null;
  decodeErrors: number;
  duplicateDeliveries: number;
  error: string | null;
}

interface GatewayTwinSourceEvents {
  state: (state: GatewayTwinUpstreamState) => void;
  telemetry: (telemetry: GatewayTwinTelemetry) => void;
  batch: (batch: GatewayTwinLogBatch) => void;
}

interface SourceConfig {
  /** MQTT input topic -> canonical topic understood by the embedded twin. */
  canonicalByInput: Map<string, GatewayTwinTopic>;
  subscriptionTopics: string[];
  historySize: number;
}

const DEFAULT_ENDPOINT = 'alht1i2bx8tzt-ats.iot.us-east-1.amazonaws.com';
const DEFAULT_HISTORY_SIZE = 256;
const MAX_HISTORY_SIZE = 65_535;
const MAX_PAYLOAD_BYTES = 1_048_576;
const MAX_LOG_BATCH_ENTRIES = 1_000;
const PACKET_CACHE_TTL_MS = 5 * 60_000;
const PACKET_CACHE_LIMIT = 256;
const DEVICE_INFO_TOPIC_SET = new Set<string>(GATEWAY_TWIN_DEVICE_INFO_TOPICS);
const TELEMETRY_TOPIC_SET = new Set<string>(GATEWAY_TWIN_TELEMETRY_TOPICS);

const logBatchRoot = protobuf.Root.fromJSON({
  nested: {
    LogEntry: {
      fields: {
        processName: { type: 'string', id: 1 },
        message: { type: 'string', id: 2 },
      },
    },
    LogBatch: {
      fields: {
        entries: { rule: 'repeated', type: 'LogEntry', id: 1 },
      },
    },
  },
});
const logBatchType = logBatchRoot.lookupType('LogBatch');

/** Decode the gateway's exact proto/log_batch.proto wire contract. */
export function decodeGatewayTwinLogBatch(payload: Uint8Array): { entries: GatewayTwinLogEntry[] } {
  const decoded = logBatchType.decode(payload);
  const object = logBatchType.toObject(decoded, { arrays: true, defaults: true }) as {
    entries?: Array<{ processName?: unknown; message?: unknown }>;
  };
  const entries = object.entries ?? [];
  if (entries.length > MAX_LOG_BATCH_ENTRIES) {
    throw new Error(`LogBatch exceeds ${MAX_LOG_BATCH_ENTRIES} entries`);
  }
  return {
    entries: entries.map((entry) => ({
      processName: typeof entry.processName === 'string' ? entry.processName : '',
      message: typeof entry.message === 'string' ? entry.message : '',
    })),
  };
}

function positiveInteger(raw: string | undefined, fallback: number, name: string): number {
  if (raw == null || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_HISTORY_SIZE) {
    throw new Error(`${name} must be an integer from 1 to ${MAX_HISTORY_SIZE}`);
  }
  return parsed;
}

function inputTopic(raw: string | undefined, fallback: string, name: string): string {
  const value = raw?.trim() || fallback;
  if (value.includes('#') || value.includes('+')) {
    throw new Error(`${name} must be a concrete MQTT topic, not a wildcard filter`);
  }
  return value;
}

function prplosInputTopic(canonical: GatewayTwinTelemetryTopic, prefix: string): string {
  return `${prefix}/${canonical.slice('prplos/'.length)}`;
}

/**
 * Read configuration lazily. `server/index.ts` loads dotenv before calling
 * `ipsecSource.start()`, while static ESM imports execute earlier.
 */
function readSourceConfig(): SourceConfig {
  const eventsInput = inputTopic(
    process.env.IOT_GATEWAY_TWIN_EVENTS_TOPIC,
    GATEWAY_TWIN_EVENTS_TOPIC,
    'IOT_GATEWAY_TWIN_EVENTS_TOPIC',
  );
  const statusInput = inputTopic(
    process.env.IOT_GATEWAY_TWIN_STATUS_TOPIC,
    GATEWAY_TWIN_STATUS_TOPIC,
    'IOT_GATEWAY_TWIN_STATUS_TOPIC',
  );
  const prplosPrefix = (process.env.IOT_GATEWAY_TWIN_PRPLOS_PREFIX?.trim() || 'prplos')
    .replace(/\/+$/, '');
  if (!prplosPrefix || prplosPrefix.includes('#') || prplosPrefix.includes('+')) {
    throw new Error('IOT_GATEWAY_TWIN_PRPLOS_PREFIX must be a concrete MQTT topic prefix');
  }

  const canonicalByInput = new Map<string, GatewayTwinTopic>();
  const add = (input: string, canonical: GatewayTwinTopic) => {
    const previous = canonicalByInput.get(input);
    if (previous && previous !== canonical) {
      throw new Error(`Gateway Twin topic alias ${input} maps to both ${previous} and ${canonical}`);
    }
    canonicalByInput.set(input, canonical);
  };
  add(eventsInput, GATEWAY_TWIN_EVENTS_TOPIC);
  add(statusInput, GATEWAY_TWIN_STATUS_TOPIC);
  for (const canonical of GATEWAY_TWIN_TELEMETRY_TOPICS) {
    add(prplosInputTopic(canonical, prplosPrefix), canonical);
  }

  return {
    canonicalByInput,
    subscriptionTopics: [...canonicalByInput.keys()],
    historySize: positiveInteger(
      process.env.IOT_GATEWAY_TWIN_HISTORY_SIZE,
      DEFAULT_HISTORY_SIZE,
      'IOT_GATEWAY_TWIN_HISTORY_SIZE',
    ),
  };
}

function hashPayload(payload: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of payload) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class GatewayTwinSource extends EventEmitter {
  private config?: SourceConfig;
  // Epoch-based ids stay monotonic across normal server restarts. Starting at
  // 1 would make a reconnecting EventSource send a larger Last-Event-ID from
  // the previous process and suppress new replay entries until the counter
  // caught up again.
  private nextEventId = Date.now();
  private history: GatewayTwinLogBatch[] = [];
  private latestTelemetry = new Map<GatewayTwinTelemetryTopic, GatewayTwinTelemetry>();
  private recentPackets = new Map<string, number>();
  private upstream: GatewayTwinUpstreamState = {
    state: 'connecting',
    endpoint: DEFAULT_ENDPOINT,
    connectedAt: null,
    lastMessageAt: null,
    lastStatusAt: null,
    decodeErrors: 0,
    duplicateDeliveries: 0,
    error: null,
  };

  constructor() {
    super();
    // Each open SSE response has one listener per event type. Routes remove all
    // three on close; allow normal multi-tab/operator concurrency without the
    // EventEmitter's default ten-listener warning.
    this.setMaxListeners(0);
  }

  private getConfig(): SourceConfig {
    return this.config ??= readSourceConfig();
  }

  setEndpoint(endpoint: string): void {
    this.upstream = { ...this.upstream, endpoint };
  }

  getSubscriptionTopics(): string[] {
    return [...this.getConfig().subscriptionTopics];
  }

  getState(): GatewayTwinUpstreamState {
    return { ...this.upstream };
  }

  getLatestTelemetry(): GatewayTwinTelemetry[] {
    return [...this.latestTelemetry.values()];
  }

  getHistoryAfter(lastEventId?: number): GatewayTwinLogBatch[] {
    if (lastEventId == null || !Number.isSafeInteger(lastEventId) || lastEventId < 0) {
      return [...this.history];
    }
    return this.history.filter((item) => item.id > lastEventId);
  }

  setConnectionState(state: GatewayTwinConnectionState, error: string | null = null): void {
    this.upstream = {
      ...this.upstream,
      state,
      error,
      connectedAt: state === 'connected'
        ? this.upstream.connectedAt ?? Date.now()
        : this.upstream.connectedAt,
    };
    this.emit('state', this.getState());
  }

  private prunePacketCache(now: number): void {
    for (const [key, seenAt] of this.recentPackets) {
      if (now - seenAt > PACKET_CACHE_TTL_MS) this.recentPackets.delete(key);
    }
    while (this.recentPackets.size > PACKET_CACHE_LIMIT) {
      const oldest = this.recentPackets.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.recentPackets.delete(oldest);
    }
  }

  /** Forward one delivery from ipsecSource's shared MQTT connection. */
  ingest(inputTopicName: string, payload: ArrayBuffer, duplicate = false): boolean {
    const canonicalTopic = this.getConfig().canonicalByInput.get(inputTopicName);
    if (!canonicalTopic) return false;

    const receivedAt = Date.now();
    const bytes = new Uint8Array(payload);
    const packetKey = `${inputTopicName}:${bytes.byteLength}:${hashPayload(bytes)}`;
    this.prunePacketCache(receivedAt);

    // AWS IoT does not guarantee a DUP flag on every redelivery. This removes
    // only explicit transport retransmissions; application-level exact dedupe
    // needs a publisher sequence/batch id, which LogBatch currently lacks.
    if (duplicate && this.recentPackets.has(packetKey)) {
      this.upstream = {
        ...this.upstream,
        duplicateDeliveries: this.upstream.duplicateDeliveries + 1,
      };
      this.emit('state', this.getState());
      return true;
    }
    this.recentPackets.set(packetKey, receivedAt);

    if (bytes.byteLength > MAX_PAYLOAD_BYTES) {
      this.recordDecodeError(canonicalTopic, `payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
      return true;
    }

    try {
      if (TELEMETRY_TOPIC_SET.has(canonicalTopic)) {
        const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
        if (!isJsonObject(parsed)) throw new Error('expected a JSON object');
        const telemetry: GatewayTwinTelemetry = {
          topic: canonicalTopic as GatewayTwinTelemetryTopic,
          receivedAt,
          payload: parsed,
        };
        this.latestTelemetry.set(telemetry.topic, telemetry);
        this.noteSuccessfulMessage(receivedAt, false);
        this.emit('telemetry', telemetry);
        return true;
      }

      const decoded = decodeGatewayTwinLogBatch(bytes);
      const topic = canonicalTopic as GatewayTwinLogTopic;
      const batch: GatewayTwinLogBatch = {
        id: this.nextEventId++,
        topic,
        receivedAt,
        entries: decoded.entries,
      };
      this.history.push(batch);
      const historySize = this.getConfig().historySize;
      if (this.history.length > historySize) {
        this.history.splice(0, this.history.length - historySize);
      }
      this.noteSuccessfulMessage(receivedAt, topic === GATEWAY_TWIN_STATUS_TOPIC);
      this.emit('batch', batch);
      return true;
    } catch (error) {
      const kind = (canonicalTopic === GATEWAY_TWIN_EVENTS_TOPIC || canonicalTopic === GATEWAY_TWIN_STATUS_TOPIC)
        ? 'LogBatch'
        : DEVICE_INFO_TOPIC_SET.has(canonicalTopic)
          ? 'DeviceInfo JSON'
          : 'network telemetry JSON';
      this.recordDecodeError(
        canonicalTopic,
        `invalid ${kind} (${error instanceof Error ? error.message : String(error)})`,
      );
      return true;
    }
  }

  private noteSuccessfulMessage(receivedAt: number, statusMessage: boolean): void {
    const shouldBroadcastState = this.upstream.state !== 'connected' || this.upstream.error !== null;
    this.upstream = {
      ...this.upstream,
      state: 'connected',
      error: null,
      connectedAt: this.upstream.connectedAt ?? receivedAt,
      lastMessageAt: receivedAt,
      lastStatusAt: statusMessage ? receivedAt : this.upstream.lastStatusAt,
    };
    if (shouldBroadcastState) this.emit('state', this.getState());
  }

  private recordDecodeError(topic: GatewayTwinTopic, detail: string): void {
    this.upstream = {
      ...this.upstream,
      decodeErrors: this.upstream.decodeErrors + 1,
      error: `${topic}: ${detail}`,
    };
    this.emit('state', this.getState());
  }

  onState(listener: GatewayTwinSourceEvents['state']): () => void {
    this.on('state', listener);
    return () => this.off('state', listener);
  }

  onTelemetry(listener: GatewayTwinSourceEvents['telemetry']): () => void {
    this.on('telemetry', listener);
    return () => this.off('telemetry', listener);
  }

  onBatch(listener: GatewayTwinSourceEvents['batch']): () => void {
    this.on('batch', listener);
    return () => this.off('batch', listener);
  }
}

export const gatewayTwinSource = new GatewayTwinSource();
