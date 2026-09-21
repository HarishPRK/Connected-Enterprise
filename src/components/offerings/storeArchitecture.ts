import { box, ellipse, iso, line, polygon, type Palette, type ScenarioId } from './scenePrimitives';

export const STORE_ZONES = {
  energy: { x: 0, y: 0, name: 'Climate & energy' },
  leak: { x: 410, y: 0, name: 'Utilities' },
  eagle: { x: 820, y: 0, name: 'IT & edge' },
  matter: { x: 0, y: 330, name: 'Smart retail zone' },
  greengrass: { x: 410, y: 330, name: 'Stockroom' },
  connectivity: { x: 820, y: 330, name: 'Checkout' },
  safety: { x: 410, y: 630, name: 'Customer aisle' },
} as const satisfies Record<ScenarioId, { readonly x: number; readonly y: number; readonly name: string }>;

export const STORE_FLOOR_WIDTH = 1230;
export const STORE_FLOOR_DEPTH = 960;

function groundText(ctx: CanvasRenderingContext2D, p: Palette, x: number, y: number, value: string, size = 18) {
  const point = iso(x, y, 2);
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.transform(0.88, 0.44, -0.88, 0.44, 0, 0);
  ctx.font = `600 ${size}px "Space Grotesk", ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = p.muted;
  ctx.fillText(value, 0, 0);
  ctx.restore();
}

function wallText(ctx: CanvasRenderingContext2D, p: Palette, x: number, z: number, value: string, size = 21) {
  const point = iso(x, 9, z);
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.transform(0.88, 0.44, 0, 1, 0, 0);
  ctx.font = `600 ${size}px "Space Grotesk", ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = p.ink;
  ctx.fillText(value, 0, 0);
  ctx.restore();
}

function glazing(ctx: CanvasRenderingContext2D, p: Palette, x: number, width: number) {
  polygon(ctx, [iso(x, 2, 99), iso(x + width, 2, 99), iso(x + width, 2, 37), iso(x, 2, 37)], p.dark ? '#172c45' : '#c7d5e5');
  polygon(ctx, [iso(x + 5, 3, 95), iso(x + width - 6, 3, 95), iso(x + 5, 3, 42)], p.dark ? '#314664' : '#e8eef5');
  const panes = Math.max(2, Math.round(width / 85));
  for (let index = 0; index <= panes; index++) {
    const location = x + width * index / panes;
    line(ctx, [iso(location, 4, 35), iso(location, 4, 101)], p.hardwareTop, 3.5);
  }
  line(ctx, [iso(x, 4, 35), iso(x + width, 4, 35)], p.hardwareSide, 5);
  line(ctx, [iso(x, 4, 101), iso(x + width, 4, 101)], p.wallTop, 3);
  box(ctx, x - 3, 2, 31, width + 6, 8, 4, p.hardwareTop, p.hardware, p.hardwareSide);
}

function shelf(ctx: CanvasRenderingContext2D, p: Palette, x: number, y: number, width: number, depth: number, height: number, facing: 'front' | 'side' = 'front') {
  const purple = p.dark ? '#827bab' : '#9287ba';
  const blue = p.dark ? '#628eac' : '#7ba8c2';
  const pale = p.dark ? '#b2b8d2' : '#e8e6ed';
  const packing = [blue, purple, pale, p.hardwareTop];
  box(ctx, x, y, 0, width, depth, 6, p.hardwareTop, p.hardware, p.hardwareSide);
  if (facing === 'front') {
    box(ctx, x, y, 6, width, 4, height - 6, p.hardwareTop, p.hardwareSide, p.hardwareSide);
    [x, x + width - 3].forEach(lx => box(ctx, lx, y, 6, 3, depth, height - 6, p.hardwareTop, p.hardware, p.hardwareSide));
  } else {
    box(ctx, x, y, 6, 4, depth, height - 6, p.hardwareTop, p.hardware, p.hardwareSide);
    [y, y + depth - 3].forEach(ly => box(ctx, x, ly, 6, width, 3, height - 6, p.hardwareTop, p.hardware, p.hardwareSide));
  }
  [8, 31, 54].filter(z => z < height - 6).forEach((z, row) => {
    box(ctx, x, y, z, width, depth, 3, p.hardwareTop, p.hardware, p.hardwareSide);
    const count = facing === 'front' ? Math.floor((width - 10) / 23) : Math.floor((depth - 10) / 23);
    for (let index = 0; index < count; index++) {
      const px = facing === 'front' ? x + 6 + index * 23 : x + 6;
      const py = facing === 'front' ? y + 7 : y + 6 + index * 23;
      const cartonW = facing === 'front' ? 15 : width - 12;
      const cartonD = facing === 'front' ? depth - 13 : 15;
      const cartonH = 12 + ((index + row) % 2) * 3;
      box(ctx, px, py, z + 3, cartonW, cartonD, cartonH, packing[(index + row) % packing.length], packing[(index + row + 1) % packing.length], p.hardwareSide);
      if (facing === 'front') line(ctx, [iso(px + 4, py + cartonD + 0.5, z + 10), iso(px + cartonW - 4, py + cartonD + 0.5, z + 10)], p.white, 2);
      else line(ctx, [iso(px + cartonW + 0.5, py + 4, z + 10), iso(px + cartonW + 0.5, py + cartonD - 4, z + 10)], p.white, 2);
    }
  });
  box(ctx, x - 1, y - 1, height, width + 2, depth + 2, 4, p.hardwareTop, p.hardware, p.hardwareSide);
}

/** Architectural backdrop only: original animated scenes supply the equipment and people. */
export function drawStoreArchitecture(ctx: CanvasRenderingContext2D, p: Palette) {
  const w = STORE_FLOOR_WIDTH;
  const d = STORE_FLOOR_DEPTH;
  const circulation = p.dark ? '#304255' : '#edf0f4';
  const room = p.dark ? '#293b50' : '#e3e9ef';
  const violet = p.dark ? '#414565' : '#c3c3da';
  const cyan = p.blue;

  ctx.save();
  ctx.shadowColor = p.dark ? 'rgba(0,0,0,.27)' : 'rgba(36,51,73,.15)';
  ctx.shadowBlur = 38;
  ctx.shadowOffsetY = 23;
  polygon(ctx, [iso(0, 0), iso(w, 0), iso(w, d), iso(0, d)], p.floor);
  ctx.restore();
  box(ctx, 0, 0, -20, w, d, 20, room, p.floorSide, p.floorFront);

  // Wide shared circulation keeps the setting one store, never a set of room tiles.
  polygon(ctx, [iso(0, 300, 0.5), iso(w, 300, 0.5), iso(w, 341, 0.5), iso(0, 341, 0.5)], circulation);
  polygon(ctx, [iso(0, 627, 0.5), iso(w, 627, 0.5), iso(w, d, 0.5), iso(0, d, 0.5)], circulation);
  polygon(ctx, [iso(392, 0, 0.7), iso(427, 0, 0.7), iso(427, d, 0.7), iso(392, d, 0.7)], circulation);
  polygon(ctx, [iso(802, 0, 0.7), iso(837, 0, 0.7), iso(837, d, 0.7), iso(802, d, 0.7)], circulation);
  // A quiet inset showroom floor changes material without enclosing a room.
  polygon(ctx, [iso(45, 347, 0.8), iso(385, 347, 0.8), iso(385, 616, 0.8), iso(45, 616, 0.8)], p.dark ? '#303d57' : '#e4e4ef');
  ctx.save();
  ctx.globalAlpha = 0.5;
  for (let x = 0; x <= w; x += 82) line(ctx, [iso(x, 0, 1), iso(x, d, 1)], p.seam, 0.65);
  for (let y = 0; y <= d; y += 64) line(ctx, [iso(0, y, 1), iso(w, y, 1)], p.seam, 0.65);
  ctx.restore();
  [300, 341, 627].forEach(y => line(ctx, [iso(7, y, 1.2), iso(w - 7, y, 1.2)], p.dark ? '#4a5870' : '#c4ccda', 1.5));
  line(ctx, [iso(0, d, 0), iso(w, d, 0), iso(w, 0, 0)], p.hardwareTop, 1.7);

  // One continuous back wall and cutaway left wall enclose the entire store.
  box(ctx, -8, -8, 0, w + 16, 9, 129, p.wallTop, p.wall, p.wallSide);
  box(ctx, -8, 0, 0, 9, d, 51, p.wallTop, p.wallSide, p.wallSide);
  box(ctx, -9, -9, 126, w + 18, 11, 5, p.wallTop, p.hardware, p.hardwareSide);
  line(ctx, [iso(0, 2, 4), iso(w, 2, 4)], p.hardwareSide, 5);
  line(ctx, [iso(2, 0, 4), iso(2, d, 4)], p.hardwareSide, 5);
  glazing(ctx, p, 47, 302);
  glazing(ctx, p, 877, 302);
  // Retail identity is architectural lettering, integrated into the rear fascia.
  box(ctx, 449, 2, 78, 326, 4, 39, violet, violet, p.hardwareSide);
  wallText(ctx, p, 612, 99, 'CONNECTED ENTERPRISE', 20);
  wallText(ctx, p, 612, 53, 'ONE CONNECTED STORE', 13);
  line(ctx, [iso(25, 5, 120), iso(398, 5, 120)], cyan, 2.8);
  line(ctx, [iso(831, 5, 120), iso(1205, 5, 120)], cyan, 2.8);

  // Low service dividers give depth while preserving every animated scene.
  [410, 820].forEach(x => {
    box(ctx, x - 3, 0, 0, 6, 103, 24, p.wallTop, p.wall, p.wallSide);
    box(ctx, x - 4, 0, 24, 8, 103, 3, p.hardwareTop, p.hardware, p.hardwareSide);
  });

  // A freestanding showroom display physically supports the Matter window,
  // moving blind, vent and thermostat without enclosing another room.
  box(ctx, 58, 324, 0, 294, 11, 4, p.hardwareTop, p.hardware, p.hardwareSide);
  box(ctx, 60, 326, 4, 290, 6, 39, p.wallTop, p.wall, p.wallSide);
  box(ctx, 60, 326, 43, 6, 6, 62, p.wallTop, p.wall, p.wallSide);
  box(ctx, 239, 326, 43, 111, 6, 62, p.wallTop, p.wall, p.wallSide);
  box(ctx, 60, 326, 105, 290, 6, 6, p.wallTop, p.wall, p.wallSide);
  ctx.save();
  ctx.globalAlpha = p.dark ? 0.56 : 0.4;
  polygon(ctx, [iso(66, 331, 101), iso(237, 331, 101), iso(237, 331, 43), iso(66, 331, 43)], p.dark ? '#24415c' : '#c1d9e7');
  polygon(ctx, [iso(70, 331.5, 98), iso(233, 331.5, 98), iso(70, 331.5, 48)], p.dark ? '#365a76' : '#e3edf5');
  ctx.restore();
  [65, 151, 238].forEach(x => line(ctx, [iso(x, 332, 43), iso(x, 332, 102)], p.hardwareTop, 3));
  line(ctx, [iso(65, 332, 102), iso(238, 332, 102)], p.hardwareTop, 3);
  line(ctx, [iso(65, 332, 43), iso(238, 332, 43)], p.hardwareSide, 4);
  box(ctx, 63, 330, 40, 178, 7, 3, p.hardwareTop, p.hardware, p.hardwareSide);
  // Slender mounting posts keep the original sensor and aisle camera grounded.
  box(ctx, 5, 356, 0, 12, 14, 5, p.hardwareTop, p.hardware, p.hardwareSide);
  box(ctx, 8, 359, 5, 6, 8, 101, p.hardwareTop, p.hardware, p.hardwareSide);
  box(ctx, 6, 357, 106, 10, 12, 3, p.hardwareTop, p.hardware, p.hardwareSide);
  box(ctx, 401, 651, 0, 18, 20, 5, p.hardwareTop, p.hardware, p.hardwareSide);
  box(ctx, 405, 656, 5, 10, 10, 107, p.hardwareTop, p.hardware, p.hardwareSide);
  box(ctx, 403, 654, 112, 14, 14, 3, p.hardwareTop, p.hardware, p.hardwareSide);

  // Merchandise follows the perimeter, leaving the original use-case sets intact.
  shelf(ctx, p, 7, 399, 29, 117, 73, 'side');
  shelf(ctx, p, 7, 555, 29, 117, 73, 'side');
  shelf(ctx, p, 1001, 756, 176, 39, 78);
  shelf(ctx, p, 1001, 851, 176, 39, 78);
  // Endcap display with three physical products, away from the scene actors.
  box(ctx, 98, 797, 0, 112, 59, 24, p.hardwareTop, p.hardware, p.hardwareSide);
  box(ctx, 95, 794, 24, 118, 65, 5, p.hardwareTop, p.hardware, p.hardwareSide);
  [114, 151, 188].forEach((x, index) => {
    box(ctx, x, 813, 29, 17, 21, 26 - index * 4, index % 2 ? violet : p.hardwareTop, p.hardware, p.hardwareSide);
    ellipse(ctx, iso(x + 8, 834.5, 44 - index * 2), 3.1, 3.1, cyan);
  });

  // Front glazing stops at a broad, centered entrance aligned to the store aisle.
  [[0, 420], [830, 1230]].forEach(([start, end]) => {
    box(ctx, start, d - 5, 0, end - start, 5, 9, p.hardwareTop, p.hardware, p.hardwareSide);
    ctx.save();
    ctx.globalAlpha = p.dark ? 0.2 : 0.29;
    polygon(ctx, [iso(start + 3, d - 2, 10), iso(end - 3, d - 2, 10), iso(end - 3, d - 2, 60), iso(start + 3, d - 2, 60)], p.blue);
    ctx.restore();
    const panels = Math.ceil((end - start) / 140);
    for (let index = 0; index <= panels; index++) {
      const x = start + (end - start) * index / panels;
      line(ctx, [iso(x, d - 1, 9), iso(x, d - 1, 61)], p.hardwareTop, 2.6);
    }
    line(ctx, [iso(start, d - 1, 61), iso(end, d - 1, 61)], p.hardwareTop, 2);
  });
  box(ctx, 443, d - 18, 0, 363, 16, 2, p.hardwareTop, p.hardwareSide, p.hardwareSide);
  box(ctx, 477, d - 88, 0.8, 295, 54, 1.2, p.dark ? '#25354b' : '#d4dbe6', p.hardwareSide, p.hardwareSide);
  groundText(ctx, p, 625, d - 58, 'STORE ENTRANCE', 17);
  [445, 799].forEach(x => {
    box(ctx, x, d - 50, 0, 8, 24, 55, p.hardwareTop, p.hardware, p.hardwareSide);
    line(ctx, [iso(x + 8.5, d - 45, 48), iso(x + 8.5, d - 31, 48)], cyan, 2.4);
  });
}
