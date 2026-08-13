/**
 * In-memory telemetry history — a rolling per-device buffer of timestamped
 * samples fed by deviceSource on every live inventory ingest.
 *
 * Two jobs:
 *   • `currentRates(mac)` — real throughput (Mbps) from the last two cumulative
 *     rx/tx byte counters the gateway reported for the client.
 *   • `historySeries()`  — downsampled per-device series (throughput, RSSI,
 *     power draw) for the dashboard's live charts.
 *
 * Session-scoped by design: it starts empty on server boot and grows as
 * samples arrive. Capacity bounds memory (~8h at a 10s cadence per device).
 */

import type { DeviceTelemetry } from '../src/types.js';

interface Sample {
  t: number;
  rxBytes?: number;
  txBytes?: number;
  rssiDbm?: number;
  apowerW?: number;
}

const MAX_SAMPLES = 2880;
/** Client counters in the current prplhome feed are refreshed about once per
 * minute even though inventory is re-published every ten seconds. Retain the
 * last measured interval through that cadence, then report idle if the counter
 * has not changed for longer than a normal refresh plus jitter. */
export const CLIENT_RATE_IDLE_AFTER_MS = 90_000;
const buffers = new Map<string, Sample[]>();

export function recordTelemetry(mac: string, t: DeviceTelemetry | undefined, when = Date.now()): void {
  if (!t) return;
  if (t.rxBytes == null && t.txBytes == null && t.rssiDbm == null && t.apowerW == null) return;
  let buf = buffers.get(mac);
  if (!buf) {
    buf = [];
    buffers.set(mac, buf);
  }
  const last = buf[buf.length - 1];
  if (last && when - last.t < 2_000) return; // collapse bursts
  buf.push({ t: when, rxBytes: t.rxBytes, txBytes: t.txBytes, rssiDbm: t.rssiDbm, apowerW: t.apowerW });
  if (buf.length > MAX_SAMPLES) buf.splice(0, buf.length - MAX_SAMPLES);
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
  const buf = buffers.get(mac);
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
}

/** Per-device history with derived rates, downsampled to ≤ maxPoints each. */
export function historySeries(maxPoints = 240): Record<string, HistoryPoint[]> {
  const out: Record<string, HistoryPoint[]> = {};
  for (const [mac, buf] of buffers) {
    const points: HistoryPoint[] = [];
    let prevBytes: Sample | undefined;
    for (const s of buf) {
      const p: HistoryPoint = { t: s.t, rssiDbm: s.rssiDbm, apowerW: s.apowerW, rxBytes: s.rxBytes, txBytes: s.txBytes };
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
    const stride = Math.max(1, Math.ceil(points.length / maxPoints));
    out[mac] = stride === 1 ? points : points.filter((_, i) => i % stride === 0 || i === points.length - 1);
  }
  return out;
}
