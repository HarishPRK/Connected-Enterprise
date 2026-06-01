import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { useThemeColors } from '../ui/Theme';
import { branches, getCostInsightsForBranch } from '../data/mock';
import type { CostWarning, ROISummary, SavingsTrendPoint, ValueCategory, ValueCategoryId } from '../types';
import {
  AlertTriangle, ArrowRight, Bot, DollarSign, Download, Lightbulb, Shield, Shuffle,
  Sparkles, TrendingUp, TrendingDown, Zap, Database, Activity, Cpu, ShieldAlert,
} from 'lucide-react';

const fmtUsd = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : `$${n.toLocaleString()}`;
const fmtUsdFull = (n: number) => `$${n.toLocaleString()}`;

const categoryIcon: Record<ValueCategoryId, React.ComponentType<{ size?: number }>> = {
  energy:     Zap,
  efficiency: Cpu,
  safety:     Shield,
  uptime:     Activity,
  routing:    Shuffle,
  bandwidth:  Sparkles,
  storage:    Database,
};

const categoryAccentKey: Record<ValueCategoryId, 'accent' | 'accent2' | 'accent3' | 'ok' | 'warn' | 'err'> = {
  energy:     'warn',     // amber for power
  efficiency: 'accent',   // mint
  safety:     'err',      // red — safety-critical
  uptime:     'ok',       // green
  routing:    'accent2',  // pink
  bandwidth:  'accent3',  // purple
  storage:    'accent',   // mint (data)
};

export function CostInsightsPage({ branchId }: { branchId: string }) {
  // Data is regenerated whenever the selected branch changes (topbar dropdown).
  // Per-branch values scale by branch size and pick branch-specific warnings.
  const { categories, warnings, trend, roi, scaleLabel } = useMemo(
    () => getCostInsightsForBranch(branchId),
    [branchId],
  );
  const branch = branches.find((b) => b.id === branchId);

  // Clicking a category mini-card filters the chart to that single category.
  // Click the same one again (or "Clear") to return to the stacked view.
  const [selectedCat, setSelectedCat] = useState<ValueCategoryId | null>(null);
  const toggleCat = (id: ValueCategoryId) =>
    setSelectedCat((prev) => (prev === id ? null : id));

  const monthSavedUsd      = categories.reduce((s, v) => s + v.monthSavedUsd, 0);
  const annualSavedRunRate = monthSavedUsd * 12;
  const wasteThisMonth     = warnings.reduce((s, w) => s + w.monthlyCostUsd, 0);
  const wasteAnnualised    = wasteThisMonth * 12;
  const roiMultiple        = (roi.annualSavingsUsd + roi.downtimeAvoidedUsd) / Math.max(1, roi.appAnnualCostUsd);
  const fixableCount       = warnings.filter((w) => w.monthlyCostUsd > 0).length;

  // Headline insights — shown above the chart so users see the big number
  // first instead of trying to parse the stacked bars.
  const chartHeadline = useMemo(() => {
    if (selectedCat) {
      const cat = categories.find((c) => c.id === selectedCat);
      const months = trend.map((p) => ({ month: p.month, v: p[selectedCat as keyof typeof p] as number }));
      const total = months.reduce((s, m) => s + m.v, 0);
      const best = months.reduce((b, m) => (m.v > b.v ? m : b), months[0]);
      return {
        bigLabel: `${cat?.name ?? 'Category'} · 12-month total`,
        big: fmtUsdFull(total),
        sub: `Best month · ${best.month} (${fmtUsdFull(best.v)})`,
      };
    }
    const monthTotals = trend.map((p) => ({
      month: p.month,
      v: p.energy + p.efficiency + p.safety + p.uptime + p.routing + p.bandwidth + p.storage,
    }));
    const total = monthTotals.reduce((s, m) => s + m.v, 0);
    const best = monthTotals.reduce((b, m) => (m.v > b.v ? m : b), monthTotals[0]);
    return {
      bigLabel: 'All categories · 12-month total',
      big: fmtUsdFull(total),
      sub: `Best month · ${best.month} (${fmtUsdFull(best.v)})`,
    };
  }, [categories, trend, selectedCat]);

  return (
    <>
      <PageHeader
        title="Cost Insights"
        subtitle={`${branch?.name ?? 'Branch'} · ${scaleLabel} · where you're saving money, and where you're still spending it unnecessarily.`}
        right={
          <div className="toolbar">
            <button><Download size={14} />Export PDF report</button>
          </div>
        }
      />

      {/* ── Hero KPI strip ── */}
      <div className="kpi-strip">
        <ValueKpi
          label="Saved this month"
          value={fmtUsd(monthSavedUsd)}
          sub={`${categories.length} categories · ↑ avg trend`}
          icon={DollarSign}
          accent="var(--ok)"
        />
        <ValueKpi
          label="Annual run-rate"
          value={fmtUsd(annualSavedRunRate)}
          sub="projected from current month"
          icon={TrendingUp}
          accent="var(--ok)"
        />
        <ValueKpi
          label="Downtime avoided"
          value={`${roi.downtimeAvoidedHours} h`}
          sub={`= ${fmtUsd(roi.downtimeAvoidedUsd)} not lost`}
          icon={Shield}
          accent="var(--accent)"
        />
        <ValueKpi
          label="Incidents auto-resolved"
          value={String(roi.incidentsAutoResolved)}
          sub="agent · no human required"
          icon={Bot}
          accent="var(--accent2)"
        />
        <ValueKpi
          label="Cost waste this month"
          value={fmtUsd(wasteThisMonth)}
          sub={fixableCount > 0 ? `${fixableCount} fixable issue${fixableCount > 1 ? 's' : ''}` : 'No leaks detected'}
          icon={AlertTriangle}
          accent={wasteThisMonth > 0 ? 'var(--err)' : 'var(--ok)'}
        />
      </div>

      <div className="grid">
        {/* ── Combined: chart headline + bar chart + category strip ── */}
        <div className="col-12">
          <Card
            title="Savings by category — last 12 months"
            sub="Click a category below to drill in · click again to clear"
            right={
              selectedCat ? (
                <button onClick={() => setSelectedCat(null)} style={{ padding: '4px 10px', fontSize: 12 }}>
                  Clear filter
                </button>
              ) : null
            }
          >
            {/* Chart headline — single big number so users get the takeaway
                in one glance instead of decoding the stack. */}
            <div className="ci-chart-headline">
              <div>
                <div className="ci-chart-headline-label">{chartHeadline.bigLabel}</div>
                <div className="ci-chart-headline-big">{chartHeadline.big}</div>
              </div>
              <div className="ci-chart-headline-sub">{chartHeadline.sub}</div>
            </div>
            <SavingsTrendChart data={trend} selected={selectedCat} />
            <div className="ci-cat-strip">
              {categories.map((v) => (
                <ValueCategoryMini
                  key={v.id}
                  category={v}
                  selected={selectedCat === v.id}
                  dimmed={selectedCat !== null && selectedCat !== v.id}
                  onClick={() => toggleCat(v.id)}
                />
              ))}
            </div>
          </Card>
        </div>

        {/* ── Cost-waste banner — pushed below the savings story so the page
              opens with what's earning before showing what's leaking. ── */}
        <div className="col-12">
          <Card
            title={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={14} style={{ color: 'var(--warn)' }} />
                Cost waste — issues costing you money right now
              </span>
            }
            sub={
              warnings.length === 0
                ? 'No cost waste detected on this branch — clean ledger'
                : wasteThisMonth > 0
                  ? `${warnings.length} issue${warnings.length > 1 ? 's' : ''} open · ${fmtUsdFull(wasteThisMonth)}/mo leaking → ${fmtUsdFull(wasteAnnualised)}/yr if left unaddressed`
                  : `${warnings.length} advisory note${warnings.length > 1 ? 's' : ''} · no direct \$ impact yet`
            }
            right={
              warnings.length > 0
                ? <span className={`badge ${wasteThisMonth > 0 ? 'warn' : ''}`}>{warnings.length} open</span>
                : <span className="badge ok">all clear</span>
            }
          >
            {warnings.length === 0 ? (
              <div style={{
                padding: '20px 16px', textAlign: 'center', color: 'var(--text-muted)',
                fontSize: 13, fontStyle: 'italic',
              }}>
                Nothing to fix here right now. This branch is running clean.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {warnings.map((w) => (
                  <CostWasteRow key={w.id} warning={w} />
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* ── ROI hero ── */}
        <div className="col-12">
          <RoiHero multiple={roiMultiple} roi={roi} />
        </div>
      </div>
    </>
  );
}

/* ─────────── KPI tile ─────────── */

function ValueKpi({
  label, value, sub, icon: Icon, accent,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ComponentType<{ size?: number }>;
  accent: string;
}) {
  return (
    <div className="kpi-card">
      <div className="kpi-top">
        <div
          className="kpi-icon"
          style={{ color: accent, background: `linear-gradient(135deg, ${accent}33, transparent)` }}
        >
          <Icon size={16} />
        </div>
        <div className="kpi-label">{label}</div>
      </div>
      <div className="kpi-mid">
        <div className="kpi-value" style={{ color: accent }}>{value}</div>
      </div>
      <div className="kpi-trend-sub" style={{ fontSize: 11 }}>{sub}</div>
    </div>
  );
}

/* ─────────── Cost-waste row ─────────── */

function CostWasteRow({ warning }: { warning: CostWarning }) {
  const nav = useNavigate();
  const sevColor =
    warning.severity === 'high' ? 'var(--err)' :
    warning.severity === 'warn' ? 'var(--warn)' : 'var(--accent)';
  const sevBadge =
    warning.severity === 'high' ? 'err' :
    warning.severity === 'warn' ? 'warn' : '';

  return (
    <div
      className="alert-row"
      style={{ borderLeftColor: sevColor, alignItems: 'flex-start', gap: 16 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <span className={`badge ${sevBadge}`}>{warning.severity.toUpperCase()}</span>
      </div>

      <div className="alert-body" style={{ flex: 1 }}>
        <div className="alert-title">{warning.title}</div>
        <div className="alert-meta" style={{ marginTop: 4, lineHeight: 1.5 }}>
          {warning.detail}
        </div>
        <div style={{
          fontSize: 12, color: 'var(--text-dim)',
          marginTop: 8, padding: '6px 10px',
          background: 'rgba(var(--accent-rgb) / 0.05)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <Lightbulb size={12} style={{ color: 'var(--accent)' }} />
          <span><strong style={{ color: 'var(--text)' }}>Recommendation:</strong> {warning.recommendation}</span>
        </div>
      </div>

      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6,
        flexShrink: 0, paddingLeft: 8,
      }}>
        {warning.monthlyCostUsd > 0 ? (
          <>
            <div style={{ fontSize: 22, fontWeight: 700, color: sevColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
              {fmtUsdFull(warning.monthlyCostUsd)}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              per month
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>no $ impact yet</div>
        )}
        {warning.fixRoute && (
          <button
            onClick={() => nav(warning.fixRoute!)}
            className="primary"
            style={{ marginTop: 6 }}
          >
            Fix this <ArrowRight size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

/* ─────────── Savings trend chart ─────────── */

function SavingsTrendChart({
  data: input, selected,
}: {
  data: SavingsTrendPoint[];
  selected: ValueCategoryId | null;
}) {
  const c = useThemeColors();

  // Total per month for the headline tooltip line
  const data = input.map((p) => ({
    ...p,
    total: p.energy + p.efficiency + p.safety + p.uptime + p.routing + p.bandwidth + p.storage,
  }));

  const allSeries: { key: keyof typeof data[number]; name: string; color: string }[] = [
    { key: 'efficiency', name: 'IT/OT efficiency',  color: c.accent  },
    { key: 'uptime',     name: 'Uptime via DPS',    color: c.ok      },
    { key: 'energy',     name: 'Energy savings',    color: c.warn    },
    { key: 'routing',    name: 'Policy routing',    color: c.accent2 },
    { key: 'safety',     name: 'Safety SLA',        color: c.err     },
    { key: 'bandwidth',  name: 'Bandwidth reduce',  color: c.accent3 },
    { key: 'storage',    name: 'Storage reduce',    color: '#67e8f9' },
  ];
  // When a category is selected, show only that one series — single-colour
  // bars are much easier to read than a 7-stack.
  const series = selected ? allSeries.filter((s) => s.key === selected) : allSeries;

  return (
    <div style={{ height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap={8}>
          <defs>
            {series.map((s) => (
              <linearGradient key={String(s.key)} id={`bv-${String(s.key)}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={s.color} stopOpacity={1} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.6} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke={c.chartGrid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" stroke={c.textMuted} fontSize={11} tickLine={false} axisLine={false} />
          <YAxis
            stroke={c.textMuted}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`}
          />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            contentStyle={{
              background: c.tooltipBg,
              border: `1px solid ${c.tooltipBorder}`,
              borderRadius: 10,
              fontSize: 12,
              backdropFilter: 'blur(10px)',
            }}
            labelStyle={{ color: c.textDim, marginBottom: 4 }}
            formatter={(v: unknown) => fmtUsdFull(typeof v === 'number' ? v : 0)}
          />
          <Legend wrapperStyle={{ fontSize: 11.5, paddingTop: 8 }} iconType="square" />
          {series.map((s, i) => (
            <Bar
              key={String(s.key)}
              dataKey={String(s.key)}
              name={s.name}
              stackId="1"
              fill={`url(#bv-${String(s.key)})`}
              stroke={s.color}
              strokeWidth={0.6}
              radius={i === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ─────────── Clickable compact category mini card ───────────
 * Click → filters the chart to this category. Click again → clears filter.
 * Visual states: idle, hover (lifts), selected (accent ring + glow), dimmed
 * (50% opacity when *another* card is selected). */
function ValueCategoryMini({
  category, selected, dimmed, onClick,
}: {
  category: ValueCategory;
  selected: boolean;
  dimmed: boolean;
  onClick: () => void;
}) {
  const Icon = categoryIcon[category.id];
  const accentKey = categoryAccentKey[category.id];
  const accent = `var(--${
    accentKey === 'accent'  ? 'accent'   :
    accentKey === 'accent2' ? 'accent-2' :
    accentKey === 'accent3' ? 'accent-3' :
    accentKey
  })`;
  const Trend = category.trendPct >= 0 ? TrendingUp : TrendingDown;
  const trendColor = category.trendPct >= 0 ? 'var(--ok)' : 'var(--err)';

  const className =
    'ci-cat-mini' +
    (selected ? ' is-selected' : '') +
    (dimmed ? ' is-dimmed' : '');

  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
      style={{
        borderTopColor: accent,
        ...(selected ? { boxShadow: `0 0 0 1px ${accent}, 0 0 24px ${accent}30` } : {}),
      }}
    >
      <div className="ci-cat-mini-head">
        <span
          className="ci-cat-mini-icon"
          style={{ color: accent, background: `linear-gradient(135deg, ${accent}26, transparent)` }}
        >
          <Icon size={13} />
        </span>
        <span className="ci-cat-mini-name">{category.name}</span>
      </div>
      <div className="ci-cat-mini-value" style={{ color: accent }}>
        {fmtUsdFull(category.monthSavedUsd)}
      </div>
      <div className="ci-cat-mini-foot">
        <span style={{ color: 'var(--text-muted)' }}>
          12-mo <strong style={{ color: 'var(--text-dim)' }}>{fmtUsdFull(category.yearSavedUsd)}</strong>
        </span>
        <span style={{ color: trendColor, display: 'inline-flex', alignItems: 'center', gap: 2, fontWeight: 600 }}>
          <Trend size={11} />
          {category.trendPct >= 0 ? '+' : ''}{category.trendPct.toFixed(1)}%
        </span>
      </div>
    </button>
  );
}

/* ─────────── ROI summary hero ─────────── */

function RoiHero({ multiple, roi }: { multiple: number; roi: ROISummary }) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <div style={{
          width: 56, height: 56, borderRadius: 14,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--grad-accent)',
          boxShadow: 'var(--glow-accent)',
          color: '#ffffff',
          flexShrink: 0,
        }}>
          <Sparkles size={26} />
        </div>

        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
            Return on investment
          </div>
          <div style={{
            fontSize: 26, fontWeight: 700, marginTop: 4,
            background: 'var(--grad-accent)',
            WebkitBackgroundClip: 'text', backgroundClip: 'text',
            WebkitTextFillColor: 'transparent', color: 'transparent',
          }}>
            Connected Enterprise pays for itself {multiple.toFixed(1)}× over
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.55 }}>
            On a <strong style={{ color: 'var(--text)' }}>{fmtUsdFull(roi.appAnnualCostUsd)}</strong>/yr subscription, you're capturing{' '}
            <strong style={{ color: 'var(--ok)' }}>{fmtUsdFull(roi.annualSavingsUsd)}</strong> in direct savings plus{' '}
            <strong style={{ color: 'var(--ok)' }}>{fmtUsdFull(roi.downtimeAvoidedUsd)}</strong> in avoided downtime —
            payback in <strong style={{ color: 'var(--text)' }}>{roi.paybackPeriodMonths.toFixed(1)} months</strong>.
          </div>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 12,
        paddingTop: 8,
        borderTop: '1px solid var(--border)',
      }}>
        <RoiStat label="Direct savings"  value={fmtUsdFull(roi.annualSavingsUsd)}    sub="annualised"          icon={DollarSign}   color="var(--ok)" />
        <RoiStat label="Downtime avoided" value={`${roi.downtimeAvoidedHours} h`}    sub={fmtUsdFull(roi.downtimeAvoidedUsd)} icon={ShieldAlert} color="var(--accent)" />
        <RoiStat label="Auto-resolved"   value={String(roi.incidentsAutoResolved)}   sub="incidents · YTD"      icon={Bot}          color="var(--accent2)" />
        <RoiStat label="Bandwidth saved" value={`${roi.bandwidthSavedTb.toFixed(1)} TB`} sub="app-aware routing"   icon={Activity}     color="var(--accent3)" />
      </div>
    </Card>
  );
}

function RoiStat({
  label, value, sub, icon: Icon, color,
}: {
  label: string; value: string; sub: string;
  icon: React.ComponentType<{ size?: number }>; color: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{
        width: 30, height: 30, borderRadius: 8,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color, background: `linear-gradient(135deg, ${color}33, transparent)`,
        border: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <Icon size={14} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
          {label}
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{sub}</div>
      </div>
    </div>
  );
}
