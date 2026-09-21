import { ellipse, iso, line, palette, polygon, progress, route, withScenePresentation, type Palette, type ScenarioId, type WorldPoint } from './scenePrimitives';
import { drawStoreArchitecture, STORE_ZONES } from './storeArchitecture';
import { drawStoreScenario } from './storeAnimations';

export const STORE_BOUNDS = { x: -475, y: -35, width: 2040, height: 1240 };
export interface StoreCamera { x: number; y: number; zoom: number }
export const OVERVIEW: StoreCamera = { x: 545, y: 575, zoom: 1 };
const ORDER = (Object.keys(STORE_ZONES) as ScenarioId[]).sort((a, b) => {
  const left = STORE_ZONES[a]; const right = STORE_ZONES[b];
  return left.x + left.y - right.x - right.y;
});

export function cameraForScenario(id: ScenarioId): StoreCamera {
  const zone = STORE_ZONES[id];
  return { ...iso(zone.x + 205, zone.y + 150, 45), zoom: 2.15 };
}

/** The application's navy surfaces, violet emphasis and cyan signals. */
export function storePalette(dark: boolean): Palette {
  return { ...palette(dark),
    floor: dark ? '#292a44' : '#e9edf5',
    floorSide: dark ? '#17192c' : '#bfc9dc', floorFront: dark ? '#202239' : '#d0d8e7',
    seam: dark ? '#393b56' : '#d3dbea', wall: dark ? '#3a3d5a' : '#f5f6fc',
    wallSide: dark ? '#2c304b' : '#dce2ef', wallTop: dark ? '#69708e' : '#ffffff',
    ink: dark ? '#f3f1ff' : '#18243a', muted: dark ? '#c4bee0' : '#53627c',
    blue: dark ? '#78cafa' : '#287eaf', teal: dark ? '#c084fc' : '#8b4bd3',
    hardware: dark ? '#66708c' : '#dbe1ee', hardwareSide: dark ? '#454d6a' : '#adbdd5',
    hardwareTop: dark ? '#95a0ba' : '#f8f9fe', screen: '#1d2948',
  };
}

function offset(id: ScenarioId) {
  const zone = STORE_ZONES[id];
  return { x: (zone.x - zone.y) * .88, y: (zone.x + zone.y) * .44 };
}

export function drawZone(ctx: CanvasRenderingContext2D, p: Palette, id: ScenarioId, time: number, labels = false) {
  withScenePresentation(ctx, { gateway: id === 'greengrass', desk: id === 'eagle', labels, routes: false }, () => drawStoreScenario(ctx, p, id, time));
}

const endpoints: Record<ScenarioId, readonly [number, number]> = {
  energy: [130, 190], leak: [580, 210], eagle: [950, 150], matter: [185, 490],
  connectivity: [1008, 525], safety: [640, 800], greengrass: [540, 495],
};

function network(ctx: CanvasRenderingContext2D, p: Palette, id: ScenarioId, time: number, staticOnly = false) {
  const gateway: WorldPoint = [774, 436, 44];
  for (const key of ORDER) {
    const [x, y] = endpoints[key];
    const active = key === id;
    if (staticOnly ? active : !active) continue;
    const enabled = !active || time >= (id === 'connectivity' ? 16.6 : 10);
    const path: WorldPoint[] = [[x, y, 2], [x, 310, 2], [790, 310, 2], [790, 436, 2], gateway];
    route(ctx, path, active ? enabled ? p.teal : p.amber : p.blue, active ? .6 : .12, time, active && enabled);
  }
  if (staticOnly) return;
  const zone = STORE_ZONES[id];
  const corners = [iso(zone.x + 14, zone.y + 14, 1), iso(zone.x + 389, zone.y + 14, 1), iso(zone.x + 389, zone.y + 290, 1), iso(zone.x + 14, zone.y + 290, 1)];
  ctx.save(); ctx.globalAlpha = .065;
  polygon(ctx, corners, p.teal);
  ctx.globalAlpha = .75;
  line(ctx, [...corners, corners[0]], p.teal, 2);
  ctx.restore();
}

/** Cached architecture and resting systems keep frame work proportional to moving actors. */
export function createStoreRenderer(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas is unavailable');
  const backdrop = document.createElement('canvas');
  const stationary = document.createElement('canvas');
  const resting = new Map<ScenarioId, HTMLCanvasElement>();
  let cachedScenario: ScenarioId | undefined;
  let p = storePalette(true);
  let width = 0; let height = 0; let ratio = 1; let textureScale = 1;
  let surface = '#131426';
  let lastCamera = { ...OVERVIEW };
  let baseScale = 1;

  const rebuild = () => {
    cachedScenario = undefined;
    backdrop.width = Math.ceil(STORE_BOUNDS.width * textureScale);
    backdrop.height = Math.ceil(STORE_BOUNDS.height * textureScale);
    const background = backdrop.getContext('2d')!;
    background.scale(textureScale, textureScale);
    background.translate(-STORE_BOUNDS.x, -STORE_BOUNDS.y);
    drawStoreArchitecture(background, p);
    for (const id of ORDER) {
      const layer = resting.get(id) ?? document.createElement('canvas');
      layer.width = Math.ceil(900 * textureScale); layer.height = Math.ceil(560 * textureScale);
      const layerContext = layer.getContext('2d')!;
      layerContext.scale(textureScale, textureScale);
      drawZone(layerContext, p, id, id === 'safety' ? 0 : 24);
      resting.set(id, layer);
    }
  };

  const composeStationary = (id: ScenarioId) => {
    stationary.width = backdrop.width; stationary.height = backdrop.height;
    const still = stationary.getContext('2d')!;
    still.drawImage(backdrop, 0, 0);
    still.scale(textureScale, textureScale);
    still.translate(-STORE_BOUNDS.x, -STORE_BOUNDS.y);
    network(still, p, id, 0, true);
    for (const key of ORDER) {
      if (key === id || key === 'energy' || key === 'greengrass') continue;
      const at = offset(key);
      still.drawImage(resting.get(key)!, at.x, at.y, 900, 560);
    }
    cachedScenario = id;
  };

  const project = (point: { x: number; y: number }) => {
    const scale = baseScale * lastCamera.zoom;
    return { x: width / 2 + (point.x - lastCamera.x) * scale, y: height / 2 + (point.y - lastCamera.y) * scale };
  };

  return {
    resize(nextWidth: number, nextHeight: number, dark: boolean, pixelRatio = window.devicePixelRatio || 1) {
      width = nextWidth; height = nextHeight; ratio = Math.min(pixelRatio, 2);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      baseScale = Math.min(width / STORE_BOUNDS.width, height / STORE_BOUNDS.height) * .95;
      // Rasterize once at focused-view density, rather than rebuilding the store every frame.
      textureScale = Math.min(2, Math.max(.8, baseScale * ratio * 2.15));
      p = storePalette(dark);
      surface = dark ? '#151528' : '#edf1f9';
      rebuild();
    },
    render(id: ScenarioId, time: number, camera: StoreCamera, focused: boolean) {
      if (!width || !height) return;
      if (cachedScenario !== id) composeStationary(id);
      lastCamera = camera;
      const scale = baseScale * camera.zoom;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.fillStyle = surface; ctx.fillRect(0, 0, width, height);
      ctx.save();
      ctx.translate(width / 2, height / 2); ctx.scale(scale, scale); ctx.translate(-camera.x, -camera.y);
      ctx.drawImage(stationary, STORE_BOUNDS.x, STORE_BOUNDS.y, STORE_BOUNDS.width, STORE_BOUNDS.height);
      network(ctx, p, id, time);
      for (const key of ORDER) {
        if (key !== id && key !== 'energy' && key !== 'greengrass') continue;
        const at = offset(key);
        const topLeft = project({ x: at.x + 140, y: at.y });
        const bottomRight = project({ x: at.x + 830, y: at.y + 540 });
        if (topLeft.x > width || bottomRight.x < 0 || topLeft.y > height || bottomRight.y < 0) continue;
        ctx.save(); ctx.translate(at.x, at.y);
        // The conveyor and ventilation continue running while another incident is selected.
        drawZone(ctx, p, key, key === id ? time : 24 + time, focused && key === id);
        ctx.restore();
      }
      const hub = iso(774, 436, 74);
      ctx.save(); ctx.globalAlpha = .5 + progress(time, 10, 12) * .4;
      ellipse(ctx, hub, 4, 4, p.teal); ctx.restore();
      ctx.restore();
      for (const key of ORDER) {
        if ((focused || width < 600) && key !== id) continue;
        const zone = STORE_ZONES[key];
        const point = project(iso(zone.x + 205, zone.y + 286, 1));
        if (point.x < 60 || point.x > width - 60 || point.y < 24 || point.y > height - 42) continue;
        ctx.font = `${key === id ? 600 : 500} 12px "Space Grotesk", system-ui, sans-serif`;
        const label = zone.name;
        const labelWidth = ctx.measureText(label).width + 24;
        ctx.fillStyle = p.dark ? '#25223f' : '#ffffff';
        ctx.beginPath(); ctx.roundRect(point.x - labelWidth / 2, point.y - 11, labelWidth, 25, 5); ctx.fill();
        ctx.fillStyle = key === id ? p.teal : p.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, point.x, point.y + 2);
      }
    },
    dispose() {
      backdrop.width = 0; backdrop.height = 0;
      stationary.width = 0; stationary.height = 0;
      for (const layer of resting.values()) { layer.width = 0; layer.height = 0; }
      resting.clear();
    },
  };
}
