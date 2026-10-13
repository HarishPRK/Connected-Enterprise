import { useEffect, useId, useRef, useState } from 'react';
import { Expand, Minimize2, Pause, Play, RotateCcw, ZoomIn, ZoomOut, Orbit, Box, Focus, ScanLine, ArrowRight, X } from 'lucide-react';
import type { FailoverSceneData, FailoverSceneRenderer, FailoverSceneTheme } from './failoverSceneTypes';
import './FailoverNetworkStage.css';
import { FailoverRouteStatus } from './FailoverRouteStatus';

interface Props {
  data: FailoverSceneData;
  theme: FailoverSceneTheme;
  onUnavailable: () => void;
}

export default function FailoverNetworkStage({ data, theme, onUnavailable }: Props) {
  const inspectorId = useId();
  const shellRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<FailoverSceneRenderer | null>(null);
  const latestRef = useRef({ data, theme, onUnavailable });
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>('gateway');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [motion, setMotion] = useState(true);
  const [orbit, setOrbit] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const selected = data.nodes.find(node => node.id === selectedId);
  const hovered = data.nodes.find(node => node.id === hoveredId);
  const connections = selected ? data.links.filter(link => link.from === selected.id || link.to === selected.id)
    .map(link => ({ link, node: data.nodes.find(node => node.id === (link.from === selected.id ? link.to : link.from)), outbound: link.from === selected.id })) : [];
  const focusEquipment = (id: string) => { setOrbit(false); setSelectedId(id); rendererRef.current?.focus(id); };
  const closeInspector = () => { setSelectedId(null); setHoveredId(null); hostRef.current?.querySelector('canvas')?.focus({ preventScroll: true }); };
  const inspectorLabel = selected?.kind === 'tunnel' ? 'LOGICAL TUNNEL INSPECTOR' : selected && ['cloud', 'internet'].includes(selected.kind) ? 'NETWORK NODE INSPECTOR' : 'EQUIPMENT INSPECTOR';

  useEffect(() => {
    latestRef.current = { data, theme, onUnavailable };
    rendererRef.current?.update(data, theme);
  }, [data, theme, onUnavailable]);

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
          id => setHoveredId(id), () => setOrbit(false));
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
      <div className="failover-stage-viewport" ref={hostRef}>
        {!ready && <div className="failover-stage-loading" role="status"><Box size={24} /><span>PREPARING YOUR NETWORK DIGITAL TWIN</span></div>}
        {ready && hovered && <div className="failover-stage-hover" aria-hidden="true"><Box size={15} /><div><strong>{hovered.label}</strong><span>CLICK TO INSPECT · DOUBLE-CLICK TO FOCUS</span></div></div>}
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
