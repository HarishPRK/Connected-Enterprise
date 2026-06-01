import { useMemo, useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { useThemeColors } from '../ui/Theme';
import {
  bandwidthRxTx, connEvents, dnsStats, fiberLink, fiveGLink,
  publicNetInfo, reachabilityProbes,
} from '../data/mock';
import type { ConnEvent, ConnEventKind, ReachabilityProbe } from '../types';
import {
  ArrowDown, ArrowUp, ArrowLeftRight, AlertTriangle, CheckCircle2, Cable,
  Cloud, Database, Globe2, Key, Network, Radio, RefreshCcw, Repeat,
  Router as RouterIcon, ShieldAlert, Wifi, Zap, Search,
} from 'lucide-react';
import { AiInsightCard } from '../components/widgets/AiInsightCard';

/* ────────── Connectivity — diagnostic deep-dive
 *
 * Distinct from the Overview page, which shows status. This page surfaces
 * troubleshooting telemetry that wouldn't fit there:
 *  • Per-WAN deep metrics (Fiber: optical Rx dBm, FCS errors, MTU.
 *                          5G: RSSI, SINR, band, cell, neighbours).
 *  • Throughput split — Rx vs Tx over the last 24 h.
 *  • Reachability probes — round-trip + success% to internet / AWS / SaaS.
 *  • DNS performance — top resolved domains + failures.
 *  • Public IP / NAT / ASN / port mappings.
 *  • Connection event log — flaps, failovers, IPsec rekeys, BGP, DHCP.
 */

const EVENT_ICON: Record<ConnEventKind, React.ComponentType<{ size?: number }>> = {
  link_flap:   AlertTriangle,
  failover:    Repeat,
  failback:    RefreshCcw,
  dhcp_renew:  Key,
  ipsec_rekey: ShieldAlert,
  bgp_up:      ArrowUp,
  bgp_down:    ArrowDown,
  dns_failure: Globe2,
  nat_overflow: Network,
  mtu_change:  ArrowLeftRight,
};

const EVENT_LABEL: Record<ConnEventKind, string> = {
  link_flap:   'Link flap',
  failover:    'Failover',
  failback:    'Failback',
  dhcp_renew:  'DHCP renew',
  ipsec_rekey: 'IPsec rekey',
  bgp_up:      'BGP up',
  bgp_down:    'BGP down',
  dns_failure: 'DNS failure',
  nat_overflow: 'NAT overflow',
  mtu_change:  'MTU change',
};

const PROBE_CATEGORY_ICON: Record<ReachabilityProbe['category'], React.ComponentType<{ size?: number }>> = {
  internet: Globe2,
  aws:      Cloud,
  saas:     Database,
  dns:      Network,
  gateway:  RouterIcon,
};

function timeAgo(iso: string) {
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function fmtUptime(h: number) {
  const d = Math.floor(h / 24); const r = h % 24;
  return `${d}d ${r}h`;
}

export function Connectivity() {
  const c = useThemeColors();
  const [eventFilter, setEventFilter] = useState<'all' | 'warn-err'>('all');

  const filteredEvents = useMemo(
    () =>
      eventFilter === 'all'
        ? connEvents
        : connEvents.filter((e) => e.severity !== 'ok'),
    [eventFilter],
  );

  const totalLookups = dnsStats.reduce((s, d) => s + d.lookupsLastHour, 0);
  const totalDnsFailures = dnsStats.reduce((s, d) => s + d.failures, 0);
  const probeSuccessAvg =
    reachabilityProbes.reduce((s, p) => s + p.successPct, 0) / reachabilityProbes.length;
  const natPct = (publicNetInfo.natTableSize / publicNetInfo.natTableMax) * 100;

  return (
    <>
      <PageHeader
        title="Connectivity"
        subtitle="Deep-dive diagnostics: WAN link health, reachability probes, DNS performance, connection events"
      />

      <div className="grid">
        {/* ── Row 0: AI insight across the whole connectivity snapshot ── */}
        <div className="col-12">
          <AiInsightCard
            topic="connectivity"
            subtitle="Bedrock analysis of WAN health, reachability, DNS and recent events"
            data={{
              fiber: fiberLink,
              fiveG: fiveGLink,
              reachabilityProbes,
              dnsStats: {
                totalLookups,
                totalFailures: totalDnsFailures,
                domains: dnsStats,
              },
              publicNet: publicNetInfo,
              natUtilizationPct: natPct,
              probeSuccessAvgPct: probeSuccessAvg,
              recentEvents: filteredEvents.slice(0, 12).map((e) => ({
                kind: e.kind,
                severity: e.severity,
                wan: e.wan,
                ts: e.ts,
                detail: e.detail,
              })),
            }}
          />
        </div>

        {/* ── Row 1: WAN deep-dive (Fiber + 5G side by side) ── */}
        <div className="col-6"><FiberDeepCard /></div>
        <div className="col-6"><FiveGDeepCard /></div>

        {/* ── Row 2: Throughput Rx vs Tx ── */}
        <div className="col-12">
          <Card
            title="Throughput — Rx vs Tx, last 24h"
            sub="Download (Rx) vs Upload (Tx) on the active WAN, 30-minute bins"
          >
            <RxTxChart />
          </Card>
        </div>

        {/* ── Row 3: Reachability probes + DNS performance ── */}
        <div className="col-7">
          <Card
            title="Reachability probes"
            sub={`Avg success ${probeSuccessAvg.toFixed(1)}% across ${reachabilityProbes.length} synthetic targets`}
            right={<span className="badge ok"><span className="dot ok" />Healthy</span>}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {reachabilityProbes.map((p) => (
                <ProbeRow key={p.id} probe={p} />
              ))}
            </div>
          </Card>
        </div>
        <div className="col-5">
          <Card
            title="DNS performance"
            sub={`${totalLookups.toLocaleString()} lookups / hour · ${totalDnsFailures} failure${totalDnsFailures === 1 ? '' : 's'}`}
            right={<Search size={14} style={{ color: 'var(--text-muted)' }} />}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {dnsStats.map((d) => {
                const failRate = d.failures > 0 ? d.failures / d.lookupsLastHour : 0;
                return (
                  <div key={d.domain} className="conn-row">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.domain}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {d.lookupsLastHour.toLocaleString()} lookups · {d.avgMs} ms avg
                      </div>
                    </div>
                    <span className={`badge ${failRate > 0.005 ? 'warn' : 'ok'}`} style={{ fontSize: 10 }}>
                      {d.failures === 0 ? '0 fail' : `${d.failures} fail`}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* ── Row 4: Connection event log + Public network info ── */}
        <div className="col-8">
          <Card
            title="Connection event log"
            sub={`${filteredEvents.length} events · last 24 h`}
            right={
              <div className="toolbar">
                <button
                  onClick={() => setEventFilter('all')}
                  style={eventFilter === 'all'
                    ? { background: 'var(--grad-accent-soft)', borderColor: 'var(--accent)', color: 'var(--text)' }
                    : undefined}
                >All</button>
                <button
                  onClick={() => setEventFilter('warn-err')}
                  style={eventFilter === 'warn-err'
                    ? { background: 'var(--grad-accent-soft)', borderColor: 'var(--accent)', color: 'var(--text)' }
                    : undefined}
                >Warn / err</button>
              </div>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filteredEvents.map((e) => <EventRow key={e.id} event={e} />)}
              {filteredEvents.length === 0 && (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5, fontStyle: 'italic' }}>
                  No events in this filter — nothing bouncing.
                </div>
              )}
            </div>
          </Card>
        </div>
        <div className="col-4">
          <Card title="Public IP & NAT" sub="Gateway egress identity">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <KV label="Public IP" value={<span className="mono">{publicNetInfo.publicIp}</span>} />
              <KV label="ASN"       value={<span className="mono">{publicNetInfo.asn}</span>} />
              <KV label="ISP"       value={publicNetInfo.isp} />
              <KV label="Geo"       value={publicNetInfo.geo} />
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                  <span>NAT table</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', color: natPct > 80 ? 'var(--warn)' : 'var(--text)' }}>
                    {publicNetInfo.natTableSize.toLocaleString()} / {publicNetInfo.natTableMax.toLocaleString()}
                  </span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                  <div style={{
                    width: `${natPct}%`, height: '100%',
                    background: natPct > 80 ? 'var(--warn)' : c.accent,
                    borderRadius: 3,
                  }} />
                </div>
              </div>
              <KV label="Port mappings" value={String(publicNetInfo.portMappingsCount)} />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

/* ─────────── WAN deep-dive cards ─────────── */

function FiberDeepCard() {
  const c = useThemeColors();
  // Optical Rx is healthy in the -8 to -22 dBm range. We map opticalRxDbm into
  // a "headroom" gauge so the user can see if signal is degrading.
  const rxLowBound = -22;
  const rxHighBound = -8;
  const rxPct = Math.max(0, Math.min(100,
    ((fiberLink.opticalRxDbm - rxLowBound) / (rxHighBound - rxLowBound)) * 100,
  ));
  const rxOk = fiberLink.opticalRxDbm > -20 && fiberLink.opticalRxDbm < -8;

  return (
    <Card
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Cable size={14} style={{ color: 'var(--accent)' }} />
          Fiber link — deep metrics
        </span>
      }
      sub="ISP-A · 1 Gbps GPON · primary underlay"
      right={<span className="badge ok"><span className="dot ok" />HEALTHY</span>}
    >
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
      }}>
        <Metric label="Optical Rx" value={`${fiberLink.opticalRxDbm.toFixed(1)} dBm`} ok={rxOk} />
        <Metric label="Attenuation" value={`${fiberLink.attenuationDb.toFixed(1)} dB`} ok={fiberLink.attenuationDb < 12} />
        <Metric label="Link speed" value={`${fiberLink.linkSpeedMbps} Mbps`} sub={`${fiberLink.duplex} duplex`} ok />
        <Metric label="MTU" value={`${fiberLink.mtu}`} sub="bytes" ok />
        <Metric label="FCS errors (1h)" value={`${fiberLink.fcsErrorsLastHour}`} ok={fiberLink.fcsErrorsLastHour < 20} />
        <Metric label="Link uptime" value={fmtUptime(fiberLink.uptimeHours)} ok />
      </div>
      <div style={{ paddingTop: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
          <span>Rx headroom</span>
          <span style={{ color: rxOk ? c.ok : c.warn }}>
            {fiberLink.opticalRxDbm.toFixed(1)} dBm
          </span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
          <div style={{
            width: `${rxPct}%`, height: '100%',
            background: `linear-gradient(90deg, var(--warn), var(--ok), var(--warn))`,
            borderRadius: 3,
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
          <span>-22 dBm</span><span>-8 dBm</span>
        </div>
      </div>
    </Card>
  );
}

function FiveGDeepCard() {
  const c = useThemeColors();
  // RSSI healthy at > -85, marginal -90 to -85, poor < -90
  const rssiPct = Math.max(0, Math.min(100, ((fiveGLink.rssiDbm + 110) / 50) * 100));
  const rssiOk = fiveGLink.rssiDbm > -85;
  const rssiWarn = fiveGLink.rssiDbm > -95 && fiveGLink.rssiDbm <= -85;

  return (
    <Card
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Radio size={14} style={{ color: 'var(--accent-2)' }} />
          5G link — deep metrics
        </span>
      }
      sub={`${fiveGLink.carrier} · ${fiveGLink.band} · standby underlay`}
      right={
        <span className={`badge ${rssiOk ? 'ok' : rssiWarn ? 'warn' : 'err'}`}>
          <span className={`dot ${rssiOk ? 'ok' : rssiWarn ? 'warn' : 'err'}`} />
          {rssiOk ? 'GOOD' : rssiWarn ? 'MARGINAL' : 'POOR'}
        </span>
      }
    >
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
      }}>
        <Metric label="RSSI" value={`${fiveGLink.rssiDbm} dBm`} ok={rssiOk} warn={rssiWarn} />
        <Metric label="SINR" value={`${fiveGLink.sinrDb} dB`} ok={fiveGLink.sinrDb > 10} />
        <Metric label="Band" value={fiveGLink.band} sub="n-band" ok />
        <Metric label="Cell ID" value={fiveGLink.cellId} ok />
        <Metric label="Neighbors" value={`${fiveGLink.neighborsCount}`} sub="cells visible" ok />
        <Metric label="Link uptime" value={fmtUptime(fiveGLink.uptimeHours)} ok />
      </div>
      <div style={{ paddingTop: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
          <span>Signal strength</span>
          <span style={{ color: rssiOk ? c.ok : c.warn }}>
            {fiveGLink.rssiDbm} dBm
          </span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
          <div style={{
            width: `${rssiPct}%`, height: '100%',
            background: `linear-gradient(90deg, var(--err), var(--warn), var(--ok))`,
            borderRadius: 3,
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
          <span>-110 dBm</span><span>-60 dBm</span>
        </div>
      </div>
    </Card>
  );
}

function Metric({
  label, value, sub, ok, warn,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  ok?: boolean;
  warn?: boolean;
}) {
  const color =
    warn ? 'var(--warn)' :
    ok   ? 'var(--text)' : 'var(--err)';
  return (
    <div>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{sub}</div>
      )}
    </div>
  );
}

/* ─────────── Rx/Tx throughput chart ─────────── */

function RxTxChart() {
  const c = useThemeColors();
  return (
    <div style={{ height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={bandwidthRxTx} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <defs>
            <linearGradient id="rxg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c.accent} stopOpacity={0.55} />
              <stop offset="100%" stopColor={c.accent} stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="txg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c.accent2} stopOpacity={0.55} />
              <stop offset="100%" stopColor={c.accent2} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={c.chartGrid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="t" stroke={c.textMuted} fontSize={11} tickLine={false} axisLine={false}
            tickFormatter={(v: string, i: number) => (i % 4 === 0 ? v : '')} interval={0} />
          <YAxis stroke={c.textMuted} fontSize={11} tickLine={false} axisLine={false}
            tickFormatter={(v: number) => `${v} Mbps`} />
          <Tooltip
            contentStyle={{
              background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}`,
              borderRadius: 10, fontSize: 12, backdropFilter: 'blur(10px)',
            }}
            labelStyle={{ color: c.textDim, marginBottom: 4 }}
          />
          <Area type="monotone" dataKey="rx" name="Rx (download)" stroke={c.accent}  fill="url(#rxg)" strokeWidth={1.6} />
          <Area type="monotone" dataKey="tx" name="Tx (upload)"   stroke={c.accent2} fill="url(#txg)" strokeWidth={1.6} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ─────────── Reachability probe row ─────────── */

function ProbeRow({ probe }: { probe: ReachabilityProbe }) {
  const Icon = PROBE_CATEGORY_ICON[probe.category];
  const rttColor =
    probe.rttMs > 80 ? 'var(--warn)' :
    probe.rttMs > 40 ? 'var(--text)' : 'var(--ok)';
  const successColor =
    probe.successPct < 99 ? 'var(--warn)' :
    probe.successPct < 100 ? 'var(--text-dim)' : 'var(--ok)';
  return (
    <div className="conn-row">
      <span style={{ color: 'var(--text-muted)', display: 'inline-flex', flexShrink: 0 }}>
        <Icon size={13} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 500, fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {probe.target}
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {probe.category} · {probe.type}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: rttColor, fontVariantNumeric: 'tabular-nums' }}>
          {probe.rttMs} ms
        </div>
        <div style={{ fontSize: 10.5, color: successColor }}>
          {probe.successPct.toFixed(1)}%
        </div>
      </div>
      {probe.lastFailureISO && (
        <span className="badge warn" style={{ fontSize: 9, padding: '2px 6px' }}>
          {timeAgo(probe.lastFailureISO)}
        </span>
      )}
    </div>
  );
}

/* ─────────── Connection event row ─────────── */

function EventRow({ event }: { event: ConnEvent }) {
  const Icon = EVENT_ICON[event.kind];
  const sevColor =
    event.severity === 'err' ? 'var(--err)' :
    event.severity === 'warn' ? 'var(--warn)' : 'var(--ok)';
  return (
    <div className="conn-row" style={{ borderLeftColor: sevColor }}>
      <span style={{ color: sevColor, display: 'inline-flex', flexShrink: 0 }}>
        <Icon size={13} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 600 }}>
            {EVENT_LABEL[event.kind]}
          </span>
          {event.wan && (
            <span className="badge" style={{ fontSize: 9, padding: '1px 6px', textTransform: 'uppercase' }}>
              {event.wan === 'both' ? 'both WANs' : event.wan}
            </span>
          )}
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
            {timeAgo(event.ts)}
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.45, marginTop: 2 }}>
          {event.detail}
        </div>
      </div>
    </div>
  );
}

/* ─────────── Tiny shared row primitive ─────────── */

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
        {label}
      </span>
      <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

// Silence unused imports kept for future use.
const _unused = { Wifi, Zap, CheckCircle2 };
void _unused;
