import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { devices, getDeviceHealth } from '../data/mock';
import type { Device } from '../types';
import {
  Laptop, Monitor, Printer, CreditCard, Server, PhoneCall,
  Flame, Wind, DoorClosed, Lock, Search, Download, Plus,
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
  const { push } = useToast();

  // The drawer is position: fixed at top: 0, so its content sits at the top of
  // the viewport. If the user clicked a row near the bottom of the table, they
  // would have to manually scroll up to see the device info — bring them up.
  useEffect(() => {
    if (selected) {
      document.querySelector<HTMLElement>('.main')?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [selected]);

  const list = useMemo(
    () => devices
      .filter((d) => d.domain === domain)
      .filter((d) => statusFilter === 'all' || d.status === statusFilter)
      .filter((d) => !q || d.name.toLowerCase().includes(q.toLowerCase()) || d.ip.includes(q)),
    [domain, q, statusFilter],
  );

  const title = domain === 'IT' ? 'IT Devices' : 'OT Devices';
  const subtitle = domain === 'IT'
    ? 'Laptops, desktops, printers, payment machines, conference phones, local servers'
    : 'Fire & smoke sensors, door locks — remote actions available';

  const counts = {
    all:  devices.filter(d => d.domain === domain).length,
    ok:   devices.filter(d => d.domain === domain && d.status === 'ok').length,
    warn: devices.filter(d => d.domain === domain && d.status === 'warn').length,
    err:  devices.filter(d => d.domain === domain && d.status === 'err').length,
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
          <div className="toolbar">
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
              {domain === 'OT' && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {list.map((d) => {
              const Icon = iconFor[d.kind];
              const health = getDeviceHealth(d);
              const reasonColor =
                d.status === 'err'  ? 'var(--err)'  :
                d.status === 'warn' ? 'var(--warn)' : 'var(--text-muted)';
              return (
                <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(d)}>
                  <td><Icon size={16} /></td>
                  <td style={{ color: 'var(--text)', fontWeight: 500 }}>{d.name}</td>
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
                  {domain === 'OT' && (
                    <td onClick={(e) => e.stopPropagation()}>
                      {d.kind === 'door_lock' && (
                        <button className="danger" title="Emergency unlock" onClick={() => setUnlockTarget(d)}>
                          <Lock size={12} />
                          Unlock
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr><td colSpan={domain === 'OT' ? 9 : 8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>No devices match the current filters.</td></tr>
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
