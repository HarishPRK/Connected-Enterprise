import { Drawer } from './Drawer';
import { StatusBadge } from '../components/StatusBadge';
import type { Device, DeviceTelemetry, HealthSignal } from '../types';
import { getDeviceHealth } from '../data/mock';
import { telemetryHealth, meteringTiles } from './deviceTelemetry';
import { Activity, Cable, Wifi, Plug, Stethoscope, CheckCircle2, AlertTriangle, XCircle, Zap } from 'lucide-react';

const connIcon = { wired: Cable, wifi: Wifi, poe: Plug } as const;

export function DeviceDrawer({
  device, onClose, onAction,
}: {
  device: Device | null;
  onClose: () => void;
  onAction?: (kind: 'unlock' | 'reboot' | 'disable', d: Device) => void;
}) {
  const open = device != null;
  if (!device) return null;
  const Icon = connIcon[device.conn];
  const health = telemetryHealth(device) ?? getDeviceHealth(device);

  return (
    <Drawer open={open} onClose={onClose} title={device.name} width={520}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <StatusBadge status={device.status} />
        <span className="badge"><Icon size={11} /> {device.conn.toUpperCase()}</span>
        <span className="badge">{device.domain}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Stat label="IP Address"     value={<span className="mono">{device.ip}</span>} />
        <Stat label="MAC Address"    value={<span className="mono">{device.mac}</span>} />
        <Stat label="Type"           value={<span style={{ textTransform: 'capitalize' }}>{device.kind.replace('_', ' ')}</span>} />
        <Stat label="Connected for"  value={`${device.connectedForHours} h`} />
      </div>

      {device.telemetry && <MeteringCard t={device.telemetry} />}

      {/* ── Diagnostics panel — justifies the status with concrete signals ── */}
      <div className="card" style={{ marginTop: 16, padding: 14, gap: 10 }}>
        <div className="card-head" style={{ paddingBottom: 0 }}>
          <div>
            <div className="card-title">
              <Stethoscope size={13} />
              Health diagnostics
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>
              {health.summary}
            </div>
          </div>
          <StatusBadge status={device.status} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          {health.signals.map((s, i) => <SignalRow key={i} signal={s} />)}
        </div>
        <div style={{
          fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic',
          paddingTop: 8, borderTop: '1px dashed var(--border)',
        }}>
          Status is computed by aggregating these signals against per-class thresholds.
          A device is <strong style={{ color: 'var(--warn)' }}>degraded</strong> when any signal
          breaches its threshold; <strong style={{ color: 'var(--err)' }}>offline</strong> when
          the heartbeat is lost.
        </div>
      </div>

      <div className="card" style={{ marginTop: 16, padding: 14, gap: 8 }}>
        <div className="card-title"><Activity size={13} /> Recent activity</div>
        <ActivityLine when="Now"        text="Live · sending heartbeats" />
        <ActivityLine when="2h ago"     text="Renewed DHCP lease" />
        <ActivityLine when="14h ago"    text="Firmware health-check OK" />
        <ActivityLine when="2d ago"     text="Reconnected after outage" />
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        {device.kind === 'door_lock' && (
          <button className="danger" onClick={() => onAction?.('unlock', device)}>Emergency Unlock</button>
        )}
        <button onClick={() => onAction?.('reboot', device)}>Reboot</button>
        <button onClick={() => onAction?.('disable', device)}>Disable</button>
      </div>
    </Drawer>
  );
}

/** Live power metering — prominent stat tiles from the device's own readings. */
function MeteringCard({ t }: { t: DeviceTelemetry }) {
  const tiles = meteringTiles(t);
  if (tiles.length === 0) return null;
  return (
    <div className="card" style={{ marginTop: 16, padding: 14, gap: 12 }}>
      <div className="card-title"><Zap size={13} /> Live power metering</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {tiles.map((m) => (
          <div className="stat" key={m.label}>
            <div className="label">{m.label}</div>
            <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
              {m.value}
            </div>
          </div>
        ))}
      </div>
      {t.tempC != null && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', paddingTop: 4, borderTop: '1px dashed var(--border)' }}>
          Device temperature {t.tempC.toFixed(1)} °C · readings stream live from the device over MQTT
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div style={{ fontSize: 14, color: 'var(--text)' }}>{value}</div>
    </div>
  );
}

function SignalRow({ signal }: { signal: HealthSignal }) {
  const sevColor =
    signal.status === 'err'  ? 'var(--err)'  :
    signal.status === 'warn' ? 'var(--warn)' : 'var(--ok)';
  const SevIcon =
    signal.status === 'err'  ? XCircle :
    signal.status === 'warn' ? AlertTriangle : CheckCircle2;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 4,
      padding: '8px 10px',
      borderRadius: 8,
      background: 'var(--surface-1)',
      borderLeft: `3px solid ${sevColor}`,
      border: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
        <span style={{ color: sevColor, display: 'inline-flex', flexShrink: 0 }}>
          <SevIcon size={13} />
        </span>
        <span style={{ color: 'var(--text-dim)', fontWeight: 500, flex: 1 }}>
          {signal.label}
        </span>
        <span style={{ color: 'var(--text)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {signal.value}
        </span>
      </div>
      {(signal.threshold || signal.why) && (
        <div style={{
          fontSize: 11, color: 'var(--text-muted)',
          paddingLeft: 21, lineHeight: 1.45,
          display: 'flex', flexWrap: 'wrap', gap: 8,
        }}>
          {signal.threshold && (
            <span>Threshold <strong style={{ color: 'var(--text-dim)' }}>{signal.threshold}</strong></span>
          )}
          {signal.why && (
            <span style={{ color: sevColor }}>{signal.why}</span>
          )}
        </div>
      )}
    </div>
  );
}

function ActivityLine({ when, text }: { when: string; text: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--text-dim)' }}>
      <span>{text}</span><span style={{ color: 'var(--text-muted)' }}>{when}</span>
    </div>
  );
}
