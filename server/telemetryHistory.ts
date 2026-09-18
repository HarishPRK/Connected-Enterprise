/**
 * Persistent telemetry history — a rolling per-device buffer of timestamped
 * samples fed by deviceSource on every live inventory ingest.
 *
 * Two jobs:
 *   • `currentRates(mac)` — real throughput (Mbps) from the last two cumulative
 *     rx/tx byte counters the gateway reported for the client.
 *   • `historySeries()`  — downsampled per-device series (throughput, RSSI,
 *     power draw) for the dashboard's live charts.
 *
 * Retains seven days, with detailed samples for the most recent hour.
 */

import type { DeviceTelemetry } from '../src/types.js';
import { ChartHistoryStore, sampleHistory } from './chartHistoryStore.js';

interface Sample {
  t: number;
  rxBytes?: number;
  txBytes?: number;
  rssiDbm?: number;
  apowerW?: number;
  /** Reset-safe running counter, preserved when older samples are compacted. */
  transferredBytes?: number;
}

/** Client counters in the current prplhome feed are refreshed about once per
 * minute even though inventory is re-published every ten seconds. Retain the
 * last measured interval through that cadence, then report idle if the counter
 * has not changed for longer than a normal refresh plus jitter. */
export const CLIENT_RATE_IDLE_AFTER_MS = 90_000;
export const telemetryHistory = new ChartHistoryStore<Sample>();
const buffers = telemetryHistory.buffers;

export function recordTelemetry(mac: string, t: DeviceTelemetry | undefined, when = Date.now()): void {
  if (!t) return;
  if (t.rxBytes == null && t.txBytes == null && t.rssiDbm == null && t.apowerW == null) return;
  const valid = (value: number | undefined) => Number.isFinite(value) ? value : undefined;
  const prior = buffers.get(mac.toUpperCase());
  let transferredBytes = prior?.at(-1)?.transferredBytes ?? 0;
  for (const direction of ['rxBytes', 'txBytes'] as const) {
    let before: number | undefined;
    for (let i = (prior?.length ?? 0) - 1; i >= 0; i--) {
      before = prior![i][direction];
      if (before != null) break;
    }
    const value = t[direction];
    if (before != null && value != null && Number.isFinite(value) && value >= before) transferredBytes += value - before;
  }
  telemetryHistory.record(mac.toUpperCase(), {
    t: when, rxBytes: valid(t.rxBytes), txBytes: valid(t.txBytes),
    rssiDbm: valid(t.rssiDbm), apowerW: valid(t.apowerW),
    transferredBytes,
  });
}

/** Mbps between two cumulative byte counters; undefined on reset/missing. */
function rate(prev: number | undefined, next: number | undefined, dtMs: number): number | undefined {
  if (prev == null || next == null || dtMs <= 0) return undefined;
  const delta = next - prev;
  if (delta < 0) return undefined; // counter reset (device reboot)
  return +(delta * 8 / (dtMs / 1000) / 1_000_000).toFixed(3);
}

function latestMeasuredRate(
  samples: readonly Sample[],
  direction: 'rxBytes' | 'txBytes',
): number | undefined {
  const observed = samples.filter((sample) => sample[direction] != null);
  if (observed.length < 2) return undefined;

  // Collapse identical republishes into counter runs. The beginning of each
  // run is the moment that new counter value first appeared; comparing run
  // starts measures the real producer update interval instead of a duplicate
  // ten-second MQTT republish.
  const runs: { t: number; bytes: number }[] = [];
  for (const sample of observed) {
    const bytes = sample[direction];
    if (bytes == null) continue;
    const last = runs[runs.length - 1];
    if (!last || last.bytes !== bytes) runs.push({ t: sample.t, bytes });
  }
  if (runs.length < 2) return undefined;

  const current = runs[runs.length - 1];
  const previous = runs[runs.length - 2];
  const latestObservation = observed[observed.length - 1];
  if (latestObservation.t - current.t > CLIENT_RATE_IDLE_AFTER_MS) return 0;
  return rate(previous.bytes, current.bytes, current.t - previous.t);
}

/** Latest measured rx/tx rate for a device. Repeated snapshots with unchanged
 * counters do not overwrite a valid interval with an artificial zero. */
export function currentRates(mac: string): { rxMbps?: number; txMbps?: number } {
  const buf = buffers.get(mac.toUpperCase());
  if (!buf) return {};
  return {
    rxMbps: latestMeasuredRate(buf, 'rxBytes'),
    txMbps: latestMeasuredRate(buf, 'txBytes'),
  };
}

export interface HistoryPoint {
  t: number;
  rxMbps?: number;
  txMbps?: number;
  rssiDbm?: number;
  apowerW?: number;
  rxBytes?: number;
  txBytes?: number;
  transferredMB?: number;
}

/** Per-device history with derived rates, downsampled to ≤ maxPoints each. */
export function historySeries(maxPoints = 360, since = -Infinity, until = Infinity, macs?: ReadonlySet<string>): Record<string, HistoryPoint[]> {
  const out: Record<string, HistoryPoint[]> = {};
  for (const [mac, buf] of buffers) {
    if (macs && !macs.has(mac)) continue;
    const points: HistoryPoint[] = [];
    let prevBytes: Sample | undefined;
    const previous: Partial<Record<'rxBytes' | 'txBytes', number>> = {};
    let transferredBytes = 0;
    let previousTransferred: number | undefined;
    for (const s of buf) {
      if (s.t < since || s.t > until) continue;
      const p: HistoryPoint = { t: s.t, rssiDbm: s.rssiDbm, apowerW: s.apowerW, rxBytes: s.rxBytes, txBytes: s.txBytes };
      // Accumulate each direction independently. Reboots establish a new
      // baseline without deleting traffic already measured in this window.
      for (const direction of ['rxBytes', 'txBytes'] as const) {
        const value = s[direction];
        if (value == null || !Number.isFinite(value) || value < 0) continue;
        const before = previous[direction];
        if ((previousTransferred == null || s.transferredBytes == null) && before != null && value >= before) {
          transferredBytes += value - before;
        }
        previous[direction] = value;
      }
      if (previousTransferred != null && s.transferredBytes != null) {
        transferredBytes += Math.max(0, s.transferredBytes - previousTransferred);
      }
      previousTransferred = s.transferredBytes;
      if (s.rxBytes != null || s.txBytes != null) p.transferredMB = transferredBytes / 1e6;
      if (s.rxBytes != null || s.txBytes != null) {
        if (prevBytes) {
          const dt = s.t - prevBytes.t;
          p.rxMbps = rate(prevBytes.rxBytes, s.rxBytes, dt);
          p.txMbps = rate(prevBytes.txBytes, s.txBytes, dt);
        }
        prevBytes = s;
      }
      points.push(p);
    }
    if (points.length) out[mac] = sampleHistory(points, maxPoints);
  }
  return out;
}
