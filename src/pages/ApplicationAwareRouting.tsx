import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import {
  Layers, Plus, Search, ArrowRight, Cable, Radio, Shuffle,
  Mic, Video, Briefcase, Globe, Cloud, Cpu, Power,
} from 'lucide-react';
import { appCategories, appPolicies } from '../data/mock';
import type { AppCategory, AppCategoryId, AppPolicy } from '../types';
import { useTheme, useThemeColors } from '../ui/Theme';
import { AiInsightCard } from '../components/widgets/AiInsightCard';

const catIcon: Record<AppCategoryId, React.ComponentType<{ size?: number }>> = {
  voice: Mic, video: Video, business: Briefcase, web: Globe, bulk: Cloud, iot: Cpu,
};

const slaBadge = {
  realtime:    'err',
  business:    'warn',
  'best-effort': '',
} as const;

export function ApplicationAwareRoutingPage() {
  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState<AppCategoryId | 'all'>('all');
  const [editing, setEditing] = useState<AppPolicy | null>(null);
  const { push } = useToast();
  const chart = useThemeColors();

  const list = useMemo(
    () => appPolicies
      .filter((p) => catFilter === 'all' || p.category === catFilter)
      .filter((p) => !query || p.app.toLowerCase().includes(query.toLowerCase()) || p.match.toLowerCase().includes(query.toLowerCase())),
    [query, catFilter],
  );

  const totals = {
    apps: appPolicies.length,
    enabled: appPolicies.filter((p) => p.enabled).length,
    realtime: appPolicies.filter((p) => p.slaClass === 'realtime').length,
    flowsPerMin: appPolicies.reduce((s, p) => s + p.hitsPerMin, 0),
    throughput: appPolicies.reduce((s, p) => s + p.throughputMbps, 0),
  };

  const topApps = [...appPolicies]
    .sort((a, b) => b.throughputMbps - a.throughputMbps)
    .slice(0, 6)
    .map((p) => ({ name: p.app.length > 14 ? p.app.slice(0, 13) + '…' : p.app, mbps: p.throughputMbps, color: appCategories.find(c => c.id === p.category)!.color }));

  return (
    <>
      <PageHeader
        title="Application Aware Routing"
        subtitle="Identify each application, then steer it to the WAN path that meets its SLA class"
        right={
          <div className="toolbar">
            <button><Layers size={14} />Templates</button>
            <button className="primary" onClick={() => setEditing({
              id: '', app: '', category: 'business', preferredPath: 'Auto', backupPath: 'None',
              match: '', hitsPerMin: 0, throughputMbps: 0, slaClass: 'business', enabled: true,
            })}><Plus size={14} />New policy</button>
          </div>
        }
      />

      {/* KPI strip */}
      <div className="kpi-strip" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <SmallStat label="Apps tracked" value={String(totals.apps)} sub={`${totals.enabled} enabled`} icon={Layers} color="var(--accent)" />
        <SmallStat label="Real-time apps" value={String(totals.realtime)} sub="forced to Fiber" icon={Mic} color="var(--err)" />
        <SmallStat label="Flows / min" value={totals.flowsPerMin.toLocaleString()} sub="across all policies" icon={Shuffle} color="var(--accent-2)" />
        <SmallStat label="Throughput" value={`${totals.throughput} Mbps`} sub="aggregate now" icon={Cloud} color="var(--ok)" />
      </div>

      <div className="grid">
        {/* AI insight across the routing policy set */}
        <div className="col-12">
          <AiInsightCard
            topic="app-routing"
            subtitle="Bedrock review of routing policies vs SLA classes"
            data={{
              totals,
              categories: appCategories.map((c) => ({
                id: c.id, name: c.name, trafficSharePct: c.trafficSharePct,
              })),
              policies: appPolicies.map((p) => ({
                app: p.app,
                category: p.category,
                slaClass: p.slaClass,
                preferredPath: p.preferredPath,
                backupPath: p.backupPath,
                match: p.match,
                hitsPerMin: p.hitsPerMin,
                throughputMbps: p.throughputMbps,
                enabled: p.enabled,
              })),
            }}
          />
        </div>

        {/* App flow Sankey-ish diagram */}
        <div className="col-8">
          <Card
            title="Application → Path mapping"
            sub="Live: each band shows traffic share routed via that path"
          >
            <AppFlowDiagram />
          </Card>
        </div>

        {/* Category cards */}
        <div className="col-4">
          <Card title="Categories" sub="DPI auto-detected · click to filter">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <CategoryRow
                name="All"
                desc="Show every application"
                color="var(--accent)"
                pct={100}
                icon={Layers}
                active={catFilter === 'all'}
                onClick={() => setCatFilter('all')}
              />
              {appCategories.map((c) => {
                const Icon = catIcon[c.id];
                return (
                  <CategoryRow
                    key={c.id}
                    name={c.name}
                    desc={c.description}
                    color={c.color}
                    pct={c.trafficSharePct}
                    icon={Icon}
                    active={catFilter === c.id}
                    onClick={() => setCatFilter(c.id)}
                  />
                );
              })}
            </div>
          </Card>
        </div>

        {/* Policy table */}
        <div className="col-12">
          <Card
            title="Routing policies"
            sub={`${list.length} shown · drag to reorder priority`}
            right={
              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, color: 'var(--text-muted)' }} />
                <input
                  placeholder="Search app or match rule"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  style={{ paddingLeft: 30, minWidth: 240 }}
                />
              </div>
            }
          >
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Application</th>
                  <th>Category</th>
                  <th>Match rule</th>
                  <th>SLA class</th>
                  <th>Path</th>
                  <th>Hits/min</th>
                  <th>Throughput</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p, i) => {
                  const cat = appCategories.find((c) => c.id === p.category)!;
                  const Icon = catIcon[p.category];
                  return (
                    <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setEditing(p)}>
                      <td className="mono" style={{ color: 'var(--text-muted)', width: 22 }}>{i + 1}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ color: cat.color, display: 'inline-flex' }}><Icon size={15} /></span>
                          <span style={{ color: 'var(--text)', fontWeight: 500 }}>{p.app}</span>
                        </div>
                      </td>
                      <td>
                        <span className="badge" style={{ color: cat.color, borderColor: `${cat.color}55`, background: `${cat.color}15` }}>
                          {cat.name}
                        </span>
                      </td>
                      <td className="mono" style={{ color: 'var(--text-dim)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.match}</td>
                      <td><span className={`badge ${slaBadge[p.slaClass]}`}>{p.slaClass}</span></td>
                      <td>
                        <PathPair pref={p.preferredPath} backup={p.backupPath} />
                      </td>
                      <td className="mono" style={{ fontVariantNumeric: 'tabular-nums' }}>{p.hitsPerMin}</td>
                      <td className="mono" style={{ fontVariantNumeric: 'tabular-nums' }}>{p.throughputMbps} Mbps</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button
                          className="icon-btn"
                          style={{ width: 28, height: 28, color: p.enabled ? 'var(--ok)' : 'var(--text-muted)' }}
                          title={p.enabled ? 'Disable' : 'Enable'}
                          onClick={() => push({
                            kind: 'info',
                            title: `${p.app} ${p.enabled ? 'disabled' : 'enabled'}`,
                            detail: 'Change applied to gateway in <1s',
                          })}
                        >
                          <Power size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {list.length === 0 && (
                  <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>No policies match the current filters.</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>

        {/* Top apps + match rule hits */}
        <div className="col-7">
          <Card title="Top apps by bandwidth" sub="Snapshot · last 60s">
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topApps} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    {topApps.map((a, i) => (
                      <linearGradient key={i} id={`bar-${i}`} x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor={a.color} stopOpacity={0.95} />
                        <stop offset="100%" stopColor={a.color} stopOpacity={0.4} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid stroke={chart.chartGrid} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" stroke={chart.textMuted} fontSize={11} tickLine={false} axisLine={false} interval={0} />
                  <YAxis stroke={chart.textMuted} fontSize={11} tickLine={false} axisLine={false} unit=" Mbps" />
                  <Tooltip
                    contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, borderRadius: 10, fontSize: 12 }}
                    labelStyle={{ color: chart.textDim }}
                    cursor={{ fill: chart.chartCursor }}
                  />
                  <Bar dataKey="mbps" radius={[6, 6, 0, 0]}>
                    {topApps.map((_, i) => (
                      <rect key={i} fill={`url(#bar-${i})`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        <div className="col-5">
          <Card title="Match rule cheatsheet" sub="Conditions you can use in policies">
            <RuleRow kind="DSCP"   value="EF, AF41, CS5"          desc="Marked at endpoint or by gateway QoS" />
            <RuleRow kind="FQDN"   value="*.teams.microsoft.com"  desc="Wildcard match against TLS SNI / DNS" />
            <RuleRow kind="L4"     value="TCP/443, UDP/3478"      desc="Protocol + port" />
            <RuleRow kind="App-ID" value="microsoft-365"          desc="DPI signature shipped with the gateway" />
            <RuleRow kind="VLAN"   value="20 (OT)"                 desc="Source VLAN at the LAN edge" />
            <RuleRow kind="User"   value="group:engineering"      desc="From identity provider sync" />
          </Card>
        </div>
      </div>

      <Modal
        open={editing != null}
        onClose={() => setEditing(null)}
        title={editing?.id ? `Edit policy — ${editing.app}` : 'New routing policy'}
        width={520}
        footer={
          <>
            <button onClick={() => setEditing(null)}>Cancel</button>
            <button
              className="primary"
              onClick={() => {
                push({ kind: 'success', title: editing?.id ? 'Policy updated' : 'Policy created', detail: 'Pushed to all gateways in this branch' });
                setEditing(null);
              }}
            >
              Save policy
            </button>
          </>
        }
      >
        {editing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <FormRow label="Application name">
              <input defaultValue={editing.app} placeholder="e.g. Salesforce" />
            </FormRow>
            <FormRow label="Match rule">
              <input defaultValue={editing.match} placeholder="e.g. *.salesforce.com or DSCP EF" />
            </FormRow>
            <FormRow label="Category">
              <select defaultValue={editing.category}>
                {appCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </FormRow>
            <FormRow label="SLA class">
              <select defaultValue={editing.slaClass}>
                <option value="realtime">Real-time (voice/video)</option>
                <option value="business">Business critical</option>
                <option value="best-effort">Best effort</option>
              </select>
            </FormRow>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <FormRow label="Preferred path">
                <select defaultValue={editing.preferredPath}>
                  <option>Auto</option><option>Fiber</option><option>5G</option>
                </select>
              </FormRow>
              <FormRow label="Backup path">
                <select defaultValue={editing.backupPath}>
                  <option>None</option><option>Fiber</option><option>5G</option>
                </select>
              </FormRow>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

/* ---------- Sub-components ---------- */

function SmallStat({
  label, value, sub, icon: Icon, color,
}: { label: string; value: string; sub: string; icon: React.ComponentType<{ size?: number }>; color: string }) {
  return (
    <div className="kpi-card">
      <div className="kpi-top">
        <div className="kpi-icon" style={{ background: `linear-gradient(135deg, ${color}33, transparent)`, color }}>
          <Icon size={16} />
        </div>
        <div className="kpi-label">{label}</div>
      </div>
      <div className="kpi-mid">
        <div className="kpi-value">{value}</div>
      </div>
      <div className="kpi-trend-sub" style={{ fontSize: 11 }}>{sub}</div>
    </div>
  );
}

function CategoryRow({
  name, desc, color, pct, icon: Icon, active, onClick,
}: {
  name: string; desc: string; color: string; pct: number;
  icon: React.ComponentType<{ size?: number }>; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: 10,
        textAlign: 'left', justifyContent: 'flex-start',
        background: active ? 'var(--grad-accent-soft)' : 'rgba(255,255,255,0.025)',
        borderColor: active ? 'rgba(var(--accent-rgb) / 0.35)' : 'var(--border)',
      }}
    >
      <span style={{ width: 28, height: 28, borderRadius: 8, background: `${color}22`, color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={14} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>
          <span>{name}</span>
          <span className="mono" style={{ color: 'var(--text-muted)' }}>{pct}%</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{desc}</div>
        <div className="progress" style={{ marginTop: 6, height: 4 }}>
          <span style={{ width: `${pct}%`, background: color, boxShadow: 'none' }} />
        </div>
      </div>
    </button>
  );
}

function PathPair({ pref, backup }: { pref: AppPolicy['preferredPath']; backup: AppPolicy['backupPath'] }) {
  const Pref = pref === 'Fiber' ? Cable : pref === '5G' ? Radio : Shuffle;
  const c = useThemeColors();
  const prefColor = pref === 'Fiber' ? c.accent : pref === '5G' ? c.accent2 : c.textDim;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: prefColor, fontWeight: 600 }}>
        <Pref size={12} />{pref}
      </span>
      {backup !== 'None' && (
        <>
          <ArrowRight size={11} style={{ color: 'var(--text-muted)' }} />
          <span style={{ color: 'var(--text-muted)' }}>{backup}</span>
        </>
      )}
    </div>
  );
}

function RuleRow({ kind, value, desc }: { kind: string; value: string; desc: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 0', borderBottom: '1px dashed var(--border)' }}>
      <span className="badge" style={{ minWidth: 60, justifyContent: 'center' }}>{kind}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="mono" style={{ fontSize: 12.5, color: 'var(--text)' }}>{value}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>
      </div>
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{label}</span>
      <div style={{ display: 'flex' }}>
        {children}
      </div>
      <style>{`label > div > input, label > div > select { flex: 1; }`}</style>
    </label>
  );
}

/* App → Path Sankey-ish flow diagram */
function AppFlowDiagram() {
  const W = 760, H = 360;
  const leftX = 80, rightX = W - 80;
  const lanes = appCategories;
  const tc = useThemeColors();
  const { theme } = useTheme();
  const surface = theme === 'dark' ? 'rgba(14,12,32,0.95)' : '#ffffff';

  const top = 30, gap = (H - 60) / (lanes.length - 1);
  const leftPoints = lanes.map((cat, i) => ({ ...cat, y: top + i * gap }));

  const right: Array<{ name: 'Fiber' | '5G' | 'Auto'; y: number; color: string }> = [
    { name: 'Fiber', y: 80,    color: tc.accent  },
    { name: 'Auto',  y: H/2,   color: tc.accent3 },
    { name: '5G',    y: H-80,  color: tc.accent2 },
  ];

  // Determine routing per category by aggregating its policies
  function pathForCat(id: AppCategory['id']): 'Fiber' | '5G' | 'Auto' {
    const ps = appPolicies.filter((p) => p.category === id && p.enabled);
    if (ps.length === 0) return 'Auto';
    const counts: Record<string, number> = { Fiber: 0, '5G': 0, Auto: 0 };
    ps.forEach((p) => counts[p.preferredPath]++);
    return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]) as 'Fiber' | '5G' | 'Auto';
  }

  const hexRgb = (hex: string) => {
    const h = hex.startsWith('#') ? hex.slice(1) : hex;
    return `${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)}`;
  };
  const fiberRgb = hexRgb(tc.accent);
  const fivegRgb = hexRgb(tc.accent2);
  const autoRgb  = hexRgb(tc.accent3);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      <defs>
        <linearGradient id="flow-fiber" x1="0" x2="1">
          <stop offset="0%"   stopColor={`rgba(${fiberRgb},0.40)`} />
          <stop offset="100%" stopColor={`rgba(${fiberRgb},0.90)`} />
        </linearGradient>
        <linearGradient id="flow-5g" x1="0" x2="1">
          <stop offset="0%"   stopColor={`rgba(${fivegRgb},0.40)`} />
          <stop offset="100%" stopColor={`rgba(${fivegRgb},0.90)`} />
        </linearGradient>
        <linearGradient id="flow-auto" x1="0" x2="1">
          <stop offset="0%"   stopColor={`rgba(${autoRgb},0.30)`} />
          <stop offset="100%" stopColor={`rgba(${autoRgb},0.70)`} />
        </linearGradient>
      </defs>

      {/* Flows */}
      {leftPoints.map((p) => {
        const dest = pathForCat(p.id);
        const r = right.find((x) => x.name === dest)!;
        const grad = dest === 'Fiber' ? 'url(#flow-fiber)' : dest === '5G' ? 'url(#flow-5g)' : 'url(#flow-auto)';
        const thickness = Math.max(4, p.trafficSharePct * 0.7);
        return (
          <path
            key={p.id}
            d={`M ${leftX} ${p.y} C ${(leftX + rightX) / 2} ${p.y}, ${(leftX + rightX) / 2} ${r.y}, ${rightX} ${r.y}`}
            stroke={grad} strokeWidth={thickness} fill="none" opacity="0.85" strokeLinecap="round"
          />
        );
      })}

      {/* Left nodes (apps) */}
      {leftPoints.map((p) => {
        const Icon = catIcon[p.id];
        return (
          <g key={p.id} transform={`translate(${leftX} ${p.y})`}>
            <circle r={20} fill={surface} stroke={p.color} strokeWidth={1.5} />
            <foreignObject x={-10} y={-10} width="20" height="20">
              <div style={{ color: p.color, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={14} />
              </div>
            </foreignObject>
            <text x={-30} y={-2} textAnchor="end" fontSize="12" fontWeight="600" fill={tc.text}>{p.name}</text>
            <text x={-30} y={12} textAnchor="end" fontSize="10" fill={tc.textMuted}>{p.trafficSharePct}% share</text>
          </g>
        );
      })}

      {/* Right nodes (paths) */}
      {right.map((r) => (
        <g key={r.name} transform={`translate(${rightX} ${r.y})`}>
          <circle r={26} fill={surface} stroke={r.color} strokeWidth={1.75} />
          <text y={4} textAnchor="middle" fontSize="13" fontWeight="700" fill={r.color}>{r.name}</text>
          <text x={36} y={-4} textAnchor="start" fontSize="11" fontWeight="600" fill={tc.text}>{r.name === 'Auto' ? 'Best of both' : r.name}</text>
          <text x={36} y={10} textAnchor="start" fontSize="10" fill={tc.textMuted}>
            {r.name === 'Fiber' ? 'realtime + business' : r.name === '5G' ? 'bulk + backup' : 'SLA-driven'}
          </text>
        </g>
      ))}
    </svg>
  );
}
