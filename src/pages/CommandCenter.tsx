import { useEffect, useMemo, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import {
  Activity, AlertTriangle, Building2, DollarSign, Download, Gauge, Laptop,
  Pencil, Plus, Trash2, Tv, Zap,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { Sparkline } from '../components/widgets/Sparkline';
import { AiInsightCard } from '../components/widgets/AiInsightCard';
import { AnimatedNumber } from '../ui/AnimatedNumber';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { useTheme, useThemeColors } from '../ui/Theme';
import { branches, fleetStats, getCostInsightsForBranch } from '../data/mock';
import type { Branch, FleetStat, Status } from '../types';

/* ─────────── Executive Command Center
 * Fleet-wide posture for executives: a pulse strip of headline KPIs, a
 * head-to-head comparison of 2-5 branches with the best/worst value per
 * metric highlighted against a fleet-average reference column, and a grid
 * of user-defined KPI cards with warn/critical thresholds (persisted per
 * browser). "Export PDF" prints the page through the app's print styles —
 * dark theme is temporarily flipped to light so charts render ink-friendly. */

const fmtUsd = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : `$${n.toLocaleString()}`;
const fmtUsdFull = (n: number) => `$${n.toLocaleString()}`;

/* Cost figures are deterministic per branch (scaled mock data), so compute
 * them once at module load instead of on every render. */
const COST_BY_BRANCH: Record<string, { monthlySavedUsd: number; paybackMonths: number }> =
  Object.fromEntries(
    branches.map((b) => {
      const ci = getCostInsightsForBranch(b.id);
      return [b.id, {
        monthlySavedUsd: ci.categories.reduce((s, c) => s + c.monthSavedUsd, 0),
        paybackMonths: ci.roi.paybackPeriodMonths,
      }];
    }),
  );

type MetricId = 'health' | 'uptime' | 'alerts' | 'throughput' | 'devices' | 'savings';

interface MetricDef {
  label: string;
  icon: ComponentType<{ size?: number }>;
  /** Direction of "good" — drives best/worst ranking and threshold breaches. */
  higherIsBetter: boolean;
  /** How the metric aggregates fleet-wide in custom KPI cards. */
  fleetAgg: 'avg' | 'total';
  format: (n: number) => string;
}

const METRICS: Record<MetricId, MetricDef> = {
  health:     { label: 'Health score',    icon: Gauge,         higherIsBetter: true,  fleetAgg: 'avg',   format: (n) => `${Math.round(n)}` },
  uptime:     { label: 'Uptime',          icon: Activity,      higherIsBetter: true,  fleetAgg: 'avg',   format: (n) => `${n.toFixed(2)}%` },
  alerts:     { label: 'Open alerts',     icon: AlertTriangle, higherIsBetter: false, fleetAgg: 'total', format: (n) => `${Math.round(n)}` },
  throughput: { label: 'Throughput',      icon: Zap,           higherIsBetter: true,  fleetAgg: 'total', format: (n) => `${Math.round(n)} Mbps` },
  devices:    { label: 'Devices online',  icon: Laptop,        higherIsBetter: true,  fleetAgg: 'total', format: (n) => `${Math.round(n)}` },
  savings:    { label: 'Monthly savings', icon: DollarSign,    higherIsBetter: true,  fleetAgg: 'total', format: fmtUsd },
};

function metricValue(id: MetricId, scope: string): number {
  const ids = scope === 'fleet' ? branches.map((b) => b.id) : [scope];
  const vals = ids.map((bid) => {
    const s = fleetStats[bid];
    if (!s) return 0;
    switch (id) {
      case 'health':     return s.healthScore * 100;
      case 'uptime':     return s.uptimePct;
      case 'alerts':     return s.openAlerts;
      case 'throughput': return s.throughputMbps;
      case 'devices':    return s.devicesOnline;
      case 'savings':    return COST_BY_BRANCH[bid]?.monthlySavedUsd ?? 0;
    }
  });
  const sum = vals.reduce((a, v) => a + v, 0);
  return METRICS[id].fleetAgg === 'avg' ? sum / Math.max(1, vals.length) : sum;
}

/** 24h series behind a KPI card — only throughput has real history in mock. */
function metricSeries(id: MetricId, scope: string): number[] | null {
  if (id !== 'throughput') return null;
  if (scope !== 'fleet') return fleetStats[scope]?.throughputSeries ?? null;
  const all = branches.map((b) => fleetStats[b.id]).filter(Boolean);
  if (all.length === 0) return null;
  const len = Math.min(...all.map((s) => s.throughputSeries.length));
  return Array.from({ length: len }, (_, i) => all.reduce((a, s) => a + (s.throughputSeries[i] ?? 0), 0));
}

/* ─── Custom KPI cards — persisted per browser ─── */

interface CustomKpi {
  id: string;
  metric: MetricId;
  scope: string;            // 'fleet' | branch id
  label?: string;
  warn?: number;
  crit?: number;
}

const KPI_KEY = 'ce-ecc-kpis-v1';
const COMPARE_KEY = 'ce-ecc-compare-v1';
const DEFAULT_COMPARE = ['b-dal-hq', 'b-pln-01', 'b-mck-03'];

const newKpiId = () => `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function loadKpis(): CustomKpi[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const arr: unknown = JSON.parse(localStorage.getItem(KPI_KEY) ?? '[]');
    if (!Array.isArray(arr)) return [];
    return arr.filter((k): k is CustomKpi => {
      if (!k || typeof k !== 'object') return false;
      const c = k as Partial<CustomKpi>;
      return typeof c.id === 'string'
        && typeof c.metric === 'string' && c.metric in METRICS
        && typeof c.scope === 'string' && (c.scope === 'fleet' || !!fleetStats[c.scope])
        && (c.label === undefined || typeof c.label === 'string')
        && (c.warn === undefined || typeof c.warn === 'number')
        && (c.crit === undefined || typeof c.crit === 'number');
    });
  } catch { return []; }
}

function loadCompare(): string[] {
  if (typeof localStorage === 'undefined') return DEFAULT_COMPARE;
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(COMPARE_KEY) ?? 'null');
    if (Array.isArray(ids)) {
      const valid = ids.filter((x): x is string => typeof x === 'string' && !!fleetStats[x]);
      if (valid.length >= 2 && valid.length <= 5) return valid;
    }
  } catch { /* fall through to default */ }
  return DEFAULT_COMPARE;
}

function kpiStatus(k: CustomKpi, value: number): Status {
  const higher = METRICS[k.metric].higherIsBetter;
  const breached = (t: number) => (higher ? value < t : value > t);
  if (k.crit !== undefined && breached(k.crit)) return 'err';
  if (k.warn !== undefined && breached(k.warn)) return 'warn';
  return 'ok';
}

const scopeName = (scope: string) =>
  scope === 'fleet' ? 'Fleet-wide' : branches.find((b) => b.id === scope)?.name ?? scope;

const autoLabel = (metric: MetricId, scope: string) => `${METRICS[metric].label} · ${scopeName(scope)}`;

/* ─────────── Page ─────────── */

export function CommandCenterPage() {
  const toast = useToast();
  const { theme, setTheme } = useTheme();
  const [compareIds, setCompareIds] = useState<string[]>(loadCompare);
  const [kpis, setKpis] = useState<CustomKpi[]>(loadKpis);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CustomKpi | null>(null);

  /* ─── Wall mode: chrome-free kiosk view for NOC/TV displays ─── */
  const [wallMode, setWallMode] = useState(false);
  const [spotlightIdx, setSpotlightIdx] = useState(0);

  // Chrome collapse is CSS-driven off a root attribute, mirroring the
  // existing data-sidebar-collapsed pattern.
  useEffect(() => {
    const root = document.documentElement;
    if (wallMode) root.setAttribute('data-wall-mode', 'true');
    else root.removeAttribute('data-wall-mode');
    return () => root.removeAttribute('data-wall-mode');
  }, [wallMode]);

  // Browser fullscreen follows the toggle. Esc exits fullscreen, which the
  // fullscreenchange listener translates into leaving wall mode; the keydown
  // fallback covers environments where the fullscreen request was denied.
  useEffect(() => {
    if (!wallMode) return;
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => { /* wall mode still works un-fullscreened */ });
    }
    const onFsChange = () => { if (!document.fullscreenElement) setWallMode(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setWallMode(false); };
    document.addEventListener('fullscreenchange', onFsChange);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      window.removeEventListener('keydown', onKey);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => { /* ignore */ });
    };
  }, [wallMode]);

  // Rotate the spotlighted branch every 15s while on the wall.
  useEffect(() => {
    if (!wallMode) return;
    const timer = window.setInterval(
      () => setSpotlightIdx((i) => (i + 1) % branches.length),
      15_000,
    );
    return () => window.clearInterval(timer);
  }, [wallMode]);

  useEffect(() => {
    try { localStorage.setItem(COMPARE_KEY, JSON.stringify(compareIds)); } catch { /* ignore quota */ }
  }, [compareIds]);
  useEffect(() => {
    try { localStorage.setItem(KPI_KEY, JSON.stringify(kpis)); } catch { /* ignore quota */ }
  }, [kpis]);

  const fleet = useMemo(() => {
    const all = branches.map((b) => fleetStats[b.id]).filter(Boolean);
    const okBranches = all.filter((s) => s.status === 'ok').length;
    return {
      branchCount: all.length,
      okBranches,
      avgUptime: all.reduce((a, s) => a + s.uptimePct, 0) / Math.max(1, all.length),
      openAlerts: all.reduce((a, s) => a + s.openAlerts, 0),
      throughput: all.reduce((a, s) => a + s.throughputMbps, 0),
      throughputSeries: metricSeries('throughput', 'fleet') ?? [],
      monthlySavings: branches.reduce((a, b) => a + (COST_BY_BRANCH[b.id]?.monthlySavedUsd ?? 0), 0),
    };
  }, []);

  const insightData = useMemo(() => ({
    view: 'Executive Command Center',
    fleet: {
      branches: fleet.branchCount,
      healthyBranches: fleet.okBranches,
      avgUptimePct: +fleet.avgUptime.toFixed(2),
      openAlerts: fleet.openAlerts,
      totalThroughputMbps: fleet.throughput,
      annualSavingsRunRateUsd: fleet.monthlySavings * 12,
    },
    comparedBranches: compareIds.map((id) => {
      const b = branches.find((x) => x.id === id);
      const s = fleetStats[id];
      return {
        name: b?.name, location: b?.location, status: s?.status,
        healthScore: s?.healthScore, uptimePct: s?.uptimePct,
        devicesOnline: s ? `${s.devicesOnline}/${s.totalDevices}` : undefined,
        openAlerts: s?.openAlerts, throughputMbps: s?.throughputMbps,
        monthlySavingsUsd: COST_BY_BRANCH[id]?.monthlySavedUsd,
        roiPaybackMonths: COST_BY_BRANCH[id]?.paybackMonths,
      };
    }),
  }), [compareIds, fleet]);

  const toggleBranch = (id: string) => {
    const selected = compareIds.includes(id);
    if (selected && compareIds.length <= 2) {
      toast.push({ kind: 'warn', title: 'Keep at least 2 branches', detail: 'A comparison needs two or more branches.' });
      return;
    }
    if (!selected && compareIds.length >= 5) {
      toast.push({ kind: 'warn', title: 'Compare up to 5 branches', detail: 'Remove a branch before adding another.' });
      return;
    }
    setCompareIds(selected ? compareIds.filter((x) => x !== id) : [...compareIds, id]);
  };

  /* Print through the browser's PDF path. Dark theme prints poorly (and the
   * charts take their colors from JS, not CSS), so flip to light for the
   * print pass and restore afterwards. */
  const exportPdf = () => {
    if (theme === 'dark') {
      const restore = () => {
        setTheme('dark');
        window.removeEventListener('afterprint', restore);
      };
      window.addEventListener('afterprint', restore);
      setTheme('light');
      window.setTimeout(() => window.print(), 150);
    } else {
      window.print();
    }
  };

  const openAdd = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (k: CustomKpi) => { setEditing(k); setModalOpen(true); };

  const saveKpi = (k: CustomKpi) => {
    const isEdit = kpis.some((x) => x.id === k.id);
    setKpis(isEdit ? kpis.map((x) => (x.id === k.id ? k : x)) : [...kpis, k]);
    setModalOpen(false);
    toast.push({ kind: 'success', title: isEdit ? 'KPI card updated' : 'KPI card added', detail: k.label ?? autoLabel(k.metric, k.scope) });
  };

  const removeKpi = (id: string) => {
    const k = kpis.find((x) => x.id === id);
    setKpis(kpis.filter((x) => x.id !== id));
    toast.push({ kind: 'info', title: 'KPI card removed', detail: k ? (k.label ?? autoLabel(k.metric, k.scope)) : undefined });
  };

  const comparedNames = compareIds.map((id) => branches.find((b) => b.id === id)?.name ?? id).join(', ');

  return (
    <>
      <PageHeader
        title="Executive Command Center"
        subtitle={`Fleet posture, head-to-head branch comparison, and your own KPI cards · ${fleet.okBranches}/${fleet.branchCount} branches healthy`}
        right={
          <div className="toolbar ecc-no-print">
            <button
              onClick={() => setWallMode((w) => !w)}
              title="Chrome-free fullscreen view for NOC / TV displays — rotates through branches"
              style={wallMode ? { background: 'var(--grad-accent-soft)', borderColor: 'var(--accent)' } : undefined}
            >
              <Tv size={14} />{wallMode ? 'Exit wall' : 'Wall mode'}
            </button>
            <button className="primary" onClick={exportPdf}><Download size={14} />Export PDF</button>
          </div>
        }
      />

      {/* Rotating branch spotlight — wall mode only; the key remount restarts
          the entry animation and the 15s progress bar in step with rotation. */}
      {wallMode && (
        <WallSpotlight
          key={spotlightIdx}
          branch={branches[spotlightIdx % branches.length]}
        />
      )}

      {/* Only visible on the printed report */}
      <div className="ecc-print-header">
        <div style={{ fontSize: 20, fontWeight: 700 }}>Connected Enterprise — Executive Command Center</div>
        <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
          Generated {new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · Comparing {comparedNames}
        </div>
      </div>

      <div className="kpi-strip" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <ExecKpi label="Branches healthy" num={fleet.okBranches} format={(n) => `${Math.round(n)}/${fleet.branchCount}`}
          icon={Building2} colorVar={fleet.okBranches === fleet.branchCount ? 'var(--ok)' : 'var(--warn)'}
          rgbVar={fleet.okBranches === fleet.branchCount ? '--ok-rgb' : '--warn-rgb'} sub="fleet status roll-up" />
        <ExecKpi label="Fleet uptime" num={fleet.avgUptime} format={(n) => `${n.toFixed(2)}%`}
          icon={Activity} colorVar="var(--accent)" rgbVar="--accent-rgb" sub="30-day average across branches" />
        <ExecKpi label="Open alerts" num={fleet.openAlerts} format={(n) => `${Math.round(n)}`}
          icon={AlertTriangle} colorVar={fleet.openAlerts > 0 ? 'var(--warn)' : 'var(--ok)'}
          rgbVar={fleet.openAlerts > 0 ? '--warn-rgb' : '--ok-rgb'} sub="fleet-wide, all severities" />
        <ExecKpi label="Fleet throughput" num={fleet.throughput} format={(n) => `${Math.round(n)} Mbps`}
          icon={Zap} colorVar="var(--accent)" rgbVar="--accent-rgb" sub="sum of branch WAN throughput"
          series={fleet.throughputSeries} />
        <ExecKpi label="Annual savings" num={fleet.monthlySavings * 12} format={fmtUsd}
          icon={DollarSign} colorVar="var(--ok)" rgbVar="--ok-rgb" sub="run-rate across all branches" />
      </div>

      <div style={{ marginBottom: 16 }}>
        <AiInsightCard
          topic="fleet"
          title="AI executive briefing"
          subtitle="CIO-level readout of the fleet and your selected branches"
          data={insightData}
        />
      </div>

      <div className="grid">
        <div className="col-12">
          <Card
            title="Branch comparison"
            sub="Side-by-side KPIs — the best value per row leads, laggards are tinted"
            right={<span className="badge">{compareIds.length} of 5</span>}
          >
            <div className="ecc-chips ecc-no-print">
              <span className="ecc-chips-label">Compare</span>
              {branches.map((b) => {
                const on = compareIds.includes(b.id);
                const s = fleetStats[b.id];
                return (
                  <button key={b.id} type="button" className={`ecc-chip ${on ? 'on' : ''}`} aria-pressed={on}
                    onClick={() => toggleBranch(b.id)}>
                    <span className={`dot ${s?.status ?? 'off'}`} />{b.name}
                  </button>
                );
              })}
            </div>
            <CompareTable ids={compareIds} />
          </Card>
        </div>

        <div className="col-12">
          <Card
            title="Custom KPIs"
            sub="Your own metric cards with warn and critical thresholds — stored in this browser"
            right={
              <div className="toolbar ecc-no-print">
                <button className="primary" onClick={openAdd}><Plus size={14} />Add KPI card</button>
              </div>
            }
          >
            {kpis.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                No custom KPIs yet — add a card to track the numbers you care about.
              </div>
            )}
            <div className="ecc-kpi-grid">
              {kpis.map((k) => (
                <CustomKpiCard key={k.id} k={k} onEdit={() => openEdit(k)} onRemove={() => removeKpi(k.id)} />
              ))}
              <button type="button" className="ecc-kpi-add ecc-no-print" onClick={openAdd}>
                <Plus size={18} />
                <span>Add KPI card</span>
              </button>
            </div>
          </Card>
        </div>
      </div>

      {modalOpen && (
        <KpiModal
          key={editing?.id ?? 'new'}
          initial={editing}
          onClose={() => setModalOpen(false)}
          onSave={saveKpi}
        />
      )}
    </>
  );
}

/* ─────────── Wall-mode branch spotlight ─────────── */

function WallSpotlight({ branch }: { branch: Branch }) {
  const c = useThemeColors();
  const s = fleetStats[branch.id];
  if (!s) return null;
  const statusColor = s.status === 'ok' ? c.ok : s.status === 'warn' ? c.warn : c.err;
  return (
    <div className="wall-spotlight">
      <div className="wall-spotlight-head">
        <span
          className="wall-spotlight-dot"
          style={{ background: statusColor, boxShadow: `0 0 14px ${statusColor}` }}
        />
        <div>
          <div className="wall-spotlight-name">{branch.name}</div>
          <div className="wall-spotlight-loc">{branch.location} · {branch.gatewayModel}</div>
        </div>
      </div>
      <div className="wall-spotlight-stats">
        <WallStat label="Health" value={`${Math.round(s.healthScore * 100)}`} tone={statusColor} />
        <WallStat label="Uptime 30d" value={`${s.uptimePct.toFixed(2)}%`} />
        <WallStat label="Devices" value={`${s.devicesOnline}/${s.totalDevices}`} />
        <WallStat label="Alerts" value={`${s.openAlerts}`} tone={s.openAlerts > 0 ? c.warn : c.ok} />
        <WallStat label="Throughput" value={`${s.throughputMbps} Mbps`} />
      </div>
      <div className="wall-spotlight-spark">
        <Sparkline
          values={s.throughputSeries}
          width={220}
          height={44}
          stroke={c.accent}
          fill="rgba(var(--accent-rgb) / 0.16)"
        />
      </div>
      <div className="wall-spotlight-progress" />
    </div>
  );
}

function WallStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="wall-stat">
      <div className="wall-stat-label">{label}</div>
      <div className="wall-stat-value" style={tone ? { color: tone } : undefined}>{value}</div>
    </div>
  );
}

/* ─────────── Exec pulse KPI tile ─────────── */

function ExecKpi({ label, num, format, icon: Icon, colorVar, rgbVar, sub, series }: {
  label: string;
  num: number;
  format: (n: number) => string;
  icon: ComponentType<{ size?: number }>;
  colorVar: string;
  rgbVar: string;
  sub?: string;
  series?: number[];
}) {
  const c = useThemeColors();
  return (
    <div className="kpi-card">
      <div className="kpi-top">
        <div className="kpi-icon" style={{ color: colorVar, background: `linear-gradient(135deg, rgba(var(${rgbVar}) / 0.18), transparent)` }}>
          <Icon size={16} />
        </div>
        <div className="kpi-label">{label}</div>
      </div>
      <div className="kpi-mid">
        <div className="kpi-value"><AnimatedNumber value={num} format={format} /></div>
        {series && series.length > 1 && (
          <div className="kpi-spark">
            <Sparkline values={series} stroke={c.accent} fill="rgba(var(--accent-rgb) / 0.18)" width={88} height={32} />
          </div>
        )}
      </div>
      {sub && <div className="kpi-trend-sub" style={{ fontSize: 11 }}>{sub}</div>}
    </div>
  );
}

/* ─────────── Branch comparison table ─────────── */

interface Sel { b: Branch; s: FleetStat }

interface CompareRow {
  key: string;
  label: string;
  icon?: ComponentType<{ size?: number }>;
  /** Ranking values per branch id — presence enables best/worst highlighting. */
  rank?: Record<string, number>;
  higherIsBetter?: boolean;
  cell: (e: Sel) => ReactNode;
  fleet: ReactNode;
}

function CompareTable({ ids }: { ids: string[] }) {
  const c = useThemeColors();
  const sel: Sel[] = ids
    .map((id) => ({ b: branches.find((x) => x.id === id), s: fleetStats[id] }))
    .filter((x): x is Sel => !!x.b && !!x.s);
  const all = branches.map((b) => fleetStats[b.id]).filter(Boolean);
  const showWorst = sel.length >= 3;

  const avg = (f: (s: FleetStat) => number) => all.reduce((a, s) => a + f(s), 0) / Math.max(1, all.length);
  const rankOf = (f: (s: FleetStat) => number) => Object.fromEntries(sel.map((e) => [e.b.id, f(e.s)]));

  // Best/worst per row; ties get no highlight, worst only shows for 3+ branches.
  const marks = (rank: Record<string, number>, higher: boolean) => {
    const vals = Object.values(rank);
    const bestV = higher ? Math.max(...vals) : Math.min(...vals);
    const worstV = higher ? Math.min(...vals) : Math.max(...vals);
    if (bestV === worstV) return { best: new Set<string>(), worst: new Set<string>() };
    return {
      best: new Set(Object.keys(rank).filter((k) => rank[k] === bestV)),
      worst: showWorst ? new Set(Object.keys(rank).filter((k) => rank[k] === worstV)) : new Set<string>(),
    };
  };

  const avgPayback = branches.reduce((a, b) => a + (COST_BY_BRANCH[b.id]?.paybackMonths ?? 0), 0) / Math.max(1, branches.length);
  const avgSavings = branches.reduce((a, b) => a + (COST_BY_BRANCH[b.id]?.monthlySavedUsd ?? 0), 0) / Math.max(1, branches.length);

  const rows: CompareRow[] = [
    {
      key: 'status', label: 'Status',
      cell: (e) => <StatusBadge status={e.s.status} />,
      fleet: `${all.filter((s) => s.status === 'ok').length}/${all.length} healthy`,
    },
    {
      key: 'health', label: 'Health score', icon: Gauge, higherIsBetter: true,
      rank: rankOf((s) => s.healthScore),
      cell: (e) => <HealthCell score={e.s.healthScore} status={e.s.status} />,
      fleet: `${Math.round(avg((s) => s.healthScore) * 100)}`,
    },
    {
      key: 'uptime', label: 'Uptime (30d)', icon: Activity, higherIsBetter: true,
      rank: rankOf((s) => s.uptimePct),
      cell: (e) => <span className="mono" style={{ fontVariantNumeric: 'tabular-nums' }}>{e.s.uptimePct.toFixed(2)}%</span>,
      fleet: `${avg((s) => s.uptimePct).toFixed(2)}%`,
    },
    {
      key: 'devices', label: 'Devices online', icon: Laptop, higherIsBetter: true,
      rank: rankOf((s) => s.devicesOnline / Math.max(1, s.totalDevices)),
      cell: (e) => <span className="mono" style={{ fontVariantNumeric: 'tabular-nums' }}>{e.s.devicesOnline}/{e.s.totalDevices}</span>,
      fleet: `${Math.round(avg((s) => s.devicesOnline))}/${Math.round(avg((s) => s.totalDevices))}`,
    },
    {
      key: 'alerts', label: 'Open alerts', icon: AlertTriangle, higherIsBetter: false,
      rank: rankOf((s) => s.openAlerts),
      cell: (e) => e.s.openAlerts > 0
        ? <span className="badge warn">{e.s.openAlerts}</span>
        : <span className="badge ok">0</span>,
      fleet: avg((s) => s.openAlerts).toFixed(1),
    },
    {
      key: 'throughput', label: 'Throughput', icon: Zap, higherIsBetter: true,
      rank: rankOf((s) => s.throughputMbps),
      cell: (e) => <span className="mono" style={{ fontVariantNumeric: 'tabular-nums' }}>{e.s.throughputMbps} Mbps</span>,
      fleet: `${Math.round(avg((s) => s.throughputMbps))} Mbps`,
    },
    {
      key: 'trend', label: '24h trend',
      cell: (e) => <Sparkline values={e.s.throughputSeries} width={80} height={26} stroke={c.accent} />,
      fleet: '—',
    },
    {
      key: 'savings', label: 'Monthly savings', icon: DollarSign, higherIsBetter: true,
      rank: Object.fromEntries(sel.map((e) => [e.b.id, COST_BY_BRANCH[e.b.id]?.monthlySavedUsd ?? 0])),
      cell: (e) => <span className="mono" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtUsdFull(COST_BY_BRANCH[e.b.id]?.monthlySavedUsd ?? 0)}</span>,
      fleet: fmtUsdFull(Math.round(avgSavings)),
    },
    {
      key: 'payback', label: 'ROI payback', icon: DollarSign, higherIsBetter: false,
      rank: Object.fromEntries(sel.map((e) => [e.b.id, COST_BY_BRANCH[e.b.id]?.paybackMonths ?? 0])),
      cell: (e) => <span className="mono" style={{ fontVariantNumeric: 'tabular-nums' }}>{(COST_BY_BRANCH[e.b.id]?.paybackMonths ?? 0).toFixed(1)} mo</span>,
      fleet: `${avgPayback.toFixed(1)} mo`,
    },
    {
      key: 'gateway', label: 'Gateway',
      cell: (e) => <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{e.b.gatewayModel} · fw {e.b.firmware}</span>,
      fleet: '—',
    },
    {
      key: 'location', label: 'Location',
      cell: (e) => <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{e.b.location}</span>,
      fleet: '—',
    },
  ];

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="fleet-table ecc-table">
        <thead>
          <tr>
            <th style={{ minWidth: 150 }}>Metric</th>
            <th className="ecc-fleet-col">Fleet avg</th>
            {sel.map((e) => {
              const healthColor = e.s.status === 'ok' ? c.ok : e.s.status === 'warn' ? c.warn : c.err;
              return (
                <th key={e.b.id}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: healthColor, boxShadow: `0 0 10px ${healthColor}80` }} />
                    {e.b.name}
                  </span>
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                    {e.b.location}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const m = r.rank ? marks(r.rank, r.higherIsBetter ?? true) : null;
            const Icon = r.icon;
            return (
              <tr key={r.key}>
                <td>
                  <span className="ecc-metric-label">
                    {Icon && <Icon size={13} />}
                    {r.label}
                  </span>
                </td>
                <td className="ecc-fleet-col mono" style={{ fontVariantNumeric: 'tabular-nums' }}>{r.fleet}</td>
                {sel.map((e) => {
                  const cls = m?.best.has(e.b.id) ? 'is-best' : m?.worst.has(e.b.id) ? 'is-worst' : '';
                  return (
                    <td key={e.b.id} className={cls}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        {r.cell(e)}
                        {m?.best.has(e.b.id) && <span className="ecc-lead-tag">Leads</span>}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function HealthCell({ score, status }: { score: number; status: Status }) {
  const c = useThemeColors();
  const color = status === 'ok' ? c.ok : status === 'warn' ? c.warn : c.err;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span className="mono" style={{ width: 28, color, fontVariantNumeric: 'tabular-nums' }}>{Math.round(score * 100)}</span>
      <span style={{ display: 'inline-block', width: 56, height: 5, background: 'rgba(var(--accent-rgb) / 0.10)', borderRadius: 999, overflow: 'hidden' }}>
        <span style={{ display: 'block', width: `${score * 100}%`, height: '100%', background: color }} />
      </span>
    </span>
  );
}

/* ─────────── Custom KPI card + editor ─────────── */

function CustomKpiCard({ k, onEdit, onRemove }: { k: CustomKpi; onEdit: () => void; onRemove: () => void }) {
  const c = useThemeColors();
  const def = METRICS[k.metric];
  const value = metricValue(k.metric, k.scope);
  const series = metricSeries(k.metric, k.scope);
  const status = kpiStatus(k, value);
  const hasThresholds = k.warn !== undefined || k.crit !== undefined;
  const statusColor = status === 'ok' ? c.ok : status === 'warn' ? c.warn : c.err;
  const iconColor = hasThresholds ? statusColor : c.accent;
  const higher = def.higherIsBetter;
  const cmp = higher ? '<' : '>';
  const thresholdText = hasThresholds
    ? [k.warn !== undefined && `warn ${cmp} ${def.format(k.warn)}`, k.crit !== undefined && `crit ${cmp} ${def.format(k.crit)}`]
        .filter(Boolean).join(' · ')
    : 'No thresholds set';
  const Icon = def.icon;
  const title = k.label || autoLabel(k.metric, k.scope);

  return (
    <div className="kpi-card ecc-kpi-card">
      <div className="ecc-kpi-actions ecc-no-print">
        <button onClick={onEdit} aria-label={`Edit ${title}`} title="Edit"><Pencil size={13} /></button>
        <button onClick={onRemove} aria-label={`Remove ${title}`} title="Remove"><Trash2 size={13} /></button>
      </div>
      <div className="kpi-top">
        <div className="kpi-icon" style={{ color: iconColor, background: `linear-gradient(135deg, ${iconColor}2e, transparent)` }}>
          <Icon size={16} />
        </div>
        <div className="kpi-label" title={title}>{title}</div>
      </div>
      <div className="kpi-mid">
        <div className="kpi-value" style={hasThresholds ? { color: statusColor } : undefined}>
          <AnimatedNumber value={value} format={def.format} />
        </div>
        {series && series.length > 1 && (
          <div className="kpi-spark">
            <Sparkline values={series} stroke={iconColor} fill={`${iconColor}2e`} width={88} height={32} />
          </div>
        )}
      </div>
      <div className="kpi-trend" style={{ justifyContent: 'space-between', width: '100%' }}>
        {hasThresholds
          ? <StatusBadge status={status} text={status === 'ok' ? 'On track' : status === 'warn' ? 'Watch' : 'Breach'} />
          : <span />}
        <span className="kpi-trend-sub">{thresholdText}</span>
      </div>
    </div>
  );
}

function KpiModal({ initial, onClose, onSave }: {
  initial: CustomKpi | null;
  onClose: () => void;
  onSave: (k: CustomKpi) => void;
}) {
  const toast = useToast();
  const [metric, setMetric] = useState<MetricId>(initial?.metric ?? 'uptime');
  const [scope, setScope] = useState<string>(initial?.scope ?? 'fleet');
  const [warn, setWarn] = useState<string>(initial?.warn !== undefined ? String(initial.warn) : '');
  const [crit, setCrit] = useState<string>(initial?.crit !== undefined ? String(initial.crit) : '');
  const [label, setLabel] = useState<string>(initial?.label ?? '');

  const def = METRICS[metric];
  const higher = def.higherIsBetter;

  const save = () => {
    const w = warn.trim() === '' ? undefined : Number(warn);
    const cr = crit.trim() === '' ? undefined : Number(crit);
    if ((w !== undefined && !Number.isFinite(w)) || (cr !== undefined && !Number.isFinite(cr))) {
      toast.push({ kind: 'warn', title: 'Thresholds must be numbers', detail: 'Leave a threshold empty to skip it.' });
      return;
    }
    if (w !== undefined && cr !== undefined && (higher ? cr > w : cr < w)) {
      toast.push({
        kind: 'warn', title: 'Check threshold order',
        detail: higher
          ? 'For this metric lower is worse — set critical at or below warn.'
          : 'For this metric higher is worse — set critical at or above warn.',
      });
      return;
    }
    onSave({
      id: initial?.id ?? newKpiId(),
      metric,
      scope,
      label: label.trim() || undefined,
      warn: w,
      crit: cr,
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? 'Edit KPI card' : 'Add KPI card'}
      width={520}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save}>{initial ? 'Save changes' : 'Add card'}</button>
        </>
      }
    >
      <div className="ecc-form-grid">
        <label>
          Metric
          <select value={metric} onChange={(e) => setMetric(e.target.value as MetricId)}>
            {(Object.keys(METRICS) as MetricId[]).map((id) => (
              <option key={id} value={id}>{METRICS[id].label}</option>
            ))}
          </select>
        </label>
        <label>
          Scope
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="fleet">Fleet-wide</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label>
          Warn threshold
          <input type="number" step="any" value={warn} onChange={(e) => setWarn(e.target.value)} placeholder="optional" />
        </label>
        <label>
          Critical threshold
          <input type="number" step="any" value={crit} onChange={(e) => setCrit(e.target.value)} placeholder="optional" />
        </label>
        <label className="full">
          Card label
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={autoLabel(metric, scope)} />
        </label>
        <div className="ecc-form-hint">
          {def.label} breaches when the value {higher ? 'falls below' : 'rises above'} a threshold.
          {' '}Current value: <strong>{def.format(metricValue(metric, scope))}</strong>.
        </div>
      </div>
    </Modal>
  );
}
