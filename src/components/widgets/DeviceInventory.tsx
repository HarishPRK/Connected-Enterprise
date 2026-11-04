import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, ChevronRight, Search, X } from 'lucide-react';
import type { Device, Status } from '../../types';
import { StatusBadge } from '../StatusBadge';
import { kinds } from './deviceTopologyModel';
import './DeviceInventory.css';

const connectionLabel = { wifi: 'Wi-Fi', wired: 'Wired', poe: 'PoE', thread: 'Thread' };
const stateLabel = { ok: 'Online', warn: 'Attention', err: 'Offline', off: 'Inactive' } as const;
const kindLabel: Record<Device['kind'], string> = {
  laptop: 'Laptop', desktop: 'Desktop', printer: 'Printer', payment: 'Payment terminal', server: 'Server',
  confphone: 'Conference phone', fire_sensor: 'Fire sensor', smoke_sensor: 'Smoke sensor', door_lock: 'Door lock',
  phone: 'Phone', tablet: 'Tablet', matter: 'Matter device', shelly: 'Shelly device', generic: 'Unspecified',
};

function DeviceRecord({ device }: { device: Device }) {
  const telemetry = device.telemetry;
  return <div className="device-record-details" data-device-id={device.id}>
    <StatusBadge status={device.status} text={stateLabel[device.status]} />
    <dl>
      <div><dt>Device type</dt><dd>{kindLabel[device.kind]}</dd></div>
      <div><dt>Connection</dt><dd>{connectionLabel[device.conn]}</dd></div>
      {device.conn === 'wifi' && Number.isInteger(telemetry?.wifiApIndex) &&
        <div><dt>Reported access point</dt><dd>AP {telemetry?.wifiApIndex}</dd></div>}
      <div><dt>IP address</dt><dd><code>{device.ip || 'Not reported'}</code></dd></div>
      <div><dt>MAC address</dt><dd><code>{device.mac || 'Not reported'}</code></dd></div>
      {telemetry?.rssiDbm != null && Number.isFinite(telemetry.rssiDbm) &&
        <div><dt>Wi-Fi signal</dt><dd>{telemetry.rssiDbm} dBm</dd></div>}
    </dl>
  </div>;
}

export function DomainInventory({ domain, devices, route, branchName, recordId, initialKind, initialStatus, onDevice, onBack, onClose }: {
  domain: Device['domain']; devices: Device[]; route: string; branchName: string;
  recordId?: string; initialKind?: Device['kind']; initialStatus?: Status;
  onDevice: (device: Device) => void; onBack?: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<string>(initialStatus ?? 'all');
  const [kind, setKind] = useState<string>(initialKind ?? 'all');
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement instanceof HTMLElement || document.activeElement instanceof SVGElement ? document.activeElement : null;
    element?.showModal();
    return () => {
      element?.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const target = recordId ? dialog.current?.querySelector<HTMLElement>('h2') : dialog.current?.querySelector('input');
    target?.focus({ preventScroll: true });
  }, [recordId]);
  const availableKinds = useMemo(() => [...new Set(devices.map(d => d.kind))].sort(), [devices]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return devices.filter(d => (status === 'all' || status === d.status) && (kind === 'all' || kind === d.kind)
      && (!needle || [d.name, d.mac, d.ip, d.id].some(value => value?.toLowerCase().includes(needle))));
  }, [devices, kind, query, status]);
  const record = recordId ? devices.find(d => d.id === recordId) : undefined;
  return createPortal(
    <dialog ref={dialog} className="device-domain-inspector" aria-labelledby={titleId} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="device-domain-inspector-body">
        <header><div>
          {recordId && onBack && <button type="button" className="device-record-back" onClick={onBack}><ArrowLeft size={13} />{domain} inventory</button>}
          <h2 id={titleId} tabIndex={-1}>{recordId ? record?.name || record?.mac || 'Device details' : `${domain} inventory`}</h2>
          <p>{branchName} · {recordId ? `${domain} device` : `${devices.length} devices`}</p>
        </div><button type="button" onClick={onClose} aria-label="Close device inventory"><X size={19} aria-hidden="true" /></button></header>
        {recordId ? (record ? <DeviceRecord device={record} /> : <p className="device-domain-empty">This device is no longer in the branch inventory.</p>) : <>
          <label className="device-domain-search"><Search size={16} aria-hidden="true" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a name, IP or MAC address" aria-label="Search this device group" /></label>
          <div className="device-record-filters">
            <select aria-label="Filter by device status" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="all">All statuses</option>{Object.entries(stateLabel).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <select aria-label="Filter by device type" value={kind} onChange={e => setKind(e.target.value)}>
              <option value="all">All types</option>{availableKinds.map(k => <option key={k} value={k}>{k === 'generic' ? 'Unspecified type' : kinds[k].label}</option>)}
            </select>
          </div>
          <ul className="device-domain-inspector-list">
            {filtered.map(device => <li key={device.id}>
              <button type="button" onClick={() => onDevice(device)}><span><strong>{device.name || device.mac || device.id}</strong><small>{device.ip || 'No IP reported'} · {connectionLabel[device.conn]}</small></span>
                <StatusBadge status={device.status} text={stateLabel[device.status]} /><ChevronRight size={14} aria-hidden="true" /></button>
            </li>)}
          </ul>
          {!filtered.length && <p className="device-domain-empty">{devices.length ? 'No devices match your search.' : 'No devices currently in this group.'}</p>}
        </>}
        <footer><span>{recordId ? 'Branch inventory' : `${filtered.length} of ${devices.length} devices`}</span>
          <Link to={route} onClick={onClose}>Open {domain} devices page <ArrowUpRight size={15} aria-hidden="true" /></Link></footer>
      </div>
    </dialog>, document.body,
  );
}
