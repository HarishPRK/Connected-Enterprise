import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight, ArrowRight, CheckCircle2, AlertTriangle, CircleOff, MinusCircle,
  Laptop, Monitor, Printer, CreditCard, Server, PhoneCall, Flame, Wind,
  DoorClosed, Smartphone, Tablet, Cpu, Plug, Boxes, ChevronDown, X, Search,
} from 'lucide-react';
import type { Device, Status } from '../../types';
import { StatusBadge } from '../StatusBadge';
import './DeviceDomainSummary.css';

const kinds = {
  laptop: { label: 'Laptops', icon: Laptop }, desktop: { label: 'Desktops', icon: Monitor },
  printer: { label: 'Printers', icon: Printer }, payment: { label: 'Payment terminals', icon: CreditCard },
  server: { label: 'Servers', icon: Server }, confphone: { label: 'Conference phones', icon: PhoneCall },
  fire_sensor: { label: 'Fire sensors', icon: Flame }, smoke_sensor: { label: 'Smoke sensors', icon: Wind },
  door_lock: { label: 'Door locks', icon: DoorClosed }, phone: { label: 'Phones', icon: Smartphone },
  tablet: { label: 'Tablets', icon: Tablet }, matter: { label: 'Matter devices', icon: Cpu },
  shelly: { label: 'Shelly devices', icon: Plug }, generic: { label: 'Other devices', icon: Boxes },
} satisfies Record<Device['kind'], { label: string; icon: typeof Laptop }>;

const states = [
  { id: 'ok', label: 'Healthy', icon: CheckCircle2 },
  { id: 'warn', label: 'Attention', icon: AlertTriangle },
  { id: 'err', label: 'Offline', icon: CircleOff },
  { id: 'off', label: 'Inactive', icon: MinusCircle },
] as const;
const connectionLabel = { wifi: 'Wi-Fi', wired: 'Wired', poe: 'PoE', thread: 'Thread' };
type Selection = { kind: Device['kind'] } | { status: Status };

function countStates(devices: Device[]) {
  const counts = { ok: 0, warn: 0, err: 0, off: 0 };
  for (const device of devices) counts[device.status] += 1;
  return counts;
}

export function DeviceDomainSummary({ domain, devices }: { domain: 'IT' | 'OT'; devices: Device[] }) {
  const [expanded, setExpanded] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const headingId = useId();
  const listId = useId();
  const list = devices.filter((device) => device.domain === domain);
  const counts = countStates(list);
  const total = list.length;
  const route = domain === 'IT' ? '/it-devices' : '/ot-devices';
  const Icon = domain === 'IT' ? Laptop : Cpu;
  const groups = Object.entries(kinds).flatMap(([kind, info]) => {
    const members = list.filter((device) => device.kind === kind);
    return members.length ? [{ kind: kind as Device['kind'], ...info, members }] : [];
  }).sort((a, b) => b.members.length - a.members.length || a.label.localeCompare(b.label));
  const visible = expanded ? groups : groups.slice(0, 4);
  const selectedDevices = selection
    ? list.filter((device) => 'kind' in selection ? device.kind === selection.kind : device.status === selection.status)
    : [];
  const selectedLabel = selection
    ? 'kind' in selection ? kinds[selection.kind].label : states.find((state) => state.id === selection.status)!.label
    : '';

  return (
    <section className="device-domain" data-domain={domain} aria-labelledby={headingId}>
      <header className="device-domain-heading">
        <span className="device-domain-icon"><Icon size={21} aria-hidden="true" /></span>
        <div className="device-domain-title"><h3 id={headingId}>{domain} devices</h3><span>{groups.length} {groups.length === 1 ? 'category' : 'categories'}</span></div>
        <strong className="device-domain-total" aria-label={`${total} ${domain} devices`}>{total}</strong>
        <Link className="device-domain-inventory" to={route} aria-label={`View all ${domain} devices`} title={`View all ${domain} devices`}><ArrowUpRight size={19} aria-hidden="true" /></Link>
      </header>

      {total === 0 ? (
        <p className="device-domain-empty">No {domain} devices in this branch inventory yet.</p>
      ) : (
        <>
          <div className="device-domain-health" aria-label={`${domain} device health`}>
            {states.filter((state) => state.id !== 'off' || counts.off > 0).map(({ id, label, icon: StateIcon }) => (
              <button key={id} type="button" data-status={id} disabled={counts[id] === 0} onClick={() => setSelection({ status: id })} aria-label={`Inspect ${counts[id]} ${label.toLowerCase()} ${domain} devices`}>
                <span><StateIcon size={13} aria-hidden="true" />{label}</span><strong>{counts[id]}</strong>
              </button>
            ))}
          </div>
          <div className="device-domain-health-rail" aria-hidden="true">
            {states.map(({ id }) => counts[id] > 0 && <span key={id} data-status={id} style={{ width: `${counts[id] / total * 100}%` }} />)}
          </div>
          <div className="device-domain-mix-heading"><span>Device categories</span><span>Count / share</span></div>
          <ul id={listId} className="device-domain-categories">
            {visible.map(({ kind, label, icon: KindIcon, members }) => {
              const health = countStates(members);
              const share = members.length / total * 100;
              return (
                <li key={kind}>
                  <button className="device-domain-category" type="button" onClick={() => setSelection({ kind })} aria-label={`Inspect ${members.length} ${label.toLowerCase()}, ${health.ok} healthy, ${health.warn} needing attention, ${health.err} offline, ${health.off} inactive`}>
                    <span className="device-domain-kind-icon"><KindIcon size={17} aria-hidden="true" /></span>
                    <span className="device-domain-category-content">
                      <span className="device-domain-category-line"><span>{label}</span><strong>{members.length}</strong><small>{share < 1 ? '<1' : Math.round(share)}%</small><ArrowRight size={13} aria-hidden="true" /></span>
                      <span className="device-domain-category-track" aria-hidden="true">{states.map(({ id }) => health[id] > 0 && <span key={id} data-status={id} style={{ width: `${health[id] / total * 100}%` }} />)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {groups.length > 4 && <button className="device-domain-more" type="button" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show fewer categories' : `Show ${groups.length - 4} more categories`}<ChevronDown size={14} aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : undefined }} /></button>}
        </>
      )}
      {selection && <DomainInventory domain={domain} label={selectedLabel} devices={selectedDevices} route={route} onClose={() => setSelection(null)} />}
    </section>
  );
}

function DomainInventory({ domain, label, devices, route, onClose }: { domain: string; label: string; devices: Device[]; route: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [query, setQuery] = useState('');
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
