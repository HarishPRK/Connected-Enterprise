import type { AppPolicy, PathThreshold } from '../src/types';

export interface RoutingConfig {
  branchId: string;
  revision: number;
  updatedAt: string | null;
  policies: AppPolicy[];
  thresholds: PathThreshold[];
}

export const DEFAULT_ROUTING_THRESHOLDS: PathThreshold[] = [
  { metric: 'latency', fiber: { warn: 80, fail: 150 }, fiveg: { warn: 120, fail: 200 }, unit: 'ms' },
  { metric: 'jitter', fiber: { warn: 30, fail: 60 }, fiveg: { warn: 40, fail: 80 }, unit: 'ms' },
  { metric: 'loss', fiber: { warn: 1, fail: 3 }, fiveg: { warn: 1.5, fail: 5 }, unit: '%' },
  { metric: 'mos', fiber: { warn: 3.6, fail: 3 }, fiveg: { warn: 3.4, fail: 2.8 }, unit: '' },
];

// Examples are policy drafts; counters stay zero until live policy telemetry exists.
export const ROUTING_TEMPLATES: AppPolicy[] = [
  { id: 'template-video', app: 'Microsoft Teams', category: 'video', preferredPath: 'Fiber', backupPath: '5G', match: 'DSCP EF · *.teams.microsoft.com', hitsPerMin: 0, throughputMbps: 0, slaClass: 'realtime', enabled: true },
  { id: 'template-voice', app: 'VoIP Gateway', category: 'voice', preferredPath: 'Fiber', backupPath: '5G', match: 'SIP / RTP · DSCP EF', hitsPerMin: 0, throughputMbps: 0, slaClass: 'realtime', enabled: true },
  { id: 'template-business', app: 'Salesforce', category: 'business', preferredPath: 'Auto', backupPath: 'None', match: '*.force.com, *.salesforce.com', hitsPerMin: 0, throughputMbps: 0, slaClass: 'business', enabled: true },
  { id: 'template-bulk', app: 'Cloud Backup', category: 'bulk', preferredPath: '5G', backupPath: 'Fiber', match: '*.s3.amazonaws.com', hitsPerMin: 0, throughputMbps: 0, slaClass: 'best-effort', enabled: true },
  { id: 'template-iot', app: 'OT Telemetry', category: 'iot', preferredPath: 'Fiber', backupPath: '5G', match: 'MQTT · TCP/8883', hitsPerMin: 0, throughputMbps: 0, slaClass: 'business', enabled: true },
];

export function defaultRoutingConfig(branchId: string): RoutingConfig {
  return { branchId, revision: 0, updatedAt: null, policies: [], thresholds: structuredClone(DEFAULT_ROUTING_THRESHOLDS) };
}

export function validateRoutingPolicy(policy: unknown): string | undefined {
  if (!policy || typeof policy !== 'object') return 'A routing policy is required.';
  const p = policy as AppPolicy;
  if (typeof p.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(p.id)) return 'The policy identifier is invalid.';
  if (typeof p.app !== 'string' || p.app.trim().length < 2 || p.app.length > 100) return 'Enter an application name with 2–100 characters.';
  if (typeof p.match !== 'string' || !p.match.trim() || p.match.length > 500) return 'Enter a match rule with 1–500 characters.';
  if (!['voice', 'video', 'business', 'web', 'bulk', 'iot'].includes(p.category)) return 'Choose a supported application category.';
  if (!['realtime', 'business', 'best-effort'].includes(p.slaClass)) return 'Choose a supported SLA class.';
  if (!['Auto', 'Fiber', '5G'].includes(p.preferredPath) || !['None', 'Fiber', '5G'].includes(p.backupPath)) return 'Choose supported WAN paths.';
  if (p.preferredPath === p.backupPath) return 'Preferred and backup paths must be different.';
  if (typeof p.enabled !== 'boolean') return 'The policy state must be enabled or disabled.';
  if (!Number.isFinite(p.hitsPerMin) || p.hitsPerMin < 0 || !Number.isFinite(p.throughputMbps) || p.throughputMbps < 0) return 'Policy counters must be nonnegative numbers.';
  return undefined;
}

export function validateRoutingThresholds(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length !== 4) return 'Provide latency, jitter, packet loss, and MOS thresholds.';
  for (const expected of DEFAULT_ROUTING_THRESHOLDS) {
    const matches = value.filter((v) => v && v.metric === expected.metric);
    if (matches.length !== 1) return `Provide exactly one ${expected.metric} threshold.`;
    const t = matches[0] as PathThreshold;
    if (t.unit !== expected.unit) return `The unit for ${expected.metric} is invalid.`;
    for (const family of ['fiber', 'fiveg'] as const) {
      const bounds = t[family];
      const max = t.metric === 'mos' ? 5 : t.metric === 'loss' ? 100 : 60_000;
      if (!bounds || !Number.isFinite(bounds.warn) || !Number.isFinite(bounds.fail)
        || bounds.warn < 0 || bounds.fail < 0 || bounds.warn > max || bounds.fail > max) {
        return `${t.metric} thresholds must be numbers between 0 and ${max}.`;
      }
      if (t.metric === 'mos' ? bounds.warn <= bounds.fail : bounds.warn >= bounds.fail) {
        return t.metric === 'mos' ? 'MOS warn must be higher than fail.' : `${t.metric} warn must be lower than fail.`;
      }
    }
  }
  return undefined;
}

export function validateRoutingConfigUpdate(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return 'Provide a routing configuration.';
  const input = value as Partial<RoutingConfig>;
  if (!Number.isInteger(input.revision) || Number(input.revision) < 0) return 'A valid configuration revision is required.';
  if (!Array.isArray(input.policies) || input.policies.length > 200) return 'Provide at most 200 routing policies.';
  const seen = new Set<string>();
  for (const policy of input.policies) {
    const error = validateRoutingPolicy(policy);
    if (error) return error;
    if (seen.has(policy.id)) return 'Policy identifiers must be unique.';
    seen.add(policy.id);
  }
  return validateRoutingThresholds(input.thresholds);
}
