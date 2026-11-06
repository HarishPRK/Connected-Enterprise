import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { ArrowUpRight, Box, CircleDot, Cpu, Laptop, Minus, Pause, Play, Router, TriangleAlert, X } from 'lucide-react';
import type { Branch, Device, Status } from '../../types';
import { countStates, kinds } from './deviceTopologyModel';
import './BranchDeviceOrbit.css';

type Filter = { kind?: Device['kind']; status?: Status };
interface Props {
  branch: Branch;
  devices: Device[];
  online?: boolean;
  onDevice: (device: Device) => void;
  onDomain: (domain: Device['domain'], filter?: Filter) => void;
  onGateway: () => void;
}
const labels: Record<Status, string> = { ok: 'Healthy', warn: 'Attention', err: 'Offline', off: 'Inactive' };
const stateOrder: Status[] = ['ok', 'warn', 'err', 'off'];
const nameOf = (device: Device) => device.name?.trim() || device.mac || device.ip || device.id;

function constellation(count: number) {
  const rings: { radius: number; size: number }[] = [];
  let remaining = count;
  let i = 0;
  while (remaining > 0) {
    const size = Math.min(remaining, 10 + i * 6);
    rings.push({ radius: count <= 10 ? 112 : 78 + i * 36, size });
    remaining -= size;
    i++;
  }
  const radius = Math.max(150, rings.at(-1)?.radius ?? 0);
  const center = radius + 19;
  const points = rings.flatMap(({ radius: r, size }, ring) => Array.from({ length: size }, (_, index) => {
    const angle = index / size * Math.PI * 2 - Math.PI / 2 + (ring % 2 ? Math.PI / size : 0);
    return { x: center + Math.cos(angle) * r, y: center + Math.sin(angle) * r };
  }));
  return { center, size: center * 2, radius, points, radii: Array.from({ length: Math.max(3, rings.length) }, (_, index) => 78 + index * 36) };
}

const OrbitDomain = memo(function OrbitDomain({ domain, devices, onDevice, onDomain }: {
  domain: Device['domain']; devices: Device[]; onDevice: Props['onDevice']; onDomain: Props['onDomain'];
}) {
  const root = useRef<HTMLElement>(null);
  const helpId = useId();
  const [hovered, setHovered] = useState<string | null>(null);
  const [kindFocus, setKindFocus] = useState<Device['kind'] | null>(null);
  const [lastFocus, setLastFocus] = useState<string | null>(null);
  const ordered = useMemo(() => [...devices].sort((a, b) => a.id.localeCompare(b.id)), [devices]);
  const positions = useMemo(() => constellation(ordered.length), [ordered.length]);
  const counts = useMemo(() => countStates(devices), [devices]);
  const groups = useMemo(() => Object.entries(kinds).flatMap(([kind, info]) => {
    const count = devices.filter(d => d.kind === kind).length;
    return count ? [{ kind: kind as Device['kind'], count, ...info }] : [];
  }).sort((a,b) => b.count-a.count || a.label.localeCompare(b.label)), [devices]);
  const active = hovered ? devices.find(d => d.id === hovered) : undefined;
  const activeKind = groups.some(group => group.kind === kindFocus) ? kindFocus : null;
  const activeIndex = active ? ordered.findIndex(d => d.id === active.id) : -1;
  const activePoint = positions.points[activeIndex];
  const Icon = domain === 'IT' ? Laptop : Cpu;
  const focusId = ordered.some(d => d.id === lastFocus) ? lastFocus : ordered[0]?.id;
  const { center, size } = positions;
  const synchronizeMoon = useCallback((element: HTMLSpanElement | null) => {
    if (!element) return;
    // A device can arrive after the orbit started. Match its counter-rotation
    // to the existing (possibly paused) timeline so its icon stays upright.
    const orbit = element.closest('.orbit-moons')?.getAnimations()[0];
    const counter = element.getAnimations()[0];
    if (orbit?.currentTime != null && counter) counter.currentTime = orbit.currentTime;
  }, []);

  function keyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = ordered.length - 1;
    else if (event.key === 'ArrowRight') next = (index + 1) % ordered.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + ordered.length) % ordered.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      let best = Infinity;
      const nodes = [...(root.current?.querySelectorAll<HTMLButtonElement>('.orbit-node') ?? [])];
      const origin = nodes[index]?.getBoundingClientRect();
      if (!origin) return;
      nodes.forEach((node, i) => {
        const point = node.getBoundingClientRect();
        const dy = (point.top - origin.top) * direction;
        if (dy < 3) return;
        const score = Math.abs(point.left - origin.left) * 2 + dy;
        if (score < best) { best = score; next = i; }
      });
    } else return;
    event.preventDefault();
    root.current?.querySelectorAll<HTMLButtonElement>('.orbit-node')[next]?.focus();
  }

  return <section className="orbit-domain" data-device-domain={domain} ref={root} aria-label={`${domain} device topology`}>
    <div className="orbit-title"><button type="button" data-inspect-domain={domain} onClick={() => onDomain(domain)}
      aria-label={`Inspect all ${devices.length} ${domain} devices`}>{domain} devices<ArrowUpRight size={14} aria-hidden="true" /></button></div>
    <div className="orbit-field" style={{ '--orbit-size': size } as CSSProperties}>
      <svg className="orbit-lines" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <g className="orbit-tracks">{positions.radii.map(radius => <circle key={radius} cx={center} cy={center} r={radius} />)}</g>
        <g className="orbit-perimeter-motion"><circle className="orbit-perimeter" cx={center} cy={center} r={positions.radius + 10} pathLength="100" />
          <circle className="orbit-track-beacon" cx={center} cy={center - positions.radius - 10} r="1.8" /></g>
        <g className="orbit-association-motion">{activePoint && <path className="orbit-association" d={`M${center} ${center}L${activePoint.x} ${activePoint.y}`} />}</g>
        <circle className="orbit-core-outline" cx={center} cy={center} r="59" />
      </svg>
      <svg className="orbit-planet-rings orbit-planet-rings-back" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <g className="orbit-ring-precession"><g transform={`translate(${center} ${center}) rotate(-28)`}>
          <ellipse rx="71" ry="25" /><ellipse rx="66" ry="21" /><ellipse className="orbit-ring-fine" rx="76" ry="29" />
        </g></g>
      </svg>
      <span className="orbit-planet" aria-hidden="true" style={{ width: `${108 / size * 100}%`, height: `${108 / size * 100}%` }} />
      <svg className="orbit-planet-rings orbit-planet-rings-front" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <g className="orbit-ring-precession"><g transform={`translate(${center} ${center}) rotate(-28)`}>
          <path d="M-71 0 A71 25 0 0 0 71 0" /><path d="M-66 0 A66 21 0 0 0 66 0" />
          <path className="orbit-ring-fine" d="M-76 0 A76 29 0 0 0 76 0" />
        </g></g>
      </svg>
      <button type="button" className="orbit-core" style={{ width: `${100 / size * 100}%`, height: `${100 / size * 100}%` }}
        onClick={() => onDomain(domain)} aria-label={`Inspect all ${devices.length} ${domain} devices`}>
        <Icon aria-hidden="true" /><strong>{devices.length}</strong><span>devices</span>
      </button>
      <span id={helpId} className="orbit-sr-only">Use arrow keys to move between devices. Press Enter to inspect a device.</span>
      <div className="orbit-moons">{ordered.map((device, index) => {
        const point = positions.points[index];
        const Glyph = device.kind === 'generic' ? Box : kinds[device.kind]?.icon ?? Box;
        return <button type="button" className="orbit-node" key={device.id}
          style={{ left: `${point.x / size * 100}%`, top: `${point.y / size * 100}%`, width: `${32 / size * 100}%`, height: `${32 / size * 100}%` }}
          data-device-id={device.id} data-domain={domain} data-kind={device.kind} data-status={device.status}
          data-highlighted={active?.id === device.id || activeKind === device.kind}
          data-dimmed={!!(active ? active.id !== device.id : activeKind && activeKind !== device.kind)}
          aria-label={`Inspect ${nameOf(device)} · ${domain} · ${labels[device.status]}`} aria-describedby={helpId}
          title={`${nameOf(device)} · ${device.kind === 'generic' ? 'Unspecified endpoint · ' : ''}${labels[device.status]}`} tabIndex={focusId === device.id ? 0 : -1}
          onPointerEnter={() => setHovered(device.id)} onPointerLeave={() => setHovered(null)}
          onFocus={() => { setLastFocus(device.id); setHovered(device.id); }} onBlur={() => setHovered(null)}
          onKeyDown={event => keyboard(event, index)} onClick={() => onDevice(device)}>
          <span className="orbit-moon-upright" ref={synchronizeMoon} aria-hidden="true"><span className="orbit-node-metal">
            <Glyph className="orbit-device-glyph" />
          </span>
          <span className="orbit-device-status">{device.status === 'err' ? <X /> : device.status === 'warn' ? <TriangleAlert /> : device.status === 'off' ? <Minus /> : null}</span></span>
        </button>;
      })}</div>
    </div>
    <div className="orbit-readout" data-status={active?.status}>
      <strong title={active ? nameOf(active) : undefined}>{active ? nameOf(active) : devices.length ? 'Select a device to inspect' : 'No devices reported'}</strong>
      {active && <span>{active.ip || active.mac || 'Address not reported'} · {labels[active.status]}</span>}
    </div>
    <div className="orbit-health" aria-label={`${domain} device health`}>{stateOrder.filter(status => counts[status] > 0).map(status =>
      <button type="button" key={status} data-inspect-status={status} data-status={status}
        onClick={() => onDomain(domain, { status })} aria-label={`Inspect ${counts[status]} ${labels[status].toLowerCase()} ${domain} devices`}>
        <i aria-hidden="true"/><strong>{counts[status]}</strong> {labels[status]}
      </button>)}</div>
    <ul className="orbit-categories">{groups.map(({ kind, label, icon: TypeIcon, count }) => <li key={kind}>
      <button type="button" data-inspect-kind={kind} onClick={() => onDomain(domain, { kind })}
        onPointerEnter={() => setKindFocus(kind)} onPointerLeave={() => setKindFocus(null)}
        onFocus={() => setKindFocus(kind)} onBlur={() => setKindFocus(null)} aria-label={`Inspect ${count} ${domain} ${label.toLowerCase()}`}>
        {kind === 'generic' ? <CircleDot size={14} aria-hidden="true" /> : <TypeIcon size={14} aria-hidden="true" />}
        <span>{label}</span><strong>{count}</strong><ArrowUpRight size={12} aria-hidden="true" />
      </button>
    </li>)}</ul>
  </section>;
});

function GatewayShell() {
  const id = useId().replace(/:/g, '');
  return <svg className="orbit-gateway-shell" viewBox="0 0 100 100" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-rim`} x1="0" y1="0" x2=".8" y2="1">
        <stop offset="0" stopColor="#a2b1bb" /><stop offset=".23" stopColor="#647a89" />
        <stop offset=".7" stopColor="#344a59" /><stop offset="1" stopColor="#83929d" />
      </linearGradient>
      <linearGradient id={`${id}-face`} x1="0" y1="0" x2=".9" y2="1">
        <stop offset="0" stopColor="#354b5a" /><stop offset=".65" stopColor="#243845" /><stop offset="1" stopColor="#182b37" />
      </linearGradient>
    </defs>
    <rect x="10" y="20" width="80" height="69" rx="15" fill="#111d27" stroke="#455967" strokeWidth=".8" />
    <rect x="10" y="12" width="80" height="70" rx="15" fill={`url(#${id}-rim)`} stroke="#9aadb7" strokeWidth=".45" />
    <rect x="14" y="16" width="72" height="62" rx="12" fill={`url(#${id}-face)`} stroke="#172a36" strokeWidth="1.2" />
    <path d="M21 19H77M13 31V64" fill="none" stroke="#ccdae2" strokeOpacity=".2" strokeWidth=".65" />
    {[[23,25],[77,25],[23,69],[77,69]].map(([x,y]) => <g key={`${x}-${y}`}>
      <circle cx={x} cy={y} r="1.65" fill="#182a36" stroke="#82939e" strokeWidth=".55" />
      <path d={`M${x-.7} ${y+.4}l1.4-.8`} stroke="#627987" strokeWidth=".6" />
    </g>)}
    <path d="M43 24H57" stroke="#101f2a" strokeWidth="2" strokeLinecap="round" />
    <Router x="36" y="32" width="28" height="28" strokeWidth={1.2} />
    <text x="50" y="71" textAnchor="middle">EDGE</text>
    <path d="M28 85H72" stroke="#6a8493" strokeWidth=".65" strokeOpacity=".45" />
  </svg>;
}

export const BranchDeviceOrbit = memo(function BranchDeviceOrbit({ branch, devices, online, onDevice, onDomain, onGateway }: Props) {
  const grouped = useMemo(() => ({ IT: devices.filter(d => d.domain === 'IT'), OT: devices.filter(d => d.domain === 'OT') }), [devices]);
  const root = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [active, setActive] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let inView = false;
    const update = () => { setReducedMotion(media.matches); setActive(inView && !document.hidden && !media.matches); };
    const observer = new IntersectionObserver(entries => { inView = entries.at(-1)?.isIntersecting ?? false; update(); });
    if (root.current) observer.observe(root.current);
    media.addEventListener('change', update); document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); media.removeEventListener('change', update); document.removeEventListener('visibilitychange', update); };
  }, []);
  return <div ref={root} className="branch-device-orbit" data-motion={active && !paused ? 'running' : 'paused'} role="group" aria-label={`${branch.name} device topology`}>
    <div className="orbit-motion-controls"><span>Device systems · one moon per device</span>
      {reducedMotion ? <span>Reduced motion</span> : <button type="button" onClick={() => setPaused(value => !value)} aria-pressed={paused}>
        {paused ? <Play size={12} aria-hidden="true" /> : <Pause size={12} aria-hidden="true" />}{paused ? 'Resume orbits' : 'Pause orbits'}
      </button>}
    </div>
    <div className="orbit-network">
      <OrbitDomain domain="IT" devices={grouped.IT} onDevice={onDevice} onDomain={onDomain} />
      <div className="orbit-gateway">
        <div className="orbit-bridge" aria-hidden="true"><i /><i /></div>
        <button type="button" onClick={onGateway} className="orbit-gateway-button" aria-label={`Open ${branch.gatewayModel} gateway twin`}>
          <GatewayShell />
        </button>
        <strong>Gateway</strong><span data-status={online === undefined ? 'off' : online ? 'ok' : 'err'}><i />{online === undefined ? 'Status unavailable' : online ? 'Online' : 'Offline'}</span>
      </div>
      <OrbitDomain domain="OT" devices={grouped.OT} onDevice={onDevice} onDomain={onDomain} />
    </div>
  </div>;
});

export default BranchDeviceOrbit;
