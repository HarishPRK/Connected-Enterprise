import { ellipse, iso, line, palette, polygon, progress, route, withScenePresentation, withSceneProjection, projectStorePoint, unprojectStorePoint, type Palette, type ScenarioId, type WorldPoint } from './scenePrimitives';
import { drawStoreArchitecture, STORE_ZONES } from './storeArchitecture';
import { drawStoreScenario, type SustainabilityMode } from './storeAnimations';

export const STORE_BOUNDS = { x: -1000, y: -250, width: 3100, height: 1800 };
export interface StoreCamera { x: number; y: number; zoom: number; angle?: number }
export const OVERVIEW: StoreCamera = { x: 540, y: 595, zoom: 1, angle: 0 };
const ORDER = (Object.keys(STORE_ZONES) as ScenarioId[]).sort((a, b) => {
  const left = STORE_ZONES[a]; const right = STORE_ZONES[b];
  return left.x + left.y - right.x - right.y;
});

export function cameraForScenario(id: ScenarioId, angle = 0): StoreCamera {
  const zone = STORE_ZONES[id];
  return { ...projectStorePoint(zone.x + 205, zone.y + 150, 45, angle), zoom: 2.15, angle };
}

/** The application's navy surfaces, violet emphasis and cyan signals. */
export function storePalette(dark: boolean): Palette {
  return { ...palette(dark),
    floor: dark ? '#24494b' : '#e9edf5',
    floorSide: dark ? '#17192c' : '#bfc9dc', floorFront: dark ? '#202239' : '#d0d8e7',
    seam: dark ? '#496871' : '#d3dbea', wall: dark ? '#365c70' : '#f5f6fc',
    wallSide: dark ? '#294655' : '#dce2ef', wallTop: dark ? '#96b8c3' : '#ffffff',
    ink: dark ? '#f3f1ff' : '#18243a', muted: dark ? '#c4bee0' : '#53627c',
    blue: dark ? '#78cafa' : '#287eaf', teal: dark ? '#5ce0be' : '#087d6c',
    hardware: dark ? '#718b9b' : '#dbe1ee', hardwareSide: dark ? '#466575' : '#adbdd5',
    hardwareTop: dark ? '#b8d4dc' : '#f8f9fe', screen: '#1d2948',
  };
}

export function drawZone(ctx: CanvasRenderingContext2D, p: Palette, id: ScenarioId, time: number, labels = false, sustainability: SustainabilityMode = 'occupancy') {
  withScenePresentation(ctx, { gateway: id === 'greengrass', desk: id === 'eagle', labels, routes: false }, () => drawStoreScenario(ctx, p, id, time, sustainability));
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

/** Rotate world geometry while keeping the original screen-space actor rigs intact. */
export function createStoreRenderer(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas is unavailable');
  const backdrop = document.createElement('canvas');
  const resting = new Map<ScenarioId, { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number }>();
  let p = storePalette(true);
  let width = 0; let height = 0; let ratio = 1; let textureScale = 1;
  let cachedAngle = NaN; let cachedMode: SustainabilityMode | undefined;
  let surface = '#111f2d'; let baseScale = 1;
  let lastCamera: StoreCamera = { ...OVERVIEW };

  const rebuild = (angle: number, mode: SustainabilityMode) => {
    backdrop.width = Math.ceil(STORE_BOUNDS.width * textureScale);
    backdrop.height = Math.ceil(STORE_BOUNDS.height * textureScale);
    const background = backdrop.getContext('2d')!;
    background.scale(textureScale, textureScale);
    background.translate(-STORE_BOUNDS.x, -STORE_BOUNDS.y);
    withSceneProjection({ angle }, () => drawStoreArchitecture(background, p));
    for (const id of ORDER) {
      const zone = STORE_ZONES[id];
      const corners = [[0, 0], [410, 0], [410, 305], [0, 305]].map(([x, y]) => projectStorePoint(zone.x + x, zone.y + y, 0, angle));
      const x = Math.min(...corners.map(point => point.x)) - 110;
      const y = Math.min(...corners.map(point => point.y)) - 240;
      const w = Math.max(...corners.map(point => point.x)) - x + 110;
      const h = Math.max(...corners.map(point => point.y)) - y + 110;
      const layer = resting.get(id)?.canvas ?? document.createElement('canvas');
      layer.width = Math.ceil(w * textureScale); layer.height = Math.ceil(h * textureScale);
      const context = layer.getContext('2d')!;
      context.scale(textureScale, textureScale); context.translate(-x, -y);
      withSceneProjection({ angle, x: zone.x, y: zone.y }, () => drawZone(context, p, id, id === 'safety' ? 0 : 24, false, mode));
      resting.set(id, { canvas: layer, x, y, w, h });
    }
    cachedAngle = angle; cachedMode = mode;
  };

  return {
    resize(nextWidth: number, nextHeight: number, dark: boolean, pixelRatio = window.devicePixelRatio || 1) {
      width = nextWidth; height = nextHeight; ratio = Math.min(pixelRatio, 2);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      baseScale = Math.min((width - 30) / 2050, (height - 100) / 1240);
      textureScale = Math.min(1.5, Math.max(.75, baseScale * ratio * 2));
      p = storePalette(dark); surface = dark ? '#111f2d' : '#edf5f7';
      cachedAngle = NaN;
    },
    render(id: ScenarioId, time: number, camera: StoreCamera, _focused: boolean, mode: SustainabilityMode = 'occupancy') {
      if (!width || !height) return;
      const angle = camera.angle ?? 0;
      if (cachedAngle !== angle || cachedMode !== mode) rebuild(angle, mode);
      lastCamera = camera;
      const scale = baseScale * camera.zoom;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.fillStyle = surface; ctx.fillRect(0, 0, width, height);
      ctx.save();
      ctx.translate(width / 2, height / 2 - 18); ctx.scale(scale, scale); ctx.translate(-camera.x, -camera.y);
      ctx.drawImage(backdrop, STORE_BOUNDS.x, STORE_BOUNDS.y, STORE_BOUNDS.width, STORE_BOUNDS.height);
      withSceneProjection({ angle }, () => { network(ctx, p, id, time, true); network(ctx, p, id, time); });
      const sorted = [...ORDER].sort((a, b) => {
        const left = STORE_ZONES[a]; const right = STORE_ZONES[b];
        return projectStorePoint(left.x + 205, left.y + 150, 0, angle).y - projectStorePoint(right.x + 205, right.y + 150, 0, angle).y;
      });
      for (const key of sorted) {
        if (key === id || key === 'energy' || key === 'greengrass') {
          const zone = STORE_ZONES[key];
          withSceneProjection({ angle, x: zone.x, y: zone.y }, () => drawZone(ctx, p, key, key === id ? time : 24 + time, false, mode));
        } else {
          const layer = resting.get(key)!;
          ctx.drawImage(layer.canvas, layer.x, layer.y, layer.w, layer.h);
        }
      }
      const hub = projectStorePoint(774, 436, 74, angle);
      ctx.save(); ctx.globalAlpha = .5 + progress(time, 10, 12) * .4;
      ellipse(ctx, hub, 4, 4, p.teal); ctx.restore();
      ctx.restore();
    },
    scenarioAtPoint(screenX: number, screenY: number, camera = lastCamera): ScenarioId | undefined {
      const scale = baseScale * camera.zoom;
      if (!scale) return undefined;
      const point = unprojectStorePoint((screenX - width / 2) / scale + camera.x, (screenY - height / 2 + 18) / scale + camera.y, camera.angle ?? 0);
      return ORDER.find(id => { const zone = STORE_ZONES[id]; return point.x >= zone.x + 10 && point.x <= zone.x + 400 && point.y >= zone.y + 10 && point.y <= zone.y + 295; });
    },
    dispose() {
      backdrop.width = 0; backdrop.height = 0;
      for (const layer of resting.values()) { layer.canvas.width = 0; layer.canvas.height = 0; }
      resting.clear();
    },
  };
}
