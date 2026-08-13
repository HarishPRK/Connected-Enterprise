import { useId } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { Card } from '../Card';
import type { BandwidthPoint } from '../../types';
import { useThemeColors } from '../../ui/Theme';
import {
  WidgetDataBadge,
  WidgetDataEmpty,
  WidgetDataNote,
  type WidgetDataMeta,
} from './WanWidget';

export interface BandwidthChartProps extends WidgetDataMeta {
  data: readonly BandwidthPoint[] | null;
  /** Explicit SLA/capacity threshold. When omitted, a p95 baseline is derived
   *  from the observed samples once enough of them exist. */
  slaMbps?: number;
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

function isValidPoint(point: BandwidthPoint) {
  return typeof point.t === 'string'
    && point.t.trim().length > 0
    && Number.isFinite(point.fiber)
    && Number.isFinite(point.fiveg);
}

export function BandwidthChart({
  data,
  dataState = 'unavailable',
  source,
  statusMessage,
  observedAt,
  slaMbps,
}: BandwidthChartProps) {
  const c = useThemeColors();
  const id = useId().replace(/:/g, '');
  const canShowObservation = dataState === 'live' || dataState === 'stale';
  const validData = canShowObservation ? (data ?? []).filter(isValidPoint) : [];
  const hasChart = validData.length >= 2;

  // SLA line: explicit threshold wins; otherwise derive a p95 baseline once
  // there are enough samples for the percentile to mean something.
  const totals = validData.map((point) => point.fiber + point.fiveg);
  const threshold = slaMbps
    ?? (totals.length >= 8 ? Number(p95(totals).toFixed(2)) : undefined);
  const thresholdLabel = slaMbps ? 'SLA' : 'p95';
  const latestTotal = totals.length > 0 ? totals[totals.length - 1] : 0;
  const breached = threshold !== undefined && latestTotal > threshold;

  return (
    <Card
      title="Bandwidth — 5G vs Fiber"
      sub={(
        <>
          <div>Observed Mbps, by source timestamp</div>
          <WidgetDataNote
            dataState={dataState}
            source={source}
            statusMessage={statusMessage}
            observedAt={observedAt}
          />
        </>
      )}
      right={<WidgetDataBadge state={dataState} />}
    >
      {!hasChart ? (
        <WidgetDataEmpty
          state={dataState}
          liveLabel="bandwidth samples"
          skeleton={dataState === 'live'}
          message={validData.length === 1
            ? 'One source sample received. Waiting for another sample to draw the chart.'
            : undefined}
        />
      ) : (
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={validData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
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
              <XAxis dataKey="t" stroke={c.textMuted} fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis
                stroke={c.textMuted} fontSize={11} tickLine={false} axisLine={false}
                tickFormatter={(value: number) => Number(value).toLocaleString()}
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
                cursor={{ stroke: c.chartCursor, strokeWidth: 1 }}
                formatter={(value) => [`${Number(value).toLocaleString()} Mbps`]}
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
                      value: `${thresholdLabel} ${threshold.toLocaleString()} Mbps`,
                      position: 'insideTopRight',
                      fill: c.warn,
                      fontSize: 10,
                      opacity: breached ? 1 : 0.75,
                    }}
                  />
                </>
              )}
              <Area type="monotone" dataKey="fiber" name="Fiber" stroke={c.accent} fill={`url(#fiber-${id})`} strokeWidth={2} activeDot={{ r: 4 }} />
              <Area type="monotone" dataKey="fiveg" name="5G" stroke={c.accent2} fill={`url(#fiveg-${id})`} strokeWidth={2} activeDot={{ r: 4 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
