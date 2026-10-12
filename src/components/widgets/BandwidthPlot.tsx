import { memo, useId } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceLine, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { useThemeColors } from '../../ui/Theme';
import { historyTick, type HistoryRange } from '../../ui/historyRange';

export interface BandwidthPlotProps {
  data: { t: number; fiber?: number; fiveg?: number }[];
  range: HistoryRange;
  since: number;
  until: number;
  sampleCount: number;
  threshold?: number;
  thresholdLabel: string;
  breached: boolean;
}

/** Deferred chart DOM keeps its measurements out of the initial Home commit. */
export const BandwidthPlot = memo(function BandwidthPlot({ data, range, since, until, sampleCount, threshold, thresholdLabel, breached }: BandwidthPlotProps) {
  const c = useThemeColors();
  const id = useId().replace(/:/g, '');
  return (
    <AreaChart responsive width="100%" height="100%" data={data}
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
        allowDataOverflow={!sampleCount}
        domain={sampleCount ? [0, (max: number) => max || 1] : [0, 1]}
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
      <Area type="linear" dataKey="fiber" name="Fiber" stroke={c.accent} fill={`url(#fiber-${id})`} strokeWidth={2} activeDot={{ r: 4 }} dot={sampleCount === 1 ? { r: 4 } : false} isAnimationActive={false} />
      <Area type="linear" dataKey="fiveg" name="5G" stroke={c.accent2} fill={`url(#fiveg-${id})`} strokeWidth={2} activeDot={{ r: 4 }} dot={sampleCount === 1 ? { r: 4 } : false} isAnimationActive={false} />
    </AreaChart>
  );
});
