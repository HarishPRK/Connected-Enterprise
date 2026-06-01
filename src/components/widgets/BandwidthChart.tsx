import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { Card } from '../Card';
import type { BandwidthPoint } from '../../types';
import { useState } from 'react';
import { useThemeColors } from '../../ui/Theme';

const ranges = ['1h', '6h', '24h', '7d'] as const;

export function BandwidthChart({ data }: { data: BandwidthPoint[] }) {
  const [range, setRange] = useState<typeof ranges[number]>('24h');
  const c = useThemeColors();
  return (
    <Card
      title="Bandwidth — 5G vs Fiber"
      sub="Mbps over the selected window"
      right={
        <div className="toolbar">
          {ranges.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={r === range
                ? { background: 'var(--grad-accent-soft)', borderColor: 'var(--accent)', color: 'var(--text)' }
                : undefined}
            >{r}</button>
          ))}
        </div>
      }
    >
      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="fiber" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c.accent} stopOpacity={0.55} />
                <stop offset="100%" stopColor={c.accent} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="fiveg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c.accent2} stopOpacity={0.55} />
                <stop offset="100%" stopColor={c.accent2} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={c.chartGrid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="t" stroke={c.textMuted} fontSize={11} tickLine={false} axisLine={false} />
            <YAxis stroke={c.textMuted} fontSize={11} tickLine={false} axisLine={false} />
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
            />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="plainline" />
            <Area type="monotone" dataKey="fiber" name="Fiber" stroke={c.accent}  fill="url(#fiber)" strokeWidth={2} activeDot={{ r: 4 }} />
            <Area type="monotone" dataKey="fiveg" name="5G"    stroke={c.accent2} fill="url(#fiveg)" strokeWidth={2} activeDot={{ r: 4 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
