import { useMemo } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell,
  Pie, PieChart, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card } from '../Card';
import { DeviceHistoryChart } from './DeviceHistoryChart';
import type { Device } from '../../types';
import { useThemeColors, type ThemeColors } from '../../ui/Theme';
import {
  Activity, Gauge, Radio, Signal, Wifi,
} from 'lucide-react';

/* ─────────── helpers ─────────── */

const HOURS = 24;

/** Deterministic id → integer hash. */
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h * 31) + id.charCodeAt(i)) >>> 0;
  return h;
}

/** Hour labels ending at the current hour, e.g. "13:00". */
function hourLabels(): string[] {
  const now = new Date().getHours();
  return Array.from({ length: HOURS }, (_, i) => {
    const h = (now - (HOURS - 1) + i + 24) % 24;
    return `${String(h).padStart(2, '0')}:00`;
  });
}

/** Deterministic wave + noise around a baseline. */
function wave(seed: number, i: number, baseline: number, amp: number): number {
  const s = ((seed * 16807) + i * 48271) % 2147483647;
  const noise = (s / 2147483647 - 0.5) * 2;
  const w = Math.sin((i / HOURS) * Math.PI * 2 + (seed % 7));
  return baseline + w * amp * 0.6 + noise * amp * 0.4;
}

const connLabel: Record<Device['conn'], string> = {
  wifi: 'Wi-Fi', wired: 'Wired', poe: 'PoE', thread: 'Thread',
};

const kindLabel: Record<Device['kind'], string> = {
  laptop: 'Laptop', desktop: 'Desktop', printer: 'Printer', payment: 'Payment',
  server: 'Server', confphone: 'ConfPhone',
  fire_sensor: 'Fire sensor', smoke_sensor: 'Smoke sensor', door_lock: 'Door lock',
  phone: 'Phone', tablet: 'Tablet', matter: 'Matter', shelly: 'Shelly', generic: 'Device',
};

/* ─────────── main component ─────────── */

export function DevicesDashboard({ devices }: { devices: Device[] }) {
  const c = useThemeColors();

  // ── KPI numbers ──
  const total      = devices.length;
  const healthy    = devices.filter((d) => d.status === 'ok').length;
  const degraded   = devices.filter((d) => d.status === 'warn').length;
  const offline    = devices.filter((d) => d.status === 'err').length;

  const wifi = devices.filter((d) => d.conn === 'wifi' && d.status !== 'err');
  // Real measured RSSI when devices report it; synthetic only as fallback.
  const realRssis = devices
    .map((d) => d.telemetry?.rssiDbm)
    .filter((x): x is number => typeof x === 'number');
  const wifiRssis = realRssis.length > 0 ? realRssis : wifi.map((d) => {
    const seed = hashId(d.id);
    const base = d.status === 'warn' ? -80 : -60;
    const amp  = d.status === 'warn' ? 4 : 5;
    return wave(seed, HOURS - 1, base, amp);
  });
  const avgRssi = wifiRssis.length
    ? Math.round(wifiRssis.reduce((s, x) => s + x, 0) / wifiRssis.length)
    : null;

  const uptimes = devices.map((d) => d.connectedForHours);
  const avgUptimeH = uptimes.length
    ? Math.round(uptimes.reduce((s, x) => s + x, 0) / uptimes.length)
    : 0;

  // ── Sparkline data (last 12 ticks) for stat panels ──
  const labels = useMemo(() => hourLabels(), []);
  const sparkLen = 12;
  const totalSpark = labels.slice(-sparkLen).map((_, i) => ({
    t: i, v: Math.max(0, Math.round(total + Math.sin(i / 3) * 0.4)),
  }));
  const offlineSpark = labels.slice(-sparkLen).map((_, i) => ({
    t: i, v: Math.max(0, Math.round(offline + (Math.sin(i / 2 + 1) > 0.4 ? 1 : 0))),
  }));
  const rssiSpark = [{ t: 0, v: avgRssi ?? 0 }];
  const uptimeSpark = labels.slice(-sparkLen).map((_, i) => ({
    t: i, v: avgUptimeH + Math.round(Math.sin(i / 4) * 2),
  }));

  const kinds = useMemo(() => [...new Set(devices.map((device) => device.kind))], [devices]);

  // ── Connection mix donut ──
  const connMix = (['wifi', 'wired', 'poe', 'thread'] as const).map((k) => ({
    key: k,
    name: connLabel[k],
    value: devices.filter((d) => d.conn === k).length,
    color: k === 'wifi' ? c.accent : k === 'wired' ? c.accent3 : k === 'poe' ? c.warn : c.accent2,
  })).filter((x) => x.value > 0);

  // ── Status × device-kind stacked bar ──
  const statusByKind = useMemo(() => {
    return kinds.map((kind) => {
      const ofKind = devices.filter((d) => d.kind === kind);
      return {
        kind: kindLabel[kind],
        Healthy:  ofKind.filter((d) => d.status === 'ok').length,
        Degraded: ofKind.filter((d) => d.status === 'warn').length,
        Offline:  ofKind.filter((d) => d.status === 'err').length,
      };
    });
  }, [devices, kinds]);

  return (
    <div className="grid" style={{ marginBottom: 12 }}>
      {/* ── stat strip ── */}
      <div className="col-12">
        <div className="dev-stats">
          <StatPanel
            label="Devices monitored"
            big={total}
            sub={`${healthy} healthy · ${degraded} degraded · ${offline} offline`}
            icon={Activity}
            color={c.accent}
            spark={totalSpark}
            sparkColor={c.accent}
          />
          <StatPanel
            label="Avg Wi-Fi RSSI"
            big={avgRssi == null ? '—' : `${avgRssi} dBm`}
            sub={avgRssi == null
              ? 'no Wi-Fi devices'
              : `${wifi.length} client${wifi.length === 1 ? '' : 's'} · target > −75 dBm`}
            icon={Wifi}
            color={avgRssi != null && avgRssi > -75 ? c.ok : avgRssi != null && avgRssi > -82 ? c.warn : c.err}
            spark={rssiSpark}
            sparkColor={c.accent2}
            unit=" dBm"
          />
          <StatPanel
            label="Avg uptime"
            big={fmtDur(avgUptimeH)}
            sub="rolling mean across selected devices"
            icon={Gauge}
            color={c.accent3}
            spark={uptimeSpark}
            sparkColor={c.accent3}
            unit=" h"
          />
          <StatPanel
            label="Offline now"
            big={offline}
            sub={offline === 0 ? 'all reachable' : `${offline} unreachable — check incidents`}
            icon={Signal}
            color={offline === 0 ? c.ok : c.err}
            spark={offlineSpark}
            sparkColor={offline === 0 ? c.ok : c.err}
          />
        </div>
      </div>

      <div className="col-8">
        <DeviceHistoryChart devices={devices} metric="rssiDbm" />
      </div>

      {/* ── Connection mix donut ── */}
      <div className="col-4">
        <Card
          title="Connection mix"
          sub="How clients reach the network — by transport"
          right={<RangeBadge label="live" />}
        >
          <div style={{ height: 260, position: 'relative' }}>
            {connMix.length === 0 ? (
              <EmptyPanel msg="No devices in the current filter." />
            ) : (
                <PieChart responsive width="100%" height="100%">
                  <Pie
                    data={connMix}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={62}
                    outerRadius={92}
                    paddingAngle={connMix.length > 1 ? 2 : 0}
                    isAnimationActive={false}
                    stroke="transparent"
                  >
                    {connMix.map((m) => <Cell key={m.key} fill={m.color} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={tooltipStyle(c)}
                    labelStyle={{ color: c.textDim, marginBottom: 4 }}
                    formatter={(v: unknown, n: unknown) => [`${v} device${v === 1 ? '' : 's'}`, String(n)]}
                  />
                </PieChart>
            )}
            {/* center label */}
            {connMix.length > 0 && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
              }}>
                <div style={{ fontSize: 26, fontWeight: 700, color: c.text, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{total}</div>
                <div style={{ fontSize: 10, color: c.textMuted, letterSpacing: '0.08em', marginTop: 4 }}>DEVICES</div>
              </div>
            )}
          </div>
          <LegendStrip items={connMix.map((m) => ({ label: `${m.name} · ${m.value}`, color: m.color }))} />
        </Card>
      </div>

      <div className="col-8">
        <DeviceHistoryChart devices={devices} metric="transferredMB" />
      </div>

      {/* ── Status by device kind ── */}
      <div className="col-4">
        <Card
          title="Health by device type"
          sub="Stacked count per kind — anything not green needs attention"
          right={<RangeBadge label="live" />}
        >
          <div style={{ height: 260 }}>
            {statusByKind.length === 0 ? (
              <EmptyPanel msg="No devices in the current filter." />
            ) : (
                <BarChart
                  responsive width="100%" height="100%"
                  layout="vertical"
                  data={statusByKind}
                  margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                  barCategoryGap={6}
                >
                  <CartesianGrid stroke={c.chartGrid} strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" stroke={c.textMuted} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="kind"
                    width={88}
                    stroke={c.textMuted}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle(c)}
                    labelStyle={{ color: c.text, marginBottom: 4, fontWeight: 600 }}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  />
                  <Bar dataKey="Healthy"  stackId="s" fill={c.ok}   radius={[3, 0, 0, 3]} />
                  <Bar dataKey="Degraded" stackId="s" fill={c.warn} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Offline"  stackId="s" fill={c.err}  radius={[0, 3, 3, 0]} />
                </BarChart>
            )}
          </div>
          <LegendStrip items={[
            { label: 'Healthy',  color: c.ok },
            { label: 'Degraded', color: c.warn },
            { label: 'Offline',  color: c.err },
          ]} />
        </Card>
      </div>
    </div>
  );
}

/* ─────────── Stat panel with sparkline ─────────── */

function StatPanel({
  label, big, sub, icon: Icon, color, spark, sparkColor, unit,
}: {
  label: string;
  big: React.ReactNode;
  sub: string;
  icon: React.ComponentType<{ size?: number }>;
  color: string;
  spark: { t: number; v: number }[];
  sparkColor: string;
  unit?: string;
}) {
  return (
    <div className="dev-stat">
      <div className="dev-stat-top">
        <span className="dev-stat-icon" style={{ color, background: `linear-gradient(135deg, ${color}33, transparent)` }}>
          <Icon size={14} />
        </span>
        <span className="dev-stat-label">{label}</span>
      </div>
      <div className="dev-stat-mid">
        <span className="dev-stat-big" style={{ color }}>
          {big}{unit && typeof big === 'number' ? <span style={{ fontSize: '0.55em', color: 'var(--text-muted)', marginLeft: 4 }}>{unit.trim()}</span> : null}
        </span>
        <div className="dev-stat-spark">
            <AreaChart responsive width="100%" height="100%" data={spark} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`sp-${label.replace(/\s+/g, '-')}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={sparkColor} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={sparkColor} strokeWidth={1.5} fill={`url(#sp-${label.replace(/\s+/g, '-')})`} isAnimationActive={false} />
            </AreaChart>
        </div>
      </div>
      <div className="dev-stat-sub">{sub}</div>
    </div>
  );
}

/* ─────────── Small helpers ─────────── */

function RangeBadge({ label }: { label: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
      padding: '4px 8px', borderRadius: 6, color: 'var(--text-muted)',
      border: '1px solid var(--border)', background: 'var(--surface-1)',
      display: 'inline-flex', alignItems: 'center', gap: 6,
    }}>
      <Radio size={10} />
      {label}
    </span>
  );
}

function EmptyPanel({ msg }: { msg: string }) {
  return (
    <div style={{
      height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--text-muted)', fontSize: 12,
    }}>{msg}</div>
  );
}

function LegendStrip({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="dev-legend">
      {items.map((it) => (
        <span key={it.label} className="dev-legend-item">
          <span className="dev-legend-swatch" style={{ background: it.color, boxShadow: `0 0 6px ${it.color}88` }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function tooltipStyle(c: ThemeColors) {
  return {
    background: c.tooltipBg,
    border: `1px solid ${c.tooltipBorder}`,
    borderRadius: 10,
    fontSize: 12,
    padding: '8px 10px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.20)',
    backdropFilter: 'blur(10px)',
  } as const;
}

function fmtDur(h: number): string {
  if (h <= 0) return '—';
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
