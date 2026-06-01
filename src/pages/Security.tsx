import { useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { useThemeColors } from '../ui/Theme';
import {
  complianceChecks, dnsBlocks, threatEvents, threatSources, threatTrend,
} from '../data/mock';
import type {
  ComplianceCheck, DnsBlock, ThreatCategory, ThreatEvent, ThreatSource,
} from '../types';
import {
  AlertOctagon, Ban, Bug, CheckCircle2, Crosshair, Database, Download, Filter,
  Globe, Globe2, Lock, MapPin, Network, RadioTower, Search, Shield, ShieldAlert,
  ShieldCheck, Skull, XCircle, Zap,
} from 'lucide-react';

/* ────────── Helpers ────────── */

const CAT_LABEL: Record<ThreatCategory, string> = {
  malware:    'Malware',
  bruteforce: 'Brute-force',
  recon:      'Recon / scan',
  ddos:       'DDoS',
  phishing:   'Phishing',
  c2:         'C2 callback',
  dlp:        'DLP',
  policy:     'Policy',
};

const CAT_ICON: Record<ThreatCategory, React.ComponentType<{ size?: number }>> = {
  malware:    Bug,
  bruteforce: Lock,
  recon:      Crosshair,
  ddos:       Zap,
  phishing:   Globe,
  c2:         RadioTower,
  dlp:        Database,
  policy:     Shield,
};

const SEV_BADGE: Record<ThreatEvent['severity'], string> = {
  low:      '',
  medium:   'warn',
  high:     'err',
  critical: 'err',
};

const ACTION_LABEL: Record<ThreatEvent['action'], string> = {
  blocked:          'Blocked',
  alerted:          'Alerted',
  'allowed-logged': 'Logged',
  quarantined:      'Quarantined',
};

function timeAgo(iso: string) {
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/* ────────── Page ────────── */

export function SecurityPage() {
  const [filter, setFilter] = useState<'all' | ThreatCategory>('all');

  const filteredEvents = useMemo(
    () => filter === 'all' ? threatEvents : threatEvents.filter((e) => e.category === filter),
    [filter],
  );

  // Aggregate KPIs across the trend (24h totals)
  const totals = threatTrend.reduce(
    (acc, p) => ({
      blocked:    acc.blocked   + p.malware + p.bruteforce + p.recon + p.ddos + p.phishing + p.c2,
      bruteforce: acc.bruteforce + p.bruteforce,
      malware:    acc.malware   + p.malware,
      c2:         acc.c2        + p.c2,
      ddos:       acc.ddos      + p.ddos,
    }),
    { blocked: 0, bruteforce: 0, malware: 0, c2: 0, ddos: 0 },
  );
  const criticals = threatEvents.filter((e) => e.severity === 'critical').length;
  const compliancePass = complianceChecks.filter((c) => c.status === 'pass').length;
  const complianceWarn = complianceChecks.filter((c) => c.status === 'warn').length;
  const compliancePct = Math.round((compliancePass / complianceChecks.length) * 100);

  return (
    <>
      <PageHeader
        title="Security & Threats"
        subtitle="Fleet-wide firewall, IDS, DDoS scrubber, web gateway and DNS security telemetry — last 24 h"
        right={
          <div className="toolbar">
            <button><Download size={14} />Export incident report</button>
          </div>
        }
      />

      <div className="kpi-strip" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <SecKpi label="Threats blocked (24h)" value={String(totals.blocked)}      sub={`${totals.bruteforce} bruteforce · ${totals.malware} malware`} icon={ShieldCheck} accent="var(--ok)" />
        <SecKpi label="Critical alerts"       value={String(criticals)}            sub="quarantined or escalated" icon={AlertOctagon} accent="var(--err)" />
        <SecKpi label="DNS blocks (24h)"      value={String(dnsBlocks.reduce((s, d) => s + d.hits, 0))} sub={`${dnsBlocks.length} unique domains`} icon={Ban} accent="var(--accent-2)" />
        <SecKpi label="Compliance score"      value={`${compliancePct}%`}          sub={`${compliancePass} pass · ${complianceWarn} warn`}        icon={Shield} accent="var(--accent)" />
      </div>

      <div className="grid">
        {/* Row 1 — 24h trend chart */}
        <div className="col-12">
          <Card
            title="Threats over the last 24 h"
            sub="Stacked by category · bruteforce spikes overnight, recon during business hours"
            right={<span className="badge ok"><span className="dot ok" /> Streaming</span>}
          >
            <ThreatTrendChart />
          </Card>
        </div>

        {/* Row 2 — Live event feed + Top sources */}
        <div className="col-7">
          <Card
            title="Live threat feed"
            sub={`${filteredEvents.length} events · ${filter === 'all' ? 'all categories' : CAT_LABEL[filter]}`}
            right={
              <div className="toolbar">
                <button
                  onClick={() => setFilter('all')}
                  style={filter === 'all'
                    ? { background: 'var(--grad-accent-soft)', borderColor: 'var(--accent)', color: 'var(--text)' }
                    : undefined}
                >All</button>
                {(['bruteforce', 'malware', 'phishing', 'c2', 'recon', 'ddos', 'dlp'] as ThreatCategory[]).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setFilter(cat)}
                    style={filter === cat
                      ? { background: 'var(--grad-accent-soft)', borderColor: 'var(--accent)', color: 'var(--text)' }
                      : undefined}
                  >
                    {CAT_LABEL[cat]}
                  </button>
                ))}
              </div>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filteredEvents.map((e) => <ThreatRow key={e.id} event={e} />)}
              {filteredEvents.length === 0 && (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5, fontStyle: 'italic' }}>
                  No events in this filter.
                </div>
              )}
            </div>
          </Card>
        </div>
        <div className="col-5">
          <Card
            title="Top attack sources"
            sub="Last 24 h · ranked by attack count"
            right={<MapPin size={13} style={{ color: 'var(--text-muted)' }} />}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {threatSources.map((s, i) => <SourceRow key={s.asn} source={s} rank={i + 1} />)}
            </div>
          </Card>
        </div>

        {/* Row 3 — DNS blocks + Category mix */}
        <div className="col-7">
          <Card
            title="DNS security · blocked domains"
            sub={`${dnsBlocks.reduce((s, d) => s + d.hits, 0)} blocks across ${dnsBlocks.length} unique domains`}
            right={<Search size={13} style={{ color: 'var(--text-muted)' }} />}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {dnsBlocks.map((d) => <DnsRow key={d.domain} dns={d} />)}
            </div>
          </Card>
        </div>
        <div className="col-5">
          <Card
            title="Category mix (24h)"
            sub="Where the noise is coming from"
          >
            <CategoryMix />
          </Card>
        </div>

        {/* Row 4 — Compliance posture */}
        <div className="col-12">
          <Card
            title="Compliance posture"
            sub={`${compliancePass} / ${complianceChecks.length} controls passing · ${complianceWarn} warnings`}
            right={<span className={`badge ${compliancePct === 100 ? 'ok' : 'warn'}`}>{compliancePct}%</span>}
          >
            <ComplianceGrid />
          </Card>
        </div>
      </div>
    </>
  );
}

/* ────────── KPI tile ────────── */

function SecKpi({
  label, value, sub, icon: Icon, accent,
}: {
  label: string; value: string; sub: string;
  icon: React.ComponentType<{ size?: number }>; accent: string;
}) {
  return (
    <div className="kpi-card">
      <div className="kpi-top">
        <div className="kpi-icon" style={{ color: accent, background: `linear-gradient(135deg, ${accent}33, transparent)` }}>
          <Icon size={16} />
        </div>
        <div className="kpi-label">{label}</div>
      </div>
      <div className="kpi-mid"><div className="kpi-value" style={{ color: accent }}>{value}</div></div>
      <div className="kpi-trend-sub" style={{ fontSize: 11 }}>{sub}</div>
    </div>
  );
}

/* ────────── Trend chart ────────── */

function ThreatTrendChart() {
  const c = useThemeColors();
  const series: { key: keyof typeof threatTrend[number]; name: string; color: string }[] = [
    { key: 'bruteforce', name: 'Brute-force',  color: c.warn    },
    { key: 'recon',      name: 'Recon',        color: c.accent  },
    { key: 'malware',    name: 'Malware',      color: c.err     },
    { key: 'phishing',   name: 'Phishing',     color: c.accent2 },
    { key: 'c2',         name: 'C2 callback',  color: c.accent3 },
    { key: 'ddos',       name: 'DDoS',         color: '#67e8f9' },
  ];
  return (
    <div style={{ height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={threatTrend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={String(s.key)} id={`sec-${String(s.key)}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.7} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.05} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke={c.chartGrid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="hour" stroke={c.textMuted} fontSize={11} tickLine={false} axisLine={false}
            tickFormatter={(v: string, i: number) => (i % 3 === 0 ? v : '')} interval={0} />
          <YAxis stroke={c.textMuted} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              background: c.tooltipBg,
              border: `1px solid ${c.tooltipBorder}`,
              borderRadius: 10,
              fontSize: 12,
              backdropFilter: 'blur(10px)',
            }}
            labelStyle={{ color: c.textDim, marginBottom: 4 }}
          />
          <Legend wrapperStyle={{ fontSize: 11.5, paddingTop: 6 }} iconType="square" />
          {series.map((s) => (
            <Area
              key={String(s.key)}
              type="monotone"
              dataKey={String(s.key)}
              name={s.name}
              stackId="1"
              stroke={s.color}
              fill={`url(#sec-${String(s.key)})`}
              strokeWidth={1.5}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ────────── Live threat row ────────── */

function ThreatRow({ event }: { event: ThreatEvent }) {
  const Icon = CAT_ICON[event.category];
  const sevClass = SEV_BADGE[event.severity];
  const actionColor =
    event.action === 'quarantined' ? 'var(--err)' :
    event.action === 'blocked'     ? 'var(--ok)' :
    event.action === 'alerted'     ? 'var(--warn)' : 'var(--text-muted)';
  const sevBorder =
    event.severity === 'critical' ? 'var(--err)' :
    event.severity === 'high'     ? 'var(--err)' :
    event.severity === 'medium'   ? 'var(--warn)' : 'var(--text-muted)';
  return (
    <div className="conn-row" style={{ borderLeftColor: sevBorder, alignItems: 'flex-start' }}>
      <span style={{ color: sevBorder, display: 'inline-flex', flexShrink: 0, marginTop: 1 }}>
        <Icon size={14} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className={`badge ${sevClass}`} style={{ fontSize: 10 }}>{event.severity.toUpperCase()}</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>
            {CAT_LABEL[event.category]}
          </span>
          <span style={{ fontSize: 11, color: actionColor, fontWeight: 600 }}>
            · {ACTION_LABEL[event.action]}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
            {timeAgo(event.ts)} ago
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.45 }}>
          {event.detail}
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)', marginTop: 4, flexWrap: 'wrap' }}>
          <span>{event.sourceFlag} {event.sourceIp}</span>
          <span>→</span>
          <span>{event.destination}</span>
          <span className="mono" style={{ marginLeft: 'auto', color: 'var(--text-dim)' }}>{event.rule}</span>
        </div>
      </div>
    </div>
  );
}

/* ────────── Source row ────────── */

function SourceRow({ source, rank }: { source: ThreatSource; rank: number }) {
  return (
    <div className="conn-row" style={{ borderLeftColor: 'var(--err)' }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', minWidth: 18, textAlign: 'center' }}>
        {rank}
      </span>
      <span style={{ fontSize: 18 }}>{source.flag}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {source.country}
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
          {source.asn} · {source.asnName}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--err)', fontVariantNumeric: 'tabular-nums' }}>
          {source.count}
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
          {CAT_LABEL[source.primaryCategory]}
        </div>
      </div>
    </div>
  );
}

/* ────────── DNS row ────────── */

function DnsRow({ dns }: { dns: DnsBlock }) {
  const catColor =
    dns.category === 'malware' || dns.category === 'c2' ? 'var(--err)' :
    dns.category === 'phishing' || dns.category === 'cryptomining' ? 'var(--warn)' : 'var(--text-muted)';
  return (
    <div className="conn-row" style={{ borderLeftColor: catColor }}>
      <span style={{ color: catColor, display: 'inline-flex', flexShrink: 0 }}>
        <Ban size={13} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="mono" style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {dns.domain}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {dns.category} · last hit {timeAgo(dns.lastHitISO)} ago · {dns.branches.length} branch{dns.branches.length === 1 ? '' : 'es'}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: catColor, fontVariantNumeric: 'tabular-nums' }}>
          {dns.hits}
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>blocks</div>
      </div>
    </div>
  );
}

/* ────────── Category mix bars ────────── */

function CategoryMix() {
  const totals: Record<'bruteforce' | 'recon' | 'malware' | 'phishing' | 'c2' | 'ddos', number> = {
    bruteforce: 0, recon: 0, malware: 0, phishing: 0, c2: 0, ddos: 0,
  };
  for (const p of threatTrend) {
    totals.bruteforce += p.bruteforce;
    totals.recon      += p.recon;
    totals.malware    += p.malware;
    totals.phishing   += p.phishing;
    totals.c2         += p.c2;
    totals.ddos       += p.ddos;
  }
  const grand = totals.bruteforce + totals.recon + totals.malware + totals.phishing + totals.c2 + totals.ddos || 1;
  const rows: { cat: ThreatCategory; n: number; color: string }[] = [
    { cat: 'bruteforce', n: totals.bruteforce, color: 'var(--warn)'    },
    { cat: 'recon',      n: totals.recon,      color: 'var(--accent)'  },
    { cat: 'malware',    n: totals.malware,    color: 'var(--err)'     },
    { cat: 'phishing',   n: totals.phishing,   color: 'var(--accent-2)' },
    { cat: 'c2',         n: totals.c2,         color: 'var(--accent-3)' },
    { cat: 'ddos',       n: totals.ddos,       color: '#67e8f9'        },
  ];
  rows.sort((a, b) => b.n - a.n);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((r) => {
        const pct = (r.n / grand) * 100;
        const Icon = CAT_ICON[r.cat];
        return (
          <div key={r.cat}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, marginBottom: 4 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text)' }}>
                <Icon size={12} />
                {CAT_LABEL[r.cat]}
              </span>
              <span style={{ color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums', fontSize: 11 }}>
                {r.n} · {pct.toFixed(1)}%
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: r.color, borderRadius: 3, transition: 'width 0.4s' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ────────── Compliance grid ────────── */

function ComplianceGrid() {
  const byFw = new Map<ComplianceCheck['framework'], ComplianceCheck[]>();
  for (const c of complianceChecks) {
    const arr = byFw.get(c.framework) ?? [];
    arr.push(c);
    byFw.set(c.framework, arr);
  }
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12,
    }}>
      {[...byFw.entries()].map(([fw, checks]) => {
        const pass = checks.filter((c) => c.status === 'pass').length;
        const total = checks.length;
        const pct = (pass / total) * 100;
        return (
          <div key={fw} style={{
            padding: 12, background: 'var(--surface-1)',
            border: '1px solid var(--border)', borderRadius: 10,
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{fw}</div>
              <span className={`badge ${pct === 100 ? 'ok' : 'warn'}`} style={{ fontSize: 10 }}>
                {pass} / {total}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {checks.map((c) => {
                const Icon = c.status === 'pass' ? CheckCircle2 : c.status === 'warn' ? ShieldAlert : XCircle;
                const color = c.status === 'pass' ? 'var(--ok)' : c.status === 'warn' ? 'var(--warn)' : 'var(--err)';
                return (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    <span style={{ color, display: 'inline-flex', marginTop: 1, flexShrink: 0 }}>
                      <Icon size={12} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11.5, color: 'var(--text)', fontWeight: 500 }}>
                        <span className="mono" style={{ color: 'var(--text-dim)' }}>{c.control}</span> · {c.title}
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                        {c.detail}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Silence unused-import warnings for icons reserved for future expansion.
const _unused = { Skull, Globe2, Network, Filter };
void _unused;
