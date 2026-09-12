import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ArrowUpRight, X, Search } from 'lucide-react';
import type { Device } from '../../types';
import { StatusBadge } from '../StatusBadge';
import './DeviceInventory.css';
const connectionLabel = { wifi: 'Wi-Fi', wired: 'Wired', poe: 'PoE', thread: 'Thread' };

export function DomainInventory({ domain, label, devices, route, onClose }: { domain: string; label: string; devices: Device[]; route: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [query, setQuery] = useState('');
  useEffect(() => {
    const element = dialog.current;
    const trigger = (document.activeElement instanceof HTMLElement || document.activeElement instanceof SVGElement) ? document.activeElement : null;
    element?.showModal();
    element?.querySelector('input')?.focus();
    return () => {
      element?.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  const filtered = devices.filter((device) => `${device.name} ${device.ip} ${device.mac}`.toLowerCase().includes(query.toLowerCase().trim()));
  return createPortal(
    <dialog ref={dialog} className="device-domain-inspector" aria-labelledby={titleId} onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="device-domain-inspector-body">
        <header><div><h2 id={titleId}>{domain} · {label}</h2><p>{devices.length} {devices.length === 1 ? 'device' : 'devices'} in the current branch inventory</p></div><button type="button" onClick={onClose} aria-label="Close device inventory"><X size={19} aria-hidden="true" /></button></header>
        <label className="device-domain-search"><Search size={16} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a name, IP or MAC address" aria-label="Search this device group" /></label>
        <ul className="device-domain-inspector-list">
          {filtered.map((device) => <li key={device.id}><div><strong>{device.name || device.mac}</strong><span>{device.ip || 'No IP reported'} · {connectionLabel[device.conn]}</span><code>{device.mac}</code></div><StatusBadge status={device.status} /></li>)}
        </ul>
        {filtered.length === 0 && <p className="device-domain-empty">{devices.length ? 'No devices match your search.' : 'No devices currently match this group.'}</p>}
        <footer><span>{filtered.length} of {devices.length} devices</span><Link to={route} onClick={onClose}>Open {domain} inventory <ArrowUpRight size={15} aria-hidden="true" /></Link></footer>
      </div>
    </dialog>, document.body,
  );
}
