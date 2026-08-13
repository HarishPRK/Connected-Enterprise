/**
 * Shared live gateway telemetry feed for the Overview LAN and PoE panels.
 *
 * The bridge rehydrates the latest value for every MQTT topic whenever the
 * SSE connection opens. This module keeps that same latest-per-topic model in
 * the browser and deliberately exposes only fields found in a real payload:
 * no placeholder ports, inferred link states, zero wattage, or assumed PoE
 * budgets are manufactured here.
 */

import { useSyncExternalStore } from 'react';

export const GATEWAY_LOG_STREAM_URL = '/api/gateway-logs/stream' as const;
export const GATEWAY_TELEMETRY_STALE_AFTER_MS = 150_000;

export const GATEWAY_ETHERNET_TOPICS = [
  'prplos/ethernet/eth1',
  'prplos/ethernet/eth0_1',
  'prplos/ethernet/eth0_2',
  'prplos/ethernet/eth0_3',
  'prplos/ethernet/eth0_4',
] as const;

export const GATEWAY_LAN_TOPICS = [
  'prplos/ethernet/eth0_1',
  'prplos/ethernet/eth0_2',
  'prplos/ethernet/eth0_3',
  'prplos/ethernet/eth0_4',
  'prplos/ethernet/eth1',
] as const;

export type GatewayEthernetTopic = (typeof GATEWAY_ETHERNET_TOPICS)[number];
export type GatewayLanTopic = (typeof GATEWAY_LAN_TOPICS)[number];
export type GatewayLanInterfaceName = 'eth0_1' | 'eth0_2' | 'eth0_3' | 'eth0_4' | 'eth1';
export type GatewayLanPortId = 1 | 2 | 3 | 4 | 5;

const ETHERNET_TOPIC_SET: ReadonlySet<string> = new Set(GATEWAY_ETHERNET_TOPICS);
const LAN_TOPIC_SET: ReadonlySet<string> = new Set(GATEWAY_LAN_TOPICS);

const LAN_TOPIC_META: Record<GatewayLanTopic, {
  id: GatewayLanPortId;
  interfaceName: GatewayLanInterfaceName;
  label: string;
}> = {
  'prplos/ethernet/eth0_1': { id: 1, interfaceName: 'eth0_1', label: 'LAN 1' },
  'prplos/ethernet/eth0_2': { id: 2, interfaceName: 'eth0_2', label: 'LAN 2' },
  'prplos/ethernet/eth0_3': { id: 3, interfaceName: 'eth0_3', label: 'LAN 3' },
  'prplos/ethernet/eth0_4': { id: 4, interfaceName: 'eth0_4', label: 'ONT/LAN' },
  'prplos/ethernet/eth1': { id: 5, interfaceName: 'eth1', label: 'Fiber' },
};

export function isGatewayEthernetTopic(topic: string): topic is GatewayEthernetTopic {
  return ETHERNET_TOPIC_SET.has(topic);
}

export function isGatewayLanTopic(topic: string): topic is GatewayLanTopic {
  return LAN_TOPIC_SET.has(topic);
}

export type GatewayUpstreamConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline'
  | 'error';

export interface GatewayBridgeState {
  state: GatewayUpstreamConnectionState;
  endpoint?: string;
  connectedAt?: number | null;
  lastMessageAt?: number | null;
  lastStatusAt?: number | null;
  decodeErrors?: number;
  duplicateDeliveries?: number;
  error?: string | null;
}

export interface GatewayDeviceTelemetryEvent {
  topic: string;
  receivedAt: number;
  payload: Record<string, unknown>;
}

export interface GatewayEthernetTelemetryEvent extends GatewayDeviceTelemetryEvent {
  topic: GatewayEthernetTopic;
}

export type LatestGatewayEthernetTelemetry = Partial<
  Record<GatewayEthernetTopic, GatewayEthernetTelemetryEvent>
>;

/** A PoE quantity exactly as reported, plus watts only when a unit is known. */
export interface GatewayPoePowerReading {
  value: number;
  unit?: 'W' | 'mW' | 'uW';
  watts?: number;
  sourcePath: string;
}

/**
 * Optional PoE evidence attached to an Ethernet report. This object is absent
 * unless an explicit PoE/PSE scope or an explicitly PoE-named field exists.
 */
export interface GatewayPoeTelemetry {
  enabled?: boolean;
  status?: string;
  powerClass?: string;
  power?: GatewayPoePowerReading;
  limit?: GatewayPoePowerReading;
}

/** Pure, time-independent parse result for one real LAN telemetry delivery. */
export interface GatewayLanPortTelemetry {
  id: GatewayLanPortId;
  label: string;
  interfaceName: GatewayLanInterfaceName;
  topic: GatewayLanTopic;
  receivedAt: number;
  sampledAt?: number;
  enabled?: boolean;
  linkUp?: boolean;
  speedMbps?: number;
  duplex?: string;
  connectedDeviceName?: string;
  rxBps?: number;
  txBps?: number;
  rxBytes?: string;
  txBytes?: string;
  rxPackets?: string;
  txPackets?: string;
  /** Rates are present only after two monotonic counter samples. */
  rxPps?: number;
  txPps?: number;
  poe?: GatewayPoeTelemetry;
}

export type GatewayFreshnessState = 'waiting' | 'fresh' | 'stale' | 'clock-skew';

export interface GatewayFreshness {
  state: GatewayFreshnessState;
  fresh: boolean;
  staleAfterMs: number;
  receivedAt?: number;
  ageMs?: number;
}

export interface GatewayLiveLanPort extends GatewayLanPortTelemetry {
  freshness: GatewayFreshness;
}

export interface GatewayLivePoePort extends GatewayLiveLanPort {
  poe: GatewayPoeTelemetry;
}

export type GatewayEventSourceTransport =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'unavailable';

export type GatewayClientErrorKind =
  | 'transport'
  | 'state-event'
  | 'telemetry-event'
  | 'telemetry-payload';

export interface GatewayClientError {
  kind: GatewayClientErrorKind;
  message: string;
  at: number;
}

export interface GatewayConnectionMetadata {
  transport: GatewayEventSourceTransport;
  upstreamState?: GatewayUpstreamConnectionState;
  connected: boolean;
  endpoint?: string;
  connectedAt?: number | null;
  lastEventAt?: number;
  lastTelemetryAt?: number;
  upstreamLastMessageAt?: number | null;
  upstreamError?: string | null;
  transportError?: string;
  upstreamDecodeErrors?: number;
  duplicateDeliveries?: number;
  clientDecodeErrors: number;
  lastClientError?: GatewayClientError;
}

export interface UseGatewayTelemetryResult {
  /** Parsed LAN topics that have actually delivered at least one payload. */
  ports: GatewayLiveLanPort[];
  portsByInterface: Partial<Record<GatewayLanInterfaceName, GatewayLiveLanPort>>;
  /** Subset of `ports`; an entry exists only when explicit PoE data exists. */
  poePorts: GatewayLivePoePort[];
  /** Latest raw bridge envelope for every Ethernet topic, including eth1. */
  latestByTopic: LatestGatewayEthernetTelemetry;
  connection: GatewayConnectionMetadata;
  freshness: GatewayFreshness;
}

const UPSTREAM_STATES: ReadonlySet<string> = new Set([
  'connecting',
  'connected',
  'reconnecting',
  'offline',
  'error',
]);

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function optionalTimestamp(
  record: Record<string, unknown>,
  key: string,
): number | null | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!finiteNonNegative(value)) throw new Error(`Bridge state ${key} is invalid`);
  return value;
}

function optionalCount(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || !finiteNonNegative(value)) {
    throw new Error(`Bridge state ${key} is invalid`);
  }
  return value;
}

/** Parse and validate the SSE `state` event without trusting its JSON shape. */
export function parseGatewayBridgeState(data: string): GatewayBridgeState {
  const parsed = asObject(JSON.parse(data));
  if (!parsed || typeof parsed.state !== 'string' || !UPSTREAM_STATES.has(parsed.state)) {
    throw new Error('Bridge sent an invalid gateway state event');
  }
  if (parsed.endpoint !== undefined && typeof parsed.endpoint !== 'string') {
    throw new Error('Bridge state endpoint is invalid');
  }
  if (
    parsed.error !== undefined
    && parsed.error !== null
    && typeof parsed.error !== 'string'
  ) {
    throw new Error('Bridge state error metadata is invalid');
  }

  return {
    state: parsed.state as GatewayUpstreamConnectionState,
    ...(parsed.endpoint !== undefined ? { endpoint: parsed.endpoint as string } : null),
    ...(parsed.connectedAt !== undefined
      ? { connectedAt: optionalTimestamp(parsed, 'connectedAt') }
      : null),
    ...(parsed.lastMessageAt !== undefined
      ? { lastMessageAt: optionalTimestamp(parsed, 'lastMessageAt') }
      : null),
    ...(parsed.lastStatusAt !== undefined
      ? { lastStatusAt: optionalTimestamp(parsed, 'lastStatusAt') }
      : null),
    ...(parsed.decodeErrors !== undefined
      ? { decodeErrors: optionalCount(parsed, 'decodeErrors') }
      : null),
    ...(parsed.duplicateDeliveries !== undefined
      ? { duplicateDeliveries: optionalCount(parsed, 'duplicateDeliveries') }
      : null),
    ...(parsed.error !== undefined ? { error: parsed.error as string | null } : null),
  };
}

/** Parse and validate the SSE `device-telemetry` envelope. */
export function parseGatewayDeviceTelemetryEvent(data: string): GatewayDeviceTelemetryEvent {
  const parsed = asObject(JSON.parse(data));
  if (!parsed || typeof parsed.topic !== 'string' || parsed.topic.trim() === '') {
    throw new Error('Bridge sent an invalid gateway telemetry topic');
  }
  if (!finiteNonNegative(parsed.receivedAt)) {
    throw new Error('Bridge sent an invalid gateway telemetry timestamp');
  }
  const payload = asObject(parsed.payload);
  if (!payload) throw new Error('Bridge sent an invalid gateway telemetry payload');
  return { topic: parsed.topic, receivedAt: parsed.receivedAt, payload };
}

const MAX_TREE_DEPTH = 12;
const MAX_LEAVES = 2_048;

interface TelemetryLeaf {
  key: string;
  path: string;
  segments: string[];
  value: unknown;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function keySegments(value: string): string[] {
  return value.replaceAll('[', '.').replaceAll(']', '.').split(/[./]+/)
    .map(normalizeKey)
    .filter(Boolean);
}

function flattenTelemetry(
  value: unknown,
  parentSegments: string[] = [],
  leaves: TelemetryLeaf[] = [],
  depth = 0,
): TelemetryLeaf[] {
  if (depth > MAX_TREE_DEPTH || leaves.length >= MAX_LEAVES) return leaves;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length && leaves.length < MAX_LEAVES; index += 1) {
      flattenTelemetry(value[index], [...parentSegments, String(index)], leaves, depth + 1);
    }
    return leaves;
  }

  const object = asObject(value);
  if (object) {
    for (const [key, child] of Object.entries(object)) {
      if (leaves.length >= MAX_LEAVES) break;
      flattenTelemetry(child, [...parentSegments, ...keySegments(key)], leaves, depth + 1);
    }
    return leaves;
  }

  const segments = parentSegments.map(normalizeKey).filter(Boolean);
  leaves.push({
    key: segments.at(-1) ?? '',
    path: segments.join('.'),
    segments,
    value,
  });
  return leaves;
}

function findLeaf(leaves: TelemetryLeaf[], aliases: readonly string[]): TelemetryLeaf | null {
  const shortest = (items: TelemetryLeaf[]) =>
    items.sort((left, right) => left.segments.length - right.segments.length)[0] ?? null;

  for (const alias of aliases) {
    const wanted = keySegments(alias);
    const normalizedAlias = wanted.at(-1) ?? normalizeKey(alias);
    if (wanted.length === 1) {
      const direct = shortest(leaves.filter((leaf) => leaf.key === normalizedAlias));
      if (direct) return direct;
    }
    const suffix = shortest(leaves.filter((leaf) => {
      if (wanted.length > leaf.segments.length) return false;
      const offset = leaf.segments.length - wanted.length;
      return wanted.every((segment, index) => leaf.segments[offset + index] === segment);
    }));
    if (suffix) return suffix;
  }
  return null;
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))
      ? value
      : null;
  }
  if (typeof value !== 'string' || value.trim() === '') return null;
  const match = value.trim().replaceAll(',', '').match(
    /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i,
  );
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null;
  if (typeof value !== 'string') return null;
  const normalized = normalizeKey(value);
  if ([
    '1', 'true', 'yes', 'on', 'up', 'enabled', 'active', 'connected', 'linkup',
  ].includes(normalized)) return true;
  if ([
    '0', 'false', 'no', 'off', 'down', 'disabled', 'inactive', 'disconnected',
    'linkdown', 'notpresent',
  ].includes(normalized)) return false;
  return null;
}

function readBoolean(leaves: TelemetryLeaf[], aliases: readonly string[]): boolean | null {
  const leaf = findLeaf(leaves, aliases);
  return leaf ? booleanValue(leaf.value) : null;
}

function readString(leaves: TelemetryLeaf[], aliases: readonly string[]): string | null {
  const leaf = findLeaf(leaves, aliases);
  return leaf ? stringValue(leaf.value) : null;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string' || value.trim() === '') return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const number = Number(trimmed);
    return Number.isSafeInteger(number) ? number : null;
  }
  const date = Date.parse(trimmed);
  return Number.isFinite(date) && date >= 0 ? date : null;
}

function collectionTime(value: unknown): number | null {
  const leaf = findLeaf(flattenTelemetry(value), ['CollectionTime']);
  return leaf ? parseTimestamp(leaf.value) : null;
}

function interfaceNameFromValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return /^(?:eth\d+(?:_\d+)?)$/.test(normalized) ? normalized : null;
}

function objectInterfaceName(object: Record<string, unknown>): string | null {
  const identifyingKeys = new Set([
    'name',
    'ifname',
    'interfacename',
    'interface',
    'device',
    'l3device',
    'alias',
  ]);
  for (const [key, value] of Object.entries(object)) {
    const normalizedKey = normalizeKey(key);
    if (
      !identifyingKeys.has(normalizedKey)
      && ![...identifyingKeys].some((candidate) => normalizedKey.endsWith(candidate))
    ) continue;
    const name = interfaceNameFromValue(value);
    if (name) return name;
  }
  return null;
}

function collectInterfaceNames(
  value: unknown,
  names = new Set<string>(),
  depth = 0,
): Set<string> {
  if (depth > MAX_TREE_DEPTH) return names;
  if (Array.isArray(value)) {
    for (const child of value) collectInterfaceNames(child, names, depth + 1);
    return names;
  }
  const object = asObject(value);
  if (!object) return names;
  const identified = objectInterfaceName(object);
  if (identified) names.add(identified);
  for (const [key, child] of Object.entries(object)) {
    const keyName = interfaceNameFromValue(key);
    if (keyName) names.add(keyName);
    collectInterfaceNames(child, names, depth + 1);
  }
  return names;
}

function findInterfaceScope(
  value: unknown,
  interfaceName: GatewayLanInterfaceName,
  depth = 0,
): unknown | null {
  if (depth > MAX_TREE_DEPTH) return null;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findInterfaceScope(child, interfaceName, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  const object = asObject(value);
  if (!object) return null;
  if (objectInterfaceName(object) === interfaceName) return object;
  for (const [key, child] of Object.entries(object)) {
    if (interfaceNameFromValue(key) === interfaceName && (asObject(child) || Array.isArray(child))) {
      return child;
    }
  }
  for (const child of Object.values(object)) {
    const found = findInterfaceScope(child, interfaceName, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

interface SelectedReport {
  scope: unknown;
  sampledAt?: number;
}

function reportEntries(payload: Record<string, unknown>): unknown[] | null {
  const reportKey = Object.keys(payload).find((key) => normalizeKey(key) === 'report');
  if (!reportKey) return null;
  const report = payload[reportKey];
  if (Array.isArray(report)) return report;
  const object = asObject(report);
  if (!object) return [];
  const keys = Object.keys(object);
  if (keys.length > 0 && keys.every((key) => /^\d+$/.test(key))) {
    return Object.values(object);
  }
  return [object];
}

/** Select the newest matching TR-181 Report entry, mirroring the twin parser. */
function selectReport(
  payload: Record<string, unknown>,
  interfaceName: GatewayLanInterfaceName,
): SelectedReport | null {
  const entries = reportEntries(payload);
  if (entries === null) {
    const names = collectInterfaceNames(payload);
    if (names.size > 0 && !names.has(interfaceName)) return null;
    return {
      scope: findInterfaceScope(payload, interfaceName) ?? payload,
      ...(collectionTime(payload) !== null ? { sampledAt: collectionTime(payload) as number } : null),
    };
  }

  const candidates = entries.flatMap((entry, index) => {
    if (!asObject(entry)) return [];
    const names = collectInterfaceNames(entry);
    if (names.size > 0 && !names.has(interfaceName)) return [];
    const sampledAt = collectionTime(entry);
    return [{ entry, index, sampledAt }];
  });
  if (candidates.length === 0) return null;
  const timestamped = candidates.filter(
    (candidate): candidate is typeof candidate & { sampledAt: number } =>
      candidate.sampledAt !== null,
  );
  const selected = timestamped.length > 0
    ? timestamped.reduce((latest, candidate) =>
      candidate.sampledAt >= latest.sampledAt ? candidate : latest)
    : candidates[0];
  return {
    scope: findInterfaceScope(selected.entry, interfaceName) ?? selected.entry,
    ...(selected.sampledAt !== null ? { sampledAt: selected.sampledAt } : null),
  };
}

function parseLinkState(leaves: TelemetryLeaf[]): boolean | null {
  const carrier = readBoolean(leaves, ['Carrier', 'LinkDetected', 'Link', 'Up']);
  if (carrier !== null) return carrier;
  const statusLeaf = findLeaf(leaves, [
    'CurrentOperationalStatus',
    'OperStatus',
    'OperationalStatus',
    'Status',
  ]);
  if (!statusLeaf) return null;
  const direct = booleanValue(statusLeaf.value);
  if (direct !== null) return direct;
  if (typeof statusLeaf.value !== 'string') return null;
  const status = normalizeKey(statusLeaf.value);
  return [
    'down',
    'unknown',
    'dormant',
    'notpresent',
    'lowerlayerdown',
    'error',
    'disabled',
    'lowerlayererror',
    'notallowed',
  ].includes(status) ? false : null;
}

function parseSpeedMbps(leaves: TelemetryLeaf[]): number | null {
  const leaf = findLeaf(leaves, [
    'CurrentBitRate',
    'SpeedMbps',
    'LinkSpeedMbps',
    'LinkSpeed',
    'Speed',
  ]);
  if (!leaf) return null;
  const value = numericValue(leaf.value);
  if (value === null || value <= 0) return null;
  const unitText = typeof leaf.value === 'string' ? leaf.value.toLowerCase() : '';
  let mbps = value;
  if (/g(?:bit|b)(?:\/s|ps)?/.test(unitText)) mbps = value * 1_000;
  else if (/k(?:bit|b)(?:\/s|ps)?/.test(unitText)) mbps = value / 1_000;
  else if (/\bb(?:it)?(?:\/s|ps)\b/.test(unitText) || value >= 10_000_000) {
    mbps = value / 1_000_000;
  }
  if (!Number.isFinite(mbps) || mbps > 1_000_000) return null;
  return Math.round(mbps * 10) / 10;
}

function parseBitRate(leaves: TelemetryLeaf[], direction: 'rx' | 'tx'): number | null {
  const bitAliases = direction === 'rx'
    ? ['RxBps', 'ReceiveBps', 'ReceivedBps', 'RxBitRate', 'ReceiveBitRate', 'DownstreamBps']
    : ['TxBps', 'TransmitBps', 'SentBps', 'TxBitRate', 'TransmitBitRate', 'UpstreamBps'];
  const byteAliases = direction === 'rx'
    ? ['RxBytesPerSecond', 'ReceiveBytesPerSecond', 'ReceivedBytesPerSecond']
    : ['TxBytesPerSecond', 'TransmitBytesPerSecond', 'SentBytesPerSecond'];
  const bitLeaf = findLeaf(leaves, bitAliases);
  if (bitLeaf) {
    const value = numericValue(bitLeaf.value);
    if (value !== null && value >= 0) {
      if (typeof bitLeaf.value === 'string') {
        const unit = bitLeaf.value.toLowerCase();
        if (/gb(?:it)?(?:\/s|ps)/.test(unit)) return value * 1_000_000_000;
        if (/mb(?:it)?(?:\/s|ps)/.test(unit)) return value * 1_000_000;
        if (/kb(?:it)?(?:\/s|ps)/.test(unit)) return value * 1_000;
      }
      return value;
    }
  }
  const byteLeaf = findLeaf(leaves, byteAliases);
  if (!byteLeaf) return null;
  const bytesPerSecond = numericValue(byteLeaf.value);
  return bytesPerSecond !== null && bytesPerSecond >= 0 ? bytesPerSecond * 8 : null;
}

function parseCounter(leaves: TelemetryLeaf[], aliases: readonly string[]): string | null {
  const value = findLeaf(leaves, aliases)?.value;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\+?\d+$/.test(trimmed)) return null;
  try {
    const parsed = BigInt(trimmed);
    return parsed >= 0n && parsed < 18_446_744_073_709_551_615n
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function parsePacketRate(leaves: TelemetryLeaf[], direction: 'rx' | 'tx'): number | null {
  const aliases = direction === 'rx'
    ? ['RxPps', 'ReceivePps', 'ReceivedPps', 'RxPacketsPerSecond', 'ReceivePacketsPerSecond']
    : ['TxPps', 'TransmitPps', 'SentPps', 'TxPacketsPerSecond', 'TransmitPacketsPerSecond'];
  const value = numericValue(findLeaf(leaves, aliases)?.value);
  return value !== null && value >= 0 ? value : null;
}

const POE_CONTEXT_SEGMENTS: ReadonlySet<string> = new Set([
  'poe',
  'poweroverethernet',
  'pse',
  'powersourcingequipment',
  'powereddevice',
]);

function isPoeLeaf(leaf: TelemetryLeaf): boolean {
  return leaf.segments.some((segment) =>
    POE_CONTEXT_SEGMENTS.has(segment) || segment.startsWith('poe'));
}

function findPoeLeaf(
  poeLeaves: TelemetryLeaf[],
  aliases: readonly string[],
  predicate: (value: unknown) => boolean = () => true,
): TelemetryLeaf | null {
  const normalizedAliases = new Set(aliases.map(normalizeKey));
  const candidates = poeLeaves.filter((leaf) =>
    leaf.segments.some((segment) => normalizedAliases.has(segment)) && predicate(leaf.value));
  return candidates.sort((left, right) => left.segments.length - right.segments.length)[0] ?? null;
}

function sharedPrefixLength(left: readonly string[], right: readonly string[]): number {
  let length = 0;
  while (length < left.length && length < right.length && left[length] === right[length]) {
    length += 1;
  }
  return length;
}

function parsePowerUnit(value: unknown): GatewayPoePowerReading['unit'] | undefined {
  if (typeof value !== 'string') return undefined;
  const compact = value.trim().replace(/\s+/g, '').replace('µ', 'u');
  if (/^(?:uw|microwatts?)$/i.test(compact)) return 'uW';
  if (/^(?:mw|milliwatts?)$/i.test(compact)) return 'mW';
  if (/^(?:w|watts?)$/i.test(compact)) return 'W';
  return undefined;
}

function unitFromRawValue(value: unknown): GatewayPoePowerReading['unit'] | undefined {
  if (typeof value !== 'string') return undefined;
  const match = value.trim().replace('µ', 'u').match(
    /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?\s*(uW|mW|W|microwatts?|milliwatts?|watts?)\b/i,
  );
  return match ? parsePowerUnit(match[1]) : undefined;
}

function unitFromMetricKey(leaf: TelemetryLeaf): GatewayPoePowerReading['unit'] | undefined {
  const metric = [...leaf.segments].reverse().find((segment) =>
    segment !== 'value' && segment !== 'current' && !POE_CONTEXT_SEGMENTS.has(segment));
  if (!metric) return undefined;
  if (metric.includes('microwatt') || metric.endsWith('uw')) return 'uW';
  if (metric.includes('milliwatt') || metric.endsWith('mw')) return 'mW';
  if (metric.includes('watt') || metric === 'powerw' || metric === 'maxpowerw') return 'W';
  return undefined;
}

function nearestPowerUnit(
  metricLeaf: TelemetryLeaf,
  poeLeaves: TelemetryLeaf[],
): GatewayPoePowerReading['unit'] | undefined {
  const unitLeaves = poeLeaves.filter((leaf) => [
    'unit',
    'units',
    'powerunit',
    'powerunits',
  ].includes(leaf.key) && parsePowerUnit(leaf.value) !== undefined);
  const nearest = unitLeaves.sort((left, right) =>
    sharedPrefixLength(metricLeaf.segments, right.segments)
    - sharedPrefixLength(metricLeaf.segments, left.segments))[0];
  return nearest ? parsePowerUnit(nearest.value) : undefined;
}

function powerReading(
  poeLeaves: TelemetryLeaf[],
  aliases: readonly string[],
): GatewayPoePowerReading | undefined {
  const leaf = findPoeLeaf(poeLeaves, aliases, (value) => numericValue(value) !== null);
  if (!leaf) return undefined;
  const value = numericValue(leaf.value);
  if (value === null || value < 0) return undefined;
  const unit = unitFromRawValue(leaf.value)
    ?? unitFromMetricKey(leaf)
    ?? nearestPowerUnit(leaf, poeLeaves);
  const watts = unit === 'W'
    ? value
    : unit === 'mW'
      ? value / 1_000
      : unit === 'uW'
        ? value / 1_000_000
        : undefined;
  return {
    value,
    ...(unit ? { unit } : null),
    ...(watts !== undefined ? { watts } : null),
    sourcePath: leaf.path,
  };
}

function parsePoeTelemetry(leaves: TelemetryLeaf[]): GatewayPoeTelemetry | undefined {
  const poeLeaves = leaves.filter(isPoeLeaf);
  if (poeLeaves.length === 0) return undefined;

  const enabledLeaf = findPoeLeaf(poeLeaves, [
    'Enable',
    'Enabled',
    'PowerEnable',
    'PoeEnable',
    'PoeEnabled',
  ], (value) => booleanValue(value) !== null);
  const enabled = enabledLeaf ? booleanValue(enabledLeaf.value) : null;
  const statusLeaf = findPoeLeaf(poeLeaves, [
    'Status',
    'PowerStatus',
    'OperationalStatus',
    'PoeStatus',
    'PoePowerStatus',
  ], (value) => stringValue(value) !== null);
  const status = statusLeaf ? stringValue(statusLeaf.value) : null;
  const classLeaf = findPoeLeaf(poeLeaves, [
    'Class',
    'PowerClass',
    'PoeClass',
    'DetectedClass',
  ], (value) => stringValue(value) !== null);
  const powerClass = classLeaf ? stringValue(classLeaf.value) : null;
  const power = powerReading(poeLeaves, [
    'Power',
    'PowerConsumption',
    'PowerDraw',
    'MeasuredPower',
    'ActualPower',
    'OutputPower',
    'PortPower',
    'PoePower',
    'PoePowerDraw',
    'PoePowerConsumption',
    'PowerWatts',
    'PoePowerWatts',
    'PowerUsed',
  ]);
  const limit = powerReading(poeLeaves, [
    'MaxPower',
    'MaximumPower',
    'PowerLimit',
    'PowerBudget',
    'AllocatedPower',
    'NegotiatedPower',
    'PoeMaxPower',
    'PoePowerLimit',
    'MaxPowerWatts',
  ]);

  if (enabled === null && status === null && powerClass === null && !power && !limit) {
    return undefined;
  }
  return {
    ...(enabled !== null ? { enabled } : null),
    ...(status !== null ? { status } : null),
    ...(powerClass !== null ? { powerClass } : null),
    ...(power ? { power } : null),
    ...(limit ? { limit } : null),
  };
}

/**
 * Parse one Ethernet delivery into a LAN port. `null` means the payload is
 * empty or explicitly describes a different interface. Missing individual
 * fields remain undefined; notably, link-down never manufactures speed 0.
 */
export function parseGatewayLanPortTelemetry(
  topic: GatewayLanTopic,
  payload: Record<string, unknown>,
  receivedAt: number,
): GatewayLanPortTelemetry | null {
  if (!finiteNonNegative(receivedAt)) throw new Error('Telemetry receivedAt is invalid');
  const meta = LAN_TOPIC_META[topic];
  const selected = selectReport(payload, meta.interfaceName);
  if (!selected) return null;
  const leaves = flattenTelemetry(selected.scope);
  if (leaves.length === 0) return null;
  // PoE commonly repeats generic names such as Enable, Status, and Power.
  // Keep that subtree out of base Ethernet lookups so PoE state can never be
  // mistaken for the interface's administrative or carrier state.
  const interfaceLeaves = leaves.filter((leaf) => !isPoeLeaf(leaf));

  const enabled = readBoolean(interfaceLeaves, [
    'Enable',
    'Enabled',
    'AdminStatus',
    'AdministrativeStatus',
  ]);
  const linkUp = parseLinkState(interfaceLeaves);
  const speedMbps = parseSpeedMbps(interfaceLeaves);
  const duplex = readString(interfaceLeaves, ['CurrentDuplexMode', 'DuplexMode', 'Duplex']);
  const connectedDeviceName = readString(interfaceLeaves, [
    'ConnectedDeviceName',
    'ConnectedHostName',
    'RemoteSystemName',
    'NeighborSystemName',
    'LLDPRemoteSystemName',
    'PeerName',
  ]);
  const rxBps = parseBitRate(interfaceLeaves, 'rx');
  const txBps = parseBitRate(interfaceLeaves, 'tx');
  const rxBytes = parseCounter(interfaceLeaves, [
    'Stats.BytesReceived',
    'BytesReceived',
    'RxBytes',
    'ReceivedBytes',
  ]);
  const txBytes = parseCounter(interfaceLeaves, [
    'Stats.BytesSent',
    'BytesSent',
    'TxBytes',
    'TransmittedBytes',
    'SentBytes',
  ]);
  const rxPackets = parseCounter(interfaceLeaves, [
    'Stats.PacketsReceived',
    'PacketsReceived',
    'RxPackets',
    'ReceivedPackets',
  ]);
  const txPackets = parseCounter(interfaceLeaves, [
    'Stats.PacketsSent',
    'PacketsSent',
    'TxPackets',
    'SentPackets',
  ]);
  const rxPps = parsePacketRate(interfaceLeaves, 'rx');
  const txPps = parsePacketRate(interfaceLeaves, 'tx');
  const poe = parsePoeTelemetry(leaves);

  return {
    id: meta.id,
    label: meta.label,
    interfaceName: meta.interfaceName,
    topic,
    receivedAt,
    ...(selected.sampledAt !== undefined ? { sampledAt: selected.sampledAt } : null),
    ...(enabled !== null ? { enabled } : null),
    ...(linkUp !== null ? { linkUp } : null),
    ...(speedMbps !== null ? { speedMbps } : null),
    ...(duplex !== null ? { duplex } : null),
    ...(connectedDeviceName !== null ? { connectedDeviceName } : null),
    ...(rxBps !== null ? { rxBps } : null),
    ...(txBps !== null ? { txBps } : null),
    ...(rxBytes !== null ? { rxBytes } : null),
    ...(txBytes !== null ? { txBytes } : null),
    ...(rxPackets !== null ? { rxPackets } : null),
    ...(txPackets !== null ? { txPackets } : null),
    ...(rxPps !== null ? { rxPps } : null),
    ...(txPps !== null ? { txPps } : null),
    ...(poe ? { poe } : null),
  };
}

function counterRatePerSecond(
  current: string | undefined,
  previous: string | undefined,
  currentAt: number,
  previousAt: number,
): number | undefined {
  if (!current || !previous || currentAt <= previousAt) return undefined;
  try {
    const currentCounter = BigInt(current);
    const previousCounter = BigInt(previous);
    if (currentCounter < previousCounter) return undefined;
    const delta = currentCounter - previousCounter;
    if (delta > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
    const seconds = (currentAt - previousAt) / 1_000;
    if (seconds <= 0 || seconds > 5 * 60) return undefined;
    return Math.round((Number(delta) / seconds) * 100) / 100;
  } catch {
    return undefined;
  }
}

/** Add rates only when two real monotonic packet-counter samples exist. */
function withDerivedPacketRates(
  current: GatewayLanPortTelemetry,
  previous: GatewayLanPortTelemetry | undefined,
): GatewayLanPortTelemetry {
  if (!previous) return current;
  const currentAt = current.sampledAt ?? current.receivedAt;
  const previousAt = previous.sampledAt ?? previous.receivedAt;
  const rxPps = current.rxPps ?? counterRatePerSecond(
    current.rxPackets,
    previous.rxPackets,
    currentAt,
    previousAt,
  );
  const txPps = current.txPps ?? counterRatePerSecond(
    current.txPackets,
    previous.txPackets,
    currentAt,
    previousAt,
  );
  return {
    ...current,
    ...(rxPps !== undefined ? { rxPps } : null),
    ...(txPps !== undefined ? { txPps } : null),
  };
}

const CLOCK_SKEW_TOLERANCE_MS = 5_000;

export function gatewayFreshness(
  receivedAt: number | undefined,
  now = Date.now(),
  staleAfterMs = GATEWAY_TELEMETRY_STALE_AFTER_MS,
): GatewayFreshness {
  if (receivedAt === undefined) {
    return { state: 'waiting', fresh: false, staleAfterMs };
  }
  const ageMs = now - receivedAt;
  if (ageMs < -CLOCK_SKEW_TOLERANCE_MS) {
    return { state: 'clock-skew', fresh: false, staleAfterMs, receivedAt, ageMs };
  }
  return {
    state: ageMs <= staleAfterMs ? 'fresh' : 'stale',
    fresh: ageMs <= staleAfterMs,
    staleAfterMs,
    receivedAt,
    ageMs,
  };
}

interface InternalGatewayTelemetryState {
  latestByTopic: LatestGatewayEthernetTelemetry;
  parsedByInterface: Partial<Record<GatewayLanInterfaceName, GatewayLanPortTelemetry>>;
  bridgeState?: GatewayBridgeState;
  transport: GatewayEventSourceTransport;
  transportError?: string;
  lastEventAt?: number;
  lastTelemetryAt?: number;
  clientDecodeErrors: number;
  lastClientError?: GatewayClientError;
}

const internal: InternalGatewayTelemetryState = {
  latestByTopic: {},
  parsedByInterface: {},
  transport: 'idle',
  clientDecodeErrors: 0,
};

const listeners = new Set<() => void>();
let eventSource: EventSource | null = null;
let freshnessTimer: ReturnType<typeof setInterval> | null = null;

function newestPortTimestamp(): number | undefined {
  const timestamps = Object.values(internal.parsedByInterface).map((port) => port.receivedAt);
  return timestamps.length > 0 ? Math.max(...timestamps) : undefined;
}

function buildSnapshot(now: number): UseGatewayTelemetryResult {
  const ports = GATEWAY_LAN_TOPICS.flatMap((topic) => {
    const meta = LAN_TOPIC_META[topic];
    const port = internal.parsedByInterface[meta.interfaceName];
    return port
      ? [{ ...port, freshness: gatewayFreshness(port.receivedAt, now) }]
      : [];
  });
  const portsByInterface: Partial<Record<GatewayLanInterfaceName, GatewayLiveLanPort>> = {};
  for (const port of ports) portsByInterface[port.interfaceName] = port;
  const poePorts = ports.filter(
    (port): port is GatewayLivePoePort => port.poe !== undefined,
  );
  const bridge = internal.bridgeState;
  const newest = newestPortTimestamp();
  return {
    ports,
    portsByInterface,
    poePorts,
    latestByTopic: internal.latestByTopic,
    connection: {
      transport: internal.transport,
      ...(bridge ? { upstreamState: bridge.state } : null),
      connected: internal.transport === 'open' && bridge?.state === 'connected',
      ...(bridge?.endpoint !== undefined ? { endpoint: bridge.endpoint } : null),
      ...(bridge?.connectedAt !== undefined ? { connectedAt: bridge.connectedAt } : null),
      ...(internal.lastEventAt !== undefined ? { lastEventAt: internal.lastEventAt } : null),
      ...(internal.lastTelemetryAt !== undefined
        ? { lastTelemetryAt: internal.lastTelemetryAt }
        : null),
      ...(bridge?.lastMessageAt !== undefined
        ? { upstreamLastMessageAt: bridge.lastMessageAt }
        : null),
      ...(bridge?.error !== undefined ? { upstreamError: bridge.error } : null),
      ...(internal.transportError !== undefined
        ? { transportError: internal.transportError }
        : null),
      ...(bridge?.decodeErrors !== undefined
        ? { upstreamDecodeErrors: bridge.decodeErrors }
        : null),
      ...(bridge?.duplicateDeliveries !== undefined
        ? { duplicateDeliveries: bridge.duplicateDeliveries }
        : null),
      clientDecodeErrors: internal.clientDecodeErrors,
      ...(internal.lastClientError ? { lastClientError: internal.lastClientError } : null),
    },
    freshness: gatewayFreshness(newest, now),
  };
}

let currentSnapshot = buildSnapshot(Date.now());

function publish(now = Date.now()): void {
  currentSnapshot = buildSnapshot(now);
  for (const listener of listeners) listener();
}

function eventData(event: Event): string {
  const data = (event as MessageEvent<unknown>).data;
  if (typeof data !== 'string') throw new Error('Bridge event data is not text');
  return data;
}

function noteClientError(kind: GatewayClientErrorKind, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  internal.clientDecodeErrors += kind === 'transport' ? 0 : 1;
  internal.lastClientError = { kind, message, at: Date.now() };
  publish();
}

function ingestStateEvent(event: Event): void {
  try {
    internal.bridgeState = parseGatewayBridgeState(eventData(event));
    internal.lastEventAt = Date.now();
    publish();
  } catch (error) {
    noteClientError('state-event', error);
  }
}

function ingestTelemetryEvent(event: Event): void {
  let delivery: GatewayDeviceTelemetryEvent;
  try {
    delivery = parseGatewayDeviceTelemetryEvent(eventData(event));
  } catch (error) {
    noteClientError('telemetry-event', error);
    return;
  }
  internal.lastEventAt = Date.now();
  if (!isGatewayEthernetTopic(delivery.topic)) {
    publish();
    return;
  }

  const ethernetDelivery: GatewayEthernetTelemetryEvent = {
    ...delivery,
    topic: delivery.topic,
  };
  const previousDelivery = internal.latestByTopic[ethernetDelivery.topic];
  if (previousDelivery && previousDelivery.receivedAt >= ethernetDelivery.receivedAt) {
    // A reconnect snapshot or delayed packet must not replace a newer value.
    publish();
    return;
  }
  internal.latestByTopic = {
    ...internal.latestByTopic,
    [ethernetDelivery.topic]: ethernetDelivery,
  };
  internal.lastTelemetryAt = Math.max(
    internal.lastTelemetryAt ?? ethernetDelivery.receivedAt,
    ethernetDelivery.receivedAt,
  );

  if (isGatewayLanTopic(ethernetDelivery.topic)) {
    try {
      const parsed = parseGatewayLanPortTelemetry(
        ethernetDelivery.topic,
        ethernetDelivery.payload,
        ethernetDelivery.receivedAt,
      );
      if (!parsed) {
        throw new Error(`${ethernetDelivery.topic} has no matching TR-181 interface report`);
      }
      const withRates = withDerivedPacketRates(
        parsed,
        internal.parsedByInterface[parsed.interfaceName],
      );
      internal.parsedByInterface = {
        ...internal.parsedByInterface,
        [parsed.interfaceName]: withRates,
      };
    } catch (error) {
      noteClientError('telemetry-payload', error);
      return;
    }
  }
  publish();
}

function startFeed(): void {
  if (eventSource) return;
  internal.transport = 'connecting';
  internal.transportError = undefined;
  publish();

  if (typeof EventSource === 'undefined') {
    internal.transport = 'unavailable';
    internal.transportError = 'EventSource is unavailable in this browser';
    internal.lastClientError = {
      kind: 'transport',
      message: internal.transportError,
      at: Date.now(),
    };
    publish();
    return;
  }

  let source: EventSource;
  try {
    source = new EventSource(GATEWAY_LOG_STREAM_URL);
  } catch (error) {
    internal.transport = 'unavailable';
    internal.transportError = error instanceof Error ? error.message : String(error);
    internal.lastClientError = {
      kind: 'transport',
      message: internal.transportError,
      at: Date.now(),
    };
    publish();
    return;
  }
  eventSource = source;

  source.onopen = () => {
    if (eventSource !== source) return;
    internal.transport = 'open';
    internal.transportError = undefined;
    publish();
  };
  source.addEventListener('state', ingestStateEvent);
  source.addEventListener('device-telemetry', ingestTelemetryEvent);
  source.onerror = () => {
    if (eventSource !== source) return;
    internal.transport = 'reconnecting';
    internal.transportError = 'Gateway telemetry stream unavailable; retrying automatically';
    internal.lastClientError = {
      kind: 'transport',
      message: internal.transportError,
      at: Date.now(),
    };
    publish();
  };

  freshnessTimer = setInterval(() => publish(), 1_000);
}

function stopFeed(): void {
  eventSource?.close();
  eventSource = null;
  if (freshnessTimer) clearInterval(freshnessTimer);
  freshnessTimer = null;
  internal.transport = 'idle';
  internal.transportError = undefined;
  currentSnapshot = buildSnapshot(Date.now());
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (listeners.size === 1) startFeed();
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) stopFeed();
  };
}

function getSnapshot(): UseGatewayTelemetryResult {
  return currentSnapshot;
}

/**
 * One ref-counted EventSource shared by every mounted consumer. The returned
 * arrays contain live observations only; consumers should render an explicit
 * waiting/unavailable state when fields are absent rather than falling back to
 * the dashboard's mock LAN or PoE arrays.
 */
export function useGatewayTelemetry(): UseGatewayTelemetryResult {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
