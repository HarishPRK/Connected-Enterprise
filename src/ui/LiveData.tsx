import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { bandwidthSeries } from '../data/mock';
import type { BandwidthPoint } from '../types';
import { useToast } from './Toast';

interface LiveDataValue {
  /** Live throughput in Mbps — ticks every few seconds. */
  throughputMbps: number;
  /** Bandwidth time series with the most recent point continuously updating. */
  bandwidthSeries: BandwidthPoint[];
  /** A monotonically increasing counter — increments to signal a "new live incident" should appear. */
  newIncidentTrigger: number;
  /** Total auto-generated events fired since mount. */
  recentEventCount: number;
  /** Toggle for the small pulsing "Live" indicator. */
  isLive: boolean;
}

const Ctx = createContext<LiveDataValue | null>(null);

const SIM_TOASTS: Array<{ kind: 'info' | 'success' | 'warn' | 'error'; title: string; detail: string }> = [
  { kind: 'info',    title: 'POS-02 reconnected',          detail: 'Wi-Fi roam to channel 36' },
  { kind: 'success', title: 'Fiber link stable',           detail: 'No flaps in last 60 minutes' },
  { kind: 'info',    title: 'Probe ack',                   detail: 'aws.amazon.com — 22 ms' },
  { kind: 'warn',    title: '5G RSSI fluctuation',         detail: 'Briefly hit −89 dBm — recovered' },
  { kind: 'success', title: 'Door lock DL-1 heartbeat',    detail: 'Reachable, lock state OK' },
  { kind: 'info',    title: 'Conf-Phone-1 PoE ramped',     detail: 'Now drawing 4.6 W' },
  { kind: 'success', title: 'Auto-failover armed',         detail: 'Standby ready: 5G' },
  { kind: 'info',    title: 'New DHCP lease issued',       detail: 'POS-03 → 10.10.1.46' },
];

const THROUGHPUT_BASE = 463;
const THROUGHPUT_BAND = 60;

export function LiveDataProvider({ children }: { children: ReactNode }) {
  const { push } = useToast();

  const [throughputMbps, setThroughput]  = useState<number>(THROUGHPUT_BASE);
  const [series, setSeries]              = useState<BandwidthPoint[]>(bandwidthSeries);
  const [newIncidentTrigger, setTrigger] = useState<number>(0);
  const [recentEventCount, setRecent]    = useState<number>(0);

  // Throughput tick — every 4s, drift up to ±15
  useEffect(() => {
    const id = window.setInterval(() => {
      setThroughput((v) => {
        const target = THROUGHPUT_BASE + (Math.random() - 0.5) * THROUGHPUT_BAND;
        return Math.round(v + (target - v) * 0.35);
      });
    }, 4000);
    return () => window.clearInterval(id);
  }, []);

  // Bandwidth tick — last point gently jitters every 5s; every 30s a new bucket pushed
  useEffect(() => {
    let bucketsPushed = 0;
    const id = window.setInterval(() => {
      setSeries((s) => {
        const last = s[s.length - 1];
        const fiber = Math.max(60, Math.min(280, last.fiber + (Math.random() - 0.5) * 18));
        const fiveg = Math.max(10, Math.min(80, last.fiveg + (Math.random() - 0.5) * 12));
        return [...s.slice(0, -1), { t: last.t, fiber: Math.round(fiber), fiveg: Math.round(fiveg) }];
      });
      bucketsPushed++;
      if (bucketsPushed % 6 === 0) {
        // Every ~30s, slide the window
        setSeries((s) => {
          const t = new Date();
          const tStr = `${String(t.getHours()).padStart(2, '0')}:${String(Math.floor(t.getMinutes() / 5) * 5).padStart(2, '0')}`;
          return [
            ...s.slice(1),
            {
              t: tStr,
              fiber: Math.round(120 + Math.random() * 100),
              fiveg: Math.round(30 + Math.random() * 30),
            },
          ];
        });
      }
    }, 5000);
    return () => window.clearInterval(id);
  }, []);

  // Random toast events — every 25–48s
  useEffect(() => {
    let mounted = true;
    let tid = 0;

    const schedule = () => {
      const ms = 25_000 + Math.random() * 23_000;
      tid = window.setTimeout(() => {
        if (!mounted) return;
        const e = SIM_TOASTS[Math.floor(Math.random() * SIM_TOASTS.length)];
        push(e);
        setRecent((c) => c + 1);
        schedule();
      }, ms);
    };
    schedule();
    return () => { mounted = false; window.clearTimeout(tid); };
  }, [push]);

  // ~50s after first mount, fire the "new incident" trigger.
  // This drives a fresh INC card to appear in IncidentsPage with a toast.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setTrigger((v) => v + 1);
      push({
        kind: 'warn',
        title: 'New incident · INC-2026-0143',
        detail: 'POS-02 packet loss spike — agent triaging',
      });
    }, 50_000);
    return () => window.clearTimeout(id);
  }, [push]);

  const value = useMemo<LiveDataValue>(() => ({
    throughputMbps,
    bandwidthSeries: series,
    newIncidentTrigger,
    recentEventCount,
    isLive: true,
  }), [throughputMbps, series, newIncidentTrigger, recentEventCount]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLiveData(): LiveDataValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLiveData must be used inside LiveDataProvider');
  return ctx;
}
