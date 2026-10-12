import { useSyncExternalStore } from 'react';
import { useLiveDataStore } from './liveDataContext';
import type { LiveDataValue } from './liveDataStore';

const noSubscription = () => () => {};
const defaultThroughput = () => 463;

export function useLiveData(): LiveDataValue {
  const store = useLiveDataStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** Live status does not subscribe to simulated metric changes. */
export function useLiveStatus(): boolean {
  return useLiveDataStore().getSnapshot().isLive;
}

export function useLiveIncidentTrigger(): number {
  const store = useLiveDataStore();
  return useSyncExternalStore(store.subscribeIncident, store.getIncidentTrigger, store.getIncidentTrigger);
}

/** Inactive consumers do not start timers or subscribe to metric updates. */
export function useSimulatedThroughput(enabled = true): number {
  const store = useLiveDataStore();
  return useSyncExternalStore(enabled ? store.subscribeSimulation : noSubscription, enabled ? store.getThroughput : defaultThroughput, defaultThroughput);
}
