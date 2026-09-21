import { useEffect, useRef, useState, type RefObject } from 'react';
import { Expand, Focus, Minimize, Store } from 'lucide-react';
import type { ScenarioId } from './scenePrimitives';
import { cameraForScenario, createStoreRenderer, OVERVIEW, type StoreCamera } from './storeRenderer';

export interface SolutionSceneProps {
  scenario: ScenarioId;
  timeRef: RefObject<number>;
  playing: boolean;
  reducedMotion: boolean;
  revision: number;
}

export function SolutionScene({ scenario, timeRef, playing, reducedMotion, revision }: SolutionSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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
      invalidateRef.current = () => {};
    };
  }, [timeRef]);

  const toggleExpanded = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await containerRef.current?.requestFullscreen();
  };

  return <div ref={containerRef} className="store-scene-container">
    <canvas ref={canvasRef} className="store-scene-canvas" aria-hidden="true" />
    <div className="store-view-controls" aria-label="Store view">
      <button type="button" aria-pressed={!focused} onClick={() => setFocused(false)}><Store size={15} aria-hidden="true" />Whole store</button>
      <button type="button" aria-pressed={focused} onClick={() => setFocused(true)}><Focus size={15} aria-hidden="true" />Focus scenario</button>
      <button type="button" onClick={() => void toggleExpanded()} aria-label={expanded ? 'Exit expanded store view' : 'Expand store view'} title={expanded ? 'Exit expanded store view' : 'Expand store view'}>
        {expanded ? <Minimize size={15} aria-hidden="true" /> : <Expand size={15} aria-hidden="true" />}
      </button>
    </div>
  </div>;
}
