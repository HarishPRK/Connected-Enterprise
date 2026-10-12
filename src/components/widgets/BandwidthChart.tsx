import { lazy, memo, Suspense, useMemo, useState } from 'react';
import { Card } from '../Card';
import { DEFAULT_HISTORY_RANGE, historyRangeMs, type HistoryRange } from '../../ui/historyRange';
import { useChartHistory } from '../../ui/useChartHistory';
import { useOnceVisible } from '../../ui/useOnceVisible';
import { HistoryRangeControl, HistoryStatus } from './HistoryRangeControl';
import {
  WidgetDataBadge,
  WidgetDataNote,
  type WidgetDataMeta,
} from './WanWidget';

const BandwidthPlot = lazy(() => import('./BandwidthPlot').then((module) => ({ default: module.BandwidthPlot })));

export interface BandwidthChartProps extends WidgetDataMeta {
  /** Explicit SLA/capacity threshold. When omitted, a p95 baseline is derived
   *  from the observed samples once enough of them exist. */
  slaMbps?: number;
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

interface BandwidthPoint { t: number; fiber: number; fiveg: number; }
interface BandwidthHistoryResponse { points: BandwidthPoint[]; since: number; until: number; }

function isValidPoint(point: BandwidthPoint) {
  return Number.isFinite(point.t)
    && Number.isFinite(point.fiber)
    && Number.isFinite(point.fiveg);
}

export const BandwidthChart = memo(function BandwidthChart({
  dataState = 'unavailable',
  source,
  statusMessage,
  observedAt,
  slaMbps,
}: BandwidthChartProps) {
  const [plotRef, plotVisible] = useOnceVisible<HTMLDivElement>();
  const [range, setRange] = useState<HistoryRange>(DEFAULT_HISTORY_RANGE);
  const history = useChartHistory<BandwidthHistoryResponse>(source
    ? `/api/ipsec/bandwidth/history?topic=${encodeURIComponent(source)}&range=${range}` : null);
  const [mountedAt] = useState(Date.now);
  const until = history.data?.until ?? mountedAt;
  const since = until - historyRangeMs(range);
  const validData = useMemo(() => (history.data?.points ?? []).filter(isValidPoint), [history.data?.points]);
  const chartData = useMemo<{ t: number; fiber?: number; fiveg?: number }[]>(() => validData.length
    ? validData : [{ t: since }, { t: until }], [validData, since, until]);

  // SLA line: explicit threshold wins; otherwise derive a p95 baseline once
  // there are enough samples for the percentile to mean something.
  const totals = useMemo(() => validData.map((point) => point.fiber + point.fiveg), [validData]);
  const baseline = useMemo(() => totals.length >= 8 ? Number(p95(totals).toPrecision(4)) : undefined, [totals]);
  const threshold = slaMbps
    ?? baseline;
  const thresholdLabel = slaMbps !== undefined ? 'SLA' : 'p95';
  const latestTotal = totals.length > 0 ? totals[totals.length - 1] : 0;
  const breached = threshold !== undefined && latestTotal > threshold;

  return (
    <Card
      className="chart-history-card"
      title="Bandwidth — 5G vs Fiber"
      sub={(
        <>
          <div>Measured Mbps over the selected range</div>
          <WidgetDataNote
            dataState={dataState}
            source={source}
            statusMessage={statusMessage}
            observedAt={validData.at(-1)?.t ?? observedAt}
          />
        </>
      )}
      right={<WidgetDataBadge state={dataState} />}
    >
      <HistoryRangeControl value={range} onChange={setRange} label="Bandwidth" />
      <div ref={plotRef} className="chart-history-plot">
        {plotVisible && (
          <Suspense fallback={<div role="status" style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 12 }}>Loading bandwidth chart…</div>}>
            <BandwidthPlot data={chartData} range={range} since={since} until={until}
              sampleCount={validData.length} threshold={threshold} thresholdLabel={thresholdLabel} breached={breached} />
          </Suspense>
        )}
      </div>
      <HistoryStatus loading={history.loading} error={history.error} empty={!validData.length}
        observedAt={validData.at(-1)?.t} />
    </Card>
  );
});
