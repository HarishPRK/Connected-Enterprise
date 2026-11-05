import { ANOMALY_REASON_LABELS } from '../../../shared/eagleTelemetry';

/** Scripted demonstration of the fields in useHardwareAnomalies. Endpoint and
 * interface checks are a separate illustrative investigation, not diagnoses
 * inferred from the hardware detector or from connection counts alone. */
export const EAGLE_TIMING = {
  symptom: 4,
  approach: 6.5,
  review: 8.5,
  selectWindow: 10,
  connections: 11.5,
  dispatch: 13.5,
  inspect: 18,
  farInspect: 20,
} as const;

export type EagleVariant = 'gateway' | 'fiber' | '5g' | 'it' | 'ot';
export const EAGLE_CASES = {
  gateway: { label: 'Shared gateway', endpointLabel: 'Checkout price lookup', delay: 2800, mse: 1.48, reason: 2, checkoutAffected: true, check: 'Inspect CPE memory and load', symptom: 'Checkout and stock responses slow together', evidence: 'Memory Pressure flag; inspect gateway resources', connections: [1320, 420, 24, 16] },
  fiber: { label: 'Fiber uplink', endpointLabel: 'Checkout price lookup', delay: 2200, mse: .53, reason: 0, checkoutAffected: true, check: 'Check fiber terminal and uplink', symptom: 'Upstream price lookup is delayed', evidence: 'Hardware within threshold; check fiber response', connections: [382, 140, 14, 4] },
  '5g': { label: 'Cellular interface', endpointLabel: '5G diagnostic probe', delay: 2400, mse: .49, reason: 0, checkoutAffected: false, check: 'Check cellular registration and signal', symptom: 'The cellular health probe responds slowly', evidence: 'Hardware within threshold; check 5G probe', connections: [228, 140, 16, 4] },
  it: { label: 'Inventory server', endpointLabel: 'Checkout price lookup', delay: 2600, mse: .51, reason: 0, checkoutAffected: true, check: 'Check inventory service and LAN port', symptom: 'The stock and price lookup is delayed', evidence: 'Hardware within threshold; check local IT service', connections: [144, 52, 12, 4] },
  ot: { label: 'Climate sensor', endpointLabel: 'Climate sensor report', delay: 3200, mse: .48, reason: 0, checkoutAffected: false, check: 'Check sensor communication and power', symptom: 'Climate readings arrive late', evidence: 'Hardware within threshold; check sensor reports', connections: [224, 68, 12, 4] },
} as const;

function ramp(time: number, start: number, end: number) {
  const t = Math.max(0, Math.min(1, (time - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

export function sampleEagle(variant: string, time: number) {
  const id: EagleVariant = Object.hasOwn(EAGLE_CASES, variant) ? variant as EagleVariant : 'gateway';
  const item = EAGLE_CASES[id];
  const symptom = time >= EAGLE_TIMING.symptom;
  const amount = ramp(time, EAGLE_TIMING.symptom, 5.5);
  const baselineResponseMs = 180;
  const endpointDelayMs = Math.round(baselineResponseMs + (item.delay - baselineResponseMs) * amount);
  const anomalyMse = Math.round((.46 + (item.mse - .46) * ramp(time, 4.6, 6)) * 1000) / 1000;
  const anomalyThreshold = 1.122;
  // The received detector flag is distinct from the mathematical crossing,
  // just as in the real dashboard. A crossing can precede a confirmed flag.
  const anomalyFlag = id === 'gateway' && time >= 6;
  const thresholdCrossed = anomalyMse > anomalyThreshold;
  const reasonCode = anomalyFlag ? item.reason : 0;
  const baseline = [224, 80, 12, 4];
  const counts = item.connections.map((value, index) => Math.round(baseline[index] + (value - baseline[index]) * amount));
  const diagnosticReviewed = time >= EAGLE_TIMING.dispatch;
  const inspectionStarted = time >= (id === 'ot' ? EAGLE_TIMING.farInspect : EAGLE_TIMING.inspect);
  const operatorAtConsole = time >= EAGLE_TIMING.review && time < EAGLE_TIMING.dispatch;
  const reviewAction = !operatorAtConsole ? 'none' : time >= 12.5 ? 'assign-check' : time >= EAGLE_TIMING.connections
    ? 'compare-connections' : time >= EAGLE_TIMING.selectWindow ? 'select-window' : 'review-chart';
  const diagnosticStatus = anomalyFlag ? 'Flagged window' : thresholdCrossed ? 'Crossing; flag pending' : 'Within threshold';
  return {
    illustrative: true as const,
    variant: id,
    affectedDevice: id,
    deviceLabel: item.label,
    endpointLabel: item.endpointLabel,
    endpointDelayMs,
    baselineResponseMs,
    checkoutAffected: item.checkoutAffected,
    symptom,
    symptomLabel: item.symptom,
    anomalyMse,
    anomalyThreshold,
    anomalyFlag,
    thresholdCrossed,
    reasonCode,
    reasonLabel: ANOMALY_REASON_LABELS[reasonCode],
    conntrack: { total: counts.reduce((sum, value) => sum + value, 0), tcp: counts[0], udp: counts[1], icmp: counts[2], other: counts[3] },
    diagnosticStatus,
    diagnosticReviewed,
    operatorAtConsole,
    reviewAction,
    inspectionStarted,
    inspectionTask: item.check,
    evidence: item.evidence,
    resolved: false as const,
    stage: inspectionStarted ? 'inspect' : diagnosticReviewed ? 'walk-to-device' : operatorAtConsole ? 'review'
      : time >= EAGLE_TIMING.approach ? 'approach' : symptom ? 'symptom' : 'baseline',
    status: inspectionStarted ? `${item.check} · investigation remains open` : diagnosticReviewed
      ? `Operator follows up: ${item.label}` : operatorAtConsole
        ? 'Operator checks MSE, detector flag and connection counts' : symptom
          ? `${item.endpointLabel}: ${(endpointDelayMs / 1000).toFixed(1)} s response` : 'Store responses normal · EA:GLE monitoring available',
  };
}
