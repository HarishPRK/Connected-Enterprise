import type { AnomalyReasonCode } from '../../shared/eagleTelemetry';
import type { HardwareAnomalyPoint } from './useHardwareAnomalies';

export type EagleSampleState = 'normal' | 'unknown' | 'crossed' | 'flagged';
export function eagleSampleState(point: HardwareAnomalyPoint): EagleSampleState {
  if (point.anomalyFlag === true) return 'flagged';
  if (point.anomalyMse !== null && point.anomalyThreshold !== null && point.anomalyMse > point.anomalyThreshold) return 'crossed';
  if (point.anomalyFlag === null || point.anomalyMse === null || point.anomalyThreshold === null) return 'unknown';
  return 'normal';
}

export function eagleSnapshotMood(reasons: AnomalyReasonCode[], latest: HardwareAnomalyPoint | null, stale: boolean) {
  if (stale) return 'waiting';
  if (reasons.some(reason => reason.code !== 0) || (latest && eagleSampleState(latest) === 'flagged')) return 'alert';
  if (latest && eagleSampleState(latest) === 'crossed') return 'alert';
  if (latest && eagleSampleState(latest) === 'normal' && reasons.length > 0) return 'calm';
  return 'waiting';
}

/** Each display segment represents real windows; preserve the most severe state in a bin. */
export function eagleHistorySegments(points: HardwareAnomalyPoint[], maximum = 80) {
  const priority: EagleSampleState[] = ['normal', 'unknown', 'crossed', 'flagged'];
  const size = Math.max(1, Math.ceil(points.length / maximum));
  const segments: { state: EagleSampleState; start: string; end: string; count: number }[] = [];
  for (let offset = 0; offset < points.length; offset += size) {
    const bin = points.slice(offset, offset + size);
    const state = bin.reduce<EagleSampleState>((worst, point) => {
      const next = eagleSampleState(point);
      return priority.indexOf(next) > priority.indexOf(worst) ? next : worst;
    }, 'normal');
    segments.push({ state, start: bin[0].time, end: bin.at(-1)!.time, count: bin.length });
  }
  return segments;
}
