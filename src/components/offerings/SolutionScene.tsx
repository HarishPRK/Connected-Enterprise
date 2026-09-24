import { useEffect, useRef, useState, type RefObject } from 'react';
import { Expand, Focus, Minimize, RotateCcw, RotateCw, Scan, Store, ZoomIn, ZoomOut } from 'lucide-react';
import type { ScenarioId } from './scenePrimitives';
import type { SustainabilityMode } from './storeAnimations';
import { cameraForScenario, createStoreRenderer, OVERVIEW, type StoreCamera } from './storeRenderer';

export interface SolutionSceneProps {
  scenario: ScenarioId;
  timeRef: RefObject<number>;
  playing: boolean;
  reducedMotion: boolean;
  revision: number;
  sustainability?: SustainabilityMode;
  onScenarioSelect: (id: ScenarioId) => void;
}

export function SolutionScene({ scenario, timeRef, playing, reducedMotion, revision, sustainability = 'occupancy', onScenarioSelect }: SolutionSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<ReturnType<typeof createStoreRenderer> | null>(null);
  const cameraRef = useRef<StoreCamera>({ ...OVERVIEW });
  const dragRef = useRef<{ pointer: number; start: number; angle: number; moved: boolean } | null>(null);
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [angle, setAngle] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [fullscreenError, setFullscreenError] = useState('');
  const stateRef = useRef({ scenario, playing, reducedMotion, focused, angle, zoom, sustainability });
  const invalidateRef = useRef<() => void>(() => {});

  useEffect(() => {
    stateRef.current = { scenario, playing, reducedMotion, focused, angle, zoom, sustainability };
    invalidateRef.current();
  }, [scenario, playing, reducedMotion, focused, angle, zoom, sustainability, revision]);

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
      const radians = state.angle * Math.PI / 180;
      const target = state.focused ? cameraForScenario(state.scenario, radians) : OVERVIEW;
      const camera = cameraRef.current;
      const delta = Math.min((now - lastTime) / 1000, .05); lastTime = now;
      const ease = state.reducedMotion || dragRef.current ? 1 : 1 - Math.exp(-10 * delta);
      camera.x += (target.x - camera.x) * ease; camera.y += (target.y - camera.y) * ease;
      camera.zoom += (target.zoom * state.zoom - camera.zoom) * ease;
      camera.angle = radians;
      renderer.render(state.scenario, timeRef.current, camera, state.focused, state.sustainability);
      const moving = Math.abs(target.x - camera.x) + Math.abs(target.y - camera.y) + Math.abs(target.zoom * state.zoom - camera.zoom) > .01;
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
      rendererRef.current = null; invalidateRef.current = () => {};
    };
  }, [timeRef]);

  const reset = () => { setAngle(0); setZoom(1); setFocused(false); };
  const changeZoom = (by: number) => setZoom(value => Math.max(.7, Math.min(1.8, value + by)));
  const toggleExpanded = async () => {
    try {
      setFullscreenError('');
      if (document.fullscreenElement) await document.exitFullscreen();
      else await containerRef.current?.requestFullscreen();
    } catch { setFullscreenError('Fullscreen is unavailable in this browser.'); }
  };

  return <div ref={containerRef} className="store-scene-container">
    <div className="store-orbit-hint"><span>Drag to rotate</span><span>{((angle % 360) + 360) % 360}°</span></div>
    <canvas ref={canvasRef} className="store-scene-canvas" tabIndex={0} role="group"
      aria-label="Interactive store twin. Drag or use left and right arrow keys to rotate. Use plus and minus to zoom, Home to reset. Select a scenario from the adjacent list."
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', '+', '=', '-', 'Home'].includes(event.key)) return;
        event.preventDefault();
        if (event.key === 'ArrowLeft') setAngle(value => value - 15);
        else if (event.key === 'ArrowRight') setAngle(value => value + 15);
        else if (event.key === 'Home') reset();
        else changeZoom(event.key === '-' ? -.15 : .15);
      }}
      onPointerDown={event => {
        if (event.button !== 0 || dragRef.current) return;
        dragRef.current = { pointer: event.pointerId, start: event.clientX, angle, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const drag = dragRef.current;
        if (!drag || drag.pointer !== event.pointerId) return;
        const distance = event.clientX - drag.start;
        if (Math.abs(distance) > 5) drag.moved = true;
        if (drag.moved) setAngle(Math.round((drag.angle + distance * .3) / 2) * 2);
      }}
      onPointerUp={event => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (!drag || drag.pointer !== event.pointerId || drag.moved) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const id = rendererRef.current?.scenarioAtPoint(event.clientX - bounds.left, event.clientY - bounds.top, cameraRef.current);
        if (id) onScenarioSelect(id);
      }}
      onPointerCancel={() => { dragRef.current = null; }}
      onLostPointerCapture={() => { dragRef.current = null; }} />
    <div className="store-view-controls" aria-label="Store view">
      <div className="store-control-group">
        <button type="button" aria-pressed={!focused} onClick={() => { setFocused(false); setZoom(1); }} title="Whole store"><Store size={16} /><span>Store</span></button>
        <button type="button" aria-pressed={focused} onClick={() => { setFocused(true); setZoom(1); }} title="Focus selected scenario"><Focus size={16} /><span>Focus</span></button>
      </div>
      <div className="store-control-group">
        <button type="button" aria-label="Rotate left" title="Rotate left" onClick={() => setAngle(value => value - 30)}><RotateCcw size={16} /></button>
        <button type="button" aria-label="Rotate right" title="Rotate right" onClick={() => setAngle(value => value + 30)}><RotateCw size={16} /></button>
        <button type="button" aria-label="Zoom out" title="Zoom out" disabled={zoom <= .7} onClick={() => changeZoom(-.15)}><ZoomOut size={16} /></button>
        <button type="button" aria-label="Zoom in" title="Zoom in" disabled={zoom >= 1.8} onClick={() => changeZoom(.15)}><ZoomIn size={16} /></button>
      </div>
      <div className="store-control-group">
        <button type="button" aria-label="Reset view" title="Reset view" onClick={reset}><Scan size={16} /></button>
        <button type="button" aria-label={expanded ? 'Exit fullscreen' : 'Expand store'} title={expanded ? 'Exit fullscreen' : 'Expand store'} onClick={toggleExpanded}>{expanded ? <Minimize size={16} /> : <Expand size={16} />}</button>
      </div>
    </div>
    {fullscreenError && <p className="store-view-error" role="status">{fullscreenError}</p>}
  </div>;
}