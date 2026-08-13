import {
  Activity, ArrowDown, ArrowUp, Building2, Cpu, ShieldAlert,
  TrendingUp, TrendingDown,
} from 'lucide-react';
import { Sparkline } from './Sparkline';
import { branches, fleetStats } from '../../data/mock';
import { useThemeColors } from '../../ui/Theme';
import { useLiveData } from '../../ui/LiveData';
import { AnimatedNumber } from '../../ui/AnimatedNumber';
import type { WidgetDataState } from './WanWidget';
import type { WanDirectionalRate } from '../../types';

interface Kpi {
  label: string;
  /** Numeric "raw" value that drives the animated counter. */
  num: number;
  /** Formatter that turns the numeric value into the displayed string. */
  format: (n: number) => string;
  icon: React.ComponentType<{ size?: number }>;
  delta: number;
  series: number[];
  accentKey: 'accent' | 'accent2' | 'accent3' | 'ok' | 'warn' | 'err';
  /** When provided, the card becomes clickable. */
  onClick?: () => void;
}

const sineSeries = (n: number, base: number, noise: number, seed = 0) =>
  Array.from({ length: n }, (_, i) => {
    const wave = Math.sin((i + seed) / 2) * noise;
    const drift = Math.sin((i + seed) / 6) * (noise * 0.4);
    return Math.max(0, Math.round(base + wave + drift));
  });

function hexAlpha(hex: string, a: number) {
  if (!hex.startsWith('#') || (hex.length !== 7 && hex.length !== 4)) return hex;
  const v = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
  const r = parseInt(v.slice(1,3), 16), g = parseInt(v.slice(3,5), 16), b = parseInt(v.slice(5,7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function hashSeed(s: string): number {
  let h = 0;
  for (const ch of s) h = ((h * 31) + ch.charCodeAt(0)) >>> 0;
  return h;
}

export function KpiStrip({
  branchId, liveWanTraffic, liveAlertsCount, livePlanoMode,
}: {
  branchId?: string;
  /** Latest valid directional rate from one exact branch/topic. */
  liveWanTraffic?: {
    rate: WanDirectionalRate | null;
    state: WidgetDataState;
    interfaceName?: string | null;
  };
  /** Optional override = count of tunnels present but unreachable. */
  liveAlertsCount?: number | null;
  /** When viewing Plano with a live IPsec feed, scope the fleet-style "branches
   *  online / devices online" cards to the single gateway we actually have
   *  telemetry for, and make the gateway card clickable. */
  livePlanoMode?: {
    gatewayOnline: boolean;
    onGatewayClick: () => void;
  };
}) {
  const c = useThemeColors();
  const { throughputMbps: liveThroughput } = useLiveData();

  // When a branch is selected, every KPI is scoped to that branch (devices,
  // alerts, uptime, throughput). Otherwise fall back to fleet-wide stats.
  const stats = branchId ? fleetStats[branchId] : undefined;
  const seed = branchId ? hashSeed(branchId) : 0;

  // Legacy fallback is used only for branches with no configured live WAN
  // source. A configured live source never falls back to synthetic traffic.
  const throughputValue = stats ? stats.throughputMbps : liveThroughput;
  const throughputSeries = stats
    ? stats.throughputSeries
    : sineSeries(12, 400, 80, seed);

  // Live alerts override (e.g. count of unreachable tunnels for Plano).
  const alertsValue =
    liveAlertsCount != null ? liveAlertsCount
    : stats?.openAlerts ?? 0;

  // Deltas: drive them from healthScore so degraded branches show down-arrows
  // for uptime, and "no change" reads naturally for healthy ones.
  const uptimeDelta = stats
    ? +((stats.healthScore - 0.92) * 100).toFixed(2)
    : 0.04;
  const devicesDelta = stats
    ? +((stats.devicesOnline / stats.totalDevices - 0.95) * 100).toFixed(1)
    : 1.2;
  const alertsDelta =
    liveAlertsCount != null ? (liveAlertsCount === 0 ? -100 : 0)
    : stats ? (stats.openAlerts === 0 ? -100 : 0)
    : -25;

  const onlineBranches = Object.values(fleetStats).filter((s) => s.status !== 'off').length;
  const throughputDelta = 8.4;

  const total = stats?.totalDevices ?? 0;
  const kpis: Kpi[] = [
    livePlanoMode
      ? {
          // Only one branch has live telemetry, so the fleet "11 / 11" is
          // misleading — collapse to "1 / 1" for the live branch.
          label: 'Branches online',
          num: 1,
          format: () => '1/1',
          icon: Building2, delta: 0,
          series: [1,1,1,1,1,1,1,1,1,1,1,1],
          accentKey: 'accent',
        }
      : {
          label: 'Branches online',
          num: onlineBranches,
          format: (n) => `${Math.round(n)}/${branches.length}`,
          icon: Building2, delta: 0,
          series: [4,5,5,5,5,5,5,5,5,5,5,5],
          accentKey: 'accent',
        },
    livePlanoMode
      ? {
          // In live-Plano mode this card represents "the gateway itself" and
          // becomes clickable — opens a modal listing its connected devices.
          label: 'Gateway online',
          num: livePlanoMode.gatewayOnline ? 1 : 0,
          format: (n) => `${Math.round(n)}/1`,
          icon: Cpu, delta: livePlanoMode.gatewayOnline ? 0 : -100,
          series: livePlanoMode.gatewayOnline
            ? [1,1,1,1,1,1,1,1,1,1,1,1]
            : [0,0,0,0,0,0,0,0,0,0,0,0],
          accentKey: livePlanoMode.gatewayOnline ? 'ok' : 'err',
          onClick: livePlanoMode.onGatewayClick,
        }
      : {
          label: 'Devices online',
          num: stats?.devicesOnline ?? 0,
          format: (n) => stats ? `${Math.round(n)}/${total}` : '—',
          icon: Cpu, delta: devicesDelta,
          series: sineSeries(12, stats?.devicesOnline ?? 14, 1, seed),
          accentKey: 'accent2',
        },
    {
      label: 'Active alerts',
      num: alertsValue,
      format: (n) => String(Math.round(n)),
      icon: ShieldAlert, delta: alertsDelta,
      series: sineSeries(12, Math.max(1, alertsValue) * 1.4, 0.8, seed + 1),
      accentKey: alertsValue > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Avg uptime (30d)',
      num: stats?.uptimePct ?? 99.92,
      format: (n) => `${n.toFixed(2)}%`,
      icon: Activity, delta: uptimeDelta,
      series: sineSeries(12, stats ? stats.uptimePct : 99, 0.4, seed + 2),
      accentKey: 'ok',
    },
    ...(!liveWanTraffic ? [{
      label: 'Throughput',
      num: throughputValue,
      format: (n: number) => {
        if (n < 0.001) return '—';
        if (n < 1) return `${(n * 1000).toFixed(0)} Kbps`;
        if (n < 10) return `${n.toFixed(2)} Mbps`;
        return `${Math.round(n)} Mbps`;
      },
      icon: TrendingUp,
      delta: throughputDelta,
      series: throughputSeries,
      accentKey: 'accent3' as const,
    }] : []),
  ];
  return (
    <div className="kpi-strip">
      {kpis.map((k) => {
        const Icon = k.icon;
        const Trend = k.delta >= 0 ? TrendingUp : TrendingDown;
        const trendColor = k.delta === 0 ? c.textMuted
          : (k.label === 'Active alerts'
              ? (k.delta < 0 ? c.ok : c.err)
              : (k.delta > 0 ? c.ok : c.err));
        const accent = c[k.accentKey];
        const clickable = !!k.onClick;
        return (
          <div key={k.label} className="kpi-card"
            onClick={k.onClick}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') k.onClick?.(); } : undefined}
            style={clickable ? { cursor: 'pointer' } : undefined}
            title={clickable ? 'Click to view connected devices' : undefined}
          >
            <div className="kpi-top">
              <div className="kpi-icon" style={{ background: `linear-gradient(135deg, ${hexAlpha(accent, 0.22)}, transparent)`, color: accent }}>
                <Icon size={16} />
              </div>
              <div className="kpi-label">{k.label}</div>
            </div>
            <div className="kpi-mid">
              <div className="kpi-value">
                <AnimatedNumber value={k.num} format={k.format} />
              </div>
              <div className="kpi-spark">
                <Sparkline values={k.series} stroke={accent} fill={hexAlpha(accent, 0.18)} width={88} height={32} />
              </div>
            </div>
            <div className="kpi-trend" style={{ color: trendColor }}>
              <Trend size={11} />
              <span>{k.delta === 0 ? 'no change' : `${k.delta > 0 ? '+' : ''}${k.delta}%`}</span>
              <span className="kpi-trend-sub">vs last 24h</span>
            </div>
          </div>
        );
      })}
      {liveWanTraffic && (
        <WanTrafficKpi
          rate={liveWanTraffic.rate}
          state={liveWanTraffic.state}
          interfaceName={liveWanTraffic.interfaceName}
        />
      )}
    </div>
  );
}

function formatWanRate(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value < 0.01) return value === 0 ? '0.00' : '<0.01';
  if (value < 10) return value.toFixed(2);
  if (value < 1_000) return value.toFixed(1);
  return Math.round(value).toLocaleString();
}

function WanTrafficKpi({
  rate,
  state,
  interfaceName,
}: {
  rate: WanDirectionalRate | null;
  state: WidgetDataState;
  interfaceName?: string | null;
}) {
  const c = useThemeColors();
  const showRate = state === 'live' && rate !== null;
  const meta = showRate
    ? `${interfaceName || 'WAN interface'} · latest ${formatInterval(rate.spanSeconds)} counter interval`
    : state === 'stale'
        ? 'WAN telemetry is stale'
        : state === 'loading'
          ? 'Waiting for the next gateway counter sample…'
          : 'WAN telemetry unavailable';

  return (
    <div className="kpi-card kpi-wan-card">
      <div className="kpi-top">
        <div
          className="kpi-icon"
          style={{
            background: `linear-gradient(135deg, ${hexAlpha(c.accent3, 0.22)}, transparent)`,
            color: c.accent3,
          }}
        >
          <Activity size={16} />
        </div>
        <div className="kpi-label">WAN traffic</div>
        <span className="kpi-window-label">live rate</span>
      </div>
      <div
        className="kpi-wan-rates"
        aria-label={showRate
          ? `Download ${formatWanRate(rate.rxMbps)} megabits per second; upload ${formatWanRate(rate.txMbps)} megabits per second`
          : meta}
      >
        <div className="kpi-wan-rate">
          <ArrowDown size={14} aria-hidden="true" />
          <span className="kpi-wan-number">{showRate ? formatWanRate(rate.rxMbps) : '—'}</span>
          <span className="kpi-wan-unit">Mbps</span>
        </div>
        <div className="kpi-wan-rate kpi-wan-rate-up">
          <ArrowUp size={14} aria-hidden="true" />
          <span className="kpi-wan-number">{showRate ? formatWanRate(rate.txMbps) : '—'}</span>
          <span className="kpi-wan-unit">Mbps</span>
        </div>
      </div>
      <div className="kpi-wan-meta">{meta}</div>
    </div>
  );
}

function formatInterval(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}
