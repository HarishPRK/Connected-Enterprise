import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { Activity, ArrowDown, ArrowUp, ArrowUpRight, Building2, Cpu, ShieldAlert, Waves, type LucideIcon } from 'lucide-react';
import { branches, fleetStats } from '../../data/mock';
import { useSimulatedThroughput } from '../../ui/useLiveData';
import type { WanDirectionalRate } from '../../types';
import type { WidgetDataState } from './WanWidget';
import { Sparkline } from './Sparkline';
import './KpiStrip.css';

interface WanTraffic {
  rate: WanDirectionalRate | null;
  state: WidgetDataState;
  interfaceName?: string | null;
}
interface KpiStripProps {
  branchId?: string;
  liveWanTraffic?: WanTraffic;
  /** Present IPsec tunnels that are currently unreachable, and the total present. */
  liveAlertsCount?: number | null;
  liveTunnelCount?: number;
  livePlanoMode?: { gatewayOnline: boolean; onGatewayClick: () => void };
}
type Tone = 'sky' | 'ok' | 'warn' | 'err' | 'muted';

function MetricCard({ label, icon: Icon, children, evidence, detail, tone = 'sky', onClick, tag, kind }: {
  label: string; icon: LucideIcon; children: ReactNode; evidence: ReactNode; detail: ReactNode;
  tone?: Tone; onClick?: () => void; tag?: string; kind: string;
}) {
  const content = <>
    <span className="home-metric-heading">
      <span className="home-metric-label"><Icon size={13} aria-hidden="true" />{label}</span>
      {tag && <span className="home-metric-tag" data-source={tag === 'Sample' ? 'sample' : undefined}>{tag}</span>}
    </span>
    <span className="home-metric-main">{children}</span>
    <span className="home-metric-evidence">{evidence}</span>
    <span className="home-metric-detail"><span>{detail}</span>{onClick && <ArrowUpRight size={13} aria-hidden="true" />}</span>
  </>;
  return onClick
    ? <button type="button" className="home-metric" data-metric={kind} data-tone={tone} onClick={onClick} title="Inspect connected devices">{content}</button>
    : <div className="home-metric" data-metric={kind} data-tone={tone}>{content}</div>;
}

function Reading({ value, unit }: { value: number | string; unit?: string }) {
  return <span className="home-metric-reading"><span>{value}</span>{unit && <span className="home-metric-unit">{unit}</span>}</span>;
}

/** A current population ratio, never a fabricated time series. */
function PopulationRail({ online, total }: { online: number | null | undefined; total?: number }) {
  const fraction = online == null || !total ? null : Math.min(1, Math.max(0, online / total));
  return <span className="home-population-rail" aria-hidden="true" data-unknown={fraction === null}>
    <span style={{ width: fraction === null ? '0%' : `${fraction * 100}%` }} />
  </span>;
}

function SiteInstrument() {
  const id = useId().replace(/:/g, '');
  return <svg className="home-metric-instrument home-site-instrument" viewBox="0 0 84 68" fill="none" aria-hidden="true">
    <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#7b94a5" /><stop offset="1" stopColor="#2c4353" /></linearGradient></defs>
    <path d="m8 54 35-11 34 12-34 11z" fill="#112334" stroke="#4d6c81" strokeWidth=".7" />
    <path d="M20 20 43 11l21 9-22 9z" fill={`url(#${id})`} stroke="#91adbd" strokeWidth=".65" />
    <path d="M20 20v29l22 11V29z" fill="#243f53" stroke="#7291a3" strokeWidth=".65" />
    <path d="M42 29 64 20v29L42 60z" fill="#182e40" stroke="#5d7b8e" strokeWidth=".65" />
    {[28,39].map(y => <g key={y} stroke="currentColor" strokeWidth="2.4"><path d={`M26 ${y}l5 2M34 ${y+4}l3 1.3M48 ${y+4}l4-1.7M56 ${y+.5}l3-1.3`} /></g>)}
    <path d="m39 56 4 2 5-2v-8l-5 2-4-2z" fill="#0e2130" />
    <path d="M5 56h7m61 1h6" stroke="currentColor" strokeOpacity=".5" />
  </svg>;
}

function GatewayInstrument({ online }: { online?: boolean }) {
  const id = useId().replace(/:/g, '');
  return <svg className="home-metric-instrument" viewBox="0 0 84 68" fill="none" aria-hidden="true">
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#8195a4" /><stop offset=".38" stopColor="#4f687a" /><stop offset="1" stopColor="#263c4d" /></linearGradient></defs>
    <rect x="10" y="18" width="65" height="40" rx="7" fill="#0e2130" stroke="#465f72" />
    <path d="m12 21 8-9h49l6 9" fill={`url(#${id})`} stroke="#8ea4b4" strokeWidth=".7" />
    <rect x="10" y="21" width="65" height="31" rx="6" fill="#1b3243" stroke="#718b9e" strokeWidth=".7" />
    {[27,35,43,51,59].map(x => <path key={x} d={`M${x} 14v6`} stroke="#142d40" strokeWidth="2.5" />)}
    {[28,39,50,61].map(x => <g key={x}><rect x={x} y="32" width="8" height="7" rx="1" fill="#0a1d2a" stroke="#8a9ca5" strokeWidth=".8" /><path d={`M${x+2} 38h4`} stroke="#b0a988" strokeWidth=".8" /></g>)}
    <circle cx="19" cy="35" r="2" fill={online === false ? '#ee7f92' : online === true ? '#90cbb0' : '#8598a7'} />
    <path d="M18 47h49" stroke="#7994a4" strokeOpacity=".25" />
  </svg>;
}

function AlertInstrument() {
  return <svg className="home-metric-instrument home-alert-instrument" viewBox="0 0 84 68" fill="none" aria-hidden="true">
    <path d="m42 6 25 10v20c0 13-16 23-25 27-9-4-25-14-25-27V16z" fill="#162b3a" stroke="#667b88" strokeWidth="1.1" />
    <path d="m42 12 19 8v16c0 10-12 18-19 22-7-4-19-12-19-22V20z" fill="currentColor" fillOpacity=".085" stroke="currentColor" strokeOpacity=".6" strokeWidth=".7" />
    <path d="M42 25v14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    <circle cx="42" cy="46" r="1.7" fill="currentColor" />
  </svg>;
}

function AvailabilityInstrument({ fraction }: { fraction?: number }) {
  const value = fraction == null ? null : Math.min(1, Math.max(0, fraction));
  return <svg className="home-metric-instrument home-availability-instrument" viewBox="0 0 76 68" fill="none" aria-hidden="true">
    <circle cx="38" cy="34" r="28" fill="#1b3040" stroke="#6c8394" strokeWidth=".75" />
    <circle cx="38" cy="34" r="24" stroke="#0b1f2d" strokeWidth="3" />
    {value !== null && <circle cx="38" cy="34" r="24" pathLength="100" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeDasharray={`${value * 100} 100`} transform="rotate(-90 38 34)" />}
    <g stroke="#99afbf" strokeOpacity=".4">{Array.from({ length: 12 }, (_, i) => <path key={i} d="M38 15v2" transform={`rotate(${i * 30} 38 34)`} />)}</g>
    <Activity x="26" y="22" width="24" height="24" strokeWidth="1.25" stroke="currentColor" />
  </svg>;
}

function TunnelSegments({ failed, total }: { failed: number; total: number }) {
  const failureCount = Math.min(Math.max(0, failed), total);
  // Segments encode a count, not tunnel identities or event history.
  if (total > 12) return <PopulationRail online={failureCount} total={total} />;
  return <span className="home-tunnel-segments" aria-hidden="true">
    {Array.from({ length: Math.max(0, total) }, (_, index) => <i key={index} data-unreachable={index < failureCount} />)}
  </span>;
}

export function KpiStrip({ branchId, liveWanTraffic, liveAlertsCount, liveTunnelCount, livePlanoMode }: KpiStripProps) {
  const stats = branchId ? fleetStats[branchId] : undefined;
  const branch = branches.find(site => site.id === branchId);
  const simulatedThroughput = useSimulatedThroughput(!stats && !liveWanTraffic);
  const siteCount = livePlanoMode ? 1 : branches.length;
  const sitesOnline = livePlanoMode ? (livePlanoMode.gatewayOnline ? 1 : null) : Object.values(fleetStats).filter(site => site.status !== 'off').length;
  const gatewayCount = livePlanoMode ? Number(livePlanoMode.gatewayOnline) : stats?.devicesOnline;
  const gatewayTotal = livePlanoMode ? 1 : stats?.totalDevices;
  const alerts = liveAlertsCount ?? stats?.openAlerts;
  const hasTunnels = liveAlertsCount != null && liveTunnelCount != null;
  const uptime = stats?.uptimePct;
  const throughput = stats?.throughputMbps ?? simulatedThroughput;
  const alertDetail = hasTunnels
    ? liveTunnelCount === 0 ? 'No tunnels reported' : `${liveAlertsCount} of ${liveTunnelCount} tunnels unreachable`
    : liveAlertsCount != null ? 'Unreachable IPsec tunnels' : 'Open alerts in sample inventory';

  return <div className="home-kpi-region">
    <div className="home-kpis" role="group" aria-label="Site performance">
      <MetricCard kind="branches" label="Branches online" icon={Building2} tone={sitesOnline == null ? 'muted' : 'sky'}
        tag={livePlanoMode ? sitesOnline == null ? 'Waiting' : 'Live' : 'Sample'}
        detail={livePlanoMode ? sitesOnline == null ? 'Awaiting branch telemetry' : branch?.location ?? 'Selected branch' : 'Sites in the sample fleet'}
        evidence={<PopulationRail online={sitesOnline} total={siteCount} />}>
        <Reading value={sitesOnline ?? '—'} unit={`/ ${siteCount}`} /><SiteInstrument />
      </MetricCard>
      <MetricCard kind="gateway" label={livePlanoMode ? 'Gateway online' : 'Devices online'} icon={Cpu}
        tone={livePlanoMode ? livePlanoMode.gatewayOnline ? 'ok' : 'err' : 'sky'} onClick={livePlanoMode?.onGatewayClick}
        tag={livePlanoMode ? livePlanoMode.gatewayOnline ? 'Online' : 'Offline' : 'Sample'}
        detail={livePlanoMode ? livePlanoMode.gatewayOnline ? 'Streaming live · Inspect devices' : 'Stream offline · Inspect devices' : 'Devices in sample inventory'}
        evidence={<PopulationRail online={gatewayCount} total={gatewayTotal} />}>
        <Reading value={gatewayCount ?? '—'} unit={gatewayTotal == null ? undefined : `/ ${gatewayTotal}`} />
        <GatewayInstrument online={livePlanoMode?.gatewayOnline} />
      </MetricCard>
      <MetricCard kind="alerts" label="Active alerts" icon={ShieldAlert}
        tone={alerts == null || (hasTunnels && liveTunnelCount === 0) ? 'muted' : alerts > 0 ? 'warn' : 'ok'}
        tag={livePlanoMode?.gatewayOnline === false ? 'Last report' : liveAlertsCount == null ? 'Sample' : hasTunnels && liveTunnelCount === 0 ? 'No tunnels' : alerts ? 'Attention' : 'Clear'}
        detail={alertDetail}
        evidence={hasTunnels && liveTunnelCount > 0
          ? <TunnelSegments failed={liveAlertsCount} total={liveTunnelCount} />
          : <span className="home-metric-context">{hasTunnels ? 'No tunnel health to summarize' : 'Current alert count'}</span>}>
        <Reading value={alerts ?? '—'} /><AlertInstrument />
      </MetricCard>
      <MetricCard kind="uptime" label="Avg uptime" icon={Activity} tone="sky" tag="Sample" detail="30-day sample availability"
        evidence={<span className="home-metric-period"><span>30 days</span><i /><span>Availability</span></span>}>
        <Reading value={uptime == null ? '—' : uptime.toFixed(2)} unit={uptime == null ? undefined : '%'} />
        <AvailabilityInstrument fraction={uptime == null ? undefined : uptime / 100} />
      </MetricCard>
      {liveWanTraffic ? <WanTrafficKpi {...liveWanTraffic} /> :
        <MetricCard kind="throughput" label="Throughput" icon={Waves} tag={stats ? 'Sample' : 'Simulated'}
          detail={stats ? 'Last 24 sample readings' : 'Simulated fleet traffic'}
          evidence={stats ? <span className="home-metric-history" aria-hidden="true"><Sparkline values={stats.throughputSeries} stroke="currentColor" fill="transparent" width={220} height={18} /></span> : <span className="home-metric-context">Current simulated rate</span>}>
          <Reading value={formatWanRate(throughput)} unit="Mbps" /><span className="home-throughput-symbol"><Waves size={40} strokeWidth={1.1} aria-hidden="true" /></span>
        </MetricCard>}
    </div>
  </div>;
}

function formatWanRate(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value < 0.01) return value === 0 ? '0.00' : '<0.01';
  if (value < 10) return value.toFixed(2);
  if (value < 1_000) return value.toFixed(1);
  return Math.round(value).toLocaleString();
}
function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}
function LastSampleAge({ observedAt }: { observedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => { if (!document.hidden) setNow(Date.now()); };
    const timer = window.setInterval(tick, 5_000);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, []);
  return <>Last sample {formatAge(now - observedAt)} ago</>;
}

function WanTrafficKpi({ rate, state, interfaceName }: WanTraffic) {
  const showRate = rate !== null && (state === 'live' || state === 'stale');
  const interval = showRate && Number.isFinite(rate.spanSeconds) && rate.spanSeconds > 0 ? `${Number(rate.spanSeconds.toFixed(1))}s interval` : '';
  const detail = state === 'stale' ? rate ? <LastSampleAge observedAt={rate.observedAt} /> : 'Waiting for fresh telemetry'
    : showRate ? [interfaceName || 'WAN interface', interval].filter(Boolean).join(' · ')
      : state === 'unavailable' ? 'WAN telemetry unavailable' : 'Waiting for gateway counters';
  const stateLabel = state === 'stale' ? 'Stale' : state === 'unavailable' ? 'Unavailable' : showRate ? 'Live' : 'Waiting';
  const rx = showRate && Number.isFinite(rate.rxMbps) ? Math.max(0, rate.rxMbps) : 0;
  const tx = showRate && Number.isFinite(rate.txMbps) ? Math.max(0, rate.txMbps) : 0;
  const total = rx + tx;
  const mix = total > 0 ? rx / total * 100 : 0;
  return <MetricCard kind="wan" label="WAN traffic" icon={Waves} tag={stateLabel} detail={detail}
    tone={state === 'stale' ? 'warn' : showRate ? 'sky' : 'muted'}
    evidence={<span className="home-wan-mix" style={{ '--rx-share': `${mix}%` } as CSSProperties} data-empty={!showRate || total === 0}
      role="img" aria-label={showRate ? `Current traffic mix: RX ${formatWanRate(rx)} Mbps, TX ${formatWanRate(tx)} Mbps.` : 'Traffic mix unavailable'}
      title="Current RX / TX traffic mix"><i /><i /></span>}>
    <span className="home-metric-wan">
      <span className="home-wan-channel"><span className="home-wan-direction"><ArrowDown size={13} aria-hidden="true" />RX <span>Mbps</span></span><strong>{showRate ? formatWanRate(rate.rxMbps) : '—'}</strong></span>
      <span className="home-wan-channel"><span className="home-wan-direction"><ArrowUp size={13} aria-hidden="true" />TX <span>Mbps</span></span><strong>{showRate ? formatWanRate(rate.txMbps) : '—'}</strong></span>
    </span>
  </MetricCard>;
}
