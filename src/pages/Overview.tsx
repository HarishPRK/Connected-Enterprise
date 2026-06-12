import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PageHeader } from '../components/PageHeader';
import { WanWidget } from '../components/widgets/WanWidget';
import { LanPorts } from '../components/widgets/LanPorts';
import { PoePorts } from '../components/widgets/PoePorts';
import { BandwidthChart } from '../components/widgets/BandwidthChart';
import { AppTrafficWidget } from '../components/widgets/AppTrafficWidget';
import { KpiStrip } from '../components/widgets/KpiStrip';
import { Topology } from '../components/widgets/Topology';
import { BranchOverviewCard } from '../components/widgets/BranchOverviewCard';
import {
  appTraffic, branches, BRANCH_TO_IPSEC_SOURCE, getDevicesForBranch, lanPorts, poePorts, wanLinks,
} from '../data/mock';
import type { BandwidthPoint, Device, WanLink, Status } from '../types';
import { useLiveData } from '../ui/LiveData';
import { useIpsecMetrics } from '../ui/useIpsecMetrics';
import {
  Download, RefreshCcw, X, Search, CheckCircle2, AlertCircle, Cpu,
  Laptop, CreditCard, PhoneCall, DoorClosed, Flame, AlertTriangle,
  Cable, Wifi, Zap, Radio,
} from 'lucide-react';

interface OverviewProps {
  branchId: string;
  onSelectBranch: (id: string) => void;
}

function inferUnderlay(ifname: string): 'fiber' | '5g' {
  const n = (ifname || '').toLowerCase();
  if (n.includes('cell') || n.includes('5g') || n.includes('lte') || n.includes('wwan')) return '5g';
  return 'fiber';
}

export function Overview({ branchId, onSelectBranch }: OverviewProps) {
  const branch = branches.find((b) => b.id === branchId) ?? branches[0];
  const { bandwidthSeries } = useLiveData();
  const branchDevices = useMemo(() => getDevicesForBranch(branchId), [branchId]);
  const [devicesModalOpen, setDevicesModalOpen] = useState(false);

  // ── Live IPsec overlay (Plano = rdk topic, McKinney = prpl topic) ──
  // Pick the cached gateway whose source-tag matches the current branch's
  // MQTT family. Falls back to "no live data" for branches not in the map.
  const ipsec = useIpsecMetrics();
  const branchSource = BRANCH_TO_IPSEC_SOURCE[branchId];
  const liveState = branchSource
    ? ipsec.list.find((g) => g.source === branchSource)
    : undefined;
  const usingLive = !!liveState;
  const liveTopic = branchSource ? `${branchSource}/ipsec/metrics` : null;

  // Throughput in Mbps + rolling bandwidth series, both derived from
  // successive WAN byte counters. Attributing the total Mbps to whichever
  // underlay the device is *currently* using — the standby underlay reads 0
  // (we don't have per-underlay byte counters in the proto).
  const [liveThroughputMbps, setLiveThroughputMbps] = useState<number | null>(null);
  const [liveBandwidth, setLiveBandwidth] = useState<BandwidthPoint[]>([]);
  const lastWanRef = useRef<{ rx: number; tx: number; ts: number } | null>(null);
  useEffect(() => {
    if (!liveState) return;
    const { wan } = liveState.metrics;
    const ts = liveState.receivedAt;
    const prev = lastWanRef.current;
    if (prev) {
      const dtSec = (ts - prev.ts) / 1000;
      if (dtSec > 0.1) {
        const bytes = Math.max(0, (wan.rx_bytes - prev.rx) + (wan.tx_bytes - prev.tx));
        const mbps  = (bytes * 8) / dtSec / 1_000_000;
        setLiveThroughputMbps(mbps);
        const activeUnderlay = liveState.metrics.active_tunnel
          ? inferUnderlay(liveState.metrics.active_tunnel)
          : null;
        const d = new Date(ts);
        const tStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
        setLiveBandwidth((arr) => [...arr, {
          t: tStr,
          fiber: activeUnderlay === 'fiber' ? +mbps.toFixed(2) : 0,
          fiveg: activeUnderlay === '5g'    ? +mbps.toFixed(2) : 0,
        }].slice(-120));   // ~20 min at 10s cadence
      }
    }
    lastWanRef.current = { rx: wan.rx_bytes, tx: wan.tx_bytes, ts };
  }, [liveState?.receivedAt, liveState]);

  // Active-alert count = tunnels reported present but currently unreachable.
  const liveAlertsCount = useMemo(() => {
    if (!liveState) return null;
    return liveState.metrics.tunnels.filter((t) => t.present && !t.reachable).length;
  }, [liveState]);

  // Auto-scenario for the Topology widget — derived purely from per-underlay
  // tunnel reachability. The widget honours this as the default "Auto" mode;
  // a manual scenario chip still overrides.
  const autoScenarioId = useMemo<string | null>(() => {
    if (!usingLive || !liveState) return null;
    const tunnels = liveState.metrics.tunnels;
    const fiberOk = tunnels.filter((t) => inferUnderlay(t.ifname) === 'fiber').some((t) => t.reachable);
    const cellOk  = tunnels.filter((t) => inferUnderlay(t.ifname) === '5g').some((t) => t.reachable);
    if (!fiberOk && cellOk) return '5g-failover';
    return 'healthy';
  }, [usingLive, liveState]);

  // WAN underlay state derived from per-underlay tunnel reachability.
  const liveLinks: WanLink[] | null = useMemo(() => {
    if (!usingLive || !liveState) return null;
    const tunnels = liveState.metrics.tunnels;
    const fiberT = tunnels.filter((t) => inferUnderlay(t.ifname) === 'fiber');
    const cellT  = tunnels.filter((t) => inferUnderlay(t.ifname) === '5g');
    const fiberOk = fiberT.some((t) => t.reachable);
    const cellOk  = cellT.some((t) => t.reachable);
    const activeUnderlay = liveState.metrics.active_tunnel
      ? inferUnderlay(liveState.metrics.active_tunnel)
      : null;
    const mbps = Math.max(0, liveThroughputMbps ?? 0);
    // We only have *aggregate* WAN bytes (erouter0), not per-underlay. Attribute
    // throughput to whichever underlay the device is currently using; the
    // standby reads as "0" so the split is honest rather than fabricated.
    const fiberRx = activeUnderlay === 'fiber' ? Math.round(mbps * 0.7) : 0;
    const fiberTx = activeUnderlay === 'fiber' ? Math.round(mbps * 0.3) : 0;
    const cellRx  = activeUnderlay === '5g'    ? Math.round(mbps * 0.7) : 0;
    const cellTx  = activeUnderlay === '5g'    ? Math.round(mbps * 0.3) : 0;
    return [
      {
        type: 'Fiber',
        status: fiberOk ? 'ok' : 'err',
        active: activeUnderlay === 'fiber',
        rxMbps: fiberRx,
        txMbps: fiberTx,
      },
      {
        type: '5G',
        status: cellOk ? 'ok' : 'warn',
        active: activeUnderlay === '5g',
        rssi: -92,                // not in proto — keep representative values
        sinr: 6,
        rxMbps: cellRx,
        txMbps: cellTx,
      },
    ];
  }, [usingLive, liveState, liveThroughputMbps]);

  return (
    <>
      <PageHeader
        title={`Overview — ${branch.name}`}
        subtitle={
          usingLive
            ? `Live view of gateway ${liveState.metrics.gateway.name} at ${branch.location} · streaming via ${liveTopic ?? ipsec.subscribedTopic ?? 'rdk/ipsec/metrics'}`
            : `Live view of gateway ${branch.gatewayModel} (${branch.firmware}) at ${branch.location}`
        }
        right={
          <div className="toolbar">
            <button><RefreshCcw size={14} />Refresh</button>
            <button><Download size={14} />Export</button>
          </div>
        }
      />

      <KpiStrip
        branchId={branchId}
        liveThroughputMbps={usingLive ? liveThroughputMbps : null}
        liveAlertsCount={usingLive ? liveAlertsCount : null}
        livePlanoMode={usingLive ? {
          gatewayOnline: ipsec.connected,
          onGatewayClick: () => setDevicesModalOpen(true),
        } : undefined}
      />

      {devicesModalOpen && (
        <DevicesModal
          gatewayName={liveState?.metrics.gateway.name ?? branch.gatewayModel}
          branchName={branch.name}
          devices={branchDevices}
          onClose={() => setDevicesModalOpen(false)}
        />
      )}

      <div className="grid">
        {/* Row 1 — branch map + gateway + IT/OT card */}
        <div className="col-12">
          <BranchOverviewCard
            branchId={branchId}
            branch={branch}
            devices={branchDevices}
            onSelectBranch={onSelectBranch}
          />
        </div>

        {/* Row 2 — full-width network topology.
            The Topology widget honours `autoScenarioId` when its "Auto" chip
            is selected (default); a manual scenario chip still overrides. */}
        <div className="col-12"><Topology autoScenarioId={autoScenarioId} /></div>

        {/* Row 3 — WAN + LAN + PoE.
            The WAN card uses live Fiber/5G state when we're on Plano AND a
            payload is available; otherwise it falls back to the mock data. */}
        <div className="col-4"><WanWidget links={liveLinks ?? wanLinks} /></div>
        <div className="col-4"><LanPorts ports={lanPorts} /></div>
        <div className="col-4"><PoePorts ports={poePorts} /></div>

        {/* Row 4 — bandwidth (big) + critical app traffic.
            Bandwidth chart shows the live rolling Mbps from real WAN deltas
            when on Plano (≥ 2 samples collected); otherwise the mock series. */}
        <div className="col-8">
          <BandwidthChart data={usingLive && liveBandwidth.length >= 2 ? liveBandwidth : bandwidthSeries} />
        </div>
        <div className="col-4"><AppTrafficWidget items={appTraffic} /></div>
      </div>
    </>
  );
}

/* ─── Device list modal: opens when the "Gateway online" KPI is clicked ─── */
const ICON_FOR_KIND: Record<Device['kind'], React.ComponentType<{ size?: number }>> = {
  laptop:       Laptop,
  desktop:      Laptop,
  printer:      Laptop,
  payment:      CreditCard,
  server:       Laptop,
  confphone:    PhoneCall,
  fire_sensor:  Flame,
  smoke_sensor: AlertTriangle,
  door_lock:    DoorClosed,
  phone:        PhoneCall,
  tablet:       Laptop,
  matter:       AlertTriangle,
  shelly:       CreditCard,
  generic:      Laptop,
};
const ICON_FOR_CONN: Record<Device['conn'], React.ComponentType<{ size?: number }>> = {
  wired:  Cable,
  wifi:   Wifi,
  poe:    Zap,
  thread: Radio,
};

const KIND_LABEL: Record<Device['kind'], string> = {
  laptop: 'Laptop', desktop: 'Desktop', printer: 'Printer', payment: 'Payment',
  server: 'Server', confphone: 'Conf phone',
  fire_sensor: 'Fire sensor', smoke_sensor: 'Smoke sensor', door_lock: 'Door lock',
  phone: 'Phone', tablet: 'Tablet', matter: 'Matter', shelly: 'Shelly', generic: 'Device',
};

const STATUS_TINT: Record<Status, { fg: string; bg: string; label: string }> = {
  ok:   { fg: 'var(--ok)',   bg: 'rgba(124,255,212,0.10)', label: 'Online' },
  warn: { fg: 'var(--warn)', bg: 'rgba(250,204,21,0.12)',  label: 'Degraded' },
  err:  { fg: 'var(--err)',  bg: 'rgba(255,107,107,0.12)', label: 'Offline' },
  off:  { fg: 'var(--text-muted)', bg: 'rgba(255,255,255,0.04)', label: 'Off' },
};

function fmtConnectedFor(hours: number): string {
  if (hours < 1)   return `${Math.round(hours * 60)}m`;
  if (hours < 48)  return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

type DeviceFilter = 'all' | 'IT' | 'OT' | 'issues';

function DevicesModal({
  gatewayName, branchName, devices, onClose,
}: {
  gatewayName: string;
  branchName: string;
  devices: Device[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DeviceFilter>('all');

  // Counters for the hero stat band
  const itCount     = devices.filter((d) => d.domain === 'IT').length;
  const otCount     = devices.filter((d) => d.domain === 'OT').length;
  const onlineCount = devices.filter((d) => d.status === 'ok').length;
  const issuesCount = devices.filter((d) => d.status !== 'ok' && d.status !== 'off').length;

  const q = query.trim().toLowerCase();
  const filtered = devices.filter((d) => {
    if (filter === 'IT'     && d.domain !== 'IT') return false;
    if (filter === 'OT'     && d.domain !== 'OT') return false;
    if (filter === 'issues' && d.status === 'ok') return false;
    if (!q) return true;
    return (
      d.name.toLowerCase().includes(q) ||
      d.ip.toLowerCase().includes(q) ||
      d.mac.toLowerCase().includes(q) ||
      d.kind.toLowerCase().includes(q)
    );
  });

  // Close on Escape + lock body scroll while open so the modal stays put
  // and the underlying page doesn't drift behind it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const chips: { id: DeviceFilter; label: string; count: number }[] = [
    { id: 'all',    label: 'All',    count: devices.length },
    { id: 'IT',     label: 'IT',     count: itCount },
    { id: 'OT',     label: 'OT',     count: otCount },
    { id: 'issues', label: 'Issues', count: issuesCount },
  ];

  // Render through a portal anchored to <body> so we escape any transformed
  // ancestor — otherwise `position: fixed` is scoped to that ancestor instead
  // of the viewport, which is why the modal previously drifted off-centre.
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(2,4,16,0.72)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'linear-gradient(180deg, rgba(124,140,255,0.04), transparent 200px), var(--panel-1)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: '20px 22px',
          width: 'min(1080px, 94vw)',
          maxHeight: '88vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 30px 80px rgba(0,0,0,0.55)',
        }}
      >
        {/* ── Hero header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{
              width: 40, height: 40, borderRadius: 10,
              background: 'linear-gradient(135deg, rgba(192,132,252,0.22), rgba(124,140,255,0.08))',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--accent3)',
            }}>
              <Cpu size={20} />
            </span>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.01em' }}>
                Devices on <span className="mono">{gatewayName}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {branchName} · {devices.length} devices on this gateway
              </div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ padding: '6px 10px' }}>
            <X size={14} />
          </button>
        </div>

        {/* ── Summary stat band ── */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
          margin: '14px 0 6px',
        }}>
          <SummaryStat label="Online"   value={`${onlineCount}/${devices.length}`} color="var(--ok)"   icon={<CheckCircle2 size={14} />} />
          <SummaryStat label="Issues"   value={String(issuesCount)}                color={issuesCount > 0 ? 'var(--warn)' : 'var(--text-dim)'} icon={<AlertCircle size={14} />} />
          <SummaryStat label="IT"       value={String(itCount)}                    color="var(--accent)"  icon={<Laptop size={14} />} />
          <SummaryStat label="OT"       value={String(otCount)}                    color="var(--accent2)" icon={<Flame size={14} />} />
        </div>

        {/* ── Search + filter chips ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0 14px', flexWrap: 'wrap' }}>
          <div style={{
            position: 'relative', flex: '1 1 240px', minWidth: 220,
          }}>
            <Search size={13} style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
            }} />
            <input
              autoFocus
              placeholder="Search by name, IP, MAC, or kind…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: '100%', padding: '7px 10px 7px 30px' }}
            />
          </div>
          <div className="toolbar">
            {chips.map((chip) => (
              <button
                key={chip.id}
                onClick={() => setFilter(chip.id)}
                style={chip.id === filter
                  ? { background: 'var(--grad-accent-soft)', borderColor: 'rgba(124,140,255,0.35)', color: 'var(--text)' }
                  : undefined}
              >
                {chip.label} <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>· {chip.count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Device tile grid ── */}
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
          {filtered.length === 0 ? (
            <div style={{
              padding: '40px 12px', color: 'var(--text-muted)', fontSize: 13,
              textAlign: 'center',
            }}>
              No devices match your filter.
            </div>
          ) : (
            <div style={{
              display: 'grid', gap: 10,
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            }}>
              {filtered.map((d) => <DeviceTile key={d.id} device={d} />)}
            </div>
          )}
        </div>

        {/* ── Footer note ── */}
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.5 }}>
          Inventory is the branch's configured device list — the IPsec proto
          carries gateway / WAN / tunnel telemetry only, not per-device status.
          Press <kbd style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 4, padding: '0 4px', fontFamily: 'inherit', fontSize: 10 }}>Esc</kbd> to close.
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SummaryStat({
  label, value, color, icon,
}: {
  label: string;
  value: string;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <div style={{
      background: 'var(--panel-2)',
      border: '1px solid var(--border)',
      borderRadius: 10, padding: '8px 12px',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color }}>{icon}</span>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  );
}

function DeviceTile({ device: d }: { device: Device }) {
  const KindIcon = ICON_FOR_KIND[d.kind] ?? Laptop;
  const ConnIcon = ICON_FOR_CONN[d.conn];
  const status = STATUS_TINT[d.status];
  return (
    <div style={{
      background: 'var(--panel-2)',
      border: '1px solid var(--border)',
      borderLeft: `3px solid ${status.fg}`,
      borderRadius: 10, padding: '10px 12px',
      display: 'flex', flexDirection: 'column', gap: 8,
      transition: 'transform 0.12s ease, border-color 0.12s ease',
    }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      {/* Top row: icon + name + status dot */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{
            width: 28, height: 28, borderRadius: 7,
            background: `linear-gradient(135deg, ${d.domain === 'IT' ? 'rgba(124,255,212,0.18)' : 'rgba(255,107,200,0.18)'}, transparent)`,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: d.domain === 'IT' ? 'var(--accent)' : 'var(--accent2)',
            flexShrink: 0,
          }}>
            <KindIcon size={14} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {d.name}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
              {KIND_LABEL[d.kind]} · <span style={{ color: d.domain === 'IT' ? 'var(--accent)' : 'var(--accent2)' }}>{d.domain}</span>
            </div>
          </div>
        </div>
        <span style={{
          fontSize: 9.5, fontWeight: 800, letterSpacing: '0.08em',
          padding: '2px 7px', borderRadius: 999,
          background: status.bg, color: status.fg,
          whiteSpace: 'nowrap',
        }}>
          ● {status.label.toUpperCase()}
        </span>
      </div>

      {/* Middle: IP / MAC */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div className="mono" style={{ fontSize: 11.5, color: 'var(--text)', fontWeight: 600 }}>
          {d.ip}
        </div>
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
          {d.mac}
        </div>
      </div>

      {/* Bottom: connection + uptime */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 11, color: 'var(--text-dim)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, textTransform: 'capitalize' }}>
          <ConnIcon size={11} />
          {d.conn === 'poe' ? 'PoE' : d.conn}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>
          up {fmtConnectedFor(d.connectedForHours)}
        </span>
      </div>
    </div>
  );
}
