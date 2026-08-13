import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Radio, Sparkles, WifiOff } from 'lucide-react';
import { useThemeColors } from '../../ui/Theme';
import type { Device } from '../../types';
import type { WidgetDataState } from './WanWidget';

type Severity = 'ok' | 'info' | 'warn' | 'err';

interface Insight {
  severity: Severity;
  text: string;
}

interface TunnelSummary {
  ifname: string;
  present: boolean;
  reachable: boolean;
}

interface InsightStripProps {
  branchName: string;
  wanState?: WidgetDataState;
  /** Age of the last WAN rate sample, when the feed is stale. */
  lastRateAgeMs?: number | null;
  tunnels?: TunnelSummary[] | null;
  activeTunnel?: string | null;
  alertsCount?: number | null;
  devices: Device[];
}

function is5g(ifname: string): boolean {
  const n = ifname.toLowerCase();
  return n.includes('cell') || n.includes('5g') || n.includes('lte') || n.includes('wwan');
}

function fmtAge(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${Math.max(1, s)}s`;
  return `${Math.floor(s / 60)}m`;
}

/** Rank the current telemetry into prioritized one-liners. Pure, derived —
 *  every line here is traceable to a real observation, no invented numbers. */
function deriveInsights({
  branchName, wanState, lastRateAgeMs, tunnels, activeTunnel, alertsCount, devices,
}: InsightStripProps): Insight[] {
  const out: Insight[] = [];
  const present = (tunnels ?? []).filter((t) => t.present);
  const unreachable = present.filter((t) => !t.reachable);

  if (unreachable.length > 0) {
    out.push({
      severity: 'err',
      text: `${unreachable.length} of ${present.length} IPsec tunnels unreachable (${unreachable.map((t) => t.ifname).join(', ')}) — failover headroom reduced.`,
    });
  }
  if (activeTunnel && is5g(activeTunnel)) {
    out.push({
      severity: 'warn',
      text: `Traffic is riding the 5G underlay via ${activeTunnel} — fiber path degraded or forced.`,
    });
  }
  if (wanState === 'stale') {
    out.push({
      severity: 'warn',
      text: `WAN telemetry is stale${lastRateAgeMs ? ` (last sample ${fmtAge(lastRateAgeMs)} ago)` : ''} — showing the last derived rate.`,
    });
  }
  const attention = devices.filter((d) => d.status !== 'ok' && d.status !== 'off');
  if (attention.length > 0) {
    const names = attention.slice(0, 2).map((d) => d.name).join(', ');
    out.push({
      severity: 'warn',
      text: `${attention.length} device${attention.length > 1 ? 's' : ''} need attention: ${names}${attention.length > 2 ? '…' : ''}.`,
    });
  }
  if ((alertsCount ?? 0) > 0 && unreachable.length === 0) {
    out.push({
      severity: 'warn',
      text: `${alertsCount} active alert${alertsCount === 1 ? '' : 's'} open on ${branchName}.`,
    });
  }
  if (out.length === 0) {
    const online = devices.filter((d) => d.status === 'ok').length;
    const tunnelNote = present.length > 0 ? ` · ${present.length}/${present.length} tunnels reachable` : '';
    out.push({
      severity: 'ok',
      text: `All systems nominal on ${branchName} — ${online}/${devices.length} devices online${tunnelNote}.`,
    });
  }
  return out;
}

const SEVERITY_ICON: Record<Severity, React.ComponentType<{ size?: number }>> = {
  ok: CheckCircle2, info: Sparkles, warn: AlertTriangle, err: WifiOff,
};

/** Slim rotating insight bar under the KPI strip: prioritized, telemetry-
 *  derived one-liners with a deep link to Ask AI for the full analysis. */
export function InsightStrip(props: InsightStripProps) {
  const c = useThemeColors();
  const insights = useMemo(() => deriveInsights(props), [props]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const count = insights.length;
  useEffect(() => {
    if (paused || count < 2) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % count), 8_000);
    return () => window.clearInterval(timer);
  }, [paused, count]);

  const current = insights[Math.min(index, count - 1)];
  const tint = current.severity === 'err' ? c.err
    : current.severity === 'warn' ? c.warn
    : current.severity === 'ok' ? c.ok
    : c.accent3;
  const Icon = current.severity === 'err' && current.text.includes('5G') ? Radio : SEVERITY_ICON[current.severity];

  return (
    <div
      className="insight-strip"
      style={{ borderColor: `${tint}44` }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role="status"
      aria-live="polite"
    >
      <span className="insight-strip-badge" style={{ color: c.accent3 }}>
        <Sparkles size={13} />
        Insights
      </span>
      <span key={`${index}-${current.text}`} className="insight-strip-msg" style={{ color: 'var(--text-dim)' }}>
        <span style={{ color: tint, display: 'inline-flex', alignItems: 'center', marginRight: 7, verticalAlign: '-2px' }}>
          <Icon size={13} />
        </span>
        {current.text}
      </span>
      {count > 1 && (
        <span className="insight-strip-dots">
          {insights.map((ins, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Insight ${i + 1} of ${count}`}
              className={`insight-strip-dot${i === index ? ' on' : ''}`}
              onClick={() => setIndex(i)}
              style={i === index ? { background: tint } : undefined}
              title={ins.text}
            />
          ))}
        </span>
      )}
      <Link to="/ask-ai" className="insight-strip-link">
        Ask AI →
      </Link>
    </div>
  );
}
