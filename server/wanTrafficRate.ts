import type { WanDirectionalRate } from '../src/types.js';

/** Ignore sub-second observations and discard a baseline after a long gap.
 * The gateway currently reports about every ten seconds; these bounds reject
 * duplicate bursts and stale counter jumps without pretending there is a
 * fixed five- or sixty-second measurement window. */
export const WAN_RATE_MIN_INTERVAL_MS = 1_000;
export const WAN_RATE_MAX_INTERVAL_MS = 30_000;

export interface WanCounterSample {
  /** Exact MQTT topic + gateway + WAN interface identity. */
  key: string;
  /** Timestamp emitted by the gateway, not browser arrival time. */
  sourceTimestampMs: number;
  /** Server time at which this counter observation arrived. */
  observedAt: number;
  rxBytes: number;
  txBytes: number;
}

export interface WanRateUpdate {
  baseline: WanCounterSample | null;
  rate: WanDirectionalRate | null;
  /** Whether the caller should replace its stored baseline. */
  accepted: boolean;
  /** Whether any previously displayed rate must be cleared. */
  reset: boolean;
}

function validSample(sample: WanCounterSample): boolean {
  return sample.key.length > 0
    && Number.isFinite(sample.sourceTimestampMs)
    && sample.sourceTimestampMs > 0
    && Number.isFinite(sample.observedAt)
    && sample.observedAt > 0
    && Number.isSafeInteger(sample.rxBytes)
    && sample.rxBytes >= 0
    && Number.isSafeInteger(sample.txBytes)
    && sample.txBytes >= 0;
}

/**
 * Derive a live directional rate from the latest two clean cumulative WAN
 * counter observations. No smoothing or interpolation is applied:
 *
 *   Mbps = (newBytes - oldBytes) * 8 / elapsedSeconds / 1,000,000
 *
 * Duplicate/out-of-order timestamps are ignored. Counter resets, stream
 * changes, and gaps over 30 seconds establish a fresh baseline so they cannot
 * create a false spike.
 */
export function advanceWanTrafficRate(
  previous: WanCounterSample | null | undefined,
  next: WanCounterSample,
): WanRateUpdate {
  if (!validSample(next)) {
    return { baseline: null, rate: null, accepted: true, reset: true };
  }

  if (!previous || !validSample(previous) || previous.key !== next.key) {
    return { baseline: next, rate: null, accepted: true, reset: true };
  }

  const elapsedMs = next.sourceTimestampMs - previous.sourceTimestampMs;
  if (elapsedMs < 0) {
    return { baseline: previous, rate: null, accepted: false, reset: false };
  }

  if (elapsedMs === 0) {
    const identical = next.rxBytes === previous.rxBytes && next.txBytes === previous.txBytes;
    return identical
      ? { baseline: previous, rate: null, accepted: false, reset: false }
      : { baseline: next, rate: null, accepted: true, reset: true };
  }

  if (elapsedMs < WAN_RATE_MIN_INTERVAL_MS) {
    return { baseline: previous, rate: null, accepted: false, reset: false };
  }

  if (
    elapsedMs > WAN_RATE_MAX_INTERVAL_MS
    || next.rxBytes < previous.rxBytes
    || next.txBytes < previous.txBytes
  ) {
    return { baseline: next, rate: null, accepted: true, reset: true };
  }

  const elapsedSeconds = elapsedMs / 1_000;
  const rxMbps = ((next.rxBytes - previous.rxBytes) * 8) / elapsedSeconds / 1_000_000;
  const txMbps = ((next.txBytes - previous.txBytes) * 8) / elapsedSeconds / 1_000_000;
  if (!Number.isFinite(rxMbps) || !Number.isFinite(txMbps)) {
    return { baseline: next, rate: null, accepted: true, reset: true };
  }

  return {
    baseline: next,
    rate: {
      rxMbps,
      txMbps,
      spanSeconds: elapsedSeconds,
      sampleCount: 2,
      sourceTimestampMs: next.sourceTimestampMs,
      observedAt: next.observedAt,
    },
    accepted: true,
    reset: false,
  };
}
