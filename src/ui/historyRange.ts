export const HISTORY_RANGES = [
  { value: '1m', label: '1 min', ms: 60_000 },
  { value: '5m', label: '5 min', ms: 300_000 },
  { value: '1h', label: '1 hr', ms: 3_600_000 },
  { value: '1d', label: '1 day', ms: 86_400_000 },
  { value: '7d', label: '7 days', ms: 604_800_000 },
] as const;

export type HistoryRange = typeof HISTORY_RANGES[number]['value'];
export const DEFAULT_HISTORY_RANGE: HistoryRange = '1h';
export function historyRangeMs(range: string): number {
  return (HISTORY_RANGES.find((item) => item.value === range) ?? HISTORY_RANGES[2]).ms;
}
export function historyTick(t: number, range: HistoryRange): string {
  return new Date(t).toLocaleString([], range === '7d' || range === '1d'
    ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit', ...(range === '1m' ? { second: '2-digit' } : {}) });
}
