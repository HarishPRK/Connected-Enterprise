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

import { useSyncExternalStore } from 'react';
import type { Device } from '../types';
import { createTelemetryPublisher, sameTelemetryValue, shareTelemetryRows } from './telemetryPublisher';

export type Domain = 'IT' | 'OT';

/** A device plus override provenance (effective `domain` + `autoDomain`). */
export interface DeviceView extends Device {
  autoDomain: Domain;
  overridden: boolean;
  /** Which gateway location this device was discovered from ('rdk' for Plano,
   *  'prpl' for McKinney). Undefined for seed devices (pre-live-discovery). */
  locationSource?: 'rdk' | 'prpl';
  /** Exact primary MQTT inventory topic(s). Auxiliary Matter/Shelly-only
   *  records may omit this while still carrying a branch location. */
  inventoryTopics?: string[];
}

export interface DeviceSnapshot {
  devices: DeviceView[];
  receivedAt: number;
  source: 'seed' | 'gateway';
  connected: boolean;
  lastInventoryAt?: number;
  inventoryTopicsSeen?: string[];
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
  /** Primary inventory topics that have reported, including an empty roster. */
  inventoryTopicsSeen: string[];
  refresh: () => Promise<void>;
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

export type MatterAction = 'On' | 'Off';

/** Drive a Matter device's OnOff cluster via the gateway. Resolves once the
 *  gateway acks (the round trip rides a shadow poll + the hub call, so this
 *  can take several seconds). Throws with the server's error message on
 *  failure or timeout. */
export async function controlMatterDevice(nodeId: number, action: MatterAction): Promise<void> {
  const res = await fetch('/api/devices/matter/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeId, action }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error ?? '';
    } catch {
      /* ignore */
    }
    throw new Error(detail || `matter control failed (${res.status})`);
  }
}

/** Drive a Shelly relay (Switch.Set). The device talks MQTT to IoT Core
 *  directly, so this resolves on the device's own RPC reply. */
export async function controlShellyDevice(deviceId: string, action: MatterAction): Promise<void> {
  const res = await fetch('/api/devices/shelly/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, action }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error ?? '';
    } catch {
      /* ignore */
    }
    throw new Error(detail || `shelly control failed (${res.status})`);
  }
}

/** Ask the gateway to re-fetch and republish the Matter device list. Resolves
 *  when the poke is sent; the refreshed inventory then arrives over the SSE
 *  stream like any other live update. */
export async function refreshMatterDevices(): Promise<void> {
  const res = await fetch('/api/devices/matter/refresh', { method: 'POST' });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error ?? '';
    } catch {
      /* ignore */
    }
    throw new Error(detail || `refresh failed (${res.status})`);
  }
}

const inventory = createTelemetryPublisher<UseDevicesResult>({
  devices: [], loaded: false, connected: false, source: 'seed',
  inventoryTopicsSeen: [], refresh: refreshDeviceInventory,
});
let eventSource: EventSource | null = null;
let hydrationAbort: AbortController | null = null;
let transportRevision = 0;
let snapshotRevision = 0;

export function mergeDeviceInventorySnapshot(previous: UseDevicesResult, snapshot: DeviceSnapshot): UseDevicesResult {
  // A slow hydration/refresh response must not resurrect devices removed by a newer SSE roster.
  if (previous.lastReceivedAt !== undefined && snapshot.receivedAt < previous.lastReceivedAt) return previous;
  const topics = snapshot.inventoryTopicsSeen ?? [];
  const next: UseDevicesResult = {
    devices: shareTelemetryRows(previous.devices, snapshot.devices ?? []),
    loaded: true,
    connected: typeof snapshot.connected === 'boolean' ? snapshot.connected : previous.connected,
    source: snapshot.source ?? previous.source,
    lastReceivedAt: snapshot.receivedAt,
    lastInventoryAt: snapshot.lastInventoryAt,
    inventoryTopicsSeen: sameTelemetryValue(previous.inventoryTopicsSeen, topics) ? previous.inventoryTopicsSeen : topics,
    refresh: refreshDeviceInventory,
  };
  return sameTelemetryValue(previous, next) ? previous : next;
}

function applySnapshot(snapshot: DeviceSnapshot, preserveConnection = false, fetchStartRevision?: number): void {
  if (!Array.isArray(snapshot.devices) || !Number.isFinite(snapshot.receivedAt)) throw new Error('Invalid device inventory snapshot');
  inventory.update((previous) => {
    // Millisecond timestamps can collide. A stream roster delivered during an
    // HTTP request wins a tie; a genuinely newer HTTP roster can still apply.
    if (fetchStartRevision !== undefined && fetchStartRevision !== snapshotRevision
      && snapshot.receivedAt <= (previous.lastReceivedAt ?? -Infinity)) return previous;
    return mergeDeviceInventorySnapshot(previous, preserveConnection ? { ...snapshot, connected: previous.connected } : snapshot);
  });
}

/** Manual refresh applies to all consumers and is visible before the promise resolves. */
export async function refreshDeviceInventory(): Promise<void> {
  const revision = transportRevision;
  const inventoryRevision = snapshotRevision;
  const response = await fetch('/api/devices/snapshot', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Device snapshot failed (${response.status})`);
  applySnapshot(await response.json() as DeviceSnapshot, revision !== transportRevision, inventoryRevision);
  inventory.flush();
}

function startFeed(): void {
  if (eventSource) return;
  hydrationAbort = new AbortController();
  const controller = hydrationAbort;
  const revision = transportRevision;
  const inventoryRevision = snapshotRevision;
  fetch('/api/devices/snapshot', { signal: controller.signal, cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Device snapshot failed (${response.status})`);
      const snapshot = await response.json() as DeviceSnapshot;
      if (!controller.signal.aborted) applySnapshot(snapshot, revision !== transportRevision, inventoryRevision);
    })
    .catch(() => { /* SSE can hydrate after a transient snapshot error. */ });

  const source = new EventSource('/api/devices/stream');
  eventSource = source;
  source.addEventListener('snapshot', (event) => {
    if (eventSource !== source) return;
    try {
      const snapshot = JSON.parse((event as MessageEvent).data) as DeviceSnapshot;
      if (!Array.isArray(snapshot.devices) || !Number.isFinite(snapshot.receivedAt)) return;
      if (snapshot.receivedAt < (inventory.getLatest().lastReceivedAt ?? -Infinity)) return;
      snapshotRevision++;
      applySnapshot(snapshot);
    } catch { /* keep last valid roster */ }
  });
  source.onerror = () => {
    if (eventSource !== source) return;
    transportRevision++;
    inventory.update((previous) => previous.connected ? { ...previous, connected: false } : previous);
  };
}

function stopFeed(): void {
  hydrationAbort?.abort();
  hydrationAbort = null;
  eventSource?.close();
  eventSource = null;
  inventory.flush();
}

export function subscribeDeviceInventory(onChange: () => void): () => void {
  const off = inventory.subscribe(onChange);
  if (inventory.size() === 1) startFeed();
  return () => { off(); if (inventory.size() === 0) stopFeed(); };
}

export const getDeviceInventorySnapshot = inventory.getSnapshot;

/** One snapshot and SSE connection for the entire app, regardless of consumer count. */
export function useDevices(): UseDevicesResult {
  return useSyncExternalStore(subscribeDeviceInventory, getDeviceInventorySnapshot, getDeviceInventorySnapshot);
}
