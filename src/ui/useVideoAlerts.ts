import { useSyncExternalStore } from 'react';

export type VideoRelayChannel = 1 | 2 | 3 | 4;
export type VideoRelayState = 'ON' | 'OFF';
export type VideoRelayCode = `${VideoRelayState}_${VideoRelayChannel}`;
export type VideoRelayLevel = 'attention' | 'warning' | 'clear' | 'critical';

export interface VideoRelayEvent {
  id: number;
  topic: string;
  code: VideoRelayCode;
  state: VideoRelayState;
  channel: VideoRelayChannel;
  level: VideoRelayLevel;
  encoding: 'raw' | 'json-string' | 'json-object';
  receivedAt: number;
  retained: boolean;
}

export interface VideoRelayChannelState {
  active: boolean | null;
  updatedAt: number | null;
  lastCode: VideoRelayCode | null;
}

type AlertTransport = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'unavailable';

export interface UseVideoAlertsResult {
  topic: string;
  connected: boolean;
  lastError?: string;
  lastLiveEvent?: VideoRelayEvent;
  channels: Record<VideoRelayChannel, VideoRelayChannelState>;
  lastReceivedAt?: number;
  transport: AlertTransport;
}

interface SnapshotPayload {
  topic: string;
  connected: boolean;
  lastError?: string | null;
  channels?: Partial<Record<VideoRelayChannel, VideoRelayChannelState>>;
  receivedAt?: number | null;
}

const CHANNELS = [1, 2, 3, 4] as const;
const STATES = new Set<VideoRelayState>(['ON', 'OFF']);
const LEVELS = new Set<VideoRelayLevel>(['attention', 'warning', 'clear', 'critical']);
const ENCODINGS = new Set<VideoRelayEvent['encoding']>(['raw', 'json-string', 'json-object']);

function emptyChannels(): Record<VideoRelayChannel, VideoRelayChannelState> {
  return {
    1: { active: null, updatedAt: null, lastCode: null },
    2: { active: null, updatedAt: null, lastCode: null },
    3: { active: null, updatedAt: null, lastCode: null },
    4: { active: null, updatedAt: null, lastCode: null },
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseChannelState(value: unknown): VideoRelayChannelState | null {
  const parsed = asObject(value);
  if (!parsed) return null;
  const active = parsed.active;
  const updatedAt = parsed.updatedAt;
  const lastCode = parsed.lastCode;
  if (active !== null && typeof active !== 'boolean') return null;
  if (updatedAt !== null && !isTimestamp(updatedAt)) return null;
  if (lastCode !== null && (typeof lastCode !== 'string' || !/^(ON|OFF)_[1-4]$/.test(lastCode))) {
    return null;
  }
  return {
    active: active as boolean | null,
    updatedAt: updatedAt as number | null,
    lastCode: lastCode as VideoRelayCode | null,
  };
}

export function parseVideoAlertSnapshot(data: string): SnapshotPayload {
  const parsed = asObject(JSON.parse(data));
  if (!parsed || typeof parsed.topic !== 'string' || parsed.topic.trim() === '') {
    throw new Error('Video alert snapshot has an invalid topic');
  }
  if (typeof parsed.connected !== 'boolean') {
    throw new Error('Video alert snapshot has an invalid connection state');
  }
  if (parsed.lastError !== undefined && parsed.lastError !== null && typeof parsed.lastError !== 'string') {
    throw new Error('Video alert snapshot has invalid error metadata');
  }
  if (parsed.receivedAt !== undefined && parsed.receivedAt !== null && !isTimestamp(parsed.receivedAt)) {
    throw new Error('Video alert snapshot has an invalid receipt timestamp');
  }

  const channelObject = asObject(parsed.channels);
  const channels: Partial<Record<VideoRelayChannel, VideoRelayChannelState>> = {};
  if (channelObject) {
    for (const channel of CHANNELS) {
      const value = channelObject[String(channel)];
      if (value === undefined) continue;
      const state = parseChannelState(value);
      if (!state) throw new Error(`Video alert snapshot has invalid channel ${channel}`);
      channels[channel] = state;
    }
  }

  return {
    topic: parsed.topic,
    connected: parsed.connected,
    ...(parsed.lastError ? { lastError: parsed.lastError as string } : null),
    ...(Object.keys(channels).length > 0 ? { channels } : null),
    ...(isTimestamp(parsed.receivedAt) ? { receivedAt: parsed.receivedAt } : null),
  };
}

export function parseVideoRelayEvent(data: string): VideoRelayEvent {
  const parsed = asObject(JSON.parse(data));
  if (!parsed) throw new Error('Video alert event is not an object');
  if (!Number.isSafeInteger(parsed.id) || (parsed.id as number) < 0) {
    throw new Error('Video alert event has an invalid id');
  }
  if (typeof parsed.topic !== 'string' || parsed.topic.trim() === '') {
    throw new Error('Video alert event has an invalid topic');
  }
  if (typeof parsed.state !== 'string' || !STATES.has(parsed.state as VideoRelayState)) {
    throw new Error('Video alert event has an invalid relay state');
  }
  if (!CHANNELS.includes(parsed.channel as VideoRelayChannel)) {
    throw new Error('Video alert event has an invalid relay channel');
  }
  const code = `${parsed.state}_${parsed.channel}`;
  if (parsed.code !== code) throw new Error('Video alert event code does not match its state and channel');
  if (typeof parsed.level !== 'string' || !LEVELS.has(parsed.level as VideoRelayLevel)) {
    throw new Error('Video alert event has an invalid level');
  }
  if (typeof parsed.encoding !== 'string' || !ENCODINGS.has(parsed.encoding as VideoRelayEvent['encoding'])) {
    throw new Error('Video alert event has an invalid encoding');
  }
  if (!isTimestamp(parsed.receivedAt)) {
    throw new Error('Video alert event has an invalid receipt timestamp');
  }
  if (typeof parsed.retained !== 'boolean') {
    throw new Error('Video alert event has an invalid retained flag');
  }

  return {
    id: parsed.id as number,
    topic: parsed.topic,
    code: parsed.code as VideoRelayCode,
    state: parsed.state as VideoRelayState,
    channel: parsed.channel as VideoRelayChannel,
    level: parsed.level as VideoRelayLevel,
    encoding: parsed.encoding as VideoRelayEvent['encoding'],
    receivedAt: parsed.receivedAt,
    retained: parsed.retained,
  };
}

let current: UseVideoAlertsResult = {
  topic: 'relay/control',
  connected: false,
  channels: emptyChannels(),
  transport: 'idle',
};
const listeners = new Set<() => void>();
let eventSource: EventSource | null = null;
let snapshotAbort: AbortController | null = null;

function publish(next: UseVideoAlertsResult): void {
  current = next;
  for (const listener of listeners) listener();
}

function applySnapshot(snapshot: SnapshotPayload): void {
  const channels = { ...current.channels };
  for (const channel of CHANNELS) {
    if (snapshot.channels?.[channel]) channels[channel] = snapshot.channels[channel];
  }
  publish({
    ...current,
    topic: snapshot.topic,
    connected: snapshot.connected,
    channels,
    lastError: snapshot.lastError ?? undefined,
    lastReceivedAt: snapshot.receivedAt ?? current.lastReceivedAt,
  });
}

function applyLiveEvent(event: VideoRelayEvent): void {
  const channels = {
    ...current.channels,
    [event.channel]: {
      active: event.state === 'ON',
      updatedAt: event.receivedAt,
      lastCode: event.code,
    },
  };
  publish({
    ...current,
    connected: true,
    channels,
    lastReceivedAt: event.receivedAt,
    // Retained broker state is useful for status, but it is not a new safety
    // event and must never trigger a toast after a process restart.
    ...(!event.retained ? { lastLiveEvent: event } : null),
  });
}

function startFeed(): void {
  if (eventSource) return;
  publish({ ...current, lastLiveEvent: undefined, transport: 'connecting' });

  snapshotAbort = new AbortController();
  fetch('/api/video-alerts/snapshot', { signal: snapshotAbort.signal })
    .then((response) => response.text())
    .then((data) => applySnapshot(parseVideoAlertSnapshot(data)))
    .catch(() => { /* The live stream remains the recovery path. */ });

  if (typeof EventSource === 'undefined') {
    publish({
      ...current,
      connected: false,
      transport: 'unavailable',
      lastError: 'Live browser events are unavailable',
    });
    return;
  }

  const source = new EventSource('/api/video-alerts/stream');
  eventSource = source;
  source.onopen = () => {
    if (eventSource !== source) return;
    publish({ ...current, transport: 'open' });
  };
  source.addEventListener('snapshot', (event) => {
    try { applySnapshot(parseVideoAlertSnapshot((event as MessageEvent).data)); } catch { /* ignore */ }
  });
  source.addEventListener('status', (event) => {
    try { applySnapshot(parseVideoAlertSnapshot((event as MessageEvent).data)); } catch { /* ignore */ }
  });
  source.addEventListener('alert', (event) => {
    try { applyLiveEvent(parseVideoRelayEvent((event as MessageEvent).data)); } catch { /* ignore */ }
  });
  source.onerror = () => {
    if (eventSource !== source) return;
    publish({
      ...current,
      connected: false,
      transport: 'reconnecting',
      lastError: 'Video alert stream unavailable; retrying automatically',
    });
  };
}

function stopFeed(): void {
  snapshotAbort?.abort();
  snapshotAbort = null;
  eventSource?.close();
  eventSource = null;
  current = { ...current, lastLiveEvent: undefined, transport: 'idle' };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) startFeed();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopFeed();
  };
}

function getSnapshot(): UseVideoAlertsResult {
  return current;
}

export function useVideoAlerts(): UseVideoAlertsResult {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
