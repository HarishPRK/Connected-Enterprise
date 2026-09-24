import { useEffect, useRef, useState, type RefObject } from 'react';
import { Expand, Focus, Minimize, Store } from 'lucide-react';
import type { ScenarioId } from './scenePrimitives';
import { STORE_ZONES } from './storeArchitecture';
import { cameraForScenario, createStoreRenderer, OVERVIEW, type StoreCamera } from './storeRenderer';

export interface SolutionSceneProps {
  scenario: ScenarioId;
  timeRef: RefObject<number>;
  playing: boolean;
  reducedMotion: boolean;
  revision: number;
  onScenarioSelect: (id: ScenarioId) => void;
}

const SCENARIOS = Object.keys(STORE_ZONES) as ScenarioId[];
const SCENARIO_LABELS: Record<ScenarioId, string> = {
  safety: 'Fall detection', connectivity: 'Dynamic Failover', energy: 'Energy Prediction',
  leak: 'Sustainability', matter: 'Matter & Interoperability', eagle: 'EA:GLE', greengrass: 'AWS Greengrass',
};

export function SolutionScene({ scenario, timeRef, playing, reducedMotion, revision, onScenarioSelect }: SolutionSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<ReturnType<typeof createStoreRenderer> | null>(null);
  const hotspotRefs = useRef<Partial<Record<ScenarioId, HTMLButtonElement>>>({});
  const cameraRef = useRef<StoreCamera>({ ...OVERVIEW });
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const stateRef = useRef({ scenario, playing, reducedMotion, focused });
  const invalidateRef = useRef<() => void>(() => {});

  useEffect(() => {
    stateRef.current = { scenario, playing, reducedMotion, focused };
    invalidateRef.current();
  }, [scenario, playing, reducedMotion, focused, revision]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = createStoreRenderer(canvas);
    rendererRef.current = renderer;
    let frame = 0; let disposed = false; let lastTime = 0;
    const render = (now: number) => {
      frame = 0;
      if (disposed) return;
      const state = stateRef.current;
      const target = state.focused ? cameraForScenario(state.scenario) : OVERVIEW;
      const camera = cameraRef.current;
      const delta = Math.min((now - lastTime) / 1000, .05); lastTime = now;
      const ease = state.reducedMotion ? 1 : 1 - Math.exp(-10 * delta);
      camera.x += (target.x - camera.x) * ease; camera.y += (target.y - camera.y) * ease;
      camera.zoom += (target.zoom - camera.zoom) * ease;
      renderer.render(state.scenario, timeRef.current, camera, state.focused);
      for (const id of SCENARIOS) {
        const element = hotspotRefs.current[id];
        if (!element) continue;
        const point = renderer.scenarioLabelPosition(id, camera);
        element.style.left = `${point.x}px`;
        element.style.top = `${point.y}px`;
        const inFocusedView = !state.focused || id === state.scenario;
        element.style.visibility = point.visible && inFocusedView ? 'visible' : 'hidden';
        element.style.opacity = canvas.clientWidth < 600 && id !== state.scenario ? '0' : '1';
      }
      const moving = Math.abs(target.x - camera.x) + Math.abs(target.y - camera.y) + Math.abs(target.zoom - camera.zoom) > .01;
      // Follow the display's animation cadence without a frame-rate cap, including 120 Hz.
      if ((state.playing && !state.reducedMotion) || moving) frame = requestAnimationFrame(render);
    };
    const invalidate = () => { if (!frame && !disposed) frame = requestAnimationFrame(render); };
    invalidateRef.current = invalidate;
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width && bounds.height) renderer.resize(bounds.width, bounds.height, document.documentElement.dataset.theme === 'dark');
      invalidate();
    };
    const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas);
    const themeObserver = new MutationObserver(resize);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    resize();
    const onFullscreen = () => setExpanded(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      disposed = true; cancelAnimationFrame(frame); resizeObserver.disconnect(); themeObserver.disconnect();
      document.removeEventListener('fullscreenchange', onFullscreen); renderer.dispose();
      rendererRef.current = null;
      invalidateRef.current = () => {};
    };
  }, [timeRef]);

  const toggleExpanded = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await containerRef.current?.requestFullscreen();
  };

  const selectZone = (id: ScenarioId) => {
    setFocused(true);
    onScenarioSelect(id);
  };

  return <div ref={containerRef} className="store-scene-container">
    <canvas ref={canvasRef} className="store-scene-canvas" aria-hidden="true"
      onClick={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const id = rendererRef.current?.scenarioAtPoint(event.clientX - bounds.left, event.clientY - bounds.top, cameraRef.current);
        if (id) selectZone(id);
      }}
      onPointerMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const id = rendererRef.current?.scenarioAtPoint(event.clientX - bounds.left, event.clientY - bounds.top, cameraRef.current);
        event.currentTarget.style.cursor = id ? 'pointer' : 'default';
      }}
      onPointerLeave={(event) => { event.currentTarget.style.cursor = 'default'; }} />
    <div className="store-zone-hotspots" aria-label="Store scenarios">
      {SCENARIOS.map((id) => {
        const zone = STORE_ZONES[id];
        const hideZoneLabel = id === 'matter';
        return <button key={id} ref={(element) => { hotspotRefs.current[id] = element ?? undefined; }}
          type="button" className="store-zone-hotspot" data-hide-label={hideZoneLabel || undefined}
          aria-label={`Start ${SCENARIO_LABELS[id]} in ${zone.name}`}
          aria-pressed={scenario === id} title={hideZoneLabel ? SCENARIO_LABELS[id] : `Start ${SCENARIO_LABELS[id]}`}
          onClick={() => selectZone(id)}>
          {hideZoneLabel ? null : zone.name}
        </button>;
      })}
    </div>
    <div className="store-view-controls" aria-label="Store view">
      <button type="button" aria-pressed={!focused} onClick={() => setFocused(false)}><Store size={15} aria-hidden="true" />Whole store</button>
      <button type="button" aria-pressed={focused} onClick={() => setFocused(true)}><Focus size={15} aria-hidden="true" />Focus scenario</button>
      <button type="button" onClick={() => void toggleExpanded()} aria-label={expanded ? 'Exit expanded store view' : 'Expand store view'} title={expanded ? 'Exit expanded store view' : 'Expand store view'}>
        {expanded ? <Minimize size={15} aria-hidden="true" /> : <Expand size={15} aria-hidden="true" />}
      </button>
    </div>
  </div>;
}
