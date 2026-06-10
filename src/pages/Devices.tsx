import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { devices as mockDevices, getDeviceHealth } from '../data/mock';
import type { Device } from '../types';
import { useDevices, classifyDevice, controlMatterDevice, type DeviceView } from '../ui/useDevices';
import {
  Laptop, Monitor, Printer, CreditCard, Server, PhoneCall,
  Flame, Wind, DoorClosed, Lock, Search, Download, Plus, ArrowLeftRight,
  Smartphone, Tablet, Cpu, Plug, HelpCircle, Power,
} from 'lucide-react';
import { DeviceDrawer } from '../ui/DeviceDrawer';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { DevicesDashboard } from '../components/widgets/DevicesDashboard';
import { AiInsightCard } from '../components/widgets/AiInsightCard';

const iconFor: Record<Device['kind'], React.ComponentType<{ size?: number }>> = {
  laptop: Laptop, desktop: Monitor, printer: Printer, payment: CreditCard,
  server: Server, confphone: PhoneCall,
  fire_sensor: Flame, smoke_sensor: Wind, door_lock: DoorClosed,
  phone: Smartphone, tablet: Tablet, matter: Cpu, shelly: Plug, generic: HelpCircle,
};

function fmtFor(h: number) {
  if (h === 0) return '—';
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function DevicesPage({ domain }: { domain: 'IT' | 'OT' }) {
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ok' | 'warn' | 'err'>('all');
  const [selected, setSelected] = useState<Device | null>(null);
  const [unlockTarget, setUnlockTarget] = useState<Device | null>(null);
  const [reason, setReason] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const { push } = useToast();
  const { devices: liveDevices, loaded, source, connected } = useDevices();

  // Live inventory from the gateway feed (Phase 0: server seed + persisted
  // IT/OT overrides). Fall back to the bundled mock until the first snapshot
  // lands or if the server is unreachable, so the page never renders empty.
  const allDevices: DeviceView[] = useMemo(
    () => (loaded && liveDevices.length
      ? liveDevices
      : mockDevices.map((d) => ({ ...d, autoDomain: d.domain, overridden: false }))),
    [loaded, liveDevices],
  );

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
      .filter((d) => !q || d.name.toLowerCase().includes(q.toLowerCase()) || d.ip.includes(q)),
    [allDevices, domain, q, statusFilter],
  );

  const title = domain === 'IT' ? 'IT Devices' : 'OT Devices';
  const subtitle = domain === 'IT'
    ? 'Laptops, desktops, printers, payment machines, conference phones, local servers'
    : 'Fire & smoke sensors, door locks — remote actions available';

  const counts = {
    all:  allDevices.filter(d => d.domain === domain).length,
    ok:   allDevices.filter(d => d.domain === domain && d.status === 'ok').length,
    warn: allDevices.filter(d => d.domain === domain && d.status === 'warn').length,
    err:  allDevices.filter(d => d.domain === domain && d.status === 'err').length,
  };

  function handleAction(kind: 'unlock' | 'reboot' | 'disable', d: Device) {
    if (kind === 'unlock') {
      setSelected(null);
      setUnlockTarget(d);
      return;
    }
    push({
      kind: 'info',
      title: kind === 'reboot' ? `Reboot queued for ${d.name}` : `${d.name} disabled`,
      detail: kind === 'reboot' ? 'Device will reconnect within ~60s' : 'Network access revoked',
    });
  }

  // Move a device between IT and OT. The server persists the override and pushes
  // a fresh snapshot over SSE, so the table re-sorts itself across both pages.
  async function handleReclassify(e: React.MouseEvent, d: DeviceView) {
    e.stopPropagation();
    const target: 'IT' | 'OT' = d.domain === 'IT' ? 'OT' : 'IT';
    try {
      await classifyDevice(d.mac, target);
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
    }
  }

  // Drive a Matter device's OnOff cluster through the gateway. Live devices
  // carry their Matter nodeId in the id (`matter-<nodeId>`); the round trip
  // (shadow poll on the gateway + hub call) takes a few seconds, so the
  // buttons show a busy state until the ack lands.
  async function handleMatterControl(e: React.MouseEvent, d: DeviceView, action: 'On' | 'Off') {
    e.stopPropagation();
    const nodeId = Number(d.id.replace(/^matter-/, ''));
    if (!Number.isInteger(nodeId) || nodeId <= 0) {
      push({ kind: 'error', title: 'No Matter nodeId', detail: `${d.name} has no live nodeId — is the gateway feed up?` });
      return;
    }
    setTogglingId(`${d.id}:${action}`);
    try {
      await controlMatterDevice(nodeId, action);
      push({ kind: 'success', title: `${d.name} turned ${action.toLowerCase()}`, detail: 'The gateway confirmed the command.' });
    } catch (err) {
      push({
        kind: 'error',
        title: `${action} failed for ${d.name}`,
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTogglingId(null);
    }
  }

  function confirmUnlock() {
    if (!unlockTarget) return;
    push({
      kind: 'success',
      title: `${unlockTarget.name} unlocked`,
      detail: `Reason logged: ${reason || 'Emergency unlock'}`,
    });
    setUnlockTarget(null);
    setReason('');
  }

  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        right={
          <div className="toolbar" style={{ alignItems: 'center' }}>
            <SourcePill source={source} connected={connected} />
            <button><Plus size={14} />Add device</button>
            <button><Download size={14} />Export</button>
          </div>
        }
      />

      <div className="toolbar" style={{ marginBottom: 12 }}>
        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, color: 'var(--text-muted)' }} />
          <input
            placeholder="Search name or IP"
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
          subtitle={`Bedrock analysis of the current ${domain} inventory`}
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
              const health = getDeviceHealth(d);
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
                    {d.kind.replace('_', ' ')}
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
                      <button
                        title={`Move ${d.name} to ${d.domain === 'IT' ? 'OT' : 'IT'}`}
                        onClick={(e) => handleReclassify(e, d)}
                      >
                        <ArrowLeftRight size={12} />
                        {d.domain === 'IT' ? 'To OT' : 'To IT'}
                      </button>
                      {d.kind === 'door_lock' && (
                        <button className="danger" title="Emergency unlock" onClick={() => setUnlockTarget(d)}>
                          <Lock size={12} />
                          Unlock
                        </button>
                      )}
                      {d.kind === 'matter' && (['On', 'Off'] as const).map((action) => (
                        <button
                          key={action}
                          title={`Turn ${action.toLowerCase()} via the gateway's Matter hub`}
                          disabled={togglingId != null && togglingId.startsWith(`${d.id}:`)}
                          onClick={(e) => handleMatterControl(e, d, action)}
                        >
                          <Power size={12} />
                          {togglingId === `${d.id}:${action}` ? `${action}…` : action}
                        </button>
                      ))}
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

      <DeviceDrawer device={selected} onClose={() => setSelected(null)} onAction={handleAction} />

      <Modal
        open={unlockTarget != null}
        onClose={() => { setUnlockTarget(null); setReason(''); }}
        title={`Emergency unlock — ${unlockTarget?.name ?? ''}`}
        footer={
          <>
            <button onClick={() => { setUnlockTarget(null); setReason(''); }}>Cancel</button>
            <button className="danger" onClick={confirmUnlock}>
              <Lock size={13} />Confirm unlock
            </button>
          </>
        }
      >
        <p>This will <strong style={{ color: 'var(--err)' }}>immediately unlock</strong> the door from the cloud. Action will be logged with your operator ID and the reason below.</p>
        <label style={{ display: 'block', marginTop: 12 }}>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>Reason</span>
          <input
            placeholder="e.g. Fire drill at 16:00"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ width: '100%' }}
          />
        </label>
      </Modal>
    </>
  );
}

/** Small status chip showing where the inventory is coming from: the live
 *  gateway feed, the gateway-but-currently-offline case, or the demo seed used
 *  until the gateway's discovery component starts publishing. */
function SourcePill({ source, connected }: { source: 'seed' | 'gateway'; connected: boolean }) {
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
        ? 'Showing the built-in demo inventory. Real devices appear once the gateway publishes to rdk/devices/inventory.'
        : connected ? 'Streaming live device inventory from the gateway.' : 'No live inventory right now — showing the last devices the gateway reported.'}
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
