import { useEffect, useRef, type RefObject } from 'react';
import { WIDTH, HEIGHT, palette, room, type Palette, type ScenarioId } from './scenePrimitives';
import { safetyScene } from './safetyScene';
import { connectivityScene, energyScene } from './operationsScenes';
import { leakScene, occupancyScene, protocolsScene } from './additionalScenes';
import { eagleScene, greengrassScene, threadScene } from './platformScenes';

interface SolutionSceneProps {
  scenario: ScenarioId;
  timeRef: RefObject<number>;
  playing: boolean;
  reducedMotion: boolean;
  revision: number;
}

const SCENE_RENDERERS: Record<ScenarioId, (ctx: CanvasRenderingContext2D, p: Palette, time: number) => void> = {
  safety: safetyScene,
  connectivity: connectivityScene,
  energy: energyScene,
  leak: leakScene,
  occupancy: occupancyScene,
  protocols: protocolsScene,
  eagle: eagleScene,
  greengrass: greengrassScene,
  thread: threadScene,
};

function draw(ctx: CanvasRenderingContext2D, width: number, height: number, pixelRatio: number, p: Palette, scenario: ScenarioId, time: number) {
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const scale = Math.min(width / WIDTH, height / HEIGHT);
  ctx.translate((width - WIDTH * scale) / 2, (height - HEIGHT * scale) / 2);
  ctx.scale(scale, scale);
  room(ctx, p, scenario);
  SCENE_RENDERERS[scenario](ctx, p, time);
}

/** A dependency-free, resolution-aware digital twin. The parent owns its clock. */
export function SolutionScene({ scenario, timeRef, playing, reducedMotion, revision }: SolutionSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let frame = 0;
    let disposed = false;
    let colors = palette(document.documentElement.dataset.theme === 'dark');

    const render = () => {
      if (disposed || !width || !height) return;
      draw(ctx, width, height, pixelRatio, colors, scenario, timeRef.current);
    };
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      render();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const themeObserver = new MutationObserver(() => {
      colors = palette(document.documentElement.dataset.theme === 'dark');
      render();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    resize();

    const animate = () => {
      render();
      frame = requestAnimationFrame(animate);
    };
    if (playing && !reducedMotion) frame = requestAnimationFrame(animate);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      themeObserver.disconnect();
    };
  }, [scenario, timeRef, playing, reducedMotion, revision]);

  return <canvas ref={canvasRef} className="solution-scene-canvas" aria-hidden="true" style={{ display: 'block', width: '100%', height: '100%' }} />;
}
