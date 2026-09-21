export type ScenarioId = 'safety' | 'connectivity' | 'energy' | 'leak' | 'matter' | 'eagle' | 'greengrass';
export type Point = { x: number; y: number };
export type WorldPoint = readonly [number, number, number?];
export type Palette = ReturnType<typeof palette>;
export const WIDTH = 900;
export const HEIGHT = 560;
export const clamp = (value: number) => Math.max(0, Math.min(1, value));
export const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };
export const progress = (time: number, from: number, to: number) => smooth((time - from) / (to - from));
export const mix = (a: number, b: number, amount: number) => a + (b - a) * amount;
export const iso = (x: number, y: number, z = 0): Point => ({ x: 421 + (x - y) * 0.88, y: 165 + (x + y) * 0.44 - z });

export interface ScenePresentation {
  gateway?: boolean;
  desk?: boolean;
  labels?: boolean;
  routes?: boolean;
}

const presentations = new WeakMap<CanvasRenderingContext2D, ScenePresentation>();
export const scenePresentation = (ctx: CanvasRenderingContext2D) => presentations.get(ctx);

/** Reuse the deployed animation rigs without duplicating the store's shared infrastructure. */
export function withScenePresentation(ctx: CanvasRenderingContext2D, options: ScenePresentation, draw: () => void) {
  const previous = presentations.get(ctx);
  presentations.set(ctx, options);
  try { draw(); } finally {
    if (previous) presentations.set(ctx, previous);
    else presentations.delete(ctx);
  }
}

export function palette(dark: boolean) {
  return {
    dark,
    floor: dark ? '#253d50' : '#e5edf0',
    floorSide: dark ? '#1a3042' : '#c4d5de',
    floorFront: dark ? '#203748' : '#d3e0e6',
    seam: dark ? '#365164' : '#cfdee4',
    wall: dark ? '#355167' : '#f6f9fa',
    wallSide: dark ? '#2b4459' : '#dce8ed',
    wallTop: dark ? '#577184' : '#ffffff',
    ink: dark ? '#e4f0f7' : '#284659',
    muted: dark ? '#a9c2d2' : '#678798',
    blue: dark ? '#70b8f2' : '#2584c7',
    teal: dark ? '#5ed7bd' : '#159b89',
    amber: dark ? '#f4b76d' : '#cf792f',
    red: dark ? '#f48d7d' : '#d45c49',
    white: dark ? '#bdd3df' : '#f7fbfd',
    hardware: dark ? '#597487' : '#d9e6ed',
    hardwareSide: dark ? '#3d5b70' : '#b2c8d6',
    hardwareTop: dark ? '#7690a0' : '#f7fafc',
    screen: '#193c51',
  };
}

export function polygon(ctx: CanvasRenderingContext2D, points: Point[], fill: string, stroke?: string, width = 1) {
  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = width;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

export function line(ctx: CanvasRenderingContext2D, points: Point[], color: string, width = 1, dash: number[] = []) {
  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(dash);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function box(ctx: CanvasRenderingContext2D, x: number, y: number, z: number, w: number, d: number, h: number, top: string, left: string, right: string) {
  polygon(ctx, [iso(x, y + d, z), iso(x + w, y + d, z), iso(x + w, y + d, z + h), iso(x, y + d, z + h)], left);
  polygon(ctx, [iso(x + w, y, z), iso(x + w, y + d, z), iso(x + w, y + d, z + h), iso(x + w, y, z + h)], right);
  polygon(ctx, [iso(x, y, z + h), iso(x + w, y, z + h), iso(x + w, y + d, z + h), iso(x, y + d, z + h)], top);
}

export function ellipse(ctx: CanvasRenderingContext2D, p: Point, rx: number, ry: number, color: string) {
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

export function contactShadow(ctx: CanvasRenderingContext2D, p: Point, rx: number, ry: number, opacity = 0.14) {
  ctx.save();
  ctx.translate(p.x + 6, p.y + 6);
  ctx.scale(rx + 5, ry + 4);
  const shade = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  shade.addColorStop(0, `rgba(11, 18, 40, ${opacity})`);
  shade.addColorStop(0.55, `rgba(11, 18, 40, ${opacity * 0.65})`);
  shade.addColorStop(1, 'rgba(11, 18, 40, 0)');
  ctx.fillStyle = shade;
  ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export function label(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, p: Palette) {
  if (scenePresentation(ctx)?.labels === false) return;
  ctx.save();
  ctx.font = '600 16px "Space Grotesk", ui-sans-serif, system-ui, sans-serif';
  const width = ctx.measureText(text).width + 32;
  ctx.fillStyle = p.dark ? '#183044' : '#ffffff';
  ctx.shadowColor = p.dark ? 'rgba(0,0,0,.12)' : 'rgba(37,72,92,.08)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  ctx.beginPath();
  ctx.roundRect(x - width / 2, y - 14, width, 29, 7);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ellipse(ctx, { x: x - width / 2 + 13, y: y + 1 }, 3, 3, color);
  ctx.fillStyle = p.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 5, y + 1);
  ctx.restore();
}

export function plant(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, p: Palette) {
  const base = iso(x, y);
  contactShadow(ctx, base, 17 * scale, 7 * scale);
  ctx.save();
  ctx.translate(base.x, base.y);
  ctx.scale(scale, scale);
  polygon(ctx, [{ x: -15, y: -22 }, { x: 15, y: -22 }, { x: 10, y: 0 }, { x: -10, y: 0 }], p.dark ? '#577281' : '#d9cbbd');
  ellipse(ctx, { x: 0, y: -22 }, 15, 6, p.dark ? '#8a9ca0' : '#efe7dd');
  ellipse(ctx, { x: 0, y: -22 }, 11, 4, '#627269');
  const leaves = [[-24, -61], [18, -70], [28, -43], [-30, -38], [-5, -78], [5, -51]];
  leaves.forEach(([lx, ly], index) => {
    line(ctx, [{ x: 0, y: -23 }, { x: lx * 0.62, y: ly + 8 }], '#4c8573', 2);
    ctx.beginPath();
    ctx.moveTo(0, -29);
    ctx.quadraticCurveTo(lx - 14, ly + 7, lx, ly);
    ctx.quadraticCurveTo(lx + 13, ly + 17, 0, -29);
    ctx.fillStyle = index % 2 ? '#428f7f' : '#6ba995';
    ctx.fill();
  });
  ctx.restore();
}

export function room(ctx: CanvasRenderingContext2D, p: Palette, scenario: ScenarioId) {
  // The open front and low side wall keep the incident readable at small widths.
  ctx.save();
  ctx.shadowColor = p.dark ? 'rgba(0,0,0,.24)' : 'rgba(54,88,106,.16)';
  ctx.shadowBlur = 32;
  ctx.shadowOffsetY = 21;
  polygon(ctx, [iso(0, 0), iso(410, 0), iso(410, 305), iso(0, 305)], p.floor);
  ctx.restore();
  box(ctx, 0, 0, -15, 410, 305, 15, p.floor, p.floorSide, p.floorFront);
  for (let x = 0; x <= 410; x += 82) line(ctx, [iso(x, 0, 0.5), iso(x, 305, 0.5)], p.seam, 0.8);
  for (let y = 0; y <= 305; y += 61) line(ctx, [iso(0, y, 0.5), iso(410, y, 0.5)], p.seam, 0.8);

  box(ctx, -7, -7, 0, 424, 8, 112, p.wallTop, p.wall, p.wallSide);
  box(ctx, -7, 0, 0, 8, 305, 64, p.wallTop, p.wallSide, p.wallSide);
  line(ctx, [iso(0, 0, 3), iso(410, 0, 3)], p.hardwareSide, 4);
  line(ctx, [iso(0, 0, 3), iso(0, 305, 3)], p.hardwareSide, 4);

  // Inset glazing, with mullions following the same physical projection.
  polygon(ctx, [iso(63, 1, 101), iso(238, 1, 101), iso(238, 1, 43), iso(63, 1, 43)], p.dark ? '#173246' : '#bbd7e3');
  polygon(ctx, [iso(68, 2, 96), iso(230, 2, 96), iso(68, 2, 51)], p.dark ? '#254e66' : '#d6e9ef');
  [63, 150, 238].forEach(x => line(ctx, [iso(x, 2, 43), iso(x, 2, 101)], p.wallTop, 4));
  line(ctx, [iso(63, 2, 43), iso(238, 2, 43)], p.hardwareSide, 5);

  // A flush door adds scale and gives the responder a believable entrance.
  polygon(ctx, [iso(310, 1, 0), iso(371, 1, 0), iso(371, 1, 92), iso(310, 1, 92)], p.dark ? '#223d50' : '#c4d7e0');
  line(ctx, [iso(311, 2, 0), iso(311, 2, 92), iso(371, 2, 92)], p.hardwareSide, 3);
  line(ctx, [iso(321, 3, 36), iso(321, 3, 47)], p.white, 3);

  plant(ctx, 33, 47, 0.9, p);
  if (scenario === 'safety' || scenario === 'connectivity') {
    const bench = iso(41, 216);
    contactShadow(ctx, bench, 45, 13);
    box(ctx, 17, 167, 0, 44, 102, 26, p.hardwareTop, p.hardware, p.hardwareSide);
    box(ctx, 13, 163, 26, 52, 110, 9, p.dark ? '#427687' : '#a8cbd1', p.dark ? '#315969' : '#79aab5', p.dark ? '#386775' : '#8ab7c0');
    line(ctx, [iso(16, 200, 36), iso(63, 200, 36)], p.dark ? '#365b6a' : '#89b5bd', 1);
    line(ctx, [iso(16, 235, 36), iso(63, 235, 36)], p.dark ? '#365b6a' : '#89b5bd', 1);
  }
  plant(ctx, 365, 272, 0.73, p);
}

export function desk(ctx: CanvasRenderingContext2D, p: Palette) {
  if (scenePresentation(ctx)?.desk === false) return;
  [218, 292].forEach(x => [28, 67].forEach(y => box(ctx, x, y, 0, 5, 5, 46, p.hardwareTop, p.hardwareSide, p.hardwareSide)));
  box(ctx, 210, 20, 46, 100, 58, 6, p.hardwareTop, p.hardware, p.hardwareSide);
  box(ctx, 244, 36, 53, 26, 13, 2, p.hardwareSide, p.hardwareSide, p.hardwareSide);
  line(ctx, [iso(257, 41, 54), iso(257, 41, 68)], p.hardwareSide, 4);
  box(ctx, 235, 38, 65, 46, 4, 30, p.hardwareSide, p.screen, '#52798e');
  polygon(ctx, [iso(240, 43, 89), iso(275, 43, 89), iso(275, 43, 71), iso(240, 43, 71)], '#285973');
  line(ctx, [iso(246, 44, 82), iso(269, 44, 82)], '#71b5ca', 2);
  line(ctx, [iso(246, 44, 77), iso(262, 44, 77)], '#5898af', 2);
  box(ctx, 235, 58, 53, 38, 10, 1, p.hardwareSide, p.hardwareSide, p.hardwareSide);
}

export function gateway(ctx: CanvasRenderingContext2D, p: Palette, active: number, time: number) {
  if (scenePresentation(ctx)?.gateway === false) return;
  contactShadow(ctx, iso(364, 106), 29, 12);
  box(ctx, 340, 77, 0, 47, 46, 34, p.hardwareTop, p.hardware, p.hardwareSide);
  box(ctx, 338, 76, 35, 51, 48, 5, p.hardwareTop, p.hardwareSide, p.hardwareSide);
  box(ctx, 344, 83, 40, 39, 30, 20, '#496579', '#233f52', '#183448');
  for (let i = 0; i < 5; i++) line(ctx, [iso(349 + i * 6, 85, 61), iso(349 + i * 6, 109, 61)], '#7691a2', 1.4);
  [349, 377].forEach(x => line(ctx, [iso(x, 86, 60), iso(x, 86, 82)], '#284a61', 3));
  const led = iso(353, 114, 49);
  ellipse(ctx, led, 2.4, 2.4, active ? p.teal : p.muted);
  if (active > 0) {
    ctx.save();
    ctx.globalAlpha = active * (0.35 + Math.sin(time * 3) * 0.15);
    ellipse(ctx, led, 5, 5, p.teal);
    ctx.restore();
  }
}

export function route(ctx: CanvasRenderingContext2D, points: WorldPoint[], color: string, opacity: number, time: number, packets = true) {
  if (scenePresentation(ctx)?.routes === false) return;
  if (opacity <= 0) return;
  const path = points.map(([x, y, z]) => iso(x, y, z ?? 2));
  ctx.save();
  ctx.globalAlpha = opacity;
  line(ctx, path, color, 2, packets ? [] : [5, 6]);
  if (packets) {
    const lengths = path.slice(1).map((point, index) => Math.hypot(point.x - path[index].x, point.y - path[index].y));
    const total = lengths.reduce((a, b) => a + b, 0);
    for (let n = 0; n < 3; n++) {
      let distance = ((time * 0.25 + n / 3) % 1) * total;
      for (let segment = 0; segment < lengths.length; segment++) {
        if (distance <= lengths[segment]) {
          const ratio = distance / lengths[segment];
          const point = { x: mix(path[segment].x, path[segment + 1].x, ratio), y: mix(path[segment].y, path[segment + 1].y, ratio) };
          ellipse(ctx, point, 3.7, 3.7, color);
          break;
        }
        distance -= lengths[segment];
      }
    }
  }
  ctx.restore();
}

export function person(ctx: CanvasRenderingContext2D, base: Point, fall: number, gait: number, responder = false, aid = 0) {
  // Jointed silhouette: jacket, trousers, shoes, hands and head remain tangible
  // during the rotation, rather than replacing the actor with a fallen icon.
  contactShadow(ctx, { x: base.x + fall * 8, y: base.y }, 19 + fall * 37, 7 + fall * 3, 0.2);
  ctx.save();
  ctx.translate(base.x, base.y - mix(51, 11, fall) - aid * 2);
  ctx.rotate(fall * 1.48);
  const stride = Math.sin(gait) * (1 - fall) * 10;
  const jacket = responder ? '#299a8b' : '#3b84b7';
  const jacketLight = responder ? '#60bdab' : '#65a5ce';
  const jacketShade = responder ? '#207b73' : '#28658d';
  const limb = (points: Point[], color: string, width: number) => line(ctx, points, color, width);
  // Far arm and leg are shaded, making the figure read as a volume.
  limb([{ x: 8, y: 0 }, { x: 9 - stride * 0.7, y: 25 - Math.abs(stride) * 0.3 }, { x: 5 - stride, y: 49 }], '#264254', 10);
  limb([{ x: 4 - stride, y: 50 }, { x: 14 - stride, y: 50 }], '#152e40', 7);
  limb([{ x: 11, y: -29 }, { x: 16 + stride * 0.7, y: -10 }, { x: 14 + stride, y: 5 - fall * 14 }], jacketShade, 9);
  ellipse(ctx, { x: 14 + stride, y: 6 - fall * 14 }, 4.5, 5, '#c9916e');
  limb([{ x: -7, y: 0 }, { x: -9 + stride * 0.65, y: 26 - Math.abs(stride) * 0.2 }, { x: -7 + stride, y: 49 }], '#36576c', 11);
  limb([{ x: -8 + stride, y: 50 }, { x: 3 + stride, y: 50 }], '#1d374a', 7);
  polygon(ctx, [{ x: -12, y: -32 }, { x: 10, y: -32 }, { x: 14, y: -21 }, { x: 10, y: 2 }, { x: -11, y: 2 }, { x: -14, y: -20 }], jacket);
  polygon(ctx, [{ x: -12, y: -31 }, { x: -4, y: -33 }, { x: -3, y: 0 }, { x: -11, y: 1 }], jacketLight);
  limb([{ x: -12, y: -27 }, { x: -17 - stride * 0.6, y: -10 - aid * 8 }, { x: -14 - stride - aid * 11, y: 4 - fall * 19 - aid * 13 }], jacketLight, 9);
  ellipse(ctx, { x: -14 - stride - aid * 11, y: 5 - fall * 19 - aid * 13 }, 4.5, 5, '#dca582');
  limb([{ x: -1, y: -32 }, { x: -1, y: -39 }], '#c38c6b', 8);
  ellipse(ctx, { x: 0, y: -46 }, 10.3, 12, '#dfac88');
  ctx.beginPath();
  ctx.ellipse(-1.6, -49, 10.2, 10, -0.1, Math.PI, Math.PI * 2.15);
  ctx.fillStyle = responder ? '#393d3c' : '#40505a';
  ctx.fill();
  ellipse(ctx, { x: 8, y: -44 }, 2, 3.3, '#d39a78');
  if (responder) {
    line(ctx, [{ x: 4, y: -22 }, { x: 4, y: -13 }], '#dcf8ee', 3);
    line(ctx, [{ x: 0, y: -17.5 }, { x: 8, y: -17.5 }], '#dcf8ee', 3);
  }
  ctx.restore();
}

export function camera(ctx: CanvasRenderingContext2D, p: Palette, opacity: number) {
  if (opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha = opacity;
  const mount = iso(22, 32, 93);
  line(ctx, [iso(0, 31, 87), mount], p.hardwareSide, 6);
  box(ctx, 13, 26, 92, 37, 21, 15, p.hardwareTop, p.hardware, p.hardwareSide);
  const lens = iso(51, 38, 99);
  ellipse(ctx, lens, 5, 6, '#25495e');
  ellipse(ctx, { x: lens.x + 0.5, y: lens.y - 1 }, 2.4, 3, '#77bbd5');
  ctx.restore();
}

export function detection(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, opacity: number) {
  ctx.save();
  ctx.globalAlpha = opacity;
  [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]].forEach(([px, py, sx, sy]) => {
    line(ctx, [{ x: px, y: py + sy * 10 }, { x: px, y: py }, { x: px + sx * 12, y: py }], color, 2.4);
  });
  ctx.restore();
}

export function pos(ctx: CanvasRenderingContext2D, p: Palette, active: boolean) {
  contactShadow(ctx, iso(151, 202), 48, 16);
  box(ctx, 108, 149, 0, 90, 56, 53, p.hardwareTop, p.hardware, p.hardwareSide);
  box(ctx, 103, 144, 53, 101, 66, 6, p.hardwareTop, p.hardwareSide, p.hardwareSide);
  box(ctx, 137, 160, 60, 27, 20, 3, p.hardwareSide, p.hardwareSide, p.hardwareSide);
  line(ctx, [iso(149, 169, 64), iso(149, 169, 78)], p.hardwareSide, 6);
  box(ctx, 129, 165, 75, 46, 7, 31, p.hardwareTop, p.screen, p.hardwareSide);
  const center = iso(152, 173, 91);
  ellipse(ctx, center, 7, 8, active ? '#69cfb5' : '#dcad70');
  if (active) line(ctx, [{ x: center.x - 3, y: center.y }, { x: center.x - 0.5, y: center.y + 3 }, { x: center.x + 4, y: center.y - 3 }], '#193c51', 2);
  else {
    line(ctx, [{ x: center.x, y: center.y - 4 }, { x: center.x, y: center.y + 1 }], '#193c51', 2);
    ellipse(ctx, { x: center.x, y: center.y + 4 }, 1, 1, '#193c51');
  }
  box(ctx, 177, 182, 60, 15, 18, 9, '#527e92', '#274f65', '#39647b');
}
