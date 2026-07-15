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

import { useSyncExternalStore } from 'react';
import type { IpsecGatewayState } from '../types';

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

const listeners = new Set<() => void>();
let es: EventSource | null = null;
let snapAbort: AbortController | null = null;

function emit() {
  for (const l of listeners) l();
}

function sortList(gateways: Record<string, IpsecGatewayState>): IpsecGatewayState[] {
  return Object.values(gateways).sort((a, b) =>
    a.metrics.gateway.name.localeCompare(b.metrics.gateway.name),
  );
}

function applySnapshot(snap: SnapshotPayload) {
  const gateways = snap.gateways ?? {};
  current = {
    gateways,
    list: sortList(gateways),
    connected: typeof snap.connected === 'boolean' ? snap.connected : current.connected,
    lastError: snap.lastError,
    subscribedTopic: snap.subscribedTopic,
    endpoint: snap.endpoint,
    lastReceivedAt: snap.receivedAt,
  };
  emit();
}

function applyUpdate(u: UpdatePayload) {
  const gateways = { ...current.gateways, [u.gatewayKey]: u.state };
  current = { ...current, gateways, list: sortList(gateways), lastReceivedAt: u.state.receivedAt };
  emit();
}

function applyStatus(s: StatusPayload) {
  current = { ...current, connected: s.connected, lastError: s.reason };
  emit();
}

function markDisconnected() {
  if (!current.connected) return;
  current = { ...current, connected: false };
  emit();
}

function startFeed() {
  if (es) return;

  // Hydrate from /snapshot first so we have data immediately.
  snapAbort = new AbortController();
  fetch('/api/ipsec/snapshot', { signal: snapAbort.signal })
    .then((r) => r.json() as Promise<SnapshotPayload>)
    .then(applySnapshot)
    .catch(() => { /* swallow — stream will recover */ });

  // Live updates via SSE.
  const source = new EventSource('/api/ipsec/stream');
  es = source;

  source.addEventListener('snapshot', (e) => {
    try { applySnapshot(JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ }
  });
  source.addEventListener('update', (e) => {
    try { applyUpdate(JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ }
  });
  source.addEventListener('status', (e) => {
    try { applyStatus(JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ }
  });
  // EventSource auto-reconnects; just mark disconnected for now.
  source.onerror = () => markDisconnected();
}

function stopFeed() {
  snapAbort?.abort();
  snapAbort = null;
  es?.close();
  es = null;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (listeners.size === 1) startFeed();
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) stopFeed();
  };
}

function getSnapshot(): UseIpsecMetricsResult {
  return current;
}

export function useIpsecMetrics(): UseIpsecMetricsResult {
  // getSnapshot returns a cached reference that only changes when the feed
  // changes, so useSyncExternalStore re-renders consumers exactly on updates.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
