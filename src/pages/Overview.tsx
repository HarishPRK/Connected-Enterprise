import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PageHeader } from '../components/PageHeader';
import { WanWidget, type WidgetDataState } from '../components/widgets/WanWidget';
import { LanPorts } from '../components/widgets/LanPorts';
import { PoePorts } from '../components/widgets/PoePorts';
import { BandwidthChart } from '../components/widgets/BandwidthChart';
import { AppTrafficWidget } from '../components/widgets/AppTrafficWidget';
import { KpiStrip } from '../components/widgets/KpiStrip';
import { Topology } from '../components/widgets/Topology';
import { FailoverTopology } from '../components/widgets/FailoverTopology';
import { BranchOverviewCard } from '../components/widgets/BranchOverviewCard';
import {
  branches, BRANCH_TO_IPSEC_SOURCE, BRANCH_TO_IPSEC_TOPIC, getDevicesForBranch,
} from '../data/mock';
import type {
  AppTraffic, BandwidthPoint, Device, LanPort, PoePort, Status, WanLink,
} from '../types';
import { useIpsecMetrics } from '../ui/useIpsecMetrics';
import { useDevices } from '../ui/useDevices';
import { useGatewayTelemetry } from '../ui/useGatewayTelemetry';
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

const IPSEC_FRESH_MS = 35_000;
const MAX_RATE_INTERVAL_SECONDS = 60;

type Underlay = 'fiber' | '5g';

interface DirectionalRate {
  rxMbps: number;
  txMbps: number;
}

interface UnderlayRateSample {
  measuredAt: number;
  fiber?: DirectionalRate;
  '5g'?: DirectionalRate;
}

interface CounterPair {
  rx: number;
  tx: number;
}

interface IpsecCounterSample {
  key: string;
  ts: number;
  wan: CounterPair;
  tunnels: Record<string, CounterPair>;
}

function measuredRate(current: number, previous: number, seconds: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || current < previous) return null;
  return ((current - previous) * 8) / seconds / 1_000_000;
}

function underlayStatus(tunnels: { present: boolean; reachable: boolean }[]): Status {
  const present = tunnels.filter((tunnel) => tunnel.present);
  if (present.length === 0) return 'off';
  return present.some((tunnel) => tunnel.reachable) ? 'ok' : 'err';
}

function validRadioRssi(value: number | undefined): value is number {
  // RSSI cannot physically be 0 dBm here; protobuf's numeric default is 0.
  return Number.isFinite(value) && Number(value) < 0;
}

function trafficLabel(device: Device): string {
  const name = device.name.trim();
  if (name) return name;
  if (device.ip && device.ip !== '—') return device.ip;
  return device.mac;
}

function measuredClientTraffic(devices: readonly Device[]): {
  measuredClients: number;
  totalMbps: number;
  rows: AppTraffic[];
} {
  const measured = devices.flatMap((device) => {
    const rx = device.telemetry?.rxMbps;
    const tx = device.telemetry?.txMbps;
    if (!Number.isFinite(rx) && !Number.isFinite(tx)) return [];
    return [{
      id: device.mac || device.id,
      label: trafficLabel(device),
      ip: device.ip,
      mbps: Math.max(0, rx ?? 0) + Math.max(0, tx ?? 0),
    }];
  });
  const active = measured.filter((client) => client.mbps > 0).sort((a, b) => b.mbps - a.mbps);
  if (active.length === 0) return { measuredClients: measured.length, totalMbps: 0, rows: [] };

  const labelCounts = new Map<string, number>();
  for (const client of active) labelCounts.set(client.label, (labelCounts.get(client.label) ?? 0) + 1);
  const named = active.map((client) => ({
    ...client,
    label: (labelCounts.get(client.label) ?? 0) > 1 && client.ip && client.ip !== '—'
      ? `${client.label} · ${client.ip}`
      : client.label,
  }));
  const visible = named.length <= 5
    ? named
    : [
      ...named.slice(0, 4),
      {
        id: 'other-measured-clients',
        label: `Other measured clients (${named.length - 4})`,
        ip: '',
        mbps: named.slice(4).reduce((sum, client) => sum + client.mbps, 0),
      },
    ];
  const totalMbps = visible.reduce((sum, client) => sum + client.mbps, 0);
  const rawShares = visible.map((client) => (client.mbps / totalMbps) * 100);
  const shares = rawShares.map(Math.floor);
  const remainder = 100 - shares.reduce((sum, share) => sum + share, 0);
  const byFraction = rawShares
    .map((share, index) => ({ index, fraction: share - shares[index] }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; i < remainder; i += 1) shares[byFraction[i].index] += 1;

  return {
    measuredClients: measured.length,
    totalMbps,
    rows: visible.map((client, index) => ({
      app: client.label,
      sharePct: shares[index],
      mbps: Number(client.mbps.toFixed(3)),
    })),
  };
}

export function Overview({ branchId, onSelectBranch }: OverviewProps) {
  const branch = branches.find((b) => b.id === branchId) ?? branches[0];
  const {
    devices: liveDevicesAll,
    loaded: devicesLoaded,
    connected: devicesConnected,
    source: devicesSource,
  } = useDevices();
  const mockDevices = useMemo(() => getDevicesForBranch(branchId), [branchId]);
  // Strictly filter live devices by location source so Plano (rdk) and McKinney
  // (prpl) device fleets never mix. A device is shown only if its locationSource
  // exactly matches this branch — devices with no locationSource (pure seed) are
  // excluded here; the branch-specific mock fallback below covers the empty state.
  const branchIpsecSource = BRANCH_TO_IPSEC_SOURCE[branchId] as 'rdk' | 'prpl' | undefined;
  const liveDevices = useMemo(
    () => branchIpsecSource
      ? liveDevicesAll.filter((d) => d.locationSource === branchIpsecSource)
      : liveDevicesAll,
    [liveDevicesAll, branchIpsecSource],
  );
  // Use real devices if loaded, otherwise fall back to mock data
  const branchDevices = devicesLoaded && liveDevices.length > 0 ? liveDevices : mockDevices;
  const [devicesModalOpen, setDevicesModalOpen] = useState(false);

  // ── Live IPsec overlay (Plano = rdk, McKinney/QDR = prplhome) ──
  // Pick the cached gateway whose source-tag matches the current branch's
  // MQTT family. Falls back to "no live data" for branches not in the map.
  const ipsec = useIpsecMetrics();
  const branchSource = BRANCH_TO_IPSEC_SOURCE[branchId];
  const liveState = branchSource
    ? ipsec.list.find((g) => g.source === branchSource)
    : undefined;
  const usingLive = !!liveState;
  const liveTopic = BRANCH_TO_IPSEC_TOPIC[branchId] ?? null;
  const gatewayTelemetry = useGatewayTelemetry();
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Each SSE observation is an external counter sample; folding it into a
  // bounded rolling series is the synchronization this effect performs.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  const ipsecDataState = useMemo<WidgetDataState>(() => {
    if (!branchSource) return 'unavailable';
    if (!liveState) return ipsec.lastError ? 'unavailable' : 'loading';
    const ageMs = nowMs - liveState.receivedAt;
    return ipsec.connected && ageMs >= -5_000 && ageMs <= IPSEC_FRESH_MS ? 'live' : 'stale';
  }, [branchSource, ipsec.connected, ipsec.lastError, liveState, nowMs]);

  const ipsecStatusMessage = ipsecDataState === 'loading'
    ? 'Waiting for the first gateway counter sample.'
    : ipsecDataState === 'stale'
      ? 'The IPsec gateway feed is no longer fresh.'
      : ipsecDataState === 'unavailable'
        ? branchSource
          ? 'The live IPsec source is unavailable.'
          : 'No live IPsec source is configured for this branch.'
        : undefined;

  // Derive directional WAN and per-underlay rates only from successive source
  // counters. Reset on a branch/gateway change so counters never cross sites.
  const [liveThroughputMbps, setLiveThroughputMbps] = useState<number | null>(null);
  const [liveBandwidth, setLiveBandwidth] = useState<BandwidthPoint[]>([]);
  const [underlayRates, setUnderlayRates] = useState<UnderlayRateSample | null>(null);
  const lastCountersRef = useRef<IpsecCounterSample | null>(null);

  useEffect(() => {
    if (!liveState) {
      lastCountersRef.current = null;
      setLiveThroughputMbps(null);
      setUnderlayRates(null);
      setLiveBandwidth([]);
      return;
    }

    const key = `${branchId}:${liveState.source ?? 'other'}:${liveState.metrics.gateway.name}`;
    const ts = liveState.receivedAt;
    const current: IpsecCounterSample = {
      key,
      ts,
      wan: { rx: liveState.metrics.wan.rx_bytes, tx: liveState.metrics.wan.tx_bytes },
      tunnels: Object.fromEntries(liveState.metrics.tunnels.map((tunnel) => [
        tunnel.ifname,
        { rx: tunnel.rx_bytes, tx: tunnel.tx_bytes },
      ])),
    };
    const previous = lastCountersRef.current;
    lastCountersRef.current = current;

    if (!previous || previous.key !== key) {
      setLiveThroughputMbps(null);
      setUnderlayRates(null);
      setLiveBandwidth([]);
      return;
    }

    const seconds = (ts - previous.ts) / 1_000;
    if (seconds <= 0.1 || seconds > MAX_RATE_INTERVAL_SECONDS) return;

    const wanRx = measuredRate(current.wan.rx, previous.wan.rx, seconds);
    const wanTx = measuredRate(current.wan.tx, previous.wan.tx, seconds);
    setLiveThroughputMbps(wanRx !== null && wanTx !== null ? wanRx + wanTx : null);

    const totals: Record<Underlay, DirectionalRate & { expected: number; valid: number }> = {
      fiber: { rxMbps: 0, txMbps: 0, expected: 0, valid: 0 },
      '5g': { rxMbps: 0, txMbps: 0, expected: 0, valid: 0 },
    };
    for (const tunnel of liveState.metrics.tunnels) {
      if (!tunnel.present) continue;
      const path = inferUnderlay(tunnel.ifname);
      totals[path].expected += 1;
      const prior = previous.tunnels[tunnel.ifname];
      if (!prior) continue;
      const rxMbps = measuredRate(tunnel.rx_bytes, prior.rx, seconds);
      const txMbps = measuredRate(tunnel.tx_bytes, prior.tx, seconds);
      if (rxMbps === null || txMbps === null) continue;
      totals[path].rxMbps += rxMbps;
      totals[path].txMbps += txMbps;
      totals[path].valid += 1;
    }

    const nextRates: UnderlayRateSample = { measuredAt: ts };
    (['fiber', '5g'] as const).forEach((path) => {
      const total = totals[path];
      if (total.expected > 0 && total.valid === total.expected) {
        nextRates[path] = {
          rxMbps: Number(total.rxMbps.toFixed(3)),
          txMbps: Number(total.txMbps.toFixed(3)),
        };
      }
    });
    setUnderlayRates(nextRates);

    const fiberKnown = totals.fiber.expected === 0 || nextRates.fiber !== undefined;
    const cellKnown = totals['5g'].expected === 0 || nextRates['5g'] !== undefined;
    if (fiberKnown && cellKnown) {
      const observed = new Date(ts);
      const label = `${String(observed.getHours()).padStart(2, '0')}:${String(observed.getMinutes()).padStart(2, '0')}:${String(observed.getSeconds()).padStart(2, '0')}`;
      setLiveBandwidth((series) => [...series, {
        t: label,
        fiber: Number(((nextRates.fiber?.rxMbps ?? 0) + (nextRates.fiber?.txMbps ?? 0)).toFixed(3)),
        fiveg: Number(((nextRates['5g']?.rxMbps ?? 0) + (nextRates['5g']?.txMbps ?? 0)).toFixed(3)),
      }].slice(-120));
    }
  }, [branchId, liveState]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
    const activeUnderlay = liveState.metrics.active_tunnel
      ? inferUnderlay(liveState.metrics.active_tunnel)
      : null;
    const radio = liveState.metrics.cellular?.radio;
    const rssi = validRadioRssi(radio?.rssi_dbm) ? radio.rssi_dbm : undefined;
    const sinr = rssi !== undefined && Number.isFinite(radio?.snr_db) ? radio?.snr_db : undefined;
    return [
      {
        type: 'Fiber',
        status: underlayStatus(fiberT),
        active: activeUnderlay === 'fiber',
        rxMbps: underlayRates?.fiber?.rxMbps,
        txMbps: underlayRates?.fiber?.txMbps,
      },
      {
        type: '5G',
        status: underlayStatus(cellT),
        active: activeUnderlay === '5g',
        rssi,
        sinr,
        rxMbps: underlayRates?.['5g']?.rxMbps,
        txMbps: underlayRates?.['5g']?.txMbps,
      },
    ];
  }, [usingLive, liveState, underlayRates]);

  const bandwidthDataState: WidgetDataState = ipsecDataState === 'live' && liveBandwidth.length < 2
    ? 'loading'
    : ipsecDataState;
  const bandwidthStatusMessage = bandwidthDataState === 'loading' && liveState
    ? 'Waiting for two consecutive tunnel counter samples.'
    : ipsecStatusMessage;

  const gatewayTwinApplies = branchId === 'b-mck-03';
  const liveLanPorts = useMemo<LanPort[]>(() => gatewayTelemetry.ports.map((port) => ({
      id: port.id,
      label: port.label,
      interfaceName: port.interfaceName,
      ...(port.linkUp !== undefined ? { linkUp: port.linkUp } : null),
      ...(port.speedMbps !== undefined ? { speedMbps: port.speedMbps } : null),
      ...(port.connectedDeviceName ? { device: port.connectedDeviceName } : null),
      ...(port.rxPackets !== undefined ? { rxPackets: port.rxPackets } : null),
      ...(port.txPackets !== undefined ? { txPackets: port.txPackets } : null),
      ...(port.rxPps !== undefined ? { rxPps: port.rxPps } : null),
      ...(port.txPps !== undefined ? { txPps: port.txPps } : null),
    })), [gatewayTelemetry.ports]);
  const lanDataState: WidgetDataState = !gatewayTwinApplies
    ? 'unavailable'
    : liveLanPorts.length === 0
      ? gatewayTelemetry.freshness.receivedAt === undefined
        ? gatewayTelemetry.connection.transport === 'connecting' || gatewayTelemetry.connection.transport === 'open'
          ? 'loading'
          : 'unavailable'
        : 'unavailable'
      : gatewayTelemetry.freshness.fresh && gatewayTelemetry.connection.connected
        ? 'live'
        : 'stale';
  const lanStatusMessage = !gatewayTwinApplies
    ? 'No branch-scoped LAN telemetry source is configured for this site.'
    : lanDataState === 'loading'
        ? 'Waiting for gateway Ethernet reports.'
        : lanDataState === 'stale'
          ? 'The gateway Ethernet reports are stale.'
          : lanDataState === 'unavailable'
            ? 'Live LAN port telemetry is unavailable.'
            : liveLanPorts.length < 5
              ? `${liveLanPorts.length}/5 GW Twin interface reports received.`
              : undefined;

  const livePoePorts = useMemo<PoePort[]>(() => gatewayTelemetry.poePorts.flatMap((port) => {
    const watts = port.poe.power?.watts;
    const limit = port.poe.limit?.watts;
    if (!Number.isFinite(watts) || !Number.isFinite(limit) || Number(limit) <= 0) return [];
    return [{
      id: port.id,
      watts: Number(watts),
      max: Number(limit),
      ...(port.connectedDeviceName ? { device: port.connectedDeviceName } : null),
    }];
  }), [gatewayTelemetry.poePorts]);
  const poeDataState: WidgetDataState = !gatewayTwinApplies
    ? 'unavailable'
    : livePoePorts.length === 0
      ? gatewayTelemetry.freshness.receivedAt === undefined
        ? gatewayTelemetry.connection.transport === 'connecting' || gatewayTelemetry.connection.transport === 'open'
          ? 'loading'
          : 'unavailable'
        : 'unavailable'
      : gatewayTelemetry.freshness.fresh && gatewayTelemetry.connection.connected
        ? 'live'
        : 'stale';
  const poeStatusMessage = !gatewayTwinApplies
    ? 'No branch-scoped PoE telemetry source is configured for this site.'
    : gatewayTelemetry.poePorts.length === 0
      ? 'Gateway reports contain no PoE power or budget fields.'
      : livePoePorts.length === 0
        ? 'PoE readings are missing a measured power value or unit-aware limit.'
        : poeDataState === 'stale'
          ? 'The gateway PoE readings are stale.'
          : undefined;

  const clientTraffic = useMemo(() => measuredClientTraffic(liveDevices), [liveDevices]);
  const trafficDataState: WidgetDataState = ipsecDataState !== 'live'
    ? ipsecDataState
    : !devicesLoaded || devicesSource !== 'gateway' || clientTraffic.measuredClients === 0
      ? 'loading'
      : devicesConnected
        ? 'live'
        : 'stale';
  const trafficItems = trafficDataState === 'live' ? clientTraffic.rows : null;
  const activeTunnel = liveState?.metrics.active_tunnel || null;
  const trafficStatusMessage = trafficDataState === 'loading'
    ? 'Waiting for consecutive Wi-Fi client counter samples.'
    : trafficDataState === 'stale'
      ? 'The measured client-rate feed is stale.'
      : trafficDataState === 'unavailable'
        ? 'No live Wi-Fi client counter source is configured for this branch.'
        : clientTraffic.totalMbps === 0
          ? 'No client traffic was measured in the latest interval.'
          : activeTunnel
            ? `Gateway active tunnel: ${activeTunnel}`
            : 'Gateway active tunnel was not reported.';

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

        {/* Row 2 — full-width topology. Branches backed by a live MQTT feed
            (Plano → rdk/ipsec/metrics, McKinney → prplhome/ipsec/metrics) render
            the Dynamic Failover diagram driven by that branch's telemetry;
            branches without a feed keep the illustrative static Topology. */}
        <div className="col-12">
          {branchSource
            ? <FailoverTopology branchId={branchId} ipsec={ipsec} />
            : <Topology autoScenarioId={autoScenarioId} />}
        </div>

        {/* Rows 3–4 are live-only: never substitute demo values when a source
            is warming, stale, missing fields, or unavailable. */}
        <div className="col-4">
          <WanWidget
            links={liveLinks}
            dataState={ipsecDataState}
            source={liveTopic ?? undefined}
            statusMessage={ipsecStatusMessage}
            observedAt={liveState?.receivedAt}
          />
        </div>
        <div className="col-4">
          <LanPorts
            ports={liveLanPorts}
            dataState={lanDataState}
            source={gatewayTwinApplies ? 'prplOS Ethernet telemetry' : undefined}
            statusMessage={lanStatusMessage}
            observedAt={gatewayTwinApplies ? gatewayTelemetry.freshness.receivedAt : undefined}
          />
        </div>
        <div className="col-4">
          <PoePorts
            ports={livePoePorts}
            dataState={poeDataState}
            source={gatewayTwinApplies ? 'prplOS Ethernet telemetry' : undefined}
            statusMessage={poeStatusMessage}
            observedAt={gatewayTwinApplies ? gatewayTelemetry.freshness.receivedAt : undefined}
          />
        </div>

        <div className="col-8">
          <BandwidthChart
            data={liveBandwidth}
            dataState={bandwidthDataState}
            source={liveTopic ?? undefined}
            statusMessage={bandwidthStatusMessage}
            observedAt={liveState?.receivedAt}
          />
        </div>
        <div className="col-4">
          <AppTrafficWidget
            items={trafficItems}
            dataState={trafficDataState}
            source={liveTopic ? `${liveTopic} Wi-Fi counters` : undefined}
            statusMessage={trafficStatusMessage}
            observedAt={liveState?.receivedAt}
          />
        </div>
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
