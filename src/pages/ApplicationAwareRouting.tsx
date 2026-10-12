import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import {
  Layers, Plus, Search, ArrowRight, Cable, Radio, Shuffle,
  Mic, Video, Briefcase, Globe, Cloud, Cpu, Power, Sparkles,
} from 'lucide-react';
import { appCategories, appPolicies } from '../data/mock';
import type { AppCategory, AppCategoryId, AppPolicy } from '../types';
import { useTheme, useThemeColors } from '../ui/Theme';
import { AiInsightCard } from '../components/widgets/AiInsightCard';
import { AppSteeringPatchboard } from '../components/widgets/AppSteeringPatchboard';
import { useRoutingConfig } from '../ui/useRoutingConfig';
import { ROUTING_TEMPLATES, validateRoutingPolicy } from '../../shared/routing-config';

const catIcon: Record<AppCategoryId, React.ComponentType<{ size?: number }>> = {
  voice: Mic, video: Video, business: Briefcase, web: Globe, bulk: Cloud, iot: Cpu,
};

const slaBadge = {
  realtime:    'err',
  business:    'warn',
  'best-effort': '',
} as const;

export function ApplicationAwareRoutingPage({ branchId }: { branchId: string }) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<AppPolicy | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const { config, loading, saving, error, save, refresh } = useRoutingConfig(branchId);
  const policies = useMemo(() => config.branchId === branchId ? config.policies : [], [branchId, config]);
  const { push } = useToast();
  const chart = useThemeColors();

  const editPolicy = (policy: AppPolicy) => { setEditing({ ...policy }); setFormError(''); };
  const updateField = <K extends keyof AppPolicy>(key: K, value: AppPolicy[K]) => {
    setEditing((previous) => previous ? { ...previous, [key]: value } : previous);
    setFormError('');
  };
  const persistPolicies = async (next: AppPolicy[], title: string) => {
    try {
      await save({ policies: next });
      push({ kind: 'success', title, detail: 'Saved for this branch on the application server.' });
      return true;
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setFormError(detail);
      push({ kind: 'error', title: 'Routing configuration was not saved', detail });
      return false;
    }
  };
  const savePolicy = async () => {
    if (!editing || saving) return;
    const next = { ...editing, id: editing.id || `policy-${crypto.randomUUID()}`, app: editing.app.trim(), match: editing.match.trim() };
    const validation = validateRoutingPolicy(next);
    if (validation) { setFormError(validation); return; }
    const updated = editing.id ? policies.map((p) => p.id === next.id ? next : p) : [...policies, next];
    if (await persistPolicies(updated, editing.id ? 'Policy updated' : 'Policy created')) setEditing(null);
  };

  const list = useMemo(
    () => policies
      .filter((p) => !query || p.app.toLowerCase().includes(query.toLowerCase()) || p.match.toLowerCase().includes(query.toLowerCase())),
    [query, policies],
  );

  const totals = {
    apps: policies.length,
    enabled: policies.filter((p) => p.enabled).length,
    realtime: policies.filter((p) => p.slaClass === 'realtime').length,
    flowsPerMin: policies.reduce((s, p) => s + p.hitsPerMin, 0),
    throughput: policies.reduce((s, p) => s + p.throughputMbps, 0),
  };

  const topApps = [...policies]
    .sort((a, b) => b.throughputMbps - a.throughputMbps)
    .slice(0, 6)
    .map((p) => ({ name: p.app.length > 14 ? p.app.slice(0, 13) + '…' : p.app, mbps: p.throughputMbps, color: appCategories.find(c => c.id === p.category)!.color }));

  return (
    <>
      <PageHeader
        title="Application Traffic Routing"
        subtitle="Identify each application, then steer it to the WAN path that meets its SLA class"
        right={
          <div className="toolbar">
            <button disabled={loading || saving} onClick={() => setTemplatesOpen(true)}><Layers size={14} />Templates</button>
            <button className="primary" disabled={loading || saving} onClick={() => editPolicy({
              id: '', app: '', category: 'business', preferredPath: 'Auto', backupPath: 'None',
              match: '', hitsPerMin: 0, throughputMbps: 0, slaClass: 'business', enabled: true,
            })}><Plus size={14} />New policy</button>
          </div>
        }
      />

      <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
        Policies are saved branch configuration for planning and analysis. Use the live patchboard below to publish individual application routes to the gateway. Policy counters await live telemetry.
      </p>
      {loading && <p role="status">Loading routing configuration…</p>}
      {error && <div role="alert" style={{ color: 'var(--err)', marginBottom: 12 }}>{error} <button onClick={() => void refresh()} disabled={saving || loading}>Retry loading</button></div>}

      {/* KPI strip */}
      <div className="kpi-strip" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <SmallStat label="Apps tracked" value={String(totals.apps)} sub={`${totals.enabled} enabled`} icon={Layers} color="var(--accent)" />
        <SmallStat label="Real-time apps" value={String(totals.realtime)} sub="configured SLA class" icon={Mic} color="var(--err)" />
        <SmallStat label="Flows / min" value={totals.flowsPerMin.toLocaleString()} sub="across all policies" icon={Shuffle} color="var(--accent-2)" />
        <SmallStat label="Throughput" value={`${totals.throughput} Mbps`} sub="aggregate now" icon={Cloud} color="var(--ok)" />
      </div>

      <div className="grid">
        {/* Application Steering Patchboard — drag a client's app onto a tunnel */}
        <div className="col-8">
          <Card
            title="Application Steering Patchboard"
            sub="Each client carries one application — grab its plug and patch it into a different tunnel; the change publishes as a proto3 AppRouteCommand on the gateway's approute topic"
          >
            <AppSteeringPatchboard branchId={branchId} externalAdvisorTrigger advisorHostId="app-route-advisor-widget" />
          </Card>
        </div>

        {/* AI route advisor — controls the advisor attached to the patchboard */}
        <div className="col-4">
          <Card title="AI Advisor" sub="Compare live tunnel conditions and suggest better application routes">
            <div id="app-route-advisor-widget" style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 120 }}>
              <div style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6 }}>
                The advisor evaluates current tunnel latency, reachability, load, and frozen clients before suggesting a route change.
              </div>
              <button
                className="primary"
                onClick={() => {
                  const trigger = document.querySelector<HTMLButtonElement>('[data-route-advisor-trigger]');
                  if (trigger) trigger.click();
                  else push({ kind: 'error', title: 'Advisor is unavailable', detail: 'Wait for the patchboard to finish loading and try again.' });
                }}
                style={{ alignSelf: 'flex-start' }}
              >
                <Sparkles size={14} /> Run AI advisor
              </button>
            </div>
          </Card>
        </div>

        {/* AI insight remains in its normal full-width analysis position */}
        <div className="col-12">
          <AiInsightCard
            topic="app-routing"
            subtitle="Review of routing policies against SLA classes"
            data={{
              totals,
              categories: appCategories.map((c) => ({
                id: c.id, name: c.name, trafficSharePct: c.trafficSharePct,
              })),
              policies: policies.map((p) => ({
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

        {/* Policy table */}
        <div className="col-12">
          <Card
            title="Routing policies"
            sub={`${list.length} saved policies shown · click a policy to edit`}
            right={
              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, color: 'var(--text-muted)' }} />
                <input
                  placeholder="Search app or match rule"
                  aria-label="Search routing policies"
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
                    <tr key={p.id} style={{ cursor: 'pointer' }} tabIndex={0} onClick={() => !saving && editPolicy(p)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); if (!saving) editPolicy(p); } }}>
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
                          aria-label={`${p.enabled ? 'Disable' : 'Enable'} ${p.app} policy`}
                          disabled={loading || saving}
                          onClick={() => void persistPolicies(policies.map((policy) => policy.id === p.id ? { ...policy, enabled: !policy.enabled } : policy), `${p.app} ${p.enabled ? 'disabled' : 'enabled'}`)}
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
          <Card title="Top apps by bandwidth" sub="Saved policies · counters await live telemetry">
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
                      <Cell key={i} fill={`url(#bar-${i})`} />
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
        onClose={() => { if (!saving) setEditing(null); }}
        title={editing?.id ? `Edit policy — ${editing.app}` : 'New routing policy'}
        width={520}
        footer={
          <>
            {editing?.id && <button disabled={saving} style={{ marginRight: 'auto', color: 'var(--err)' }} onClick={async () => { if (await persistPolicies(policies.filter((p) => p.id !== editing.id), 'Policy deleted')) setEditing(null); }}>Delete policy</button>}
            <button disabled={saving} onClick={() => setEditing(null)}>Cancel</button>
            <button
              className="primary"
              disabled={saving || loading}
              onClick={() => void savePolicy()}
            >
              {saving ? 'Saving…' : 'Save policy'}
            </button>
          </>
        }
      >
        {editing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {formError && <p role="alert" style={{ color: 'var(--err)', margin: 0 }}>{formError}</p>}
            <FormRow label="Application name">
              <input value={editing.app} onChange={(event) => updateField('app', event.target.value)} maxLength={100} disabled={saving} placeholder="e.g. Salesforce" />
            </FormRow>
            <FormRow label="Match rule">
              <input value={editing.match} onChange={(event) => updateField('match', event.target.value)} maxLength={500} disabled={saving} placeholder="e.g. *.salesforce.com or DSCP EF" />
            </FormRow>
            <FormRow label="Category">
              <select value={editing.category} disabled={saving} onChange={(event) => updateField('category', event.target.value as AppPolicy['category'])}>
                {appCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </FormRow>
            <FormRow label="SLA class">
              <select value={editing.slaClass} disabled={saving} onChange={(event) => updateField('slaClass', event.target.value as AppPolicy['slaClass'])}>
                <option value="realtime">Real-time (voice/video)</option>
                <option value="business">Business critical</option>
                <option value="best-effort">Best effort</option>
              </select>
            </FormRow>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <FormRow label="Preferred path">
                <select value={editing.preferredPath} disabled={saving} onChange={(event) => updateField('preferredPath', event.target.value as AppPolicy['preferredPath'])}>
                  <option>Auto</option><option>Fiber</option><option>5G</option>
                </select>
              </FormRow>
              <FormRow label="Backup path">
                <select value={editing.backupPath} disabled={saving} onChange={(event) => updateField('backupPath', event.target.value as AppPolicy['backupPath'])}>
                  <option>None</option><option>Fiber</option><option>5G</option>
                </select>
              </FormRow>
            </div>
          </div>
        )}
      </Modal>
      <Modal open={templatesOpen} onClose={() => setTemplatesOpen(false)} title="Routing policy templates" width={560}>
        <p style={{ color: 'var(--text-dim)' }}>Choose a starting policy, review its match rule and paths, then save it for this branch.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ROUTING_TEMPLATES.map((template) => <button key={template.id} style={{ justifyContent: 'space-between' }} onClick={() => { setTemplatesOpen(false); editPolicy({ ...template, id: '' }); }}><span>{template.app}</span><span style={{ color: 'var(--text-muted)' }}>{template.slaClass} · {template.preferredPath}</span></button>)}
        </div>
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
export function AppFlowDiagram() {
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
