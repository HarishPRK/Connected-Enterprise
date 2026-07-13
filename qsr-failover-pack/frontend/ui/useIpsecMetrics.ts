/**
 * Client hook for live IPsec metrics streaming from the Express server.
 *
 * On mount: GET /api/ipsec/snapshot for the current cache.
 * Then opens an EventSource on /api/ipsec/stream and replaces state on each
 * `update` / `snapshot` event. Listens to `status` events to surface the
 * upstream IoT connection state in the UI.
 *
 * Designed so the rest of the app can call `useIpsecMetrics()` and get:
 *   { gateways, list, connected, lastError, lastReceivedAt }
 */

import { useEffect, useMemo, useRef, useState } from 'react';
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

export function useIpsecMetrics(): UseIpsecMetricsResult {
  const [gateways, setGateways] = useState<Record<string, IpsecGatewayState>>({});
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState<string | undefined>();
  const [subscribedTopic, setSubscribedTopic] = useState<string | undefined>();
  const [endpoint, setEndpoint] = useState<string | undefined>();
  const [lastReceivedAt, setLastReceivedAt] = useState<number | undefined>();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Hydrate from /snapshot first so we have data immediately.
    fetch('/api/ipsec/snapshot')
      .then((r) => r.json() as Promise<SnapshotPayload>)
      .then((snap) => {
        if (cancelled) return;
        setGateways(snap.gateways ?? {});
        if (typeof snap.connected === 'boolean') setConnected(snap.connected);
        setLastError(snap.lastError);
        setSubscribedTopic(snap.subscribedTopic);
        setEndpoint(snap.endpoint);
        setLastReceivedAt(snap.receivedAt);
      })
      .catch(() => { /* swallow — stream will recover */ });

    // Live updates via SSE.
    const es = new EventSource('/api/ipsec/stream');
    esRef.current = es;

    es.addEventListener('snapshot', (e) => {
      try {
        const snap = JSON.parse((e as MessageEvent).data) as SnapshotPayload;
        setGateways(snap.gateways ?? {});
        if (typeof snap.connected === 'boolean') setConnected(snap.connected);
        setLastError(snap.lastError);
        setSubscribedTopic(snap.subscribedTopic);
        setEndpoint(snap.endpoint);
        setLastReceivedAt(snap.receivedAt);
      } catch { /* ignore */ }
    });

    es.addEventListener('update', (e) => {
      try {
        const u = JSON.parse((e as MessageEvent).data) as UpdatePayload;
        setGateways((prev) => ({ ...prev, [u.gatewayKey]: u.state }));
        setLastReceivedAt(u.state.receivedAt);
      } catch { /* ignore */ }
    });

    es.addEventListener('status', (e) => {
      try {
        const s = JSON.parse((e as MessageEvent).data) as StatusPayload;
        setConnected(s.connected);
        setLastError(s.reason);
      } catch { /* ignore */ }
    });

    es.onerror = () => {
      // EventSource auto-reconnects; just mark disconnected for now.
      setConnected(false);
    };

    return () => {
      cancelled = true;
      es.close();
      esRef.current = null;
    };
  }, []);

  const list = useMemo(() => {
    return Object.values(gateways).sort((a, b) =>
      a.metrics.gateway.name.localeCompare(b.metrics.gateway.name),
    );
  }, [gateways]);

  return { gateways, list, connected, lastError, subscribedTopic, endpoint, lastReceivedAt };
}
