import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ChevronDown, Cpu, Laptop, Network, Pause, Play, Router, MapPin, Clock } from 'lucide-react';
import type { Branch, Device, Status } from '../../types';
import { DomainInventory } from './DeviceInventory';
import { countStates, kinds, states } from './deviceTopologyModel';
import './DeviceTopology.css';

type Selection = { kind: Device['kind'] } | { status: Status } | { deviceId: string };
const priority: Record<Status, number> = { err: 0, warn: 1, off: 2, ok: 3 };

// Bounded rings preserve distinct hit targets. Larger inventories remain available
// through category/health controls, with the rendered subset explicitly labelled.
function nodePositions(count: number) {
  const rings = [{ capacity: 10, radius: 51 }, { capacity: 20, radius: 77 }, { capacity: 30, radius: 104 }];
  const points: { x: number; y: number }[] = [];
  for (const { capacity, radius } of rings) {
    const size = Math.min(capacity, count - points.length);
    for (let i = 0; i < size; i++) {
      const angle = i / size * Math.PI * 2 - Math.PI / 2;
      points.push({ x: 120 + Math.cos(angle) * radius, y: 120 + Math.sin(angle) * radius });
    }
  }
  return points;
}

export const DeviceTopology = memo(function DeviceTopology({ branch, devices, online }: { branch: Branch; devices: Device[]; online: boolean }) {
  const root = useRef<HTMLElement>(null);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(!document.hidden);
  const titleId = useId();
  const domainDevices = useMemo(() => ({
    IT: devices.filter((device) => device.domain === 'IT'),
    OT: devices.filter((device) => device.domain === 'OT'),
  }), [devices]);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.05 });
    if (root.current) observer.observe(root.current);
    const handleVisibility = () => setForeground(!document.hidden);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', handleVisibility); };
  }, []);
  return (
    <section ref={root} className="device-fabric" aria-labelledby={titleId} data-moving={!paused && visible && foreground && online}>
      <header className="fabric-heading">
        <div><h3 id={titleId}><Network size={19} aria-hidden="true" />Device topology</h3><p>{branch.gatewayModel} · {branch.id}</p></div>
        <button className="fabric-motion" type="button" aria-label={paused ? 'Resume topology animation' : 'Pause topology animation'} aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? <Play size={15} /> : <Pause size={15} />}<span>{paused ? 'Resume' : 'Pause'}</span></button>
      </header>
      <div className="fabric-network">
        <DeviceCluster domain="IT" devices={domainDevices.IT} />
        <div className="fabric-gateway" data-online={online}>
          <svg className="fabric-bridge" viewBox="0 0 160 100" aria-hidden="true">
            <path d="M0 50H160 M0 38H45L60 50 M160 62H115L100 50" />
            <path className="fabric-stream fabric-stream-it" d="M0 50H80" pathLength="100" />
            <path className="fabric-stream fabric-stream-ot" d="M160 50H80" pathLength="100" />
          </svg>
          <Link to="/gateway-twin" className="fabric-chip" aria-label="Open EDGE gateway digital twin">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <g className="fabric-chip-pins">{[30, 45, 60, 75, 90].map((position) => <path key={position} d={`M${position} 5V20 M${position} 100V115 M5 ${position}H20 M100 ${position}H115`} />)}</g>
              <rect className="fabric-chip-base" x="18" y="24" width="84" height="84" rx="15" />
              <rect className="fabric-chip-face" x="18" y="16" width="84" height="84" rx="15" />
              <rect className="fabric-chip-circuit" x="26" y="24" width="68" height="68" rx="10" pathLength="100" />
              <Router x="42" y="38" width="36" height="36" strokeWidth={1.4} />
              <text x="60" y="86" textAnchor="middle">EDGE</text>
            </svg>
          </Link>
          <strong>Gateway</strong><span className={online ? 'fabric-gateway-online' : 'fabric-gateway-offline'}><i />{online ? 'Online' : 'Offline'}</span>
        </div>
        <DeviceCluster domain="OT" devices={domainDevices.OT} />
      </div>
      <div className="fabric-caption"><span className="fabric-node-key" />One node = one device<span>Schematic links · inventory health</span></div>
      <footer className="fabric-meta"><span><MapPin size={13} />{branch.location}</span><span><Clock size={13} />{Math.floor(branch.uptimeHours / 24)}d {branch.uptimeHours % 24}h uptime</span><span>FW {branch.firmware}</span></footer>
    </section>
  );
});

const DeviceCluster = memo(function DeviceCluster({ domain, devices }: { domain: 'IT' | 'OT'; devices: Device[] }) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [hoveredKind, setHoveredKind] = useState<Device['kind'] | null>(null);
  const [hoveredDevice, setHoveredDevice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const inspectNode = useCallback((deviceId: string) => setSelection({ deviceId }), []);
  const titleId = useId();
  const listId = useId();
  const glowId = useId().replace(/:/g, '');
  const counts = useMemo(() => countStates(devices), [devices]);
  const rendered = useMemo(() => [...devices].sort((a, b) => priority[a.status] - priority[b.status] || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)).slice(0, 60), [devices]);
  const positions = useMemo(() => nodePositions(rendered.length), [rendered.length]);
  const groups = useMemo(() => Object.entries(kinds).flatMap(([kind, info]) => {
    const members = devices.filter((device) => device.kind === kind);
    return members.length ? [{ kind: kind as Device['kind'], ...info, members }] : [];
  }).sort((a, b) => b.members.length - a.members.length || a.label.localeCompare(b.label)), [devices]);
  const activeDevice = devices.find((device) => device.id === hoveredDevice);
  const activeGroup = groups.find((group) => group.kind === hoveredKind);
  const CoreIcon = activeDevice ? kinds[activeDevice.kind].icon : activeGroup ? activeGroup.icon : domain === 'IT' ? Laptop : Cpu;
  const route = domain === 'IT' ? '/it-devices' : '/ot-devices';
  const selected = useMemo(() => selection ? devices.filter((device) => 'kind' in selection ? device.kind === selection.kind : 'status' in selection ? device.status === selection.status : device.id === selection.deviceId) : [], [selection, devices]);
  const selectedLabel = selection ? 'kind' in selection ? kinds[selection.kind].label : 'status' in selection ? states.find((state) => state.id === selection.status)!.label : 'Device details' : '';
  return (
    <section className="fabric-domain" data-domain={domain} aria-labelledby={titleId}>
      <div className="fabric-domain-heading"><h4 id={titleId}>{domain} devices</h4><Link to={route} aria-label={`View all ${domain} devices`}><ArrowUpRight size={16} /></Link></div>
      <svg className="fabric-constellation" viewBox="0 0 240 240" aria-label={`${domain} inventory, ${devices.length} devices. Select a node for details.`}>
        <defs><radialGradient id={glowId}><stop offset="0" stopColor="currentColor" stopOpacity=".14" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></radialGradient></defs>
        <circle cx="120" cy="120" r="119" fill={`url(#${glowId})`} aria-hidden="true" />
        <g className="fabric-orbits" aria-hidden="true">{[51, 77, 104].map((radius) => <circle key={radius} cx="120" cy="120" r={radius} />)}<path d="M0 120H240 M120 0V240" /></g>
        {devices.length > 0 && <circle className="fabric-orbit-sweep" cx="120" cy="120" r="114" pathLength="100" aria-hidden="true" />}
        <g aria-hidden="true" className="fabric-spokes">{rendered.map((device, index) => <path key={device.id} data-highlighted={device.id === hoveredDevice || device.kind === hoveredKind} d={`M120 120L${positions[index].x} ${positions[index].y}`} />)}</g>
        <circle className="fabric-domain-core" cx="120" cy="120" r="36" aria-hidden="true" />
        <g aria-hidden="true" className="fabric-core-content"><CoreIcon x="111" y="96" width="18" height="18" strokeWidth={1.6} /><text className="fabric-core-count" x="120" y="139" textAnchor="middle">{activeDevice ? '1' : activeGroup ? activeGroup.members.length : devices.length}</text></g>
        {rendered.map((device, index) => {
          const dimmed = hoveredDevice ? device.id !== hoveredDevice : hoveredKind ? device.kind !== hoveredKind : false;
          return <DeviceNode key={device.id} id={device.id} label={device.name || device.mac} status={device.status} dimmed={dimmed} active={device.id === hoveredDevice} x={positions[index].x} y={positions[index].y} onHover={setHoveredDevice} onInspect={inspectNode} />;
        })}
      </svg>
      <div className="fabric-readout" data-status={activeDevice?.status}><strong>{activeDevice ? activeDevice.name || activeDevice.mac : activeGroup ? activeGroup.label : `${counts.ok} of ${devices.length} healthy`}</strong><span>{activeDevice ? `${activeDevice.ip || 'No IP'} · ${states.find((state) => state.id === activeDevice.status)!.label}` : activeGroup ? `${activeGroup.members.length} ${activeGroup.members.length === 1 ? 'device' : 'devices'} highlighted` : devices.length > 60 ? `60 of ${devices.length} nodes shown · issues first` : devices.length ? 'Select a node to inspect' : 'Waiting for device discovery'}</span></div>
      <div className="fabric-health" aria-label={`${domain} device health`}>{states.filter((state) => state.id !== 'off' || counts.off > 0).map(({ id, label }) => <button key={id} type="button" data-status={id} disabled={counts[id] === 0} onClick={() => setSelection({ status: id })} aria-label={`Inspect ${counts[id]} ${label.toLowerCase()} ${domain} devices`}><i /><strong>{counts[id]}</strong><span>{label}</span></button>)}</div>
      {devices.length === 0 ? <p className="fabric-empty">No {domain} devices in this branch inventory yet.</p> : <ul id={listId} className="fabric-categories">{(expanded ? groups : groups.slice(0, 4)).map(({ kind, label, icon: Icon, members }) => <li key={kind}><button type="button" onPointerEnter={() => setHoveredKind(kind)} onPointerLeave={() => setHoveredKind(null)} onFocus={() => setHoveredKind(kind)} onBlur={() => setHoveredKind(null)} onClick={() => setSelection({ kind })} aria-label={`Inspect ${members.length} ${label.toLowerCase()}`}><Icon size={16} /><span>{label}</span><strong>{members.length}</strong><ArrowUpRight size={13} /></button></li>)}</ul>}
      {groups.length > 4 && <button className="fabric-more" type="button" aria-controls={listId} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show fewer' : `+ ${groups.length - 4} categories`}<ChevronDown size={13} /></button>}
      {selection && <DomainInventory domain={domain} label={selectedLabel} devices={selected} route={route} onClose={() => setSelection(null)} />}
    </section>
  );
});

// Only the glyph's displayed fields cross this boundary. The full, current
// inventory continues through DeviceCluster to readouts and the inspector.
const DeviceNode = memo(function DeviceNode({ id, label, status, dimmed, active, x, y, onHover, onInspect }: {
  id: string; label: string; status: Status; dimmed: boolean; active: boolean; x: number; y: number;
  onHover: (id: string | null) => void; onInspect: (id: string) => void;
}) {
  return <g className="fabric-node" data-status={status} data-dimmed={dimmed} data-active={active} transform={`translate(${x} ${y})`} role="button" tabIndex={0} aria-label={`Inspect ${label}, ${states.find((state) => state.id === status)!.label}`} onPointerEnter={() => onHover(id)} onPointerLeave={() => onHover(null)} onFocus={() => onHover(id)} onBlur={() => onHover(null)} onClick={() => onInspect(id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onInspect(id); } }}>
    <circle className="fabric-node-hit" r="11" /><circle className="fabric-node-halo" r="9" /><rect className="fabric-node-body" x="-5.5" y="-5.5" width="11" height="11" rx="3" /><path className="fabric-node-mark" d={status === 'err' ? 'M-2-2L2 2M2-2L-2 2' : status === 'warn' ? 'M0-3V0M0 2V3' : status === 'off' ? 'M-2 0H2' : 'M-2 0L-.5 1.5L2-1.5'} />
  </g>;
});
