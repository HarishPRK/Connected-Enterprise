import { useMemo, useState } from 'react';
import {
  CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { Device } from '../../types';
import { useThemeColors } from '../../ui/Theme';
import { DEFAULT_HISTORY_RANGE, historyRangeMs, historyTick, type HistoryRange } from '../../ui/historyRange';
import { deviceHistoryRows, type DeviceHistoryResponse } from '../../ui/deviceHistory';
import { useChartHistory } from '../../ui/useChartHistory';
import { Card } from '../Card';
import { HistoryRangeControl, HistoryStatus } from './HistoryRangeControl';

export function DeviceHistoryChart({ devices, metric }: {
  devices: Device[];
  metric: 'rssiDbm' | 'transferredMB';
}) {
  const c = useThemeColors();
  const [range, setRange] = useState<HistoryRange>(DEFAULT_HISTORY_RANGE);
  const isRssi = metric === 'rssiDbm';
  const label = isRssi ? 'Wi-Fi signal' : 'Data transferred';
  const macQuery = [...new Set(devices.map((device) => device.mac.toUpperCase()))].sort().join(',');
  const history = useChartHistory<DeviceHistoryResponse>(macQuery
    ? `/api/devices/telemetry/history?range=${range}&macs=${encodeURIComponent(macQuery)}` : null);
  const [mountedAt] = useState(Date.now);
  const until = history.data?.until ?? mountedAt;
  const since = until - historyRangeMs(range);
  const chart = useMemo(() => deviceHistoryRows(history.data?.series ?? {},
    new Set(macQuery.split(',')), metric, range, since, until),
  [history.data, macQuery, metric, range, since, until]);
  const names = new Map(devices.map((device) => [device.mac.toUpperCase(), device.name]));
  const palette = [c.accent, c.accent2, c.accent3, c.ok, c.warn, '#67e8f9', '#fb7185', '#a78bfa', '#facc15'];
  const max = Math.max(0, ...chart.rows.map((row) => Math.max(0, ...chart.keys.map((key) => row[key] ?? 0))));
  const useKB = !isRssi && max > 0 && max < 1;
  const unit = isRssi ? 'dBm' : useKB ? 'KB' : 'MB';
  const scale = useKB ? 1000 : 1;
  const deviceLabel = (key: string) => {
    const name = names.get(key) ?? key;
    return devices.filter((device) => device.name === name).length > 1 ? `${name} · ${key}` : name;
  };

  return (
    <Card className="chart-history-card" title={label}
      sub={isRssi
        ? 'Measured per-device RSSI. Dashed lines mark warning and error thresholds.'
        : `Cumulative ${unit} per device in the selected range (RX + TX).`}
    >
      <HistoryRangeControl value={range} onChange={setRange} label={label} />
      <div className="chart-history-plot">
          <LineChart responsive width="100%" height="100%" data={chart.rows.length ? chart.rows : [{ ts: since }, { ts: until }]}
            margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid stroke={c.chartGrid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="ts" type="number" scale="time" domain={[since, until]} allowDataOverflow
              ticks={Array.from({ length: 5 }, (_, i) => since + (until - since) * i / 4)}
              tickFormatter={(t: number) => historyTick(t, range)}
              stroke={c.textMuted} fontSize={11} tickLine={false} axisLine={false} minTickGap={32} />
            <YAxis stroke={c.textMuted} fontSize={11} tickLine={false} axisLine={false}
              allowDataOverflow={!chart.rows.length}
              domain={isRssi ? [-100, -20] : [0, max || 1]}
              tickFormatter={(v: number) => (v * scale).toLocaleString(undefined, { maximumFractionDigits: 2 })} />
            <Tooltip contentStyle={{ background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}`, borderRadius: 10, fontSize: 12 }}
              labelStyle={{ color: c.textDim }}
              labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
              formatter={(v, key) => [`${(Number(v) * scale).toLocaleString(undefined, { maximumFractionDigits: 3 })} ${unit}`, deviceLabel(String(key))]} />
            {isRssi && <>
              <ReferenceLine y={-70} stroke={c.warn} strokeDasharray="4 4"
                label={{ value: 'warn −70', position: 'insideTopRight', fill: c.warn, fontSize: 10 }} />
              <ReferenceLine y={-80} stroke={c.err} strokeDasharray="4 4"
                label={{ value: 'err −80', position: 'insideBottomRight', fill: c.err, fontSize: 10 }} />
            </>}
            {!chart.keys.length && (
              <Line dataKey="__unreported" stroke="transparent" dot={false}
                legendType="none" tooltipType="none" isAnimationActive={false} />
            )}
            {chart.keys.map((key, i) => (
              <Line key={key} dataKey={key} type={isRssi ? 'linear' : 'stepAfter'}
                stroke={palette[i % palette.length]} strokeWidth={1.7}
                dot={(chart.counts.get(key) ?? 0) === 1 ? { r: 3 } : false}
                connectNulls activeDot={{ r: 4 }} isAnimationActive={false} />
            ))}
          </LineChart>
      </div>
      <HistoryStatus loading={history.loading} error={history.error} empty={!chart.rows.length}
        observedAt={chart.rows.at(-1)?.ts} />
      {!!chart.keys.length && <div className="dev-legend chart-history-legend">
        {chart.keys.map((key, i) => <span key={key} className="dev-legend-item">
          <span className="dev-legend-swatch" style={{ background: palette[i % palette.length] }} />
          {deviceLabel(key)}
        </span>)}
      </div>}
    </Card>
  );
}
