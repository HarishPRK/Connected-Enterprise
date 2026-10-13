import { useEffect, useId, useRef, useState } from 'react';
import { Expand, Minimize2, Pause, Play, RotateCcw, ZoomIn, ZoomOut, Orbit, Box, Focus, ScanLine, ArrowRight, X, GripVertical, MoveRight } from 'lucide-react';
import type { FailoverSceneData, FailoverSceneRenderer, FailoverSceneTheme } from './failoverSceneTypes';
import './FailoverNetworkStage.css';
import { FailoverRouteStatus } from './FailoverRouteStatus';

interface Props {
  data: FailoverSceneData;
  theme: FailoverSceneTheme;
  onUnavailable: () => void;
  onTunnelSwitch?: (nodeId: string) => boolean;
}

export default function FailoverNetworkStage({ data, theme, onUnavailable, onTunnelSwitch }: Props) {
  const inspectorId = useId();
  const shellRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<FailoverSceneRenderer | null>(null);
  const latestRef = useRef({ data, theme, onUnavailable, onTunnelSwitch });
  const destinationRef = useRef<HTMLSelectElement>(null);
  const flowPointerRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>('gateway');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [motion, setMotion] = useState(true);
  const [orbit, setOrbit] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [flowDrag, setFlowDrag] = useState<{ targetId: string | null } | null>(null);
  const [flowMessage, setFlowMessage] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const destinations = data.nodes.filter(node => node.kind === 'tunnel' && node.switchable && !node.active);
  const destination = destinations.find(node => node.id === destinationId) ?? destinations[0];
  const dragTarget = data.nodes.find(node => node.id === flowDrag?.targetId);
  const selected = data.nodes.find(node => node.id === selectedId);
  const hovered = data.nodes.find(node => node.id === hoveredId);
  const connections = selected ? data.links.filter(link => link.from === selected.id || link.to === selected.id)
    .map(link => ({ link, node: data.nodes.find(node => node.id === (link.from === selected.id ? link.to : link.from)), outbound: link.from === selected.id })) : [];
  const focusEquipment = (id: string) => { setOrbit(false); setSelectedId(id); rendererRef.current?.focus(id); };
  const closeInspector = () => { setSelectedId(null); setHoveredId(null); hostRef.current?.querySelector('canvas')?.focus({ preventScroll: true }); };
  const inspectorLabel = selected?.kind === 'tunnel' ? 'LOGICAL TUNNEL INSPECTOR' : selected && ['cloud', 'internet'].includes(selected.kind) ? 'NETWORK NODE INSPECTOR' : 'EQUIPMENT INSPECTOR';

  useEffect(() => {
    latestRef.current = { data, theme, onUnavailable, onTunnelSwitch };
    rendererRef.current?.update(data, theme);
  }, [data, theme, onUnavailable, onTunnelSwitch]);

  function switchFlow(id: string) {
    const latest = latestRef.current;
    const target = latest.data.nodes.find(node => node.id === id && node.kind === 'tunnel' && node.switchable && !node.active);
    if (latest.data.mode !== 'live' || !target || !latest.onTunnelSwitch?.(id)) {
      setFlowMessage('TUNNEL IS NO LONGER AVAILABLE. CHOOSE ANOTHER ROUTE.');
      return false;
    }
    setFlowMessage(latest.data.preview ? `PREVIEW MOVED TO ${target.label}` : `${target.label} REQUESTED. WAITING FOR GATEWAY CONFIRMATION.`);
    return true;
  }
  const switchFlowRef = useRef(switchFlow);
  useEffect(() => { switchFlowRef.current = switchFlow; });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let started = false;
    const start = async () => {
      if (started || cancelled) return;
      started = true;
      try {
        const { createFailoverSceneRenderer } = await import('./failoverSceneRenderer');
        if (cancelled) return;
        const latest = latestRef.current;
        const renderer = createFailoverSceneRenderer(host, latest.data, latest.theme,
          id => setSelectedId(id), () => latestRef.current.onUnavailable(),
          id => setHoveredId(id), () => setOrbit(false),
          id => switchFlowRef.current(id),
          (targetId, dragging) => setFlowDrag(dragging ? { targetId } : null));
        if (cancelled) { renderer.dispose(); return; }
        rendererRef.current = renderer;
        renderer.select('gateway');
        setReady(true);
      } catch {
        if (!cancelled) latestRef.current.onUnavailable();
      }
    };
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void start(); }
    }, { rootMargin: '160px' });
    observer.observe(host);
    return () => {
      cancelled = true;
      observer.disconnect();
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => { rendererRef.current?.select(selectedId); }, [selectedId, ready]);
  useEffect(() => { rendererRef.current?.setMotion(motion); }, [motion, ready]);
  useEffect(() => { rendererRef.current?.setOrbit(orbit); }, [orbit, ready]);
  useEffect(() => {
    const change = () => { setExpanded(document.fullscreenElement === shellRef.current); rendererRef.current?.resize(); };
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);

  const expand = async () => {
    if (document.fullscreenElement === shellRef.current) await document.exitFullscreen();
    else await shellRef.current?.requestFullscreen().catch(() => { /* Browser can decline fullscreen; the stage stays usable. */ });
  };

  return (
    <div className="failover-network-stage" ref={shellRef} onKeyDown={event => {
      if (event.key === 'Escape') closeInspector();
    }}>
      <div className="failover-stage-toolbar">
        <div className="failover-stage-instructions">
          <div><Box size={17} aria-hidden="true" /><strong>NETWORK DIGITAL TWIN</strong><span className="failover-stage-mode">{data.mode === 'target' ? 'TARGET POLICY' : data.route?.pending ? 'REQUESTED ROUTE' : data.preview || data.route?.phase === 'preview' ? 'PREVIEW ROUTE' : 'LIVE TELEMETRY'}</span></div>
          <span>CLICK TO INSPECT · DOUBLE-CLICK TO FOCUS · DRAG TO ORBIT · SCROLL TO ZOOM · RIGHT-DRAG TO PAN</span>
        </div>
        <div className="failover-stage-actions" aria-label="3D view controls">
          <button type="button" disabled={!ready} onClick={() => { setOrbit(false); setSelectedId(null); rendererRef.current?.focus('tunnels'); }}><ScanLine size={15} /><span>FOCUS TUNNELS</span></button>
          <button type="button" disabled={!ready || !selectedId} onClick={() => { setOrbit(false); if (selectedId) rendererRef.current?.focus(selectedId); }}><Focus size={15} /><span>FOCUS NODE</span></button>
          <button type="button" aria-label="Reset 3D view" title="Fit the complete network" disabled={!ready} onClick={() => { setOrbit(false); rendererRef.current?.reset(); }}><RotateCcw size={15} /><span>FIT NETWORK</span></button>
          <button type="button" aria-label="Zoom in" title="Zoom in" disabled={!ready} onClick={() => rendererRef.current?.zoom('in')}><ZoomIn size={16} /></button>
          <button type="button" aria-label="Zoom out" title="Zoom out" disabled={!ready} onClick={() => rendererRef.current?.zoom('out')}><ZoomOut size={16} /></button>
          <button type="button" aria-pressed={motion} title={motion ? 'Pause network animations' : 'Resume network animations'} disabled={!ready} onClick={() => setMotion(value => !value)}>{motion ? <Pause size={14} /> : <Play size={14} />}<span>{motion ? 'PAUSE' : 'PLAY'}</span></button>
          <button type="button" aria-pressed={orbit} title="Slowly orbit the network stage" disabled={!ready} onClick={() => setOrbit(value => !value)}><Orbit size={15} /><span>SHOWCASE</span></button>
          <button type="button" title={expanded ? 'Exit fullscreen' : 'Expand the 3D scene'} aria-label={expanded ? 'Exit fullscreen' : 'Expand 3D scene'} onClick={() => { void expand(); }}>{expanded ? <Minimize2 size={16} /> : <Expand size={16} />}</button>
        </div>
      </div>
      <FailoverRouteStatus route={data.route} />
      {data.mode === 'live' && onTunnelSwitch && <div className="failover-stage-flow-controls" aria-label="Move packet flow">
        <button type="button" className="failover-stage-flow-handle" disabled={!ready || !destinations.length}
          aria-label="Drag packet flow to a tunnel, or choose a destination below" title="Drag this packet onto a reachable tunnel"
          onPointerDown={event => {
            if (!event.isPrimary || event.button !== 0 || !rendererRef.current?.beginFlowDrag(event.clientX, event.clientY)) return;
            event.preventDefault();
            flowPointerRef.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => { if (flowPointerRef.current === event.pointerId) rendererRef.current?.moveFlowDrag(event.clientX, event.clientY); }}
          onPointerUp={event => {
            if (flowPointerRef.current !== event.pointerId) return;
            rendererRef.current?.moveFlowDrag(event.clientX, event.clientY);
            rendererRef.current?.endFlowDrag(true);
            flowPointerRef.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onLostPointerCapture={() => { rendererRef.current?.endFlowDrag(false); flowPointerRef.current = null; }}
          onPointerCancel={() => { rendererRef.current?.endFlowDrag(false); flowPointerRef.current = null; }}
          onClick={() => destinationRef.current?.focus()}><GripVertical size={14} /><span className="failover-stage-packet" aria-hidden="true" /><span>MOVE FLOW</span></button>
        <span className="failover-stage-flow-hint">{destinations.length ? 'DRAG THE PACKET OR ACTIVE PATH ONTO A TUNNEL' : 'NO ALTERNATE REACHABLE TUNNEL'}</span>
        <div className="failover-stage-flow-destination">
          <label htmlFor={`${inspectorId}-destination`}>DESTINATION</label>
          <select ref={destinationRef} id={`${inspectorId}-destination`} aria-label="Destination tunnel" value={destination?.id ?? ''}
            disabled={!ready || !destinations.length} onChange={event => setDestinationId(event.target.value)}>
            {!destinations.length && <option value="">NO AVAILABLE TUNNEL</option>}
            {destinations.map(node => <option key={node.id} value={node.id}>{node.label}</option>)}
          </select>
          <button type="button" disabled={!ready || !destination} onClick={() => { if (destination) switchFlow(destination.id); }}><MoveRight size={14} />{data.preview ? 'PREVIEW TUNNEL' : 'SWITCH TUNNEL'}</button>
        </div>
        <span className="failover-stage-sr" role="status" aria-live="polite">{flowDrag ? dragTarget ? `RELEASE TO USE ${dragTarget.label}` : 'DRAG TO A HIGHLIGHTED TUNNEL. ESCAPE TO CANCEL.' : flowMessage}</span>
      </div>}
      <div className="failover-stage-viewport" ref={hostRef}>
        {!ready && <div className="failover-stage-loading" role="status"><Box size={24} /><span>PREPARING YOUR NETWORK DIGITAL TWIN</span></div>}
        {ready && hovered && !flowDrag && <div className="failover-stage-hover" aria-hidden="true"><Box size={15} /><div><strong>{hovered.label}</strong><span>CLICK TO INSPECT · DOUBLE-CLICK TO FOCUS</span></div></div>}
        {flowDrag && <div className="failover-stage-drop-hint"><MoveRight size={16} /><strong>{dragTarget ? `RELEASE TO ${data.preview ? 'PREVIEW' : 'SWITCH TO'} ${dragTarget.label}` : 'DROP ON A HIGHLIGHTED TUNNEL'}</strong><span>ESC TO CANCEL</span></div>}
      </div>
      <div className="failover-stage-node-index" aria-label="Select network node">
        <span className="failover-stage-index-label">INSPECT</span>
        {data.nodes.map((node, index) => <button type="button" key={node.id} aria-pressed={selectedId === node.id} aria-controls={inspectorId} onClick={() => setSelectedId(node.id)} onDoubleClick={() => focusEquipment(node.id)}>
          <span className="failover-stage-station-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          <span className="failover-stage-node-dot" style={{ background: node.status === 'err' ? theme.err : node.status === 'warn' ? theme.warn : node.status === 'idle' ? theme.muted : node.color }} />{node.label}
        </button>)}
      </div>
      <span className="failover-stage-sr" role="status" aria-live="polite">{selected ? `INSPECTING ${selected.label}` : 'EQUIPMENT INSPECTOR CLOSED'}</span>
      <div className="failover-stage-details" id={inspectorId} role="region" aria-label="Selected network node details">
        {selected ? <>
          <div className="failover-stage-node-description"><span className="failover-stage-detail-eyebrow">{['sdwan', 'internet', 'cloud'].includes(selected.kind) ? 'OPERATOR PREMISES' : 'ENTERPRISE PREMISES'} · {inspectorLabel}</span><strong>{selected.label}</strong><span>{selected.detail}</span></div>
          {selected.metrics?.map(metric => <div className="failover-stage-node-metric" key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong></div>)}
          <div className="failover-stage-inspect-actions"><button type="button" disabled={!ready} onClick={() => focusEquipment(selected.id)}><Focus size={14} />FOCUS SELECTED</button><button type="button" aria-label="Close equipment inspector" onClick={closeInspector}><X size={15} /></button></div>
          {connections.length > 0 && <div className="failover-stage-connections"><span>CONNECTED NODES</span><div>{connections.map(({ link, node, outbound }) => node && <button type="button" key={link.id} onClick={() => setSelectedId(node.id)} title={`Inspect ${node.label}`}><ArrowRight size={12} className={outbound ? '' : 'is-inbound'} /><strong>{node.label}</strong><span>{!link.available ? 'UNAVAILABLE' : link.active ? data.preview ? 'PREVIEW PATH' : data.mode === 'target' ? 'POLICY PATH' : data.route?.pending ? 'REQUESTED PATH' : 'ACTIVE PATH' : 'STANDBY'}</span></button>)}</div></div>}
        </> : <span>SELECT EQUIPMENT OR A TUNNEL TO VIEW ITS TELEMETRY.</span>}
      </div>
      <div className="failover-stage-caption">{data.preview ? 'CAPTURED TELEMETRY' : data.mode === 'target' ? 'POLICY PREVIEW' : data.route?.pending ? 'LIVE TELEMETRY · REQUESTED ROUTE SHOWN' : 'LIVE NETWORK STATE'} · LAYOUT & EQUIPMENT MOTION ARE ILLUSTRATIVE · IPSEC TUNNELS REPRESENT ENCRYPTED LOGICAL PATHS</div>
    </div>
  );
}
