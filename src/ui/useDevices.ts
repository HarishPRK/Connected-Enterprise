/**
 * Client hook for the live device inventory streamed from the Express server.
 *
 * On mount: GET /api/devices/snapshot for the current inventory, then opens an
 * EventSource on /api/devices/stream and replaces state on each `snapshot`
 * event (the server pushes a fresh snapshot whenever a device is reclassified).
 *
 * `classifyDevice(mac, domain)` POSTs an IT/OT override; the resulting snapshot
 * arrives back over the same stream, so all open tabs stay in sync.
 *
 * Phase 0 is seed-backed; the hook is unchanged when Phase 1 swaps the server
 * seed for live gateway discovery — same endpoints, same shape.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Device } from '../types';

export type Domain = 'IT' | 'OT';

/** A device plus override provenance (effective `domain` + `autoDomain`). */
export interface DeviceView extends Device {
  autoDomain: Domain;
  overridden: boolean;
}

interface DeviceSnapshot {
  devices: DeviceView[];
  receivedAt: number;
  source: 'seed' | 'gateway';
  connected: boolean;
  lastInventoryAt?: number;
  overrides: Record<string, Domain>;
}

export interface UseDevicesResult {
  /** Full inventory with effective IT/OT applied. */
  devices: DeviceView[];
  /** True once the first snapshot (fetch or SSE) has arrived. */
  loaded: boolean;
  /** True when the upstream inventory feed is live (always true for the seed). */
  connected: boolean;
  /** 'seed' until the gateway sends a live inventory, then 'gateway'. */
  source: 'seed' | 'gateway';
  lastReceivedAt?: number;
  /** When the last live inventory was ingested (undefined while on seed). */
  lastInventoryAt?: number;
}

/** Move a device between IT and OT. Resolves on the server's ack; the updated
 *  inventory arrives via the SSE stream, so callers usually don't need the
 *  return value beyond error handling. */
export async function classifyDevice(mac: string, domain: Domain): Promise<void> {
  const res = await fetch('/api/devices/classify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mac, domain }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error ?? '';
    } catch {
      /* ignore */
    }
    throw new Error(detail || `classify failed (${res.status})`);
  }
}

export function useDevices(): UseDevicesResult {
  const [devices, setDevices] = useState<DeviceView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [connected, setConnected] = useState(false);
  const [source, setSource] = useState<'seed' | 'gateway'>('seed');
  const [lastReceivedAt, setLastReceivedAt] = useState<number | undefined>();
  const [lastInventoryAt, setLastInventoryAt] = useState<number | undefined>();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;

    const apply = (snap: DeviceSnapshot) => {
      setDevices(snap.devices ?? []);
      if (typeof snap.connected === 'boolean') setConnected(snap.connected);
      if (snap.source) setSource(snap.source);
      setLastReceivedAt(snap.receivedAt);
      setLastInventoryAt(snap.lastInventoryAt);
      setLoaded(true);
    };

    // Hydrate immediately so the table renders without waiting for the stream.
    fetch('/api/devices/snapshot')
      .then((r) => r.json() as Promise<DeviceSnapshot>)
      .then((snap) => {
        if (!cancelled) apply(snap);
      })
      .catch(() => {
        /* swallow — the stream will hydrate us, and the page has a fallback */
      });

    const es = new EventSource('/api/devices/stream');
    esRef.current = es;

    es.addEventListener('snapshot', (e) => {
      try {
        apply(JSON.parse((e as MessageEvent).data) as DeviceSnapshot);
      } catch {
        /* ignore */
      }
    });

    es.onerror = () => {
      // EventSource auto-reconnects; mark the feed down until it recovers.
      setConnected(false);
    };

    return () => {
      cancelled = true;
      es.close();
      esRef.current = null;
    };
  }, []);

  return useMemo(
    () => ({ devices, loaded, connected, source, lastReceivedAt, lastInventoryAt }),
    [devices, loaded, connected, source, lastReceivedAt, lastInventoryAt],
  );
}
