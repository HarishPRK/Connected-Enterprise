import { bandwidthSeries } from '../data/mock';
import type { BandwidthPoint } from '../types';

export interface LiveDataValue {
  throughputMbps: number;
  bandwidthSeries: BandwidthPoint[];
  newIncidentTrigger: number;
  recentEventCount: number;
  isLive: boolean;
}
interface SimToast { kind: 'info' | 'success' | 'warn' | 'error'; title: string; detail: string }
export interface LiveDataHost {
  now: () => number;
  random: () => number;
  isVisible: () => boolean;
  setInterval: (callback: () => void, delay: number) => number;
  clearInterval: (id: number) => void;
  setTimeout: (callback: () => void, delay: number) => number;
  clearTimeout: (id: number) => void;
  onVisibilityChange: (callback: () => void) => () => void;
}
const browserHost: LiveDataHost = {
  now: () => Date.now(), random: () => Math.random(),
  isVisible: () => !document.hidden,
  setInterval: (callback, delay) => window.setInterval(callback, delay),
  clearInterval: (id) => window.clearInterval(id),
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: (id) => window.clearTimeout(id),
  onVisibilityChange: (callback) => {
    document.addEventListener('visibilitychange', callback);
    return () => document.removeEventListener('visibilitychange', callback);
  },
};
const SIM_TOASTS: SimToast[] = [
  { kind: 'info', title: 'POS-02 reconnected', detail: 'Wi-Fi roam to channel 36' },
  { kind: 'success', title: 'Fiber link stable', detail: 'No flaps in last 60 minutes' },
  { kind: 'info', title: 'Probe ack', detail: 'aws.amazon.com — 22 ms' },
  { kind: 'warn', title: '5G RSSI fluctuation', detail: 'Briefly hit −89 dBm — recovered' },
  { kind: 'success', title: 'Door lock DL-1 heartbeat', detail: 'Reachable, lock state OK' },
  { kind: 'info', title: 'Conf-Phone-1 PoE ramped', detail: 'Now drawing 4.6 W' },
  { kind: 'success', title: 'Auto-failover armed', detail: 'Standby ready: 5G' },
  { kind: 'info', title: 'New DHCP lease issued', detail: 'POS-03 → 10.10.1.46' },
];

/** Simulation state stays outside React. Metric listeners never invalidate
 * incident-only subscribers, and no metric timers run without a consumer. */
export function createLiveDataStore(host: LiveDataHost = browserHost) {
  let snapshot: LiveDataValue = { throughputMbps: 463, bandwidthSeries, newIncidentTrigger: 0, recentEventCount: 0, isLive: true };
  const allListeners = new Set<() => void>();
  const simulationListeners = new Set<() => void>();
  const incidentListeners = new Set<() => void>();
  let started = false;
  let detachVisibility: (() => void) | undefined;
  let push: ((toast: SimToast) => void) | undefined;
  let throughputTimer: number | undefined;
  let bandwidthTimer: number | undefined;
  let toastTimer: number | undefined;
  let incidentTimer: number | undefined;
  let incidentDue: number | undefined;
  let bucketsPushed = 0;
  const notify = (listeners: Set<() => void>) => {
    for (const listener of listeners) listener();
    for (const listener of allListeners) listener();
  };
  function stopSimulation() {
    if (throughputTimer !== undefined) host.clearInterval(throughputTimer);
    if (bandwidthTimer !== undefined) host.clearInterval(bandwidthTimer);
    throughputTimer = bandwidthTimer = undefined;
  }
  function stopEvents() {
    if (toastTimer !== undefined) host.clearTimeout(toastTimer);
    if (incidentTimer !== undefined) host.clearTimeout(incidentTimer);
    toastTimer = incidentTimer = undefined;
  }
  function syncSimulation() {
    if (!started || !host.isVisible() || simulationListeners.size + allListeners.size === 0) { stopSimulation(); return; }
    if (throughputTimer === undefined) throughputTimer = host.setInterval(() => {
      if (!host.isVisible()) return;
      const target = 463 + (host.random() - 0.5) * 60;
      const throughputMbps = Math.round(snapshot.throughputMbps + (target - snapshot.throughputMbps) * 0.35);
      if (throughputMbps === snapshot.throughputMbps) return;
      snapshot = { ...snapshot, throughputMbps };
      notify(simulationListeners);
    }, 4_000);
    if (bandwidthTimer === undefined) bandwidthTimer = host.setInterval(() => {
      if (!host.isVisible()) return;
      const series = snapshot.bandwidthSeries;
      const last = series[series.length - 1];
      if (!last) return;
      bucketsPushed++;
      const append = bucketsPushed % 6 === 0;
      const now = new Date(host.now());
      const point = append ? {
        t: `${String(now.getHours()).padStart(2, '0')}:${String(Math.floor(now.getMinutes() / 5) * 5).padStart(2, '0')}`,
        fiber: Math.round(120 + host.random() * 100), fiveg: Math.round(30 + host.random() * 30),
      } : {
        t: last.t,
        fiber: Math.round(Math.max(60, Math.min(280, last.fiber + (host.random() - 0.5) * 18))),
        fiveg: Math.round(Math.max(10, Math.min(80, last.fiveg + (host.random() - 0.5) * 12))),
      };
      snapshot = { ...snapshot, bandwidthSeries: [...series.slice(append ? 1 : 0, append ? undefined : -1), point] };
      notify(simulationListeners);
    }, 5_000);
  }
  function scheduleToast() {
    if (!started || !host.isVisible()) return;
    toastTimer = host.setTimeout(() => {
      toastTimer = undefined;
      if (!started || !host.isVisible()) return;
      push?.(SIM_TOASTS[Math.floor(host.random() * SIM_TOASTS.length)]);
      snapshot = { ...snapshot, recentEventCount: snapshot.recentEventCount + 1 };
      // An event-count change should not render incident trigger subscribers.
      for (const listener of allListeners) listener();
      scheduleToast();
    }, 25_000 + host.random() * 23_000);
  }
  function syncEvents() {
    if (!started || !host.isVisible()) { stopEvents(); return; }
    if (toastTimer === undefined) scheduleToast();
    if (snapshot.newIncidentTrigger === 0 && incidentTimer === undefined) {
      incidentTimer = host.setTimeout(() => {
        incidentTimer = undefined;
        if (!started || !host.isVisible()) return;
        snapshot = { ...snapshot, newIncidentTrigger: 1 };
        notify(incidentListeners);
        push?.({ kind: 'warn', title: 'New incident · INC-2026-0143', detail: 'POS-02 packet loss spike — agent triaging' });
      }, Math.max(0, (incidentDue ?? host.now() + 50_000) - host.now()));
    }
  }
  function subscribeTo(listeners: Set<() => void>, listener: () => void) {
    listeners.add(listener);
    syncSimulation();
    return () => { listeners.delete(listener); syncSimulation(); };
  }
  return {
    getSnapshot: () => snapshot,
    getThroughput: () => snapshot.throughputMbps,
    getIncidentTrigger: () => snapshot.newIncidentTrigger,
    subscribe: (listener: () => void) => subscribeTo(allListeners, listener),
    subscribeSimulation: (listener: () => void) => subscribeTo(simulationListeners, listener),
    subscribeIncident: (listener: () => void) => subscribeTo(incidentListeners, listener),
    start(onToast: (toast: SimToast) => void) {
      push = onToast;
      if (started) return;
      started = true;
      incidentDue ??= host.now() + 50_000;
      detachVisibility = host.onVisibilityChange(() => { syncSimulation(); syncEvents(); });
      syncSimulation(); syncEvents();
    },
    stop() {
      started = false;
      stopSimulation(); stopEvents();
      detachVisibility?.(); detachVisibility = undefined;
      push = undefined;
    },
  };
}
