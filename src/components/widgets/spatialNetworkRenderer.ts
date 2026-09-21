import type { Device, Status } from '../../types';
import { GATEWAY, SPATIAL_HEIGHT, SPATIAL_WIDTH, getDeviceFlow, type SpatialNode } from './spatialNetworkModel';

type Point = { x: number; y: number };
type Theme = {
  dark: boolean; violet: string; pink: string; cyan: string; text: string; muted: string;
  warn: string; error: string; floor: string; floorEdge: string; metal: string;
  metalSide: string; metalFront: string; screen: string; white: string;
};
type RenderOptions = {
  time: number;
  online: boolean;
  hoveredId: string | null;
  highlightedKind?: Device['kind'] | null;
  highlightedDomain?: 'IT' | 'OT' | null;
};
type Route = { node: SpatialNode; path: Path2D; points: [Point, Point, Point, Point] };
type AnimatedRoute = { points: Route['points']; phase: number; progress: number };
type TrailGroup = {
  color: string; opacity: number; width: number; tail: number; headRadius: number;
  headOpacity: number; headColor: string; routes: AnimatedRoute[];
};

const TAU = Math.PI * 2;

function themeFor(canvas: HTMLCanvasElement, dark: boolean): Theme {
  const css = getComputedStyle(canvas);
  const value = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const rgb = (name: string, fallback: string) => {
    const channels = value(name, fallback).split(/\s+/).map(Number);
    return channels.length === 3 && channels.every(Number.isFinite) ? `rgb(${channels.join(',')})` : fallback;
  };
  return {
    dark,
    violet: rgb('--accent-3-rgb', dark ? '192 132 252' : '147 51 234'),
    pink: rgb('--accent-2-rgb', dark ? '255 123 214' : '236 72 153'),
    cyan: dark ? '#79d8f6' : '#087f9e',
    text: value('--text', dark ? '#f3f1ff' : '#0f172a'),
    muted: value('--text-muted', dark ? '#8a83b0' : '#94a3b8'),
    warn: rgb('--warn-rgb', dark ? '251 191 36' : '245 158 11'),
    error: rgb('--err-rgb', dark ? '255 85 119' : '239 68 68'),
    floor: dark ? '#23233e' : '#eef0fa',
    floorEdge: dark ? '#17182c' : '#dfe3f0',
    metal: dark ? '#657397' : '#b4c6de',
    metalSide: dark ? '#2a304c' : '#738caa',
    metalFront: dark ? '#414c70' : '#98afc9',
    screen: dark ? '#111a33' : '#213755',
    white: dark ? '#d1def4' : '#ffffff',
  };
}

function polygon(ctx: CanvasRenderingContext2D, points: readonly Point[], fill?: string, stroke?: string, lineWidth = 1) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
}

function line(ctx: CanvasRenderingContext2D, points: readonly Point[], color: string, width = 1) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}

function iso(x: number, y: number, z = 0): Point {
  return { x: (x - y) * .84, y: (x + y) * .42 - z };
}

function block(ctx: CanvasRenderingContext2D, x: number, y: number, z: number, w: number, d: number, h: number, top: string, front: string, side: string, edge?: string) {
  const a = iso(x, y, z + h), b = iso(x + w, y, z + h), c = iso(x + w, y + d, z + h), e = iso(x, y + d, z + h);
  const cb = iso(x + w, y + d, z), eb = iso(x, y + d, z), bb = iso(x + w, y, z);
  polygon(ctx, [b, bb, cb, c], side);
  polygon(ctx, [e, c, cb, eb], front);
  polygon(ctx, [a, b, c, e], top);
  if (edge) line(ctx, [e, a, b, c, e], edge, .55);
}

function topLine(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, z: number, color: string, width = 1) {
  line(ctx, [iso(ax, ay, z), iso(bx, by, z)], color, width);
}

function led(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill();
}

function statusColor(theme: Theme, status: Status, domain: Device['domain']) {
  return status === 'err' ? theme.error : status === 'warn' ? theme.warn : status === 'off' ? theme.muted : domain === 'IT' ? theme.cyan : theme.pink;
}

/** A physical glyph is drawn once, then reused as a high-DPI sprite. */
function drawDevice(ctx: CanvasRenderingContext2D, theme: Theme, device: Device) {
  const accent = statusColor(theme, device.status, device.domain);
  const inactive = device.status === 'off' || device.status === 'err';
  const screenAccent = inactive ? theme.muted : accent;
  const metal = theme.metal, front = theme.metalFront, side = theme.metalSide;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.save();
  ctx.globalAlpha = .2;
  polygon(ctx, [iso(-18, -9), iso(12, -9), iso(20, 16), iso(-10, 16)], '#060a1e');
  ctx.restore();
  block(ctx, -15, -10, 0, 30, 20, 2.4, theme.dark ? '#313753' : '#e1e6f2', theme.floorEdge, theme.floorEdge);
  ctx.save(); ctx.globalAlpha = inactive ? .35 : .75;
  topLine(ctx, -13, 10, 13, 10, 2.6, accent, 1.1);
  ctx.restore();

  switch (device.kind) {
    case 'laptop': {
      block(ctx, -13, -8, 3, 26, 17, 1.8, metal, front, side, theme.white);
      const screen = [iso(-12, -8, 5), iso(12, -8, 5), iso(12, -11, 24), iso(-12, -11, 24)];
      polygon(ctx, screen, side, metal, 1.4);
      polygon(ctx, [iso(-10, -8.7, 7), iso(10, -8.7, 7), iso(10, -10.5, 21.6), iso(-10, -10.5, 21.6)], theme.screen);
      topLine(ctx, -9, -9.9, 7, -9.9, 17, screenAccent, 1.2);
      topLine(ctx, -9, -9.3, 2, -9.3, 12, theme.metal, .65);
      for (let row = 0; row < 3; row++) topLine(ctx, -10, -3 + row * 2, 10, -3 + row * 2, 5, side, .6);
      polygon(ctx, [iso(-3, 5, 5), iso(3, 5, 5), iso(3, 8, 5), iso(-3, 8, 5)], front);
      break;
    }
    case 'desktop': {
      block(ctx, -5, -1, 3, 10, 9, 1.2, metal, front, side);
      block(ctx, -1.5, 1, 4, 3, 3, 8, front, front, side);
      block(ctx, -14, -2, 11, 28, 2.2, 18, metal, side, side, theme.white);
      polygon(ctx, [iso(-12, .4, 13), iso(12, .4, 13), iso(12, .4, 27), iso(-12, .4, 27)], theme.screen);
      topLine(ctx, -10, .55, 9, .55, 23, screenAccent, 1.3);
      topLine(ctx, -10, .55, 3, .55, 19, metal, .7);
      block(ctx, -10, 8, 3, 20, 4, 1, metal, front, side);
      break;
    }
    case 'phone':
    case 'tablet': {
      const w = device.kind === 'tablet' ? 21 : 12, h = device.kind === 'tablet' ? 27 : 24;
      block(ctx, -w / 2, -3, 3, w, 3, h, metal, side, front, theme.white);
      polygon(ctx, [iso(-w / 2 + 1.6, .12, 5.2), iso(w / 2 - 1.6, .12, 5.2), iso(w / 2 - 1.6, .12, h + .6), iso(-w / 2 + 1.6, .12, h + .6)], theme.screen);
      polygon(ctx, [iso(-w / 2 + 2, .2, 6), iso(w / 2 - 2, .2, 12), iso(w / 2 - 2, .2, h), iso(-w / 2 + 2, .2, h)], theme.dark ? '#243653' : '#315a7f');
      topLine(ctx, -w / 2 + 3, .3, w / 2 - 3, .3, 14, screenAccent, 1.6);
      const home = iso(0, .4, 4.5); led(ctx, home.x, home.y, .7, metal);
      break;
    }
    case 'server': {
      block(ctx, -11, -7, 3, 22, 15, 30, metal, side, front, theme.white);
      for (let row = 0; row < 4; row++) {
        const z = 7 + row * 6.2;
        polygon(ctx, [iso(-9, 8.12, z), iso(9, 8.12, z), iso(9, 8.12, z + 4.7), iso(-9, 8.12, z + 4.7)], theme.screen);
        topLine(ctx, -6, 8.3, 3, 8.3, z + 2.4, metal, .6);
        const light = iso(6, 8.3, z + 2.4); led(ctx, light.x, light.y, .85, screenAccent);
      }
      break;
    }
    case 'printer': {
      block(ctx, -13, -8, 3, 26, 18, 11, metal, front, side, theme.white);
      block(ctx, -10, -7, 14, 20, 11, 4, front, front, side);
      polygon(ctx, [iso(-8, -6, 18.2), iso(8, -6, 18.2), iso(8, -9, 29), iso(-8, -9, 29)], theme.white);
      topLine(ctx, -6, -7.2, 5, -7.2, 23, theme.metal, .6);
      polygon(ctx, [iso(-9, 10.2, 5), iso(9, 10.2, 5), iso(9, 10.2, 9), iso(-9, 10.2, 9)], theme.screen);
      polygon(ctx, [iso(-7, 10.5, 6), iso(7, 10.5, 6), iso(7, 17, 4), iso(-7, 17, 4)], theme.white);
      const light = iso(10, 8, 14.2); led(ctx, light.x, light.y, 1, screenAccent);
      break;
    }
    case 'payment': {
      block(ctx, -9, -7, 3, 18, 16, 5, metal, front, side, theme.white);
      polygon(ctx, [iso(-7, -5, 8.2), iso(7, -5, 8.2), iso(7, -8, 24), iso(-7, -8, 24)], side, metal, 1.4);
      polygon(ctx, [iso(-5.5, -5.6, 12), iso(5.5, -5.6, 12), iso(5.5, -7.4, 21.5), iso(-5.5, -7.4, 21.5)], theme.screen);
      topLine(ctx, -3.5, -6.6, 3.5, -6.6, 17, screenAccent, 1.8);
      for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) { const p = iso(-4 + col * 4, 3 + row * 3, 8.2); led(ctx, p.x, p.y, .8, side); }
      break;
    }
    case 'confphone': {
      block(ctx, -12, -7, 3, 24, 17, 4, metal, front, side);
      polygon(ctx, [iso(-5, -4, 7.2), iso(5, -4, 7.2), iso(5, 1, 7.2), iso(-5, 1, 7.2)], theme.screen);
      topLine(ctx, -3, -1.8, 3, -1.8, 7.4, screenAccent, .8);
      block(ctx, -13, -8, 8, 26, 5, 4, front, side, side, metal);
      for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) { const p = iso(-4 + col * 4, 4 + row * 3, 7.2); led(ctx, p.x, p.y, .7, side); }
      break;
    }
    case 'fire_sensor':
    case 'smoke_sensor': {
      const p = iso(0, 0, 10);
      ctx.fillStyle = side; ctx.beginPath(); ctx.ellipse(p.x, p.y + 4, 13, 7, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = metal; ctx.beginPath(); ctx.ellipse(p.x, p.y, 13, 7, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = front; ctx.lineWidth = .8; ctx.beginPath(); ctx.ellipse(p.x, p.y, 9, 4.8, 0, 0, TAU); ctx.stroke();
      for (let i = 0; i < 4; i++) line(ctx, [{ x: -7 + i * 4, y: -6 }, { x: -7 + i * 4, y: -4 }], side, 1.2);
      led(ctx, p.x + 7, p.y + 1, 1.1, screenAccent);
      break;
    }
    case 'door_lock': {
      block(ctx, -5, -3, 3, 10, 6, 31, metal, front, side, theme.white);
      const keyhole = iso(0, 3.2, 23); led(ctx, keyhole.x, keyhole.y, 1.6, theme.screen);
      block(ctx, -2, 3.4, 15, 14, 3, 3, metal, side, front, theme.white);
      const light = iso(0, 3.3, 8); led(ctx, light.x, light.y, .9, screenAccent);
      break;
    }
    case 'matter': {
      block(ctx, -11, -8, 3, 22, 16, 12, metal, front, side, theme.white);
      const center = iso(0, 0, 15.4);
      line(ctx, [{ x: center.x - 4, y: center.y + 1 }, { x: center.x, y: center.y - 3 }, { x: center.x + 4, y: center.y + 1 }], screenAccent, 1.3);
      line(ctx, [{ x: center.x, y: center.y - 3 }, { x: center.x, y: center.y + 4 }], screenAccent, 1.3);
      const light = iso(5, 8.2, 8); led(ctx, light.x, light.y, 1, screenAccent);
      break;
    }
    case 'shelly': {
      block(ctx, -10, -7, 3, 20, 14, 17, theme.dark ? '#75678c' : '#c6b6dd', front, side, theme.white);
      for (let i = 0; i < 3; i++) {
        block(ctx, -8 + i * 5.5, -7, 20, 4, 5, 3.5, metal, front, side);
        const terminal = iso(-6 + i * 5.5, -4.5, 23.6); led(ctx, terminal.x, terminal.y, 1.1, theme.screen);
      }
      const center = iso(0, 3, 20.2);
      line(ctx, [{ x: center.x + 2, y: center.y - 2.5 }, { x: center.x - 1.5, y: center.y }, { x: center.x + 1, y: center.y }, { x: center.x - 2, y: center.y + 3 }], screenAccent, 1.4);
      const light = iso(6, 7.2, 8); led(ctx, light.x, light.y, 1.2, screenAccent);
      break;
    }
    case 'generic': {
      // Discovery supplies no physical type: an intentionally neutral enclosure.
      block(ctx, -11, -7, 3, 22, 14, 13, metal, front, side, theme.white);
      topLine(ctx, -8, -4, 8, -4, 16.2, side, .9);
      topLine(ctx, -8, -1, 5, -1, 16.2, side, .65);
      topLine(ctx, -8, 2, 2, 2, 16.2, side, .65);
      polygon(ctx, [iso(-7, 7.2, 7), iso(3, 7.2, 7), iso(3, 7.2, 10), iso(-7, 7.2, 10)], theme.screen);
      const light = iso(7, 7.3, 8.4); led(ctx, light.x, light.y, 1.05, screenAccent);
      break;
    }
  }
}

function bezier(points: Route['points'], t: number): Point {
  const m = 1 - t;
  return {
    x: m * m * m * points[0].x + 3 * m * m * t * points[1].x + 3 * m * t * t * points[2].x + t * t * t * points[3].x,
    y: m * m * m * points[0].y + 3 * m * m * t * points[1].y + 3 * m * t * t * points[2].y + t * t * t * points[3].y,
  };
}

function buildRoute(node: SpatialNode): Route {
  const direction = node.device.domain === 'IT' ? 1 : -1;
  const points: Route['points'] = [
    { x: node.x, y: node.y + 3 },
    { x: node.x + direction * 34, y: node.y + 17 },
    { x: GATEWAY.x - direction * 97, y: node.y + 28 },
    { x: GATEWAY.x - direction * 41, y: GATEWAY.y + 33 },
  ];
  const path = new Path2D();
  path.moveTo(points[0].x, points[0].y);
  path.bezierCurveTo(points[1].x, points[1].y, points[2].x, points[2].y, points[3].x, points[3].y);
  return { node, path, points };
}

function drawPlatform(ctx: CanvasRenderingContext2D, theme: Theme, points: Point[], accent: string) {
  ctx.save();
  ctx.shadowColor = theme.dark ? 'rgba(3,6,20,.45)' : 'rgba(24,38,72,.18)';
  ctx.shadowBlur = 13;
  ctx.shadowOffsetY = 8;
  polygon(ctx, points, theme.floorEdge);
  ctx.restore();
  const down = points.map(p => ({ x: p.x, y: p.y + 6 }));
  polygon(ctx, down, theme.floorEdge);
  for (let i = 1; i < points.length - 1; i++) {
    polygon(ctx, [points[i], points[i + 1], down[i + 1], down[i]], theme.dark ? i === 1 ? '#171d32' : '#20283f' : i === 1 ? '#aebed5' : '#c5d1e3');
  }
  const top = Math.min(...points.map(point => point.y));
  const bottom = Math.max(...points.map(point => point.y));
  const surface = ctx.createLinearGradient(0, top, 0, bottom);
  surface.addColorStop(0, theme.dark ? '#303952' : '#f1f5fc');
  surface.addColorStop(.56, theme.dark ? '#28314a' : '#e7edf7');
  surface.addColorStop(1, theme.dark ? '#242c43' : '#dce5f2');
  ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath(); ctx.fillStyle = surface; ctx.fill();
  ctx.save(); ctx.globalAlpha = theme.dark ? .35 : .24;
  line(ctx, [...points, points[0]], accent, .7);
  ctx.restore();
  ctx.save(); ctx.globalAlpha = .68;
  line(ctx, points.slice(2).map(p => ({ x: p.x, y: p.y + 4 })), accent, 1.4);
  ctx.restore();
}

function domainPlane(nodes: readonly SpatialNode[], domain: Device['domain']): Point[] | null {
  const members = nodes.filter(node => node.device.domain === domain);
  if (!members.length) return null;
  const center = domain === 'IT' ? 205 : 695;
  const slope = domain === 'IT' ? .12 : -.12;
  const edge = Math.max(...members.map(node => node.size)) * .62 + 13;
  const left = Math.max(domain === 'IT' ? 22 : 526, Math.min(...members.map(node => node.x)) - edge);
  const right = Math.min(domain === 'IT' ? 374 : 878, Math.max(...members.map(node => node.x)) + edge);
  const depth = Math.max(...members.map(node => node.size)) * .32 + 14;
  const back = Math.min(...members.map(node => node.y + (node.x - center) * slope)) - depth;
  const front = Math.max(...members.map(node => node.y + (node.x - center) * slope)) + depth;
  return [
    { x: left, y: back - (left - center) * slope },
    { x: right, y: back - (right - center) * slope },
    { x: right, y: front - (right - center) * slope },
    { x: left, y: front - (left - center) * slope },
  ];
}

function drawFloor(ctx: CanvasRenderingContext2D, theme: Theme, nodes: readonly SpatialNode[]) {
  ctx.clearRect(0, 0, SPATIAL_WIDTH, SPATIAL_HEIGHT);
  // Fitted workplanes retain the same perspective for sparse and dense inventories.
  const bridge = [
    { x: 341, y: 251 }, { x: 451, y: 219 }, { x: 563, y: 251 },
    { x: 563, y: 310 }, { x: 451, y: 343 }, { x: 341, y: 310 },
  ];
  drawPlatform(ctx, theme, bridge, theme.violet);
  for (const domain of ['IT', 'OT'] as const) {
    const plane = domainPlane(nodes, domain);
    if (!plane) continue;
    const accent = domain === 'IT' ? theme.cyan : theme.pink;
    drawPlatform(ctx, theme, plane, accent);
    const center = {
      x: (plane[0].x + plane[2].x) / 2,
      y: (plane[0].y + plane[2].y) / 2,
    };
    const inset = plane.map(point => ({ x: point.x + (center.x - point.x) * .06, y: point.y + (center.y - point.y) * .1 }));
    ctx.save(); ctx.globalAlpha = theme.dark ? .14 : .18;
    line(ctx, [...inset, inset[0]], accent, .6);
    ctx.restore();
    for (const point of inset) {
      ctx.save(); ctx.globalAlpha = .5;
      led(ctx, point.x, point.y, 1.4, theme.metal);
      line(ctx, [{ x: point.x - .8, y: point.y + .3 }, { x: point.x + .8, y: point.y - .3 }], theme.metalSide, .6);
      ctx.restore();
    }
  }
}

function drawGateway(ctx: CanvasRenderingContext2D, theme: Theme, online: boolean) {
  ctx.save(); ctx.translate(GATEWAY.x, GATEWAY.y + 32);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.save(); ctx.globalAlpha = .26;
  polygon(ctx, [iso(-44, -33), iso(39, -33), iso(45, 44), iso(-38, 44)], '#030615');
  ctx.restore();
  block(ctx, -39, -31, 0, 78, 62, 6, theme.dark ? '#3a3454' : '#e3daf6', theme.floorEdge, theme.metalSide);
  block(ctx, -35, -28, 6, 70, 56, 3, theme.violet, theme.dark ? '#674798' : '#af81e3', theme.dark ? '#453369' : '#9361c4');
  block(ctx, -32, -26, 9, 64, 52, 48, theme.dark ? '#6c6e91' : '#c8d1e5', theme.dark ? '#373b59' : '#8f9ebb', theme.dark ? '#252c49' : '#7084a5', theme.dark ? '#a6a7c4' : '#f5f3ff');
  block(ctx, -27, -22, 57, 54, 44, 3.5, theme.dark ? '#777a9f' : '#dde2ef', theme.dark ? '#545b7c' : '#b4bfd5', theme.dark ? '#515775' : '#aebcd5');
  for (let i = 0; i < 8; i++) topLine(ctx, -20, -15 + i * 3.1, 2, -15 + i * 3.1, 60.8, theme.dark ? '#414662' : '#8a9bb5', 1.55);

  const badge = [iso(9, -14, 61), iso(22, -14, 61), iso(22, -1, 61), iso(9, -1, 61)];
  polygon(ctx, badge, theme.dark ? '#383954' : '#afb4ce');
  const center = iso(15.5, -7.5, 61.1);
  ctx.save(); ctx.translate(center.x, center.y); ctx.transform(.84, .42, -.84, .42, 0, 0);
  ctx.strokeStyle = theme.violet; ctx.lineWidth = 1.2; ctx.strokeRect(-3, -3, 6, 6);
  for (let i = -2; i <= 2; i += 2) {
    line(ctx, [{ x: i, y: -5 }, { x: i, y: -3 }], theme.violet, .8);
    line(ctx, [{ x: i, y: 3 }, { x: i, y: 5 }], theme.violet, .8);
  }
  ctx.restore();

  // Front ports have recessed housings and individual metal contacts.
  for (let i = 0; i < 4; i++) {
    const x = -24 + i * 11;
    polygon(ctx, [iso(x, 26.15, 19), iso(x + 8, 26.15, 19), iso(x + 8, 26.15, 29), iso(x, 26.15, 29)], theme.screen);
    for (let j = 0; j < 3; j++) topLine(ctx, x + 1.8 + j * 2, 26.3, x + 1.8 + j * 2, 26.3, 24, theme.metal, 1);
    const p = iso(x + 4, 26.4, 32.3);
    led(ctx, p.x, p.y, 1.15, online ? i < 2 ? theme.cyan : theme.pink : theme.muted);
  }
  const indicator = iso(27, 26.4, 23);
  led(ctx, indicator.x, indicator.y, 1.8, online ? theme.violet : theme.muted);
  const etching = iso(-19, 26.5, 40);
  ctx.save(); ctx.translate(etching.x, etching.y); ctx.transform(.84, .42, 0, 1, 0, 0);
  ctx.fillStyle = theme.dark ? '#d7d4ed' : '#f8f8ff'; ctx.font = '600 7px "Space Grotesk", sans-serif'; ctx.fillText('EDGE', 0, 0);
  ctx.restore();

  if (online) {
    ctx.save(); ctx.globalAlpha = .45;
    topLine(ctx, -35, 28, 35, 28, 8.8, theme.violet, 1.6);
    ctx.restore();
  }
  ctx.restore();
}

export function createSpatialRenderer(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('A 2D canvas context is required for the device network.');
  const ctx = context;
  const floor = document.createElement('canvas');
  const floorCtx = floor.getContext('2d')!;
  const background = document.createElement('canvas');
  const backgroundCtx = background.getContext('2d')!;
  const foreground = document.createElement('canvas');
  const foregroundCtx = foreground.getContext('2d')!;
  const sprites = new Map<string, HTMLCanvasElement>();
  let theme = themeFor(canvas, document.documentElement.dataset.theme === 'dark');
  let routes: Route[] = [];
  let nodeReference: readonly SpatialNode[] | null = null;
  let cachedOptions: Omit<RenderOptions, 'time'> | null = null;
  let trailGroups: TrailGroup[] = [];
  let scaleX = 1, scaleY = 1;
  let disposed = false;

  function sprite(device: Device) {
    const key = `${device.kind}:${device.domain}:${device.status}`;
    let image = sprites.get(key);
    if (!image) {
      image = document.createElement('canvas');
      image.width = 160; image.height = 176;
      const spriteCtx = image.getContext('2d')!;
      spriteCtx.setTransform(2, 0, 0, 2, 80, 120);
      drawDevice(spriteCtx, theme, device);
      sprites.set(key, image);
    }
    return image;
  }

  function resize(width: number, height: number, pixelRatio = window.devicePixelRatio || 1, dark = document.documentElement.dataset.theme === 'dark') {
    if (disposed) return;
    const ratio = Math.min(2.5, Math.max(1, pixelRatio));
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    scaleX = canvas.width / SPATIAL_WIDTH; scaleY = canvas.height / SPATIAL_HEIGHT;
    theme = themeFor(canvas, dark);
    sprites.clear();
    floor.width = canvas.width; floor.height = canvas.height;
    background.width = canvas.width; background.height = canvas.height;
    foreground.width = canvas.width; foreground.height = canvas.height;
    floorCtx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    drawFloor(floorCtx, theme, nodeReference ?? []);
    cachedOptions = null;
  }

  function cacheScene(options: RenderOptions) {
    backgroundCtx.setTransform(1, 0, 0, 1, 0, 0);
    backgroundCtx.clearRect(0, 0, background.width, background.height);
    backgroundCtx.drawImage(floor, 0, 0);
    backgroundCtx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    backgroundCtx.lineCap = 'round'; backgroundCtx.lineJoin = 'round';
    foregroundCtx.setTransform(1, 0, 0, 1, 0, 0);
    foregroundCtx.clearRect(0, 0, foreground.width, foreground.height);
    foregroundCtx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    const anyHighlight = !!(options.hoveredId || options.highlightedKind || options.highlightedDomain);
    const selected = (node: SpatialNode) => options.hoveredId ? node.device.id === options.hoveredId : options.highlightedKind ? node.device.kind === options.highlightedKind && (!options.highlightedDomain || node.device.domain === options.highlightedDomain) : node.device.domain === options.highlightedDomain;
    const groups = new Map<string, TrailGroup>();

    for (const route of routes) {
      const { node, path, points } = route;
      const active = selected(node);
      const faded = anyHighlight && !active;
      const color = statusColor(theme, node.device.status, node.device.domain);
      const flow = getDeviceFlow(node.device, options.online);
      backgroundCtx.strokeStyle = color;
      backgroundCtx.globalAlpha = faded ? .045 : active ? .75 : node.device.status === 'off' ? .1 : .2;
      backgroundCtx.lineWidth = active ? 1.45 : .75;
      if (node.device.status === 'err' || node.device.status === 'off') backgroundCtx.setLineDash([2, 4]);
      backgroundCtx.stroke(path); backgroundCtx.setLineDash([]);
      if (flow.active && !faded) {
        const key = `${color}:${active}:${flow.measured}`;
        let group = groups.get(key);
        if (!group) {
          group = {
            color, opacity: active ? .96 : flow.measured ? .78 : .55,
            width: active ? 2.1 : 1.35, tail: active ? .095 : .055,
            headRadius: active ? 1.7 : 1.1, headOpacity: active ? 1 : .85,
            headColor: theme.dark ? theme.white : color, routes: [],
          };
          groups.set(key, group);
        }
        group.routes.push({ points, phase: node.phase, progress: 0 });
      }
    }
    backgroundCtx.globalAlpha = 1;

    for (const { node } of routes) {
      const active = selected(node);
      const image = sprite(node.device);
      const unitScale = node.size / 34;
      const lift = active ? 3 : 0;
      foregroundCtx.globalAlpha = anyHighlight && !active ? .32 : node.device.status === 'off' ? .57 : 1;
      if (active) {
        const color = statusColor(theme, node.device.status, node.device.domain);
        foregroundCtx.save(); foregroundCtx.translate(node.x, node.y + 2); foregroundCtx.scale(unitScale, unitScale);
        foregroundCtx.globalAlpha = .9;
        polygon(foregroundCtx, [iso(-19, -13), iso(19, -13), iso(19, 13), iso(-19, 13)], undefined, color, 1);
        foregroundCtx.restore();
      }
      foregroundCtx.drawImage(image, node.x - 40 * unitScale, node.y - 60 * unitScale - lift, 80 * unitScale, 88 * unitScale);
    }
    foregroundCtx.globalAlpha = 1;
    drawGateway(foregroundCtx, theme, options.online);
    trailGroups = [...groups.values()];
    cachedOptions = { online: options.online, hoveredId: options.hoveredId, highlightedKind: options.highlightedKind, highlightedDomain: options.highlightedDomain };
  }

  function render(nodes: readonly SpatialNode[], options: RenderOptions) {
    if (disposed) return;
    if (nodeReference !== nodes) {
      routes = nodes.map(buildRoute).sort((a, b) => a.node.y - b.node.y || a.node.x - b.node.x);
      nodeReference = nodes;
      drawFloor(floorCtx, theme, nodes);
      cachedOptions = null;
    }
    if (!cachedOptions || cachedOptions.online !== options.online || cachedOptions.hoveredId !== options.hoveredId
      || cachedOptions.highlightedKind !== options.highlightedKind || cachedOptions.highlightedDomain !== options.highlightedDomain) cacheScene(options);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(background, 0, 0);
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // Shared optical materials are batched into four strokes and one fill.
    // Device geometry and gateway detailing do not issue draw calls per frame.
    for (const group of trailGroups) {
      for (const route of group.routes) route.progress = ((options.time * .105 + route.phase) % 1 + 1) % 1;
      ctx.strokeStyle = group.color; ctx.lineWidth = group.width;
      for (let segment = 0; segment < 4; segment++) {
        ctx.globalAlpha = group.opacity * ((segment + 1) / 4);
        ctx.beginPath();
        for (const route of group.routes) {
          const start = route.progress - group.tail + segment * group.tail / 4;
          if (start < 0 || start > 1) continue;
          const end = Math.min(1, start + group.tail / 4 + .003);
          const a = bezier(route.points, start), b = bezier(route.points, end);
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = group.headOpacity; ctx.fillStyle = group.headColor;
      ctx.beginPath();
      for (const route of group.routes) {
        const point = bezier(route.points, route.progress);
        ctx.moveTo(point.x + group.headRadius, point.y);
        ctx.arc(point.x, point.y, group.headRadius, 0, TAU);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(foreground, 0, 0);
  }

  function dispose() {
    disposed = true;
    sprites.clear(); routes = []; nodeReference = null; cachedOptions = null; trailGroups = [];
    floor.width = 0; floor.height = 0;
    background.width = 0; background.height = 0;
    foreground.width = 0; foreground.height = 0;
  }

  return { resize, render, dispose };
}
