import {
  box, contactShadow, desk, ellipse, gateway, iso, label, line, mix, person,
  polygon, progress, route, type Palette, type Point,
} from './scenePrimitives';

function waterDrop(ctx: CanvasRenderingContext2D, at: Point, size: number, color: string) {
  ctx.beginPath();
  ctx.moveTo(at.x, at.y - size * 1.7);
  ctx.bezierCurveTo(at.x + size * 1.5, at.y, at.x + size, at.y + size, at.x, at.y + size);
  ctx.bezierCurveTo(at.x - size, at.y + size, at.x - size * 1.5, at.y, at.x, at.y - size * 1.7);
  ctx.fillStyle = color;
  ctx.fill();
}

export function leakScene(ctx: CanvasRenderingContext2D, p: Palette, time: number) {
  const leak = progress(time, 0.8, 2);
  const pool = progress(time, 1, 10);
  const sensor = progress(time, 10, 11.5);
  const isolated = progress(time, 17, 20);
  const pipe = [iso(26, 37, 101), iso(26, 132, 101), iso(80, 132, 101), iso(80, 132, 47)];
  line(ctx, pipe, p.hardwareSide, 16);
  line(ctx, pipe, p.hardwareTop, 9);
  [57, 103].forEach(y => box(ctx, 21, y, 96, 10, 9, 11, p.hardwareTop, p.hardwareSide, p.hardware));
  const puddle = iso(109, 186, 1);
  ctx.save();
  ctx.translate(puddle.x, puddle.y);
  ctx.rotate(-0.1);
  ctx.scale(1, 0.48);
  const radius = mix(13, 102, pool);
  ctx.globalAlpha = leak * 0.56;
  ctx.beginPath();
  ctx.moveTo(-radius, 0);
  ctx.bezierCurveTo(-radius * 1.12, -radius * 0.63, -radius * 0.18, -radius * 0.93, radius * 0.44, -radius * 0.6);
  ctx.bezierCurveTo(radius * 1.2, -radius * 0.47, radius * 1.17, radius * 0.27, radius * 0.65, radius * 0.53);
  ctx.bezierCurveTo(radius * 0.1, radius * 0.92, -radius * 0.75, radius * 0.78, -radius, 0);
  ctx.fillStyle = p.dark ? '#439bbe' : '#7fc6df';
  ctx.fill();
  ctx.globalAlpha = leak * 0.5;
  ctx.strokeStyle = p.blue;
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.restore();
  // Water remains on the floor after the supply is isolated; cleanup is still needed.
  if (leak > 0 && isolated < 1) {
    const nozzle = iso(80, 132, 46);
    for (let index = 0; index < 6; index++) {
      const phase = (time * 1.7 + index / 6) % 1;
      const x = nozzle.x + phase * 30;
      const y = nozzle.y + phase * phase * 61;
      ctx.save();
      ctx.globalAlpha = leak * (1 - isolated);
      waterDrop(ctx, { x, y }, 3.7, p.blue);
      ctx.restore();
    }
    const splash = (time * 1.7) % 1;
    ctx.save();
    ctx.globalAlpha = (1 - splash) * (1 - isolated) * 0.5;
    ctx.beginPath();
    ctx.ellipse(nozzle.x + 30, nozzle.y + 62, 5 + splash * 22, 2 + splash * 7, 0, 0, Math.PI * 2);
    ctx.strokeStyle = p.blue;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  }
  // Isolation valve is physically part of the pipe, with a turning actuator.
  const valve = iso(26, 107, 104);
  ellipse(ctx, valve, 16, 16, isolated === 1 ? p.teal : p.amber);
  ellipse(ctx, valve, 11.5, 11.5, p.floorSide);
  ctx.save();
  ctx.translate(valve.x, valve.y);
  ctx.rotate(isolated * Math.PI / 2);
  line(ctx, [{ x: -14, y: 0 }, { x: 14, y: 0 }], isolated === 1 ? p.teal : p.amber, 4);
  line(ctx, [{ x: 0, y: -14 }, { x: 0, y: 14 }], isolated === 1 ? p.teal : p.amber, 4);
  ctx.restore();
  box(ctx, 151, 221, 0, 53, 43, 45, '#d7bd97', '#b99b74', '#c9a97f');
  box(ctx, 156, 224, 45, 42, 37, 27, '#e3ceb0', '#c5ad8d', '#d1b799');
  line(ctx, [iso(178, 225, 73), iso(178, 260, 73)], '#f2e4cf', 5);
  desk(ctx, p);
  gateway(ctx, p, sensor, time);
  if (sensor > 0) {
    ctx.save();
    ctx.globalAlpha = sensor;
    const puck = iso(174, 164, 4);
    contactShadow(ctx, puck, 19, 7);
    ellipse(ctx, puck, 20, 10, p.hardwareSide);
    ellipse(ctx, { x: puck.x, y: puck.y - 5 }, 20, 10, p.hardwareTop);
    ellipse(ctx, { x: puck.x, y: puck.y - 7 }, 4, 2.8, isolated === 1 ? p.teal : p.blue);
    ctx.restore();
    route(ctx, [[174, 164, 2], [246, 164, 2], [246, 110, 2], [349, 110, 2]], p.blue, sensor * 0.8, time);
    route(ctx, [[349, 99, 2], [249, 99, 2], [249, 67, 2], [26, 67, 2]], p.teal, isolated * 0.8, time);
  }
  if (time >= 2 && time < 10) label(ctx, 292, 115, 'The leak is spreading', p.amber, p);
  else if (time >= 10 && time < 17) label(ctx, 292, 115, 'Water detected', p.blue, p);
  else if (time >= 17 && time < 20) label(ctx, 292, 115, 'Closing the valve', p.blue, p);
  else if (time >= 20) label(ctx, 292, 115, 'Supply isolated', p.teal, p);
}

export function occupancyScene(ctx: CanvasRenderingContext2D, p: Palette, time: number) {
  const departure = progress(time, 0.4, 3.6);
  const connected = progress(time, 10, 12);
  const dimmed = progress(time, 17, 20.5);
  // A pendant, desk lamp and wall vent are visibly left on in an empty room.
  const light = iso(151, 169, 134);
  ctx.save();
  ctx.globalAlpha = (1 - dimmed * 0.85) * (p.dark ? 0.22 : 0.28);
  polygon(ctx, [light, iso(35, 248, 1), iso(239, 236, 1), iso(219, 101, 1)], '#ffd877');
  ctx.restore();
  box(ctx, 58, 170, 0, 5, 55, 47, p.hardwareTop, p.hardwareSide, p.hardwareSide);
  box(ctx, 140, 170, 0, 5, 55, 47, p.hardwareTop, p.hardwareSide, p.hardwareSide);
  box(ctx, 47, 162, 47, 111, 79, 6, p.hardwareTop, p.hardware, p.hardwareSide);
  box(ctx, 82, 242, 0, 39, 31, 25, p.hardwareTop, p.hardware, p.hardwareSide);
  box(ctx, 83, 267, 25, 37, 4, 38, p.hardwareTop, p.hardwareSide, p.hardware);
  line(ctx, [{ x: light.x, y: light.y - 33 }, { x: light.x, y: light.y }], p.hardwareSide, 3);
  polygon(ctx, [{ x: light.x - 12, y: light.y - 4 }, { x: light.x + 12, y: light.y - 4 }, { x: light.x + 25, y: light.y + 15 }, { x: light.x - 25, y: light.y + 15 }], p.hardwareSide);
  ellipse(ctx, { x: light.x, y: light.y + 15 }, 25, 8, dimmed > 0.9 ? p.hardware : '#ffdb87');
  desk(ctx, p);
  gateway(ctx, p, connected, time);
  const vent = iso(270, 2, 66);
  polygon(ctx, [iso(248, 2, 48), iso(291, 2, 48), iso(291, 2, 75), iso(248, 2, 75)], p.hardwareSide);
  for (let i = 0; i < 4; i++) line(ctx, [iso(252, 3, 53 + i * 5), iso(287, 3, 53 + i * 5)], p.hardwareTop, 2);
  for (let i = 0; i < 3; i++) {
    const phase = (time * 0.5 + i / 3) % 1;
    ctx.save();
    ctx.globalAlpha = (1 - dimmed) * (1 - phase) * 0.5;
    line(ctx, [{ x: vent.x - 8 + i * 7, y: vent.y + 3 }, { x: vent.x - 26 + i * 8, y: vent.y + 20 + phase * 29 }], p.blue, 2);
    ctx.restore();
  }
  if (time < 3.6) {
    ctx.save();
    ctx.globalAlpha = 1 - progress(time, 3.2, 3.6);
    person(ctx, iso(mix(211, 341, departure), mix(194, 21, departure)), 0, time * 7);
    ctx.restore();
  }
  if (connected > 0) {
    ctx.save();
    ctx.globalAlpha = connected;
    const sensor = iso(12, 33, 92);
    ellipse(ctx, sensor, 14, 12, p.hardwareTop);
    ellipse(ctx, sensor, 6, 6, p.blue);
    ctx.globalAlpha = connected * 0.12;
    polygon(ctx, [sensor, iso(130, 274, 1), iso(301, 162, 1)], p.blue);
    ctx.restore();
    route(ctx, [[14, 33, 2], [190, 33, 2], [190, 100, 2], [350, 100, 2]], p.blue, connected * 0.7, time);
    // Window shades lower only when the room's connected controls act.
    if (dimmed > 0) {
      polygon(ctx, [iso(68, 4, 95), iso(231, 4, 95), iso(231, 4, 95 - 39 * dimmed), iso(68, 4, 95 - 39 * dimmed)], p.hardware);
      for (let i = 1; i <= 5; i++) line(ctx, [iso(68, 5, 95 - 7 * i * dimmed), iso(231, 5, 95 - 7 * i * dimmed)], p.hardwareSide, 1);
    }
  }
  if (time >= 3.6 && time < 10) label(ctx, 484, 126, 'Nobody here. Still running.', p.amber, p);
  else if (time >= 10 && time < 17) label(ctx, 484, 126, 'Room is unoccupied', p.blue, p);
  else if (time >= 17) label(ctx, 484, 126, 'Lights + climate set back', p.teal, p);
}

export function protocolsScene(ctx: CanvasRenderingContext2D, p: Palette, time: number) {
  const connected = progress(time, 10, 14);
  const unified = progress(time, 17, 19);
  const devices = [
    { x: 58, y: 150, name: 'Modbus', color: p.amber, labelX: 309, labelY: 188 },
    { x: 184, y: 210, name: 'BACnet', color: p.blue, labelX: 398, labelY: 285 },
    { x: 120, y: 43, name: 'OPC UA', color: p.dark ? '#c3a7f3' : '#9364ba', labelX: 492, labelY: 140 },
  ];
  for (const [index, device] of devices.entries()) {
    const { x, y, name, color, labelX, labelY } = device;
    contactShadow(ctx, iso(x + 25, y + 25), 31, 11);
    box(ctx, x, y, 0, 43, 37, index === 1 ? 36 : 62, p.hardwareTop, p.hardware, p.hardwareSide);
    const height = index === 1 ? 36 : 62;
    polygon(ctx, [iso(x + 6, y + 38, height - 10), iso(x + 37, y + 38, height - 10), iso(x + 37, y + 38, height - 32), iso(x + 6, y + 38, height - 32)], p.screen);
    for (let row = 0; row < 3; row++) line(ctx, [iso(x + 10, y + 39, height - 15 - row * 5), iso(x + 26 + row * 3, y + 39, height - 15 - row * 5)], unified ? p.teal : color, 1.5);
    label(ctx, labelX, labelY, name, color, p);
    const from = iso(x + 44, y + 18, 4);
    const end = iso(295, 119 + index * 13, 4);
    const path = [from, { x: mix(from.x, end.x, 0.48), y: from.y }, end];
    line(ctx, path, connected ? color : p.hardwareSide, 2, connected ? [] : [4, 5]);
    // Before translation, mismatched packets reach a dead end and return.
    const phase = (time * 0.4 + index * 0.25) % 1;
    const travel = connected ? phase : Math.sin(phase * Math.PI) * 0.7;
    const packet = { x: mix(from.x, end.x, travel), y: mix(from.y, end.y, travel) };
    ctx.save();
    ctx.translate(packet.x, packet.y);
    ctx.rotate(index === 0 ? 0 : index === 1 ? Math.PI / 4 : Math.PI / 6);
    if (index === 2) ellipse(ctx, { x: 0, y: 0 }, 4, 4, color);
    else polygon(ctx, [{ x: -4, y: -4 }, { x: 4, y: -4 }, { x: 4, y: 4 }, { x: -4, y: 4 }], color);
    ctx.restore();
    if (time > 2 && connected < 1) {
      ctx.save();
      ctx.globalAlpha = 1 - connected;
      line(ctx, [{ x: end.x - 5, y: end.y - 5 }, { x: end.x + 5, y: end.y + 5 }], p.amber, 2);
      line(ctx, [{ x: end.x + 5, y: end.y - 5 }, { x: end.x - 5, y: end.y + 5 }], p.amber, 2);
      ctx.restore();
    }
  }
  desk(ctx, p);
  gateway(ctx, p, connected, time);
  route(ctx, [[295, 119, 4], [347, 119, 4]], p.teal, connected, time);
  route(ctx, [[350, 92, 4], [320, 92, 4], [320, 50, 4], [276, 50, 4]], p.teal, unified, time);
  if (unified > 0) {
    ctx.save();
    ctx.globalAlpha = unified;
    for (let index = 0; index < 3; index++) ellipse(ctx, iso(246 + index * 9, 44, 80), 2.3, 2.7, p.teal);
    ctx.restore();
  }
  if (time >= 2 && time < 10) label(ctx, 693, 252, 'Protocols do not match', p.amber, p);
  else if (time >= 10 && time < 17) label(ctx, 693, 252, 'Translating at the edge', p.blue, p);
  else if (time >= 17) label(ctx, 693, 252, 'One connected view', p.teal, p);
}
