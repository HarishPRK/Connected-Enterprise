import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ArrowUpRight, ChevronDown, Clock, Cpu, Laptop, MapPin, Maximize2, Minimize2, Network, Pause, Play, Router, Wifi, Cable, Radio, Zap } from 'lucide-react';
import type { Branch, Device, Status } from '../../types';
import { DomainInventory } from './DeviceInventory';
import { countStates, kinds, states } from './deviceTopologyModel';
import { buildSpatialNodes, deviceLabel, getDeviceFlow, SPATIAL_WIDTH, SPATIAL_HEIGHT, type SpatialNode } from './spatialNetworkModel';
import { createSpatialRenderer } from './spatialNetworkRenderer';
import './DeviceTopology.css';

type Domain = Device['domain'];
type Selection = { domain: Domain } & ({ kind: Device['kind'] } | { status: Status } | { deviceId: string });
const connections = { wifi: { label: 'Wi-Fi', icon: Wifi }, wired: { label: 'Wired', icon: Cable }, poe: { label: 'PoE', icon: Zap }, thread: { label: 'Thread', icon: Radio } };

/** A single animation clock draws the scene; inventory updates never restart it. */
function SpatialScene({ nodes, online, moving, hoveredId, highlighted, onHover, onInspect }: {
  nodes: SpatialNode[]; online: boolean; moving: boolean; hoveredId: string | null;
  highlighted: { domain: Domain; kind: Device['kind'] } | null;
  onHover: (id: string | null) => void; onInspect: (device: Device) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const state = useRef({ nodes, online, moving, hoveredId, highlighted });
  const invalidate = useRef<() => void>(() => {});
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focused = nodes.find(node => node.device.id === focusedId)?.device.id ?? nodes[0]?.device.id;

  useEffect(() => {
    state.current = { nodes, online, moving, hoveredId, highlighted };
    invalidate.current();
  }, [nodes, online, moving, hoveredId, highlighted]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = createSpatialRenderer(canvas);
    let frame = 0; let time = 0; let previous: number | undefined; let disposed = false;
    const draw = (now: number) => {
      frame = 0;
      if (disposed) return;
      const current = state.current;
      if (current.moving && previous !== undefined) time += Math.min((now - previous) / 1000, .05);
      previous = current.moving ? now : undefined;
      renderer.render(current.nodes, {
        time, online: current.online, hoveredId: current.hoveredId,
        highlightedKind: current.highlighted?.kind ?? null,
        highlightedDomain: current.highlighted?.domain ?? null,
      });
      if (current.moving) frame = requestAnimationFrame(draw);
    };
    const refresh = () => { if (!disposed && !frame) frame = requestAnimationFrame(draw); };
    invalidate.current = refresh;
    const resize = () => {
      const box = canvas.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) renderer.resize(box.width, box.height, Math.min(devicePixelRatio || 1, 2), document.documentElement.dataset.theme === 'dark');
      refresh();
    };
    const sizeObserver = new ResizeObserver(resize); sizeObserver.observe(canvas);
    const themeObserver = new MutationObserver(resize);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    resize();
    return () => {
      disposed = true; cancelAnimationFrame(frame); sizeObserver.disconnect(); themeObserver.disconnect();
      renderer.dispose(); invalidate.current = () => {};
    };
  }, []);

  const navigate = (event: KeyboardEvent<HTMLButtonElement>, node: SpatialNode) => {
    let next: SpatialNode | undefined;
    if (event.key === 'Home') next = nodes[0];
    else if (event.key === 'End') next = nodes[nodes.length - 1];
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
      const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
      next = nodes.filter(other => other !== node && (horizontal ? other.x - node.x : other.y - node.y) * direction > 1)
        .sort((a, b) => {
          const score = (other: SpatialNode) => Math.hypot(other.x - node.x, other.y - node.y) + Math.abs(horizontal ? other.y - node.y : other.x - node.x) * 2;
          return score(a) - score(b);
        })[0];
    } else return;
    event.preventDefault();
    if (next) buttons.current.get(next.device.id)?.focus();
  };

  return <div className="spatial-stage" role="group" aria-label="Spatial device network. Use arrow keys to move between devices, and Enter to inspect.">
    <canvas ref={canvasRef} className="spatial-canvas" aria-hidden="true" />
    <div className="spatial-hit-layer">
      {nodes.map(node => <button key={node.device.id} type="button" className="spatial-node-hit"
        ref={button => { if (button) buttons.current.set(node.device.id, button); else buttons.current.delete(node.device.id); }}
        style={{ left: `${node.x / SPATIAL_WIDTH * 100}%`, top: `${(node.y - node.size * .45) / SPATIAL_HEIGHT * 100}%`, width: `${node.size * 1.5 / SPATIAL_WIDTH * 100}%` }}
        tabIndex={focused === node.device.id ? 0 : -1}
        aria-label={`Inspect ${deviceLabel(node.device)}, ${node.device.domain}, ${connections[node.device.conn].label}, ${states.find(s => s.id === node.device.status)!.label}`}
        onPointerEnter={() => onHover(node.device.id)} onPointerLeave={() => onHover(null)}
        onFocus={() => { setFocusedId(node.device.id); onHover(node.device.id); }} onBlur={() => onHover(null)}
        onKeyDown={event => navigate(event, node)} onClick={() => onInspect(node.device)} />)}
      <Link to="/gateway-twin" className="spatial-gateway-hit" aria-label="Open EDGE gateway digital twin" onPointerEnter={() => onHover(null)} />
    </div>
    <span className="spatial-gateway-label"><Router size={12} aria-hidden="true" />Shared gateway</span>
    {nodes.length === 0 && <div className="spatial-empty-scene">Devices appear here as they are discovered.</div>}
  </div>;
}

export function DeviceTopology({ branch, devices, online }: { branch: Branch; devices: Device[]; online: boolean }) {
  const root = useRef<HTMLElement>(null);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(!document.hidden);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [expanded, setExpanded] = useState(false);
  const [expandError, setExpandError] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<{ domain: Domain; kind: Device['kind'] } | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const titleId = useId();
  const nodes = useMemo(() => buildSpatialNodes(devices), [devices]);
  const activeDevice = devices.find(device => device.id === hoveredId);
  const moving = !paused && visible && foreground && online && !reducedMotion;
  const counts = { IT: devices.filter(d => d.domain === 'IT'), OT: devices.filter(d => d.domain === 'OT') };
  const selectedDevices = selection ? devices.filter(device => device.domain === selection.domain && ('kind' in selection ? device.kind === selection.kind : 'status' in selection ? device.status === selection.status : device.id === selection.deviceId)) : [];
  const selectedLabel = selection ? 'kind' in selection ? kinds[selection.kind].label : 'status' in selection ? states.find(s => s.id === selection.status)!.label : 'Device details' : '';
  const ActiveIcon = activeDevice ? kinds[activeDevice.kind].icon : Network;
  const ConnectionIcon = activeDevice ? connections[activeDevice.conn].icon : null;
  const flow = activeDevice ? getDeviceFlow(activeDevice, online) : null;

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .05 });
    if (root.current) observer.observe(root.current.querySelector('.spatial-stage') ?? root.current);
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const visibility = () => setForeground(!document.hidden);
    const motion = () => setReducedMotion(query.matches);
    const fullscreen = () => setExpanded(document.fullscreenElement === root.current);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('fullscreenchange', fullscreen);
    query.addEventListener('change', motion);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', visibility); document.removeEventListener('fullscreenchange', fullscreen); query.removeEventListener('change', motion); };
  }, []);

  const toggleExpanded = async () => {
    try {
      setExpandError('');
      if (document.fullscreenElement === root.current) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch {
      setExpandError('Expanded view is unavailable in this browser.');
    }
  };

  return <section ref={root} className="device-fabric" aria-labelledby={titleId} data-moving={moving}>
    <header className="fabric-heading">
      <div><h3 id={titleId}><Network size={19} aria-hidden="true" />Device topology</h3><p>{branch.gatewayModel} · {branch.id}</p></div>
      <div className="fabric-tools">
        {!reducedMotion && <button className="fabric-motion" type="button" aria-label={paused ? 'Resume topology animation' : 'Pause topology animation'} aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}<span>{paused ? 'Resume' : 'Pause'}</span></button>}
        {document.fullscreenEnabled && <button className="fabric-expand" type="button" aria-label={expanded ? 'Exit expanded device topology' : 'Expand device topology'} title={expanded ? 'Exit expanded device topology' : 'Expand device topology'} onClick={() => void toggleExpanded()}>{expanded ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}</button>}
      </div>
    </header>
    {expandError && <p className="fabric-empty" role="status">{expandError}</p>}
    <div className="spatial-domain-headings">
      {(['IT', 'OT'] as const).map(domain => { const Icon = domain === 'IT' ? Laptop : Cpu; return <div key={domain} className="spatial-domain-total" data-domain={domain}>
        <Link to={domain === 'IT' ? '/it-devices' : '/ot-devices'} aria-label={`View all ${domain} devices`}><Icon size={17} aria-hidden="true" /><strong>{counts[domain].length}</strong><span>{domain} devices</span><ArrowUpRight size={14} aria-hidden="true" /></Link>
      </div>; })}
      <span className="spatial-gateway-status" data-online={online}><i />Gateway {online ? 'online' : 'offline'}</span>
    </div>
    <SpatialScene nodes={nodes} online={online} moving={moving} hoveredId={activeDevice?.id ?? null} highlighted={highlighted} onHover={setHoveredId} onInspect={device => setSelection({ domain: device.domain, deviceId: device.id })} />
    <div className="spatial-insight" data-domain={activeDevice?.domain} data-status={activeDevice?.status}>
      <ActiveIcon size={20} aria-hidden="true" />
      <div><strong>{activeDevice ? deviceLabel(activeDevice) : highlighted ? kinds[highlighted.kind].label : devices.length ? 'Explore the connected devices' : 'Waiting for device discovery'}</strong><span>{activeDevice ? `${activeDevice.ip && activeDevice.ip !== '—' ? activeDevice.ip : 'No IP reported'} · ${states.find(s => s.id === activeDevice.status)!.label}` : highlighted ? `${counts[highlighted.domain].filter(d => d.kind === highlighted.kind).length} ${highlighted.domain} devices highlighted` : devices.length ? 'Hover to trace a connection. Select a device to inspect.' : 'The gateway inventory will appear here when available.'}</span></div>
      {activeDevice && ConnectionIcon && <span className="spatial-connection"><ConnectionIcon size={13} aria-hidden="true" />{connections[activeDevice.conn].label}</span>}
      {flow?.measured && <span className="spatial-rates" title="Reported device throughput">{flow.rxMbps !== undefined && <span><ArrowDown size={12} aria-hidden="true" />{flow.rxMbps.toFixed(2)}</span>}{flow.txMbps !== undefined && <span><ArrowUp size={12} aria-hidden="true" />{flow.txMbps.toFixed(2)}</span>}<small>Mbps</small></span>}
    </div>
    <div className="fabric-domains">{(['IT', 'OT'] as const).map(domain => <DomainSummary key={domain} domain={domain} devices={counts[domain]} onSelect={setSelection} onHighlight={setHighlighted} />)}</div>
    <div className="fabric-caption"><span className="fabric-node-key" />One device = one shape<span>Schematic connections · inventory health</span>{nodes.length < devices.length && <span>{nodes.length} of {devices.length} shown · issues first</span>}{reducedMotion && <span>Reduced motion</span>}</div>
    <footer className="fabric-meta"><span><MapPin size={13} aria-hidden="true" />{branch.location}</span><span><Clock size={13} aria-hidden="true" />{Math.floor(branch.uptimeHours / 24)}d {branch.uptimeHours % 24}h uptime</span><span>FW {branch.firmware}</span></footer>
    {selection && <DomainInventory domain={selection.domain} label={selectedLabel} devices={selectedDevices} route={selection.domain === 'IT' ? '/it-devices' : '/ot-devices'} onClose={() => setSelection(null)} />}
  </section>;
}

function DomainSummary({ domain, devices, onSelect, onHighlight }: { domain: Domain; devices: Device[]; onSelect: (selection: Selection) => void; onHighlight: (value: { domain: Domain; kind: Device['kind'] } | null) => void }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const counts = countStates(devices);
  const groups = Object.entries(kinds).flatMap(([kind, info]) => { const members = devices.filter(device => device.kind === kind); return members.length ? [{ kind: kind as Device['kind'], ...info, members }] : []; }).sort((a, b) => b.members.length - a.members.length || a.label.localeCompare(b.label));
  return <section className="fabric-domain" data-domain={domain} aria-label={`${domain} device inventory`}>
    <div className="fabric-health" aria-label={`${domain} device health`}>{states.filter(state => state.id !== 'off' || counts.off > 0).map(({ id, label }) => <button key={id} type="button" data-status={id} disabled={counts[id] === 0} onClick={() => onSelect({ domain, status: id })} aria-label={`Inspect ${counts[id]} ${label.toLowerCase()} ${domain} devices`}><i /><strong>{counts[id]}</strong><span>{label}</span></button>)}</div>
    {devices.length === 0 ? <p className="fabric-empty">No {domain} devices in this branch inventory yet.</p> : <ul id={listId} className="fabric-categories">{(expanded ? groups : groups.slice(0, 4)).map(({ kind, label, icon: Icon, members }) => <li key={kind}><button type="button" onPointerEnter={() => onHighlight({ domain, kind })} onPointerLeave={() => onHighlight(null)} onFocus={() => onHighlight({ domain, kind })} onBlur={() => onHighlight(null)} onClick={() => onSelect({ domain, kind })} aria-label={`Inspect ${members.length} ${label.toLowerCase()} ${domain} devices`}><Icon size={16} aria-hidden="true" /><span>{label}</span><strong>{members.length}</strong><ArrowUpRight size={13} aria-hidden="true" /></button></li>)}</ul>}
    {groups.length > 4 && <button className="fabric-more" type="button" aria-controls={listId} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show fewer' : `+ ${groups.length - 4} categories`}<ChevronDown size={13} aria-hidden="true" /></button>}
  </section>;
}
