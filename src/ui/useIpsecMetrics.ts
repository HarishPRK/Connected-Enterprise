/**
 * Client hook for live IPsec metrics streaming from the Express server.
 *
 * SHARED FEED: every caller of `useIpsecMetrics()` subscribes to ONE
 * module-level store — a single GET /api/ipsec/snapshot + one EventSource on
 * /api/ipsec/stream, ref-counted across all consumers. The app renders the
 * failover feed in several places at once (the global OpsIncidents provider,
 * the Overview page, the Dynamic Failover page, the client→tunnel
 * constellation); without sharing, each mounted consumer opened its own
 * stream and the server fanned the same data out N times per client. The
 * connection opens on the first subscriber and closes when the last unmounts.
 *
 * Callers get: { gateways, list, connected, lastError, subscribedTopic,
 * endpoint, lastReceivedAt } — unchanged.
 */

import { useCallback, useSyncExternalStore } from 'react';
import type { IpsecGatewayState } from '../types';
import { createTelemetryPublisher, sameTelemetryValue } from './telemetryPublisher';

interface SnapshotPayload {
  gateways: Record<string, IpsecGatewayState>;
  receivedAt: number;
  connected?: boolean;
  lastError?: string;
  subscribedTopic?: string;
  endpoint?: string;
}

interface UpdatePayload {
  gatewayKey: string;
  state: IpsecGatewayState;
}

interface StatusPayload {
  connected: boolean;
  reason?: string;
}

export interface UseIpsecMetricsResult {
  /** Latest state per gateway, keyed by lowercase gateway name. */
  gateways: Record<string, IpsecGatewayState>;
  /** Same data as a sorted array for easy rendering. */
  list: IpsecGatewayState[];
  /** True if the Express server's MQTT subscription is currently up. */
  connected: boolean;
  /** Server-reported last error (if any). */
  lastError?: string;
  /** Cloud topic the server is subscribed to. */
  subscribedTopic?: string;
  /** Server-side AWS IoT endpoint. */
  endpoint?: string;
  /** Most recent server timestamp we've heard from. */
  lastReceivedAt?: number;
}

/* ─────────── Shared store (one connection for the whole app) ─────────── */

const EMPTY_LIST: IpsecGatewayState[] = [];
let current: UseIpsecMetricsResult = { gateways: {}, list: EMPTY_LIST, connected: false };
const publication = createTelemetryPublisher(current);
let es: EventSource | null = null;
let snapAbort: AbortController | null = null;
let statusRevision = 0;
const gatewayStreamRevisions: Record<string, number> = {};
const gatewayStreamTimestamps: Record<string, number> = {};

function emit() {
  publication.publish(current);
}

function sortList(gateways: Record<string, IpsecGatewayState>): IpsecGatewayState[] {
  return Object.values(gateways).sort((a, b) =>
    a.metrics.gateway.name.localeCompare(b.metrics.gateway.name),
  );
}

function applySnapshot(snap: SnapshotPayload, preserveStatus = false, fetchStartRevisions?: Readonly<Record<string, number>>, fromStream = false) {
  const incoming = snap.gateways ?? {};
  const gateways = { ...incoming };
  // Guard ties per gateway so an unrelated topic can still hydrate. Stream
  // removals also get a revision, preventing a delayed HTTP response from
  // resurrecting a gateway removed by an authoritative stream snapshot.
  if (fetchStartRevisions) {
    for (const [key, state] of Object.entries(gateways)) {
      if ((gatewayStreamRevisions[key] ?? 0) !== (fetchStartRevisions[key] ?? 0)
        && state.receivedAt <= (gatewayStreamTimestamps[key] ?? -Infinity)) {
        if (current.gateways[key]) gateways[key] = current.gateways[key];
        else delete gateways[key];
      }
    }
  }
  for (const [key, previous] of Object.entries(current.gateways)) {
    const next = gateways[key];
    if (next && (next.receivedAt < previous.receivedAt || sameTelemetryValue(previous, next))
      || !next && (previous.receivedAt > snap.receivedAt
        || fetchStartRevisions && (gatewayStreamRevisions[key] ?? 0) !== (fetchStartRevisions[key] ?? 0) && previous.receivedAt >= snap.receivedAt)) gateways[key] = previous;
  }
  if (fromStream) {
    for (const key of new Set([...Object.keys(current.gateways), ...Object.keys(incoming)])) {
      const next = incoming[key];
      const previous = current.gateways[key];
      if (next && next.receivedAt >= (previous?.receivedAt ?? -Infinity) || !next && !gateways[key]) {
        gatewayStreamRevisions[key] = (gatewayStreamRevisions[key] ?? 0) + 1;
        gatewayStreamTimestamps[key] = next?.receivedAt ?? snap.receivedAt;
      }
    }
  }
  const sameGateways = Object.keys(gateways).length === current.list.length
    && Object.entries(gateways).every(([key, state]) => current.gateways[key] === state);
  current = {
    gateways: sameGateways ? current.gateways : gateways,
    list: sameGateways ? current.list : sortList(gateways),
    connected: !preserveStatus && typeof snap.connected === 'boolean' ? snap.connected : current.connected,
    lastError: preserveStatus ? current.lastError : snap.lastError,
    subscribedTopic: snap.subscribedTopic,
    endpoint: snap.endpoint,
    lastReceivedAt: Math.max(current.lastReceivedAt ?? 0, snap.receivedAt),
  };
  emit();
}

function applyUpdate(u: UpdatePayload) {
  const previous = current.gateways[u.gatewayKey];
  if (previous && previous.receivedAt > u.state.receivedAt) return;
  gatewayStreamRevisions[u.gatewayKey] = (gatewayStreamRevisions[u.gatewayKey] ?? 0) + 1;
  gatewayStreamTimestamps[u.gatewayKey] = u.state.receivedAt;
  if (previous && sameTelemetryValue(previous, u.state)) return;
  const gateways = { ...current.gateways, [u.gatewayKey]: u.state };
  current = { ...current, gateways, list: sortList(gateways), lastReceivedAt: Math.max(current.lastReceivedAt ?? 0, u.state.receivedAt) };
  emit();
}

function applyStatus(s: StatusPayload) {
  statusRevision++;
  if (current.connected === s.connected && current.lastError === s.reason) return;
  current = { ...current, connected: s.connected, lastError: s.reason };
  emit();
}

/** Rehydrate every mounted consumer from the server's current read-only snapshot. */
export async function refreshIpsecMetrics(): Promise<void> {
  const revision = statusRevision;
  const gatewayRevisions = { ...gatewayStreamRevisions };
  const response = await fetch('/api/ipsec/snapshot', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Gateway snapshot failed (${response.status})`);
  applySnapshot(await response.json() as SnapshotPayload, revision !== statusRevision, gatewayRevisions);
  publication.flush();
}

function markDisconnected() {
  statusRevision++;
  if (!current.connected) return;
  current = { ...current, connected: false };
  emit();
}

function startFeed() {
  if (es) return;

  // Hydrate from /snapshot first so we have data immediately.
  snapAbort = new AbortController();
  const controller = snapAbort;
  const revision = statusRevision;
  const gatewayRevisions = { ...gatewayStreamRevisions };
  fetch('/api/ipsec/snapshot', { signal: controller.signal })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Gateway snapshot failed (${response.status})`);
      const snapshot = await response.json() as SnapshotPayload;
      if (!controller.signal.aborted) applySnapshot(snapshot, revision !== statusRevision, gatewayRevisions);
    })
    .catch(() => { /* swallow — stream will recover */ });

  // Live updates via SSE.
  const source = new EventSource('/api/ipsec/stream');
  es = source;

  source.addEventListener('snapshot', (e) => {
    if (es !== source) return;
    statusRevision++;
    try { applySnapshot(JSON.parse((e as MessageEvent).data), false, undefined, true); } catch { /* ignore */ }
  });
  source.addEventListener('update', (e) => {
    if (es !== source) return;
    try { applyUpdate(JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ }
  });
  source.addEventListener('status', (e) => {
    if (es !== source) return;
    try { applyStatus(JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ }
  });
  // EventSource auto-reconnects; just mark disconnected for now.
  source.onerror = () => { if (es === source) markDisconnected(); };
}

function stopFeed() {
  snapAbort?.abort();
  snapAbort = null;
  es?.close();
  es = null;
  publication.flush();
}

export function subscribeIpsecMetrics(onChange: () => void): () => void {
  const off = publication.subscribe(onChange);
  if (publication.size() === 1) startFeed();
  return () => {
    off();
    if (publication.size() === 0) stopFeed();
  };
}

function getSnapshot(): UseIpsecMetricsResult {
  return publication.getSnapshot();
}
export const getIpsecMetricsSnapshot = getSnapshot;

export function useIpsecMetrics(): UseIpsecMetricsResult {
  // getSnapshot returns a cached reference that only changes when the feed
  // changes, so useSyncExternalStore re-renders consumers exactly on updates.
  return useSyncExternalStore(subscribeIpsecMetrics, getSnapshot, getSnapshot);
}

export function useIpsecGateway(topic: string | null | undefined): IpsecGatewayState | undefined {
  const read = useCallback(() => getSnapshot().list.find((gateway) => gateway.topic === topic), [topic]);
  return useSyncExternalStore(subscribeIpsecMetrics, read, read);
}

export function useIpsecConnected(): boolean {
  const read = () => getSnapshot().connected;
  return useSyncExternalStore(subscribeIpsecMetrics, read, read);
}

export function useIpsecError(): string | undefined {
  const read = () => getSnapshot().lastError;
  return useSyncExternalStore(subscribeIpsecMetrics, read, read);
}
