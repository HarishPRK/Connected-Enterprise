import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultRoutingConfig, ROUTING_TEMPLATES, validateRoutingPolicy } from '../../shared/routing-config';
import { routingCategoryColor, routingTrafficSummary } from '../../src/ui/routingPresentation';
import type { AppCategoryId } from '../../src/types';

test('enterprise examples populate the bandwidth ranking without inventing traffic for new policies', () => {
  const policies = defaultRoutingConfig('branch-a').policies;
  const summary = routingTrafficSummary([...policies, { ...ROUTING_TEMPLATES[0], throughputMbps: 999 }]);
  assert.equal(summary.sampleCount, 10);
  assert.equal(summary.throughput, 328);
  assert.equal(summary.flowsPerMin, 1933);
  assert.deepEqual(summary.topApps.map((p) => p.app), ['Microsoft Teams', 'Web browsing', 'Google Meet', 'Microsoft 365', 'Google Workspace', 'Cloud Backup']);
  assert.equal(routingTrafficSummary(ROUTING_TEMPLATES).sampleCount, 0);
  assert.deepEqual(routingTrafficSummary([]).topApps, []);
  assert.ok(policies.every((policy) => validateRoutingPolicy(policy) === undefined));
});

test('defaults are independent copies so editing one branch cannot alter another', () => {
  const first = defaultRoutingConfig('first');
  first.policies[0].app = 'Edited';
  first.policies.splice(1);
  const second = defaultRoutingConfig('second');
  assert.equal(second.policies.length, 10);
  assert.equal(second.policies[0].app, 'Microsoft Teams');
});

test('category colors remain legible in light and dark charts and badges', () => {
  const luminance = (hex: string) => {
    const rgb = hex.slice(1).match(/../g)!.map((value) => parseInt(value, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  for (const theme of ['light', 'dark'] as const) {
    const bg = luminance(theme === 'light' ? '#ffffff' : '#25223f');
    for (const category of ['voice', 'video', 'business', 'web', 'bulk', 'iot'] as AppCategoryId[]) {
      const fg = luminance(routingCategoryColor(category, theme));
      assert.ok((Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05) >= 4.5, `${theme} ${category}`);
    }
  }
});
