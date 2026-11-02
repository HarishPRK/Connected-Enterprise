import type { AppCategoryId, AppPolicy } from '../types';
import type { Theme } from './Theme';

// Keep the existing category hues, with readable contrast on each surface.
const categoryColors: Record<Theme, Record<AppCategoryId, string>> = {
  dark: { voice: '#22d3ee', video: '#34d399', business: '#a3e635', web: '#c084fc', bulk: '#fbbf24', iot: '#fb7185' },
  light: { voice: '#0e7490', video: '#047857', business: '#4d7c0f', web: '#7e22ce', bulk: '#a16207', iot: '#be123c' },
};

export function routingCategoryColor(category: AppCategoryId, theme: Theme): string {
  return categoryColors[theme][category];
}

export function routingTrafficSummary(policies: AppPolicy[]) {
  const samples = policies.filter((policy) => policy.trafficSource === 'sample');
  return {
    sampleCount: samples.length,
    flowsPerMin: samples.reduce((sum, policy) => sum + policy.hitsPerMin, 0),
    throughput: samples.reduce((sum, policy) => sum + policy.throughputMbps, 0),
    topApps: [...samples].sort((a, b) => b.throughputMbps - a.throughputMbps).slice(0, 6),
  };
}
