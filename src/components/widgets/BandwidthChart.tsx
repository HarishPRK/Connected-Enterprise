import { memo, useId, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceLine, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { Card } from '../Card';
import { useThemeColors } from '../../ui/Theme';
import { DEFAULT_HISTORY_RANGE, historyRangeMs, historyTick, type HistoryRange } from '../../ui/historyRange';
import { useChartHistory } from '../../ui/useChartHistory';
import { HistoryRangeControl, HistoryStatus } from './HistoryRangeControl';
import {
  WidgetDataBadge,
  WidgetDataNote,
  type WidgetDataMeta,
} from './WanWidget';

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
  const c = useThemeColors();
  const id = useId().replace(/:/g, '');
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

  // Keep Recharts outside freshness/loading-only card updates.
  const plot = useMemo(() => (
        <div className="chart-history-plot">
            <AreaChart responsive width="100%" height="100%" data={chartData}
              margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <defs>
                <linearGradient id={`fiber-${id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={c.accent} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={c.accent} stopOpacity={0} />
                </linearGradient>
                <linearGradient id={`fiveg-${id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={c.accent2} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={c.accent2} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={c.chartGrid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={[since, until]} allowDataOverflow
                ticks={Array.from({ length: 5 }, (_, i) => since + (until - since) * i / 4)}
                tickFormatter={(t: number) => historyTick(t, range)}
                stroke={c.textMuted} fontSize={11} tickLine={false} axisLine={false} minTickGap={32} />
              <YAxis
                stroke={c.textMuted} fontSize={11} tickLine={false} axisLine={false}
                allowDataOverflow={!validData.length}
                domain={validData.length ? [0, (max: number) => max || 1] : [0, 1]}
                tickFormatter={(value: number) => Number(value).toLocaleString(undefined, { maximumSignificantDigits: 3 })}
                label={{
                  value: 'Mbps', angle: -90, position: 'insideLeft', offset: 14,
                  style: { fontSize: 10, fill: c.textMuted, textAnchor: 'middle' },
                }}
              />
              <Tooltip
                contentStyle={{
                  background: c.tooltipBg,
                  border: `1px solid ${c.tooltipBorder}`,
                  borderRadius: 10,
                  fontSize: 12,
                  boxShadow: '0 10px 30px rgba(0,0,0,0.20)',
                  backdropFilter: 'blur(10px)',
                }}
                labelStyle={{ color: c.textDim, marginBottom: 4 }}
                labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
                cursor={{ stroke: c.chartCursor, strokeWidth: 1 }}
                formatter={(value) => [`${Number(value).toLocaleString(undefined, { maximumSignificantDigits: 4 })} Mbps`]}
              />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="plainline" />
              {threshold !== undefined && (
                <>
                  <ReferenceArea
                    y1={threshold}
                    fill={c.warn}
                    fillOpacity={breached ? 0.09 : 0.045}
                    ifOverflow="extendDomain"
                  />
                  <ReferenceLine
                    y={threshold}
                    stroke={c.warn}
                    strokeOpacity={breached ? 0.9 : 0.55}
                    strokeDasharray="6 4"
                    strokeWidth={breached ? 1.6 : 1.2}
                    ifOverflow="extendDomain"
                    label={{
                      value: `${thresholdLabel} ${threshold.toLocaleString(undefined, { maximumSignificantDigits: 4 })} Mbps`,
                      position: 'insideTopRight',
                      fill: c.warn,
                      fontSize: 10,
                      opacity: breached ? 1 : 0.75,
                    }}
                  />
                </>
              )}
              <Area type="linear" dataKey="fiber" name="Fiber" stroke={c.accent} fill={`url(#fiber-${id})`} strokeWidth={2} activeDot={{ r: 4 }} dot={validData.length === 1 ? { r: 4 } : false} isAnimationActive={false} />
              <Area type="linear" dataKey="fiveg" name="5G" stroke={c.accent2} fill={`url(#fiveg-${id})`} strokeWidth={2} activeDot={{ r: 4 }} dot={validData.length === 1 ? { r: 4 } : false} isAnimationActive={false} />
            </AreaChart>
        </div>
  ), [chartData, c, id, range, since, until, threshold, thresholdLabel, breached, validData.length]);

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
      {plot}
      <HistoryStatus loading={history.loading} error={history.error} empty={!validData.length}
        observedAt={validData.at(-1)?.t} />
    </Card>
  );
});
