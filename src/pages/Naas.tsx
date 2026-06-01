import { useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { naasServices, naasSlas, naasAddons } from '../data/mock';
import type { NaasAddOn, NaasCategoryId, NaasService, SlaItem } from '../types';
import { useThemeColors, type ThemeColors } from '../ui/Theme';
import {
  Activity, BadgeCheck, Boxes, Cable, CheckCircle2, CloudCog, Cpu, Eye, Globe2,
  Lock, Network, Plus, Shield, ShieldCheck, Sparkles, Timer,
  Wifi, Wrench, Zap,
} from 'lucide-react';

const fmtUsdFull = (n: number) => `$${n.toLocaleString()}`;

const CATEGORY_META: Record<NaasCategoryId, {
  label: string;
  short: string;
  icon: React.ComponentType<{ size?: number }>;
  color: string;
}> = {
  connectivity:  { label: 'Connectivity',  short: 'CONN',  icon: Network,    color: 'var(--accent)'   },
  security:      { label: 'Security',      short: 'SEC',   icon: ShieldCheck, color: 'var(--err)'      },
  observability: { label: 'Observability', short: 'OBS',   icon: Eye,        color: 'var(--accent3)' },
  access:        { label: 'Access',        short: 'ACC',   icon: Lock,       color: 'var(--accent2)' },
  compute:       { label: 'Compute',       short: 'CPU',   icon: Cpu,        color: 'var(--warn)'     },
};

/** Map category → resolved hex from theme (Recharts needs real colors, not var()). */
function categoryHex(c: ThemeColors, cat: NaasCategoryId): string {
  switch (cat) {
    case 'connectivity':  return c.accent;
    case 'security':      return c.err;
    case 'observability': return c.accent3;
    case 'access':        return c.accent2;
    case 'compute':       return c.warn;
  }
}

const SERVICE_ICON: Record<string, React.ComponentType<{ size?: number }>> = {
  'sdwan-as-a-service': Cable,
  'cloud-firewall': Shield,
  'ddos-protection': ShieldCheck,
  'zero-trust-vpn': Lock,
  'bandwidth-on-demand': Zap,
  'app-monitoring': Activity,
  'device-inventory': Boxes,
  'web-gateway': Globe2,
  'dns-security': ShieldCheck,
  'sso': BadgeCheck,
};

const FILTERS: { id: 'all' | NaasCategoryId; label: string }[] = [
  { id: 'all',           label: 'All services' },
  { id: 'connectivity',  label: 'Connectivity' },
  { id: 'security',      label: 'Security' },
  { id: 'observability', label: 'Observability' },
  { id: 'access',        label: 'Access' },
  { id: 'compute',       label: 'Compute' },
];

export function NaasPage() {
  const [filter, setFilter] = useState<'all' | NaasCategoryId>('all');

  const filtered = useMemo(
    () => naasServices.filter((s) => filter === 'all' || s.category === filter),
    [filter],
  );

  const activeCount   = naasServices.filter((s) => s.active).length;
  const slaPass       = naasSlas.filter((s) => s.status === 'ok').length;

  return (
    <>
      <PageHeader
        title="Network as a Service"
        subtitle="Cloud-delivered network services bundled with your subscription — turn capabilities on without touching hardware."
        right={
          <div className="toolbar">
            <button className="primary"><Plus size={14} />Add service</button>
          </div>
        }
      />

      {/* ── Value-prop hero strip — what we deliver, not what it costs ── */}
      <div className="naas-valueprops">
        <ValueProp
          icon={Network}
          headline="Always-on stack"
          big={`${naasServices.length} services`}
          sub="cloud-delivered · every branch · 24/7"
          detail="Connectivity, security, observability, access and compute layered on top of the SD-WAN edge — fully managed"
          accent="var(--accent)"
        />
        <ValueProp
          icon={Timer}
          headline="Faster deployment"
          big="4 min"
          sub="avg activation time per service"
          detail="A new firewall rule, VPN seat or DNS policy goes live across the fleet in minutes — no truck-roll, no install window"
          accent="var(--accent-3)"
        />
        <ValueProp
          icon={Wrench}
          headline="Managed operations"
          big="Fully managed"
          sub="no patching, replacements, or maintenance on your team"
          detail="Firmware updates, security patches, certificate rotation and hardware break-fix happen automatically at every edge — included in the subscription"
          accent="var(--accent-2)"
        />
        <ValueProp
          icon={CloudCog}
          headline="Multi-cloud reach"
          big="AWS · Azure · GCP"
          sub="unified SD-WAN policy across 3 clouds"
          detail="Cloud OnRamp to AWS today · Azure vWAN + GCP Network Connectivity Center via the Multi-Cloud add-on"
          accent="var(--ok)"
        />
      </div>

      {/* ── Hero KPI strip ── */}
      <div className="kpi-strip">
        <NaasKpi
          label="Active services"
          value={`${activeCount} / ${naasServices.length}`}
          sub="provisioned · ready to use"
          icon={CloudCog}
          accent="var(--accent)"
        />
        <NaasKpi
          label="Inspected · 24 h"
          value="55.0K"
          sub="firewall + SWG + DNS + IDS events"
          icon={ShieldCheck}
          accent="var(--accent2)"
        />
        <NaasKpi
          label="SLAs met"
          value={`${slaPass} / ${naasSlas.length}`}
          sub={slaPass === naasSlas.length ? 'all metrics in band' : 'review breaches below'}
          icon={CheckCircle2}
          accent={slaPass === naasSlas.length ? 'var(--ok)' : 'var(--warn)'}
        />
        <NaasKpi
          label="Available add-ons"
          value={String(naasAddons.length)}
          sub="ready to enable"
          icon={Sparkles}
          accent="var(--accent3)"
        />
      </div>

      <div className="grid">
        {/* ── Service catalog — utilisation chart ── */}
        <div className="col-12">
          <Card
            title="Service catalog · utilisation"
            sub="Live usage vs provisioned capacity — sorted by current load. Hover a row for details."
            right={
              <div className="toolbar">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFilter(f.id)}
                    style={f.id === filter
                      ? { background: 'var(--grad-accent-soft)', borderColor: 'var(--accent)', color: 'var(--text)' }
                      : undefined}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            }
          >
            <ServiceUtilisationChart services={filtered} />
          </Card>
        </div>

        {/* ── SLA panel ── */}
        <div className="col-8">
          <Card
            title="Service-level agreements"
            sub="Live measurements vs contracted thresholds — anything yellow needs attention before month-end review."
            right={<span className={`badge ${slaPass === naasSlas.length ? 'ok' : 'warn'}`}>
              {slaPass} / {naasSlas.length} healthy
            </span>}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {naasSlas.map((sla) => <SlaRow key={sla.id} item={sla} />)}
            </div>
          </Card>
        </div>

        {/* ── Coverage map ── */}
        <div className="col-4">
          <Card
            title="Coverage by category"
            sub="What's in the stack · service count and utilisation per layer"
          >
            <CoverageBars />
          </Card>
        </div>

        {/* ── Marketplace ── */}
        <div className="col-12">
          <Card
            title="Marketplace · add-ons"
            sub="Optional capabilities — enable any with one click. Billing prorated to the day."
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
              {naasAddons.map((a) => <AddOnCard key={a.id} addon={a} />)}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

/* ─────────── KPI tile ─────────── */

/* ─────────── Value-prop hero tile ─────────── */

function ValueProp({
  icon: Icon, headline, big, sub, detail, accent,
}: {
  icon: React.ComponentType<{ size?: number }>;
  headline: string;
  big: string;
  sub: string;
  detail: string;
  accent: string;
}) {
  return (
    <div className="naas-vp-card" style={{ borderColor: accent }}>
      <div className="naas-vp-head">
        <span className="naas-vp-icon" style={{ color: accent, background: `linear-gradient(135deg, ${accent}26, transparent)` }}>
          <Icon size={16} />
        </span>
        <span className="naas-vp-headline">{headline}</span>
      </div>
      <div className="naas-vp-big" style={{ color: accent }}>{big}</div>
      <div className="naas-vp-sub">{sub}</div>
      <div className="naas-vp-detail">{detail}</div>
    </div>
  );
}

function NaasKpi({
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

/* ─────────── Service utilisation chart ───────────
 * Real horizontal bar chart via Recharts — grid, axes, gradient-filled bars,
 * status-coloured cells, and a rich tooltip. Sorted by load. */

interface ServiceChartRow {
  id: string;
  name: string;
  short: string;
  category: NaasCategoryId;
  cap: string;
  usage: number;
  cost: number;
  status: NaasService['status'];
  color: string;
  description: string;
  active: boolean;
}

function ServiceUtilisationChart({ services }: { services: NaasService[] }) {
  const c = useThemeColors();

  const data: ServiceChartRow[] = useMemo(
    () => [...services]
      .sort((a, b) => b.usagePct - a.usagePct)
      .map((s) => {
        const catHex = categoryHex(c, s.category);
        const color =
          s.status === 'err'  ? c.err  :
          s.status === 'warn' ? c.warn :
          s.usagePct >= 95    ? c.err  :
          s.usagePct >= 80    ? c.warn : catHex;
        return {
          id: s.id,
          name: s.name,
          short: CATEGORY_META[s.category].short,
          category: s.category,
          cap: s.capacityLabel,
          usage: s.usagePct,
          cost: s.monthlyCostUsd,
          status: s.status,
          color,
          description: s.description,
          active: s.active,
        };
      }),
    [services, c],
  );

  const height = Math.max(220, data.length * 44 + 56);
  const yAxisWidth = 230;

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={data}
          margin={{ top: 12, right: 96, left: 8, bottom: 8 }}
          barCategoryGap={10}
        >
          <defs>
            {data.map((d) => (
              <linearGradient key={d.id} id={`naas-grad-${d.id}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%"   stopColor={d.color} stopOpacity={0.45} />
                <stop offset="100%" stopColor={d.color} stopOpacity={1} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke={c.chartGrid} strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v) => `${v}%`}
            stroke={c.textMuted}
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={yAxisWidth}
            stroke={c.textMuted}
            tickLine={false}
            axisLine={false}
            interval={0}
            tick={<ServiceYAxisTick data={data} />}
          />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.05)' }}
            contentStyle={{
              background: c.tooltipBg,
              border: `1px solid ${c.tooltipBorder}`,
              borderRadius: 10,
              fontSize: 12,
              padding: '10px 12px',
              backdropFilter: 'blur(10px)',
            }}
            labelStyle={{ color: c.text, marginBottom: 4, fontWeight: 600 }}
            content={<ServiceTooltip />}
          />
          <Bar dataKey="usage" barSize={20} radius={[2, 8, 8, 2]} isAnimationActive>
            {data.map((d) => (
              <Cell
                key={d.id}
                fill={`url(#naas-grad-${d.id})`}
                stroke={d.color}
                strokeWidth={0.75}
                strokeOpacity={0.65}
              />
            ))}
            <LabelList
              dataKey="usage"
              position="right"
              formatter={(v) => (typeof v === 'number' ? `${v}%` : '')}
              fill={c.text}
              fontSize={12}
              fontWeight={700}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Custom Y-axis tick: service name on top, CONN/SEC/etc tag + capacity below. */
function ServiceYAxisTick({
  x, y, payload, data,
}: {
  x?: number; y?: number; payload?: { value: string };
  data: ServiceChartRow[];
}) {
  if (x == null || y == null || !payload) return null;
  const row = data.find((d) => d.name === payload.value);
  if (!row) return null;
  const c = useThemeColors();
  const meta = CATEGORY_META[row.category];
  const Icon = SERVICE_ICON[row.id] ?? meta.icon;
  const catHex = categoryHex(c, row.category);
  const trim = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  return (
    <g transform={`translate(${x},${y})`}>
      <foreignObject x={-225} y={-18} width={220} height={36}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          height: 36, width: '100%',
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: row.status === 'ok' ? c.ok : row.status === 'warn' ? c.warn : c.err,
            boxShadow: `0 0 6px ${row.status === 'ok' ? c.ok : row.status === 'warn' ? c.warn : c.err}`,
            flexShrink: 0,
          }} />
          <span style={{
            width: 26, height: 26, borderRadius: 7,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: catHex,
            background: `linear-gradient(135deg, ${catHex}26, transparent)`,
            border: `1px solid ${catHex}44`,
            flexShrink: 0,
          }}>
            <Icon size={13} />
          </span>
          <div style={{ minWidth: 0, flex: 1, lineHeight: 1.2 }}>
            <div style={{
              fontSize: 12.5, fontWeight: 600, color: c.text,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {trim(row.name, 28)}
            </div>
            <div style={{
              fontSize: 10.5, color: c.textMuted,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              <span style={{ color: catHex, fontWeight: 700, letterSpacing: '0.05em' }}>{row.short}</span>
              <span style={{ opacity: 0.5 }}> · </span>
              {row.cap}
            </div>
          </div>
        </div>
      </foreignObject>
    </g>
  );
}

function ServiceTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload: ServiceChartRow }>;
}) {
  const c = useThemeColors();
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const catHex = categoryHex(c, row.category);
  return (
    <div style={{
      background: c.tooltipBg,
      border: `1px solid ${c.tooltipBorder}`,
      borderRadius: 10,
      padding: '10px 12px',
      backdropFilter: 'blur(10px)',
      fontSize: 12,
      maxWidth: 320,
      boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
          padding: '2px 6px', borderRadius: 4,
          color: catHex, background: `${catHex}22`, border: `1px solid ${catHex}55`,
        }}>{row.short}</span>
        <span style={{ fontWeight: 600, color: c.text }}>{row.name}</span>
      </div>
      <div style={{ color: c.textDim, lineHeight: 1.5, marginBottom: 6 }}>{row.description}</div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px',
        fontSize: 11, color: c.textMuted, paddingTop: 6, borderTop: `1px dashed ${c.tooltipBorder}`,
      }}>
        <span>usage</span><span style={{ color: row.color, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{row.usage}%</span>
        <span>capacity</span><span style={{ color: c.textDim }}>{row.cap}</span>
        <span>billing</span><span style={{ color: c.textDim, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>
          {row.cost === 0 ? 'on usage' : `${fmtUsdFull(row.cost)}/mo`}
        </span>
        <span>status</span>
        <span style={{ color: row.status === 'ok' ? c.ok : row.status === 'warn' ? c.warn : c.err, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {row.status}{!row.active && ' · off'}
        </span>
      </div>
    </div>
  );
}

/* ─────────── SLA row — horizontal bar gauge ───────────
 * Uses real hex colours (from theme) so the gradient + glow actually render. */

function SlaRow({ item }: { item: SlaItem }) {
  const c = useThemeColors();
  const sev = item.status === 'err' ? c.err : item.status === 'warn' ? c.warn : c.ok;
  const pct = Math.max(0, Math.min(100, item.pct));

  return (
    <div className="naas-sla-bar-row" style={{ borderLeftColor: sev }}>
      <div className="naas-sla-bar-info">
        <div className="naas-sla-bar-name">{item.name}</div>
        <div className="naas-sla-bar-meta">
          target <strong style={{ color: 'var(--text-dim)' }}>{item.contracted}</strong>
          <span style={{ opacity: 0.5 }}> · </span>
          actual <strong style={{ color: sev }}>{item.actual}</strong>
        </div>
      </div>
      <div className="naas-sla-bar-track">
        <div
          className="naas-sla-bar-fill"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${sev}66, ${sev})`,
            boxShadow: `0 0 12px ${sev}99, inset 0 0 0 1px ${sev}`,
          }}
        />
      </div>
      <div className="naas-sla-bar-pct mono" style={{ color: sev }}>{pct}%</div>
    </div>
  );
}

/* ─────────── Coverage donut — services by category layer ─────────── */

function CoverageBars() {
  const totals = (Object.keys(CATEGORY_META) as NaasCategoryId[]).map((cid) => {
    const services = naasServices.filter((s) => s.category === cid);
    const usage = services.reduce((sum, s) => sum + s.usagePct, 0);
    const avgUsage = services.length === 0 ? 0 : Math.round(usage / services.length);
    return { id: cid, count: services.length, usage, avgUsage };
  });
  const totalServices = totals.reduce((s, t) => s + t.count, 0) || 1;

  // Donut geometry
  const size = 160, stroke = 22, r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  let acc = 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', justifyContent: 'center' }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{ flexShrink: 0 }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
        {totals.filter((t) => t.count > 0).map((t) => {
          const meta = CATEGORY_META[t.id];
          const frac = t.count / totalServices;
          const dash = C * frac;
          const offset = -acc;
          acc += dash;
          return (
            <circle
              key={t.id}
              cx={size / 2} cy={size / 2} r={r}
              fill="none"
              stroke={meta.color}
              strokeWidth={stroke}
              strokeDasharray={`${dash - 1.5} ${C - dash + 1.5}`}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              style={{ transition: 'stroke-dasharray 0.5s' }}
            />
          );
        })}
        <text x={size / 2} y={size / 2 - 2} textAnchor="middle" fontSize={26} fontWeight={700} fill="var(--text)" fontFamily="JetBrains Mono">
          {totalServices}
        </text>
        <text x={size / 2} y={size / 2 + 16} textAnchor="middle" fontSize={10} fill="var(--text-muted)" letterSpacing="0.06em">
          SERVICES
        </text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 130, flex: 1 }}>
        {totals.filter((t) => t.count > 0).map((t) => {
          const meta = CATEGORY_META[t.id];
          const Icon = meta.icon;
          return (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
            }}>
              <span style={{
                width: 22, height: 22, borderRadius: 6,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                color: meta.color,
                background: `linear-gradient(135deg, ${meta.color}26, transparent)`,
                border: '1px solid var(--border)',
                flexShrink: 0,
              }}>
                <Icon size={11} />
              </span>
              <span style={{ flex: 1, color: 'var(--text)' }}>{meta.label}</span>
              <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', fontSize: 11 }}>
                {t.count} · {t.avgUsage}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────── Marketplace add-on card ─────────── */

function AddOnCard({ addon }: { addon: NaasAddOn }) {
  const meta = CATEGORY_META[addon.category];
  const Icon = meta.icon;
  return (
    <div style={{
      padding: 14,
      border: '1px solid var(--border)',
      borderRadius: 12,
      background: 'var(--surface-1)',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: `linear-gradient(135deg, ${meta.color}33, transparent)`,
          color: meta.color,
          border: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <Icon size={15} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{addon.name}</div>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {meta.short} add-on
          </div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
        {addon.description}
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {addon.bullets.map((b, i) => (
          <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11.5, color: 'var(--text-dim)' }}>
            <span style={{ color: meta.color, marginTop: 5, flexShrink: 0 }}>•</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: 8, borderTop: '1px dashed var(--border)', gap: 8,
      }}>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
          billed {fmtUsdFull(addon.monthlyCostUsd)}/mo
        </span>
        <button className="primary"><Plus size={12} />Enable</button>
      </div>
    </div>
  );
}

// Reference unused imports so TS keeps them around if file later imports them.
const _unused = { Wifi };
void _unused;
