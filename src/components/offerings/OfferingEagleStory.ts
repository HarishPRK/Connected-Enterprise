import { ANOMALY_REASON_LABELS } from '../../../shared/eagleTelemetry';

/** Local illustrative film, never a device-control API. Detector fields,
 * service checks, attempted actions and fresh verification remain distinct. */
export const EAGLE_TIMING = {
  symptom: 3, approach: 6, accumulation: 6, flagReceived: 8,
  review: 8.5, selectWindow: 10, connections: 11.2, dispatch: 12.5,
  inspect: 13.7, farInspect: 13, attempt: 17, actionComplete: 18,
  firstFreshWindow: 20, flagClear: 22, result: 22, duration: 24,
} as const;
export type EagleVariant = 'gateway' | 'fiber' | '5g' | 'it' | 'ot';
export const EAGLE_CASES = {
  gateway: {
    label: 'Shared gateway', endpointLabel: 'Checkout price lookup', delay: 2800,
    mse: 1.48, reason: 2, checkoutAffected: true, connections: [1320, 420, 24, 16],
    symptom: 'Camera archive, checkout and telemetry queues grow together',
    check: 'Compare CPE memory with the archive and analytics workload',
    evidence: 'A received Memory Pressure flag supports a resource check, not a root-cause verdict',
    finding: 'The illustrative resource check finds a growing nonessential archive queue',
    action: 'Pause the archive job; restart the example analytics worker',
    actionDetail: 'Inspect the CPE and Dell appliance, then use the rack console for a scripted workload intervention.',
    outcome: 'Fresh windows show recovery; continue monitoring the shared gateway', improves: true,
  },
  fiber: {
    label: 'Fiber uplink', endpointLabel: 'Upstream price lookup', delay: 2200,
    mse: .53, reason: 0, checkoutAffected: true, connections: [382, 140, 14, 4],
    symptom: 'The upstream lookup waits while local sensor reports continue',
    check: 'Inspect terminal indicators and compare local and upstream probes',
    evidence: 'Normal hardware windows do not clear the separate uplink symptom',
    finding: 'Local service is responsive; the repeated upstream probe is still slow',
    action: 'Check the terminal and repeat the upstream diagnostic probe',
    actionDetail: 'A colleague checks the fiber terminal while the operator repeats the probe at the rack console.',
    outcome: 'The repeat probe is still slow; escalate the uplink investigation', improves: false,
  },
  '5g': {
    label: 'Cellular interface', endpointLabel: '5G diagnostic probe', delay: 2400,
    mse: .49, reason: 0, checkoutAffected: false, connections: [228, 140, 16, 4],
    symptom: 'Cellular health probes queue while trading stays on fiber',
    check: 'Inspect the modem and compare registration with probe responses',
    evidence: 'An interface check is delayed; the hardware detector has not flagged the CPE',
    finding: 'The example registration check needs a fresh cellular session',
    action: 'Request an illustrative re-registration, then repeat the probe',
    actionDetail: 'A colleague checks the cellular unit while the operator requests a scripted registration refresh.',
    outcome: 'Two fresh cellular probes improve; retain a readiness follow-up', improves: true,
  },
  it: {
    label: 'Inventory server', endpointLabel: 'Inventory service lookup', delay: 2600,
    mse: .51, reason: 0, checkoutAffected: true, connections: [144, 52, 12, 4],
    symptom: 'The inventory request queue grows; camera recording continues',
    check: 'Inspect the server link and compare inventory-worker responses',
    evidence: 'Normal gateway hardware does not establish that its local application is healthy',
    finding: 'The example inventory worker has pending requests despite a live LAN link',
    action: 'Restart the example inventory worker, then repeat the lookup',
    actionDetail: 'Inspect the server and its link, return to the rack and start the scripted worker restart.',
    outcome: 'Fresh lookups return and the queue drains; keep the service under observation', improves: true,
  },
  ot: {
    label: 'Climate sensor', endpointLabel: 'Climate sensor report', delay: 3200,
    mse: .48, reason: 0, checkoutAffected: false, connections: [224, 68, 12, 4],
    symptom: 'Climate reports become stale while checkout continues',
    check: 'Inspect sensor power and compare report age with communication state',
    evidence: 'A stale report is a communication symptom, not proof of HVAC failure',
    finding: 'The powered sensor has stale reports; the next check is a fresh poll',
    action: 'Inspect the sensor, then request an illustrative fresh poll',
    actionDetail: 'A colleague checks the powered sensor while the rack operator requests a new report; no HVAC repair is implied.',
    outcome: 'Two fresh reports arrive; continue monitoring sensor communication', improves: true,
  },
} as const;
export function eagleVariant(value: string): EagleVariant {
  return Object.hasOwn(EAGLE_CASES, value) ? value as EagleVariant : 'gateway';
}
function clampTime(time: number) { return Number.isNaN(time) ? 0 : Math.max(0, Math.min(24, time)); }
function ramp(time: number, start: number, end: number) {
  const u = Math.max(0, Math.min(1, (time - start) / (end - start)));
  return u * u * (3 - 2 * u);
}
export interface EagleWindow {
  index: number; at: number; mse: number; threshold: number;
  crossed: boolean; flag: boolean; reasonCode: number; fresh: boolean;
}
/** Compressed example five-minute windows. W03 crosses before W04's received
 * flag. MSE recedes at W10, but the received flag clears only at W11. */
export function eagleWindows(variant: string, time: number): EagleWindow[] {
  const id = eagleVariant(variant), item = EAGLE_CASES[id], t = clampTime(time);
  const gatewayMse = [.46, .47, .64, 1.24, 1.48, 1.46, 1.49, 1.48, 1.45, 1.34, .86, .50, .48];
  return Array.from({ length: Math.floor(t / 2) + 1 }, (_, index) => {
    const at = index * 2;
    const mse = id === 'gateway' ? gatewayMse[index]
      : Number((.46 + (item.mse - .46) * ramp(at, 3, 6) * (item.improves ? 1 - .8 * ramp(at, 18, 22) : 1)).toFixed(3));
    const flag = id === 'gateway' && at >= 8 && at < 22;
    return { index, at, mse, threshold: 1.122, crossed: mse > 1.122, flag, reasonCode: flag ? item.reason : 0, fresh: at >= 20 };
  });
}
export function sampleEagle(variant: string, time: number) {
  const id = eagleVariant(variant), item = EAGLE_CASES[id], t = clampTime(time);
  const amount = ramp(t, 3, 6), recovery = item.improves ? ramp(t, 18, 22) : 0;
  const baselineResponseMs = 180;
  const endpointDelayMs = Math.round(180 + (item.delay - 180) * amount * (1 - recovery * .98));
  const windows = eagleWindows(id, t), latest = windows[windows.length - 1];
  const anomalyMse = latest.mse, anomalyThreshold = latest.threshold;
  const anomalyFlag = latest.flag, thresholdCrossed = latest.crossed, reasonCode = latest.reasonCode;
  const counts = item.connections.map((value, index) => Math.round([224, 80, 12, 4][index] + (value - [224, 80, 12, 4][index]) * amount * (1 - .9 * recovery)));
  const local = id === 'gateway' || id === 'it';
  const operatorAtConsole = t >= 8.5 && (t < 12.5 || !local || t >= 16.5);
  const reviewAction = !operatorAtConsole ? 'none' : t >= 22 ? 'verify-result' : t >= 18 ? 'watch-fresh-windows'
    : t >= 17 ? 'attempt-action' : t >= 12 ? 'assign-check' : t >= 11.2 ? 'compare-connections'
      : t >= 10 ? 'select-window' : 'review-chart';
  const inspectionStarted = t >= (local ? 13.7 : 13);
  const actionAttempted = t >= 17, actionComplete = t >= 18;
  const freshWindows = windows.filter(window => window.fresh).length;
  const recoveryObserved = actionComplete && endpointDelayMs < 500;
  const flagCleared = id !== 'gateway' || !anomalyFlag && t >= 22;
  const recoveryVerified = recoveryObserved && freshWindows >= 2 && flagCleared && !thresholdCrossed;
  const symptom = t >= 3 && endpointDelayMs > 500;
  const queueAmount = amount * (1 - recovery);
  const endpointQueues = [
    { id: 'checkout', label: 'Price / inventory', pending: Math.round((item.checkoutAffected ? 8 : 0) * queueAmount), current: !item.checkoutAffected || recoveryVerified },
    { id: 'camera', label: 'Camera archive', pending: Math.round((id === 'gateway' ? 12 : id === 'fiber' ? 5 : 0) * queueAmount), current: id !== 'gateway' && id !== 'fiber' || recoveryVerified },
    { id: 'telemetry', label: id === '5g' ? 'Cellular probes' : 'Sensor reports', pending: Math.round((id === 'ot' ? 10 : id === 'gateway' ? 6 : id === '5g' ? 7 : 0) * queueAmount), current: id !== 'ot' && id !== 'gateway' && id !== '5g' || recoveryVerified },
  ];
  const stage = t >= 22 ? 'result' : t >= 18 ? 'verify' : t >= 17 ? 'attempt' : inspectionStarted ? 'inspect'
    : t >= 12.5 ? 'walk-to-device' : t >= 8.5 ? 'review' : t >= 6 ? 'accumulating' : t >= 3 ? 'symptom' : 'baseline';
  const diagnosticStatus = anomalyFlag ? thresholdCrossed ? 'Flagged window' : 'MSE lower; received flag still set'
    : thresholdCrossed ? 'Crossing; flag pending' : 'Within threshold';
  const verificationStatus = t < 18 ? 'Not started' : freshWindows < 2 ? `Waiting for fresh windows · ${freshWindows}/2`
    : recoveryVerified ? 'Recovery observed in two fresh windows' : 'Repeat check still delayed · escalate';
  return {
    illustrative: true as const, productionCommandIssued: false as const,
    variant: id, time: t, affectedDevice: id, deviceLabel: item.label, endpointLabel: item.endpointLabel,
    endpointDelayMs, baselineResponseMs, checkoutAffected: item.checkoutAffected,
    symptom, symptomOccurred: t >= 3, symptomLabel: item.symptom, endpointQueues,
    anomalyMse, anomalyThreshold, anomalyFlag, thresholdCrossed, reasonCode,
    reasonLabel: ANOMALY_REASON_LABELS[reasonCode], windows, selectedWindow: t >= 10 ? Math.min(4, windows.length - 1) : windows.length - 1,
    conntrack: { total: counts.reduce((sum, value) => sum + value, 0), tcp: counts[0], udp: counts[1], icmp: counts[2], other: counts[3] },
    diagnosticStatus, diagnosticReviewed: t >= 12.5, operatorAtConsole, reviewAction,
    inspectionStarted, inspectionTask: item.check, inspectionFinding: inspectionStarted ? item.finding : 'Physical check pending',
    evidence: item.evidence, actionLabel: item.action, actionDetail: item.actionDetail,
    actionAttempted, actionComplete, recovery, recoveryObserved, freshWindows, flagCleared, recoveryVerified,
    verificationStatus, investigationOpen: true as const, resolved: false as const, stage,
    status: t >= 22 ? item.outcome : t >= 18 ? verificationStatus : actionAttempted ? item.action
      : inspectionStarted ? item.finding : t >= 12.5 ? `Follow up: ${item.check}`
        : operatorAtConsole ? 'Compare windows, received flags and connection context'
          : t >= 6 ? 'More windows arrive; compare evidence before acting'
            : t >= 3 ? `${item.endpointLabel}: ${(endpointDelayMs / 1000).toFixed(1)} s` : 'Connected devices respond normally',
  };
}

/** Integral of illustrative speed; slowing and recovery cannot move packets
 * backwards. Midpoint integration is deterministic and independent of frames. */
export function eaglePacketClock(variant: string, time: number): number {
  const t = clampTime(time), item = EAGLE_CASES[eagleVariant(variant)], step = .05;
  let elapsed = 0;
  for (let at = 0; at < t; at += step) {
    const dt = Math.min(step, t - at), mid = at + dt / 2;
    const delay = 180 + (item.delay - 180) * ramp(mid, 3, 6) * (1 - (item.improves ? ramp(mid, 18, 22) : 0) * .98);
    elapsed += dt * 180 / delay;
  }
  return elapsed;
}
