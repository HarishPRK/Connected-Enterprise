import { historyRangeMs, type HistoryRange } from './historyRange';

export interface DeviceHistoryPoint {
  t: number;
  rssiDbm?: number;
  transferredMB?: number;
}
export interface DeviceHistoryResponse {
  series: Record<string, DeviceHistoryPoint[]>;
  since: number;
  until: number;
}
export interface DeviceHistoryRow { ts: number; [key: string]: number; }

/** Align nearby observations to bounded chart rows; keys remain device MACs,
 * so two devices with the same display name never overwrite one another. */
export function deviceHistoryRows(
  series: Record<string, DeviceHistoryPoint[]>,
  macs: ReadonlySet<string>,
  metric: 'rssiDbm' | 'transferredMB',
  range: HistoryRange,
  since: number,
  until: number,
) {
  const binMs = Math.max(1_000, historyRangeMs(range) / 360);
  const bins = new Map<number, DeviceHistoryRow>();
  const counts = new Map<string, number>();
  for (const [mac, points] of Object.entries(series)) {
    const key = mac.toUpperCase();
    if (!macs.has(key)) continue;
    for (const point of points) {
      const value = point[metric];
      if (value == null || !Number.isFinite(value) || point.t < since || point.t > until) continue;
      const bin = Math.floor((point.t - since) / binMs);
      const row = bins.get(bin) ?? { ts: point.t };
      row.ts = Math.max(row.ts, point.t);
      row[key] = value;
      bins.set(bin, row);
    }
  }
  const rows = [...bins.values()].sort((a, b) => a.ts - b.ts);
  for (const row of rows) {
    for (const mac of macs) if (row[mac] !== undefined) counts.set(mac, (counts.get(mac) ?? 0) + 1);
  }
  const keys = [...counts.keys()];
  if (metric === 'transferredMB') {
    const last: Record<string, number> = {};
    for (const row of rows) {
      for (const key of keys) {
        if (row[key] !== undefined) last[key] = row[key];
        else if (last[key] !== undefined) row[key] = last[key];
      }
    }
  }
  return { rows, keys, counts };
}
