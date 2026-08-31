/**
 * Live Video Analytics relay alerts.
 *
 * The Greengrass/LAN detector publishes relay commands such as `ON_4` on
 * `relay/control`. `ipsecSource` owns the process-wide AWS IoT connection and
 * forwards that topic here; this source only validates, retains, and emits the
 * latest real observations for the Video Analytics SSE endpoint.
 */

import { EventEmitter } from 'node:events';

export const DEFAULT_VIDEO_ALERT_TOPIC = 'relay/control' as const;
export const VIDEO_RELAY_CHANNELS = [1, 2, 3, 4] as const;

const MAX_RELAY_PAYLOAD_BYTES = 1_024;
const RECENT_PACKET_TTL_MS = 30_000;
const RECENT_PACKET_LIMIT = 64;
const JSON_COMMAND_FIELDS = ['command', 'cmd', 'message', 'value', 'state', 'payload'] as const;

export type VideoRelayChannel = (typeof VIDEO_RELAY_CHANNELS)[number];
export type VideoRelayState = 'ON' | 'OFF';
export type VideoRelayCode = `${VideoRelayState}_${VideoRelayChannel}`;
export type VideoRelayLevel = 'attention' | 'warning' | 'clear' | 'critical';
export type VideoRelayEncoding = 'raw' | 'json-string' | 'json-object';

export interface ParsedVideoRelayCommand {
  code: VideoRelayCode;
  state: VideoRelayState;
  channel: VideoRelayChannel;
  level: VideoRelayLevel;
  encoding: VideoRelayEncoding;
}

export interface VideoRelayEvent extends ParsedVideoRelayCommand {
  id: number;
  topic: string;
  receivedAt: number;
  retained: boolean;
}

export interface VideoRelayChannelState {
  active: boolean | null;
  updatedAt: number | null;
  lastCode: VideoRelayCode | null;
}

export interface VideoAlertSnapshot {
  topic: string;
  connected: boolean;
  lastError: string | null;
  lastEvent: VideoRelayEvent | null;
  channels: Record<VideoRelayChannel, VideoRelayChannelState>;
  receivedAt: number | null;
  decodeErrors: number;
  duplicateDeliveries: number;
}

interface VideoAlertSourceEvents {
  alert: (event: VideoRelayEvent) => void;
  status: (snapshot: VideoAlertSnapshot) => void;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCode(value: string): Omit<ParsedVideoRelayCommand, 'encoding'> | null {
  const match = /^(ON|OFF)_([1-4])$/.exec(value);
  if (!match) return null;

  const state = match[1] as VideoRelayState;
  const channel = Number(match[2]) as VideoRelayChannel;
  const level: VideoRelayLevel = channel === 1
    ? 'attention'
    : channel === 2
      ? 'warning'
      : channel === 3
        ? 'clear'
        : 'critical';

  return {
    code: `${state}_${channel}`,
    state,
    channel,
    level,
  };
}

function extractJsonCommand(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!isPlainObject(value)) {
    throw new Error('expected a JSON string or object');
  }

  const candidates = JSON_COMMAND_FIELDS
    .filter((field) => Object.hasOwn(value, field))
    .map((field) => value[field]);
  if (candidates.length === 0) {
    throw new Error(`expected one of: ${JSON_COMMAND_FIELDS.join(', ')}`);
  }
  if (candidates.some((candidate) => typeof candidate !== 'string')) {
    throw new Error('relay command fields must be strings');
  }

  const commands = [...new Set(candidates as string[])];
  if (commands.length !== 1) {
    throw new Error('conflicting relay command fields');
  }
  return commands[0];
}

/** Parse the narrow relay/control contract without searching arbitrary JSON. */
export function parseVideoRelayPayload(
  payload: ArrayBuffer | Uint8Array,
): ParsedVideoRelayCommand {
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  if (bytes.byteLength === 0) throw new Error('empty relay payload');
  if (bytes.byteLength > MAX_RELAY_PAYLOAD_BYTES) {
    throw new Error(`relay payload exceeds ${MAX_RELAY_PAYLOAD_BYTES} bytes`);
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('relay payload is not valid UTF-8');
  }
  if (text.includes('\0')) throw new Error('relay payload contains a NUL byte');
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) throw new Error('empty relay payload');

  const raw = parseCode(trimmed);
  if (raw) return { ...raw, encoding: 'raw' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error('expected ON_1…ON_4, OFF_1…OFF_4, or a supported JSON wrapper');
  }

  const command = extractJsonCommand(parsed);
  const normalized = parseCode(command);
  if (!normalized) throw new Error(`unsupported relay command: ${command}`);
  return {
    ...normalized,
    encoding: typeof parsed === 'string' ? 'json-string' : 'json-object',
  };
}

export function resolveVideoAlertTopic(configured = process.env.IOT_VIDEO_ALERT_TOPIC): string {
  const topic = configured?.trim() || DEFAULT_VIDEO_ALERT_TOPIC;
  if (topic.includes('#') || topic.includes('+')) {
    throw new Error('IOT_VIDEO_ALERT_TOPIC must be one concrete MQTT topic');
  }
  return topic;
}

function hashPayload(payload: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of payload) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function emptyChannelState(): Record<VideoRelayChannel, VideoRelayChannelState> {
  return {
    1: { active: null, updatedAt: null, lastCode: null },
    2: { active: null, updatedAt: null, lastCode: null },
    3: { active: null, updatedAt: null, lastCode: null },
    4: { active: null, updatedAt: null, lastCode: null },
  };
}

export class VideoAlertSource extends EventEmitter {
  private readonly topic: string;
  private connected = false;
  private lastError: string | null = null;
  private lastEvent: VideoRelayEvent | null = null;
  private channels = emptyChannelState();
  private receivedAt: number | null = null;
  private decodeErrors = 0;
  private duplicateDeliveries = 0;
  private nextEventId = Date.now();
  private recentPackets = new Map<string, number>();

  constructor(topic = resolveVideoAlertTopic()) {
    super();
    this.topic = topic;
    this.setMaxListeners(0);
  }

  getTopic(): string {
    return this.topic;
  }

  getSnapshot(): VideoAlertSnapshot {
    return {
      topic: this.topic,
      connected: this.connected,
      lastError: this.lastError,
      lastEvent: this.lastEvent ? { ...this.lastEvent } : null,
      channels: {
        1: { ...this.channels[1] },
        2: { ...this.channels[2] },
        3: { ...this.channels[3] },
        4: { ...this.channels[4] },
      },
      receivedAt: this.receivedAt,
      decodeErrors: this.decodeErrors,
      duplicateDeliveries: this.duplicateDeliveries,
    };
  }

  setConnectionState(connected: boolean, error: string | null = null): void {
    this.connected = connected;
    this.lastError = error;
    this.emit('status', this.getSnapshot());
  }

  private pruneRecentPackets(now: number): void {
    for (const [key, seenAt] of this.recentPackets) {
      if (now - seenAt > RECENT_PACKET_TTL_MS) this.recentPackets.delete(key);
    }
    while (this.recentPackets.size > RECENT_PACKET_LIMIT) {
      const oldest = this.recentPackets.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.recentPackets.delete(oldest);
    }
  }

  /** Returns false for unrelated topics and true for every handled delivery. */
  ingest(
    inputTopic: string,
    payload: ArrayBuffer,
    duplicate = false,
    retained = false,
  ): boolean {
    if (inputTopic !== this.topic) return false;

    const now = Date.now();
    const bytes = new Uint8Array(payload);
    const packetKey = `${inputTopic}:${bytes.byteLength}:${hashPayload(bytes)}`;
    this.pruneRecentPackets(now);
    if (duplicate && this.recentPackets.has(packetKey)) {
      this.duplicateDeliveries += 1;
      this.emit('status', this.getSnapshot());
      return true;
    }
    this.recentPackets.set(packetKey, now);

    let parsed: ParsedVideoRelayCommand;
    try {
      parsed = parseVideoRelayPayload(bytes);
    } catch (error) {
      this.decodeErrors += 1;
      this.lastError = `${this.topic}: ${error instanceof Error ? error.message : String(error)}`;
      this.emit('status', this.getSnapshot());
      return true;
    }

    const event: VideoRelayEvent = {
      ...parsed,
      id: this.nextEventId++,
      topic: this.topic,
      receivedAt: now,
      retained,
    };
    this.channels[event.channel] = {
      active: event.state === 'ON',
      updatedAt: now,
      lastCode: event.code,
    };
    this.connected = true;
    this.lastError = null;
    this.lastEvent = event;
    this.receivedAt = now;
    this.emit('alert', event);
    return true;
  }

  onAlert(listener: VideoAlertSourceEvents['alert']): () => void {
    this.on('alert', listener);
    return () => this.off('alert', listener);
  }

  onStatus(listener: VideoAlertSourceEvents['status']): () => void {
    this.on('status', listener);
    return () => this.off('status', listener);
  }
}

export const videoAlertSource = new VideoAlertSource();
