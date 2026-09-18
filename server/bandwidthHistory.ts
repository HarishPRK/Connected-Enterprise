import type { IpsecMetrics } from '../src/types.js';
import { ChartHistoryStore, sampleHistory } from './chartHistoryStore.js';

export interface BandwidthObservation {
  t: number;
  fiber: number;
  fiveg: number;
}
export const bandwidthHistory = new ChartHistoryStore<BandwidthObservation>();
const baselines = new Map<string, { t: number; sourceTime: number; identity: string; tunnels: IpsecMetrics['tunnels'] }>();

/** Called on ingest, independent of open dashboards. Never derive a rate from
 * a cached partial section, reset counter, or repeated source timestamp. */
export function recordBandwidth(topic: string, metrics: IpsecMetrics, receivedAt: number): void {
  if (!Array.isArray(metrics.tunnels) || !metrics.tunnels.length) return;
  const sourceTime = Number(metrics.timestamp_ms) || 0;
  const identity = `${metrics.gateway?.name ?? ''}:${metrics.gateway?.mac ?? ''}`;
  const previous = baselines.get(topic);
  if (previous && sourceTime && previous.sourceTime && sourceTime <= previous.sourceTime) return;
  baselines.set(topic, { t: receivedAt, sourceTime, identity, tunnels: metrics.tunnels });
  if (!previous || previous.identity !== identity) return;
  const elapsed = (sourceTime && previous.sourceTime ? sourceTime - previous.sourceTime : receivedAt - previous.t) / 1000;
  if (elapsed <= 0 || elapsed > 300) return;
  const point: BandwidthObservation = { t: receivedAt, fiber: 0, fiveg: 0 };
  let observed = false;
  for (const tunnel of metrics.tunnels) {
    if (!tunnel.present) continue;
    const before = previous.tunnels.find((item) => item.ifname === tunnel.ifname && item.present);
    if (!before) return;
    const counters = [tunnel.rx_bytes, tunnel.tx_bytes, before.rx_bytes, before.tx_bytes];
    if (!counters.every((value) => Number.isFinite(value) && value >= 0)) return;
    const rx = tunnel.rx_bytes - before.rx_bytes;
    const tx = tunnel.tx_bytes - before.tx_bytes;
    if (rx < 0 || tx < 0) return;
    const key = /cell|5g|lte|wwan/i.test(tunnel.ifname) ? 'fiveg' : 'fiber';
    point[key] += (rx + tx) * 8 / elapsed / 1_000_000;
    observed = true;
  }
  if (observed) bandwidthHistory.record(topic, point);
}

export function bandwidthSeries(topic: string, since: number, maxPoints = 360, until = Date.now()): BandwidthObservation[] {
  return sampleHistory((bandwidthHistory.buffers.get(topic) ?? []).filter((p) => p.t >= since && p.t <= until), maxPoints);
}
