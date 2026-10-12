import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import {
  getDeviceHealth,
  getDevicesForBranch,
  BRANCH_TO_IPSEC_SOURCE,
  BRANCH_TO_DEVICE_TOPIC,
} from '../data/mock';
import type { Device } from '../types';
import { useDevices, classifyDevice, controlMatterDevice, controlShellyDevice, refreshMatterDevices, type DeviceView } from '../ui/useDevices';
import { matchesDeviceInventory } from '../ui/deviceInventory';
import {
  Laptop, Monitor, Printer, CreditCard, Server, PhoneCall,
  Flame, Wind, DoorClosed, Lock, Search, Download, Plus, ArrowLeftRight,
  Smartphone, Tablet, Cpu, Plug, HelpCircle, Power, RefreshCw,
} from 'lucide-react';
import { DeviceDrawer } from '../ui/DeviceDrawer';
import { telemetryHealth, formatConnectedFor } from '../ui/deviceTelemetry';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { DevicesDashboard } from '../components/widgets/DevicesDashboard';
import { AiInsightCard } from '../components/widgets/AiInsightCard';
import { downloadCsv } from '../ui/download';

const iconFor: Record<Device['kind'], React.ComponentType<{ size?: number }>> = {
  laptop: Laptop, desktop: Monitor, printer: Printer, payment: CreditCard,
  server: Server, confphone: PhoneCall,
  fire_sensor: Flame, smoke_sensor: Wind, door_lock: DoorClosed,
  phone: Smartphone, tablet: Tablet, matter: Cpu, shelly: Plug, generic: HelpCircle,
};

const fmtFor = formatConnectedFor;

export function DevicesPage({ domain, branchId }: { domain: 'IT' | 'OT'; branchId: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const setQ = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('q', value); else next.delete('q');
    setSearchParams(next, { replace: true });
  };
  const [statusFilter, setStatusFilter] = useState<'all' | 'ok' | 'warn' | 'err'>('all');
  const [selected, setSelected] = useState<Device | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const { push } = useToast();
  const { devices: liveDevices, loaded, source, connected, refresh, inventoryTopicsSeen } = useDevices();
  const [refreshing, setRefreshing] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [busyDevices, setBusyDevices] = useState<Set<string>>(new Set());

  // Poke the gateway to re-fetch the Matter device list. The fresh inventory
  // arrives over the live SSE stream, so we just confirm the request and keep
  // the spinner up briefly for feedback.
  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refresh();
      push({ kind: 'success', title: 'Inventory refreshed', detail: 'The latest server inventory has been loaded.' });
    } catch (err) {
      push({ kind: 'error', title: 'Refresh failed', detail: err instanceof Error ? err.message : String(err) });
    } finally {
      setRefreshing(false);
    }
  }

  // Strictly scope live devices to THIS branch's location so Plano (rdk) and
  // McKinney (prpl) fleets never mix. `prplhome/ipsec/metrics` is normalised
  // to locationSource 'prpl', while `rdk/ipsec/metrics` becomes 'rdk'. Devices
  // with no locationSource (pure seed, before real LAN discovery) are excluded
  // from the live view; the branch-specific mock below backs the empty state.
  const branchSource = BRANCH_TO_IPSEC_SOURCE[branchId] as 'rdk' | 'prpl' | undefined;
  const branchTopic = BRANCH_TO_DEVICE_TOPIC[branchId];
  const canDiscoverMatter = branchId === 'b-mck-03' && source === 'gateway' && connected;
  async function handleDiscover() {
    setDiscovering(true);
    try {
      await refreshMatterDevices();
      push({ kind: 'info', title: 'Discovery requested', detail: 'The configured Matter gateway will republish its commissioned device list.' });
    } catch (error) {
      push({ kind: 'error', title: 'Discovery failed', detail: error instanceof Error ? error.message : String(error) });
    } finally { setDiscovering(false); }
  }
  const liveForBranch = useMemo(
    () => liveDevices.filter((device) =>
      matchesDeviceInventory(device, branchSource, branchTopic),
    ),
    [liveDevices, branchSource, branchTopic],
  );

  // Live inventory from the gateway feed (Phase 0: server seed + persisted
  // IT/OT overrides). Fall back to this branch's mock fleet until the first
  // live inventory for this location lands or if the server is unreachable, so
  // the page never renders empty — and never borrows another branch's devices.
  const allDevices: DeviceView[] = useMemo(
    () => (loaded && (liveForBranch.length > 0 || !!branchTopic && inventoryTopicsSeen.includes(branchTopic))
      ? liveForBranch
      : getDevicesForBranch(branchId).map((d) => ({ ...d, autoDomain: d.domain, overridden: false }))),
    [loaded, liveForBranch, branchId, branchTopic, inventoryTopicsSeen],
  );
  const showingLiveInventory = loaded && (liveForBranch.length > 0 || !!branchTopic && inventoryTopicsSeen.includes(branchTopic));

  // The drawer is position: fixed at top: 0, so its content sits at the top of
  // the viewport. If the user clicked a row near the bottom of the table, they
  // would have to manually scroll up to see the device info — bring them up.
  useEffect(() => {
    if (selected) {
      document.querySelector<HTMLElement>('.main')?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [selected]);

  const list = useMemo(
    () => allDevices
      .filter((d) => d.domain === domain)
      .filter((d) => statusFilter === 'all' || d.status === statusFilter)
      .filter((d) => !q.trim() || `${d.name} ${d.ip} ${d.mac} ${d.kind}`.toLowerCase().includes(q.trim().toLowerCase())),
    [allDevices, domain, q, statusFilter],
  );

  const title = domain === 'IT' ? 'IT Devices' : 'OT Devices';
  const subtitle = domain === 'IT'
    ? 'Laptops, desktops, printers, payment machines, conference phones, local servers'
    : 'Sensors, door locks, Matter and Shelly devices — live relay controls where supported';

  const counts = {
    all:  allDevices.filter(d => d.domain === domain).length,
    ok:   allDevices.filter(d => d.domain === domain && d.status === 'ok').length,
    warn: allDevices.filter(d => d.domain === domain && d.status === 'warn').length,
    err:  allDevices.filter(d => d.domain === domain && d.status === 'err').length,
  };

  // Move a device between IT and OT. The server persists the override and pushes
  // a fresh snapshot over SSE, so the table re-sorts itself across both pages.
  async function handleReclassify(e: React.MouseEvent, d: DeviceView) {
    e.stopPropagation();
    if (busyDevices.has(d.id)) return;
    setBusyDevices((current) => new Set(current).add(d.id));
    const target: 'IT' | 'OT' = d.domain === 'IT' ? 'OT' : 'IT';
    try {
      await classifyDevice(d.mac, target);
      await refresh();
      push({
        kind: 'success',
        title: `${d.name} moved to ${target}`,
        detail: d.autoDomain === target
          ? 'Reverted to its auto-classification.'
          : `Now classified as ${target} (manual override).`,
      });
    } catch (err) {
      push({
        kind: 'error',
        title: 'Reclassify failed',
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally { setBusyDevices((current) => { const next = new Set(current); next.delete(d.id); return next; }); }
  }

  // Show the requested power state only while a command is pending. Once it
  // settles, the live inventory remains authoritative for external changes.
  const [powerOverrides, setPowerOverrides] = useState<Record<string, boolean>>({});

  // Flip a switchable OT device to the opposite of its displayed state.
  // Matter devices go through the gateway's hub (nodeId encoded in the id as
  // `matter-<nodeId>`); Shelly devices talk MQTT to IoT Core directly (their
  // id IS the MQTT device id). The relay switches the moment the device gets
  // the command — halfway through the round trip — so we flip the button
  // optimistically on click and let the live feed reconcile to the device's
  // real state (or revert if the command fails).
  async function handlePowerToggle(e: React.MouseEvent, d: DeviceView, currentlyOn: boolean) {
    e.stopPropagation();
    if (busyDevices.has(d.id)) return;
    setBusyDevices((current) => new Set(current).add(d.id));
    const action: 'On' | 'Off' = currentlyOn ? 'Off' : 'On';
    const desired = !currentlyOn;
    setPowerOverrides((prev) => ({ ...prev, [d.id]: desired }));
    try {
      if (d.kind === 'shelly') {
        await controlShellyDevice(d.id, action);
      } else {
        const nodeId = Number(d.id.replace(/^matter-/, ''));
        if (!Number.isInteger(nodeId) || nodeId <= 0) {
          throw new Error(`${d.name} has no live nodeId — is the gateway feed up?`);
        }
        await controlMatterDevice(nodeId, action);
      }
      push({
        kind: 'success',
        title: `${d.name} turned ${action.toLowerCase()}`,
        detail: d.kind === 'shelly' ? 'The device confirmed the command.' : 'The gateway confirmed the command.',
      });
    } catch (err) {
      // Command failed — undo the optimistic flip.
      setPowerOverrides((prev) => ({ ...prev, [d.id]: currentlyOn }));
      push({
        kind: 'error',
        title: `${action} failed for ${d.name}`,
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyDevices((current) => { const next = new Set(current); next.delete(d.id); return next; });
      setPowerOverrides((current) => { const next = { ...current }; delete next[d.id]; return next; });
    }
  }

  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        right={
          <div className="toolbar" style={{ alignItems: 'center' }}>
            <SourcePill source={showingLiveInventory ? source : 'seed'} connected={connected} topic={branchTopic} />
            <button onClick={handleRefresh} disabled={refreshing} title="Fetch the current inventory from the server">
              <RefreshCw size={14} className={refreshing ? 'spin' : undefined} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <button onClick={() => setAddOpen(true)}><Plus size={14} />Add device</button>
            <button onClick={() => downloadCsv(`${domain.toLowerCase()}-devices-${branchId}.csv`, ['Name', 'Type', 'Domain', 'IP', 'MAC', 'Connection', 'Status', 'Connected hours', 'Source'], list.map((d) => [d.name, d.kind, d.domain, d.ip, d.mac, d.conn, d.status, d.connectedForHours, showingLiveInventory ? 'gateway' : 'demo']))}><Download size={14} />Export</button>
          </div>
        }
      />

      <div className="toolbar" style={{ marginBottom: 12 }}>
        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, color: 'var(--text-muted)' }} />
          <input
            placeholder="Search name, IP, MAC or type"
            aria-label={`Search ${domain} devices`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ paddingLeft: 30, minWidth: 260 }}
          />
        </div>
        {(['all', 'ok', 'warn', 'err'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            style={s === statusFilter
              ? { background: 'var(--grad-accent-soft)', borderColor: 'rgba(var(--accent-rgb) / 0.35)', color: 'var(--text)' }
              : undefined}
            aria-pressed={s === statusFilter}
          >
            {s === 'all' ? 'All' : s === 'ok' ? 'Healthy' : s === 'warn' ? 'Degraded' : 'Offline'}
            <span style={{ color: 'var(--text-muted)', marginLeft: 4, fontVariantNumeric: 'tabular-nums' }}>{counts[s]}</span>
          </button>
        ))}
      </div>

      <DevicesDashboard devices={list} />

      <div style={{ marginTop: 16, marginBottom: 16 }}>
        <AiInsightCard
          topic={domain === 'IT' ? 'it-devices' : 'ot-devices'}
          subtitle={`Analysis of the current ${domain} inventory`}
          data={{
            domain,
            total: list.length,
            counts,
            devices: list.map((d) => ({
              id: d.id, name: d.name, kind: d.kind, status: d.status,
              ip: d.ip, mac: d.mac, conn: d.conn, connectedForHours: d.connectedForHours,
            })),
          }}
        />
      </div>

      <Card>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Name</th>
              <th>Type</th>
              <th>IP</th>
              <th>MAC</th>
              <th>Connection</th>
              <th>Connected for</th>
              <th>Status · justification</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((d) => {
              const Icon = iconFor[d.kind] ?? HelpCircle;
              const health = telemetryHealth(d) ?? getDeviceHealth(d);
              const reasonColor =
                d.status === 'err'  ? 'var(--err)'  :
                d.status === 'warn' ? 'var(--warn)' : 'var(--text-muted)';
              return (
                <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(d)}>
                  <td><Icon size={16} /></td>
                  <td style={{ color: 'var(--text)', fontWeight: 500 }}>
                    {d.name}
                    {d.overridden && (
                      <span
                        title={`Manually classified — auto-detected as ${d.autoDomain}`}
                        style={{
                          marginLeft: 8, fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
                          textTransform: 'uppercase', padding: '1px 6px', borderRadius: 4,
                          background: 'var(--grad-accent-soft)', color: 'var(--text-dim)',
                          border: '1px solid rgba(var(--accent-rgb) / 0.3)',
                        }}
                      >
                        moved
                      </span>
                    )}
                  </td>
                  <td style={{ textTransform: 'capitalize', color: 'var(--text-dim)' }}>
                    {d.kind === 'shelly' ? 'MQTT' : d.kind.replace('_', ' ')}
                  </td>
                  <td className="mono">{d.ip}</td>
                  <td className="mono" style={{ color: 'var(--text-muted)' }}>{d.mac}</td>
                  <td style={{ textTransform: 'uppercase', fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.06em' }}>{d.conn}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtFor(d.connectedForHours)}</td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start', maxWidth: 320 }}>
                      <StatusBadge status={d.status} />
                      <span
                        style={{
                          fontSize: 11,
                          color: reasonColor,
                          fontStyle: d.status === 'ok' ? 'italic' : 'normal',
                          lineHeight: 1.4,
                        }}
                        title={health.summary}
                      >
                        {health.summary}
                      </span>
                    </div>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {d.kind !== 'matter' && d.kind !== 'shelly' && (
                        <button
                          title={!showingLiveInventory ? 'Reclassification requires this branch’s gateway inventory' : busyDevices.has(d.id) ? 'Reclassification is pending' : `Move ${d.name} to ${d.domain === 'IT' ? 'OT' : 'IT'}`}
                          onClick={(e) => handleReclassify(e, d)}
                          disabled={!showingLiveInventory || busyDevices.has(d.id)}
                        >
                          <ArrowLeftRight size={12} />
                          {d.domain === 'IT' ? 'To OT' : 'To IT'}
                        </button>
                      )}
                      {d.kind === 'door_lock' && (
                        <button className="danger" disabled title="Remote door unlock is unavailable: no lock-control integration is configured">
                          <Lock size={12} />
                          Unlock
                        </button>
                      )}
                      {(d.kind === 'matter' || d.kind === 'shelly') && (() => {
                        const isOn = powerOverrides[d.id] ?? d.power ?? false;
                        return (
                          <button
                            className={`power-toggle${isOn ? ' on' : ''}`}
                            title={`${d.name} is ${d.power == null && !(d.id in powerOverrides) ? 'in an unknown state' : isOn ? 'on' : 'off'} — click to turn ${isOn ? 'off' : 'on'}`}
                            onClick={(e) => handlePowerToggle(e, d, isOn)}
                            disabled={!showingLiveInventory || !connected || busyDevices.has(d.id)}
                            aria-label={`${isOn ? 'Turn off' : 'Turn on'} ${d.name}`}
                            aria-pressed={isOn}
                          >
                            <Power size={15} />
                          </button>
                        );
                      })()}
                    </div>
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>No devices match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {/* Resolve the selected device against the LIVE list so the drawer's
          metering/duration keep updating while it's open. */}
      <DeviceDrawer
        device={selected ? (allDevices.find((d) => d.id === selected.id) ?? selected) : null}
        onClose={() => setSelected(null)}
      />

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={`Add ${domain} device`}
        footer={
          <>
            <button onClick={() => setAddOpen(false)}>Close</button>
            <button onClick={handleRefresh} disabled={refreshing}>Refresh inventory</button>
            {domain === 'OT' && <button className="primary" onClick={handleDiscover} disabled={!canDiscoverMatter || discovering} title={!canDiscoverMatter ? 'Matter discovery requires the connected McKinney gateway' : undefined}>{discovering ? 'Requesting…' : 'Discover Matter devices'}</button>}
          </>
        }
      >
        <p>Connect the device to this branch's gateway network. It will appear automatically when the gateway publishes its next inventory update.</p>
        {domain === 'OT' && <p>Commission Matter devices through the gateway's Matter hub, then use <strong>Discover Matter devices</strong> to request the current commissioned list. Shelly devices appear when they publish telemetry.</p>}
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>Manual device creation and commissioning are not exposed by the gateway API. This inventory follows devices discovered by the gateway.</p>
      </Modal>
    </>
  );
}

/** Small status chip showing where the inventory is coming from: the live
 *  gateway feed, the gateway-but-currently-offline case, or the demo seed used
 *  until the gateway's discovery component starts publishing. */
function SourcePill({
  source,
  connected,
  topic,
}: {
  source: 'seed' | 'gateway';
  connected: boolean;
  topic?: string;
}) {
  const live = source === 'gateway' && connected;
  const label = source === 'seed'
    ? 'Demo data · no gateway feed'
    : connected ? 'Live · gateway feed' : 'Gateway offline · last known';
  const color = source === 'seed'
    ? 'var(--text-muted)'
    : connected ? 'var(--ok, #10b981)' : 'var(--warn, #f59e0b)';
  return (
    <span
      title={source === 'seed'
        ? `Showing the built-in demo inventory. Real devices appear when ${topic ?? 'the gateway telemetry feed'} publishes Wi-Fi clients.`
        : connected ? `Streaming live device inventory from ${topic ?? 'the gateway'}.` : 'No live inventory right now — showing the last devices the gateway reported.'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5,
        color: 'var(--text-dim)', padding: '3px 9px', borderRadius: 999,
        border: '1px solid var(--border)', whiteSpace: 'nowrap',
      }}
    >
      <span style={{
        width: 7, height: 7, borderRadius: '50%', background: color,
        boxShadow: live ? `0 0 0 3px color-mix(in srgb, ${color} 25%, transparent)` : 'none',
      }} />
      {label}
    </span>
  );
}
