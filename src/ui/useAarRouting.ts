/**
 * Client hook for the live Application-Aware Routing feed (proto/aar.proto),
 * decoded server-side and streamed as JSON on /api/aar/{snapshot,stream}.
 *
 * SHARED FEED: like useIpsecMetrics, every caller subscribes to ONE
 * module-level store — a single GET /snapshot + one EventSource — ref-counted
 * across consumers. Opens on the first subscriber, closes when the last leaves.
 */

import { useSyncExternalStore } from 'react';

export interface AarTunnel {
  iface: string;
  latency_ms: number;
  updatedAt: number;
}
export interface AarDecision {
  src_ip: string;
  tunnel: string;
  tunnel_latency_ms: number;
  dst_ip: string;
  dst_latency_ms: number;
  total_latency_ms: number;
  updatedAt: number;
}
export interface AarRoute {
  dst_ip: string;
  latency_ms: number;
  via: string;
  updatedAt: number;
}
export interface AarFlow {
  src_ip: string;
  dst_ip: string;
  updatedAt: number;
}

export interface AarRoutingState {
  tunnels: AarTunnel[];
  decisions: AarDecision[];
  routes: AarRoute[];
  flows: AarFlow[];
  connected: boolean;
  /** Server timestamp of the last routing/* message (0 until the first). */
  receivedAt: number;
}

/* ─────────── Shared store ─────────── */

const EMPTY: AarRoutingState = {
  tunnels: [], decisions: [], routes: [], flows: [], connected: false, receivedAt: 0,
};
let current: AarRoutingState = EMPTY;

const listeners = new Set<() => void>();
let es: EventSource | null = null;
let snapAbort: AbortController | null = null;

function emit() {
  for (const l of listeners) l();
}

export function mergeAarSnapshot(previous: AarRoutingState, value: unknown): AarRoutingState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return previous;
  const snap = value as Partial<AarRoutingState>;
  if (!['tunnels', 'decisions', 'routes', 'flows', 'connected', 'receivedAt'].some((key) => key in snap)) return previous;
  if (snap.receivedAt !== undefined && (!Number.isFinite(snap.receivedAt) || snap.receivedAt < previous.receivedAt)) return previous;
  for (const key of ['tunnels', 'decisions', 'routes', 'flows'] as const) {
    if (snap[key] !== undefined && !Array.isArray(snap[key])) return previous;
  }
  return {
    tunnels: snap.tunnels ?? previous.tunnels,
    decisions: snap.decisions ?? previous.decisions,
    routes: snap.routes ?? previous.routes,
    flows: snap.flows ?? previous.flows,
    connected: typeof snap.connected === 'boolean' ? snap.connected : previous.connected,
    receivedAt: snap.receivedAt ?? previous.receivedAt,
  };
}

function apply(snap: unknown) {
  const next = mergeAarSnapshot(current, snap);
  if (next === current) return;
  current = next;
  emit();
}

function startFeed() {
  if (es) return;

  snapAbort = new AbortController();
  fetch('/api/aar/snapshot', { signal: snapAbort.signal })
    .then((r) => { if (!r.ok) throw new Error(`AAR snapshot failed (${r.status})`); return r.json(); })
    .then(apply)
    .catch(() => { /* stream will recover */ });

  const source = new EventSource('/api/aar/stream');
  es = source;
  const onData = (e: Event) => {
    try { apply(JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ }
  };
  source.addEventListener('snapshot', onData);
  source.addEventListener('update', onData);
  source.onerror = () => {
    if (!current.connected) return;
    current = { ...current, connected: false };
    emit();
  };
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

function getSnapshot(): AarRoutingState {
  return current;
}

export function useAarRouting(): AarRoutingState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
