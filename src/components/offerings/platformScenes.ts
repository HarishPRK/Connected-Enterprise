import {
  box, clamp, contactShadow, detection, ellipse, gateway, iso, label, line, mix,
  person, polygon, progress, route, type Palette, type Point,
} from './scenePrimitives';

function hardwareText(ctx: CanvasRenderingContext2D, text: string, at: Point, color: string, size = 16) {
  ctx.save();
  ctx.font = `600 ${size}px "Space Grotesk", ui-sans-serif, system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, at.x, at.y);
  ctx.restore();
}

function warning(ctx: CanvasRenderingContext2D, at: Point, color: string, time: number, opacity = 1) {
  ctx.save();
  ctx.globalAlpha = opacity;
  const spread = 3 + Math.sin(time * 4) * 2;
  for (let index = 0; index < 3; index++) {
    const angle = -Math.PI * 0.9 + index * 0.4;
    line(ctx, [
      { x: at.x + Math.cos(angle) * (15 + spread), y: at.y + Math.sin(angle) * (15 + spread) },
      { x: at.x + Math.cos(angle) * (24 + spread), y: at.y + Math.sin(angle) * (24 + spread) },
    ], color, 2.3);
  }
  ctx.restore();
}

function rack(ctx: CanvasRenderingContext2D, p: Palette, load: number, identified: number, time: number) {
  contactShadow(ctx, iso(103, 170), 64, 19);
  box(ctx, 54, 113, 0, 83, 69, 139, p.hardwareTop, p.hardware, p.hardwareSide);
  box(ctx, 49, 109, 139, 93, 77, 7, p.hardwareTop, p.hardwareSide, p.hardwareSide);
  // Three physical server drawers. The middle drawer retains its amber fault
  // after identification: analytics does not silently repair the equipment.
  for (let index = 0; index < 3; index++) {
    const z = 19 + index * 37;
    const fault = index === 1;
    box(ctx, 61, 181, z, 68, 6, 29, p.hardwareTop, fault && identified > 0 ? p.dark ? '#675236' : '#ecd5ad' : p.screen, p.hardwareSide);
    for (let slot = 0; slot < 7; slot++) line(ctx, [iso(67 + slot * 5, 188, z + 8), iso(67 + slot * 5, 188, z + 22)], '#7392a2', 1.5);
    ellipse(ctx, iso(119, 189, z + 15), 3, 3, fault && load > 0.2 ? p.amber : p.teal);
    line(ctx, [iso(61, 188, z - 3), iso(130, 188, z - 3)], p.hardwareSide, 3);
  }
  for (let slot = 0; slot < 9; slot++) line(ctx, [iso(138, 121 + slot * 6, 21), iso(138, 121 + slot * 6, 119)], p.dark ? '#304c60' : '#9fb9c8', 2);
  // The load display is embedded in the rack, with a rising trace on its screen.
  polygon(ctx, [iso(61, 187, 137), iso(128, 187, 137), iso(128, 187, 113), iso(61, 187, 113)], p.screen);
  const trace: Point[] = [];
  for (let point = 0; point <= 14; point++) trace.push(iso(66 + point * 4, 188, 117 + load * point * 0.95 + Math.sin(point * 1.8 + time * 2) * 1.8));
  line(ctx, trace, load > 0.5 ? p.amber : p.teal, 2);
  if (identified > 0) {
    const start = iso(60, 187, 87);
    const end = iso(131, 187, 52);
    detection(ctx, start.x - 7, start.y - 10, end.x - start.x + 14, end.y - start.y + 20, p.amber, identified);
  }
}

export function eagleScene(ctx: CanvasRenderingContext2D, p: Palette, time: number) {
  const load = progress(time, 0.8, 7);
  const analytics = progress(time, 10, 12);
  const identified = progress(time, 13, 16);
  const acknowledgement = progress(time, 17, 21);
  // Cables precede the equipment, so routing reads as part of this room.
  route(ctx, [[133, 153, 2], [240, 153, 2], [240, 103, 2], [349, 103, 2]], p.blue, analytics * 0.8, time);
  rack(ctx, p, load, identified, time);
  gateway(ctx, p, analytics, time);

  // Job trays build up in front of the cabinet. Their topmost sheet lands with
  // a small overshoot, making congestion a physical event rather than a chart.
  box(ctx, 123, 217, 0, 78, 54, 17, p.hardwareTop, p.hardwareSide, p.hardware);
  box(ctx, 123, 217, 17, 5, 54, 8, p.hardwareTop, p.hardwareSide, p.hardware);
  box(ctx, 196, 217, 17, 5, 54, 8, p.hardwareTop, p.hardwareSide, p.hardware);
  const jobs = mix(1, 9, load);
  for (let index = 0; index < Math.ceil(jobs); index++) {
    const arrival = clamp(jobs - index);
    const landing = Math.sin(arrival * Math.PI) * 14 * (1 - arrival);
    ctx.save();
    ctx.globalAlpha = Math.min(1, arrival * 3);
    box(ctx, 131 + (index % 2) * 2, 225, 19 + index * 5 + landing, 58, 38, 3.5, p.dark ? '#cca66b' : '#f2d39e', p.dark ? '#8e703f' : '#d7b178', p.dark ? '#b08c55' : '#e3bf89');
    line(ctx, [iso(138, 236, 24 + index * 5 + landing), iso(172, 236, 24 + index * 5 + landing)], p.dark ? '#80623c' : '#c69c63', 1.6);
    ctx.restore();
  }
  if (time > 3 && time < 13) warning(ctx, iso(129, 188, 78), p.amber, time, load);
  if (analytics > 0 && identified < 1) {
    const scan = 27 + ((time - 10) * 31 % 105);
    ctx.save();
    ctx.globalAlpha = analytics * 0.55;
    polygon(ctx, [iso(58, 189, scan), iso(132, 189, scan), iso(132, 189, scan + 8), iso(58, 189, scan + 8)], p.blue);
    ctx.restore();
  }

  // An operator approaches a freestanding service console and acknowledges the
  // affected drawer. The warning and queued work remain visible at the end.
  box(ctx, 247, 145, 0, 13, 17, 61, p.hardwareTop, p.hardware, p.hardwareSide);
  box(ctx, 231, 143, 58, 58, 7, 39, p.hardwareTop, p.screen, p.hardwareSide);
  const consoleAt = iso(260, 151, 79);
  if (identified > 0) {
    ctx.save();
    ctx.globalAlpha = identified;
    for (let row = 0; row < 3; row++) {
      const z = 88 - row * 10;
      line(ctx, [iso(239, 152, z), iso(278, 152, z)], row === 1 ? p.amber : '#74a5b8', row === 1 ? 4 : 2);
    }
    ctx.restore();
  } else {
    line(ctx, [{ x: consoleAt.x - 12, y: consoleAt.y }, { x: consoleAt.x + 11, y: consoleAt.y }], '#74a5b8', 2);
  }
  const approach = progress(time, 16.5, 19.5);
  person(ctx, iso(mix(325, 271, approach), mix(252, 199, approach)), 0, approach < 1 && time > 16.5 ? time * 7 : 0, true, acknowledgement * 0.7);
  if (time > 2 && time < 10) label(ctx, 351, 84, 'Load climbs. Work backs up.', p.amber, p);
  else if (time >= 10 && time < 16) label(ctx, 351, 84, 'EA:GLE correlates the signals', p.blue, p);
  else if (time >= 16 && time < 20) label(ctx, 351, 84, 'Anomaly traced to this drawer', p.amber, p);
  else if (time >= 20) label(ctx, 351, 84, 'Operator knows where to look', p.teal, p);
  label(ctx, 362, 425, 'Queued work', p.amber, p);
}

function cloud(ctx: CanvasRenderingContext2D, p: Palette, at: Point, connected: boolean) {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.beginPath();
  ctx.moveTo(-43, 23);
  ctx.bezierCurveTo(-76, 23, -78, -13, -52, -22);
  ctx.bezierCurveTo(-53, -51, -13, -63, 5, -40);
  ctx.bezierCurveTo(32, -54, 56, -34, 53, -13);
  ctx.bezierCurveTo(80, -8, 74, 25, 48, 25);
  ctx.closePath();
  ctx.fillStyle = p.dark ? '#36576b' : '#f5fbfe';
  ctx.shadowColor = p.dark ? 'rgba(0,0,0,.16)' : 'rgba(47,84,104,.15)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 8;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  if (connected) {
    line(ctx, [{ x: -12, y: -9 }, { x: -3, y: 0 }, { x: 15, y: -19 }], p.teal, 4);
  } else {
    line(ctx, [{ x: -8, y: -18 }, { x: 8, y: -2 }], p.amber, 3.5);
    line(ctx, [{ x: 8, y: -18 }, { x: -8, y: -2 }], p.amber, 3.5);
  }
  ctx.restore();
}

function conveyor(ctx: CanvasRenderingContext2D, p: Palette, time: number) {
  [68, 204].forEach(x => [160, 208].forEach(y => box(ctx, x, y, 0, 7, 7, 35, p.hardwareTop, p.hardwareSide, p.hardwareSide)));
  box(ctx, 55, 151, 33, 175, 75, 14, p.hardwareTop, p.hardware, p.hardwareSide);
  box(ctx, 62, 157, 47, 160, 61, 3, p.dark ? '#29495d' : '#789aa9', p.hardwareSide, p.hardwareSide);
  for (let index = 0; index < 13; index++) {
    const x = 64 + (index * 13 + time * 19) % 154;
    line(ctx, [iso(x, 160, 51), iso(x, 215, 51)], p.dark ? '#416779' : '#a6c2cb', 3);
  }
  for (let index = 0; index < 2; index++) {
    const travel = (time * 0.1 + index * 0.5) % 1;
    const x = 67 + travel * 113;
    box(ctx, x, 168, 51, 31, 36, 26, '#dfc299', '#b79569', '#caa97e');
    line(ctx, [iso(x + 16, 170, 78), iso(x + 16, 201, 78)], '#f6e3c6', 4);
  }
  // The sensor gantry remains active throughout the WAN outage.
  [156, 221].forEach(y => box(ctx, 173, y, 47, 5, 5, 65, p.hardwareTop, p.hardwareSide, p.hardwareSide));
  box(ctx, 171, 154, 111, 9, 76, 7, p.hardwareTop, p.hardwareSide, p.hardware);
  box(ctx, 167, 183, 101, 17, 17, 10, p.hardwareTop, p.hardwareSide, p.hardware);
  ellipse(ctx, iso(177, 201, 105), 2.7, 2.7, p.teal);
  ctx.save();
  ctx.globalAlpha = 0.13;
  polygon(ctx, [iso(176, 192, 103), iso(161, 179, 52), iso(192, 209, 52)], p.teal);
  ctx.restore();
}

export function greengrassScene(ctx: CanvasRenderingContext2D, p: Palette, time: number) {
  const outage = progress(time, 1.1, 2);
  const processing = progress(time, 10, 12);
  const reconnect = progress(time, 17, 18.5);
  const synced = progress(time, 18.5, 22.5);
  const online = outage < 0.5 || reconnect > 0.5;
  const cloudAt = { x: 735, y: 98 };
  const gatewayAt = iso(364, 91, 80);
  const cable = [gatewayAt, { x: gatewayAt.x + 50, y: gatewayAt.y - 24 }, { x: 735, y: 168 }, { x: 735, y: 124 }];
  line(ctx, cable, online ? p.blue : p.hardwareSide, 2, online ? [] : [5, 7]);
  if (!online) {
    const gap = { x: 727, y: 184 };
    ellipse(ctx, gap, 10, 11, p.dark ? '#193247' : '#edf5f8');
    line(ctx, [{ x: 720, y: 177 }, { x: 734, y: 191 }], p.amber, 3);
    line(ctx, [{ x: 734, y: 177 }, { x: 720, y: 191 }], p.amber, 3);
  }
  cloud(ctx, p, cloudAt, online);
  label(ctx, 735, 146, online ? 'Cloud connected' : 'Cloud unavailable', online ? p.teal : p.amber, p);
  route(ctx, [[184, 200, 2], [278, 200, 2], [278, 109, 2], [349, 109, 2]], p.teal, 0.55 + processing * 0.3, time);
  conveyor(ctx, p, time);
  gateway(ctx, p, 1, time);

  // A real storage enclosure holds the illustrative sample trays. The stack
  // accumulates during loss of cloud access, then drains only after reconnect.
  box(ctx, 269, 178, 0, 66, 54, 31, p.hardwareTop, p.hardwareSide, p.hardware);
  box(ctx, 268, 177, 31, 68, 56, 6, p.hardwareTop, p.hardware, p.hardwareSide);
  for (let slot = 0; slot < 3; slot++) line(ctx, [iso(278, 233, 8 + slot * 7), iso(326, 233, 8 + slot * 7)], p.screen, 2.5);
  const samples = mix(0, 8, progress(time, 2, 10)) * (1 - synced);
  for (let index = 0; index < Math.ceil(samples); index++) {
    ctx.save();
    ctx.globalAlpha = clamp(samples - index);
    box(ctx, 278, 185, 38 + index * 5, 48, 36, 3, p.dark ? '#77b7cc' : '#c0e1ec', p.dark ? '#497f94' : '#79b4ca', p.dark ? '#5b99af' : '#95cbdc');
    ctx.restore();
  }
  if (time >= 2 && time < 17) {
    const phase = (time * 0.8) % 1;
    const from = iso(176, 194, 94);
    const to = iso(300, 204, 40 + samples * 5);
    const token = { x: mix(from.x, to.x, phase), y: mix(from.y, to.y, phase) - Math.sin(phase * Math.PI) * 34 };
    ctx.save();
    ctx.globalAlpha = Math.sin(phase * Math.PI);
    polygon(ctx, [{ x: token.x, y: token.y - 5 }, { x: token.x + 8, y: token.y }, { x: token.x, y: token.y + 5 }, { x: token.x - 8, y: token.y }], p.blue);
    ctx.restore();
  }
  if (reconnect > 0) {
    for (let index = 0; index < 4; index++) {
      const phase = (time * 0.45 + index / 4) % 1;
      const from = iso(300, 204, 83);
      const to = { x: cloudAt.x - 8, y: cloudAt.y + 16 };
      const token = { x: mix(from.x, to.x, phase), y: mix(from.y, to.y, phase) - Math.sin(phase * Math.PI) * 25 };
      ctx.save();
      ctx.globalAlpha = reconnect * (1 - synced * 0.8) * Math.sin(phase * Math.PI);
      ellipse(ctx, token, 4, 4, p.teal);
      ctx.restore();
    }
  }
  if (processing > 0) label(ctx, 365, 364, 'Local processing continues', p.teal, p);
  label(ctx, 581, 433, synced > 0.98 ? 'Buffer synchronized' : 'Samples kept locally', synced > 0.98 ? p.teal : p.blue, p);
  if (time > 2 && time < 10) label(ctx, 340, 92, 'Cloud link drops. Site carries on.', p.amber, p);
  else if (time >= 10 && time < 17) label(ctx, 340, 92, 'Greengrass works at the edge', p.blue, p);
  else if (time >= 17) label(ctx, 340, 92, 'Connection returns. Data catches up.', p.teal, p);
}

function radioPulse(ctx: CanvasRenderingContext2D, at: Point, color: string, time: number, opacity: number) {
  for (let index = 0; index < 2; index++) {
    const phase = (time * 0.7 + index * 0.5) % 1;
    ctx.save();
    ctx.globalAlpha = opacity * (1 - phase) * 0.45;
    ctx.beginPath();
    ctx.ellipse(at.x, at.y, 7 + phase * 23, 4 + phase * 12, 0, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

export function threadScene(ctx: CanvasRenderingContext2D, p: Palette, time: number) {
  const border = progress(time, 10, 12);
  const mesh = progress(time, 12, 16);
  const reachable = progress(time, 17, 19.5);
  const color = mesh > 0.7 ? p.teal : p.amber;
  // Door and thermostat are battery devices. A plugged-in lamp is the visible
  // neighboring router; the border router connects that mesh to the IP network.
  const thermostatAt = iso(72, 10, 76);
  box(ctx, 50, 5, 55, 46, 10, 39, p.hardwareTop, p.hardware, p.hardwareSide);
  polygon(ctx, [iso(57, 16, 86), iso(89, 16, 86), iso(89, 16, 65), iso(57, 16, 65)], p.screen);
  hardwareText(ctx, '21°', { x: thermostatAt.x + 1, y: thermostatAt.y - 1 }, '#c2ebeb');
  ellipse(ctx, iso(86, 17, 60), 2, 2, color);
  // Contact sensor is attached to the doorway, not a floating device icon.
  box(ctx, 365, 5, 65, 8, 7, 24, p.hardwareTop, p.hardware, p.hardwareSide);
  box(ctx, 352, 5, 66, 6, 7, 21, p.hardwareTop, p.hardware, p.hardwareSide);
  ellipse(ctx, iso(369, 13, 77), 2, 2, color);
  const opening = progress(time, 0.6, 2.8);
  // A slightly opened door reveals the event the contact sensor has to report.
  polygon(ctx, [iso(312, 3, 0), iso(369 - opening * 18, 3 + opening * 36, 0), iso(369 - opening * 18, 3 + opening * 36, 91), iso(312, 3, 91)], p.dark ? '#426074' : '#dae7ed');
  line(ctx, [iso(359 - opening * 15, 7 + opening * 30, 35), iso(359 - opening * 15, 7 + opening * 30, 46)], p.hardwareSide, 3);

  // The plug and desk lamp have grounded cords and hardware, making the mesh
  // routes visibly connect useful room objects rather than arbitrary nodes.
  box(ctx, 6, 161, 27, 9, 27, 35, p.hardwareTop, p.hardware, p.hardwareSide);
  const plugAt = iso(17, 176, 45);
  ellipse(ctx, plugAt, 5, 7, p.hardwareSide);
  line(ctx, [{ x: plugAt.x - 1, y: plugAt.y - 3 }, { x: plugAt.x - 1, y: plugAt.y + 3 }], p.screen, 1.5);
  line(ctx, [iso(17, 176, 35), iso(31, 180, 3), iso(178, 180, 3), iso(192, 148, 3)], p.hardwareSide, 2);
  [155, 213].forEach(x => [116, 154].forEach(y => box(ctx, x, y, 0, 5, 5, 42, p.hardwareTop, p.hardwareSide, p.hardwareSide)));
  box(ctx, 146, 107, 42, 84, 61, 7, p.hardwareTop, p.hardware, p.hardwareSide);
  const lampAt = iso(192, 139, 52);
  ellipse(ctx, lampAt, 17, 8, p.hardwareSide);
  line(ctx, [{ x: lampAt.x, y: lampAt.y - 3 }, { x: lampAt.x, y: lampAt.y - 50 }], p.hardwareSide, 5);
  polygon(ctx, [{ x: lampAt.x - 10, y: lampAt.y - 63 }, { x: lampAt.x + 10, y: lampAt.y - 63 }, { x: lampAt.x + 25, y: lampAt.y - 38 }, { x: lampAt.x - 25, y: lampAt.y - 38 }], p.dark ? '#527d8a' : '#aeced1');
  ellipse(ctx, { x: lampAt.x, y: lampAt.y - 38 }, 25, 7, '#f1dca3');
  ellipse(ctx, { x: lampAt.x + 11, y: lampAt.y - 1 }, 2.4, 2.4, mesh > 0.7 ? p.teal : p.blue);

  // Existing IP-side equipment waits for a bridge. A physical mini display
  // shows newly arriving sensor rows only after the border connection exists.
  box(ctx, 285, 33, 0, 52, 35, 62, p.hardwareTop, p.hardware, p.hardwareSide);
  box(ctx, 283, 31, 62, 56, 39, 5, p.hardwareTop, p.hardwareSide, p.hardwareSide);
  polygon(ctx, [iso(291, 69, 54), iso(331, 69, 54), iso(331, 69, 26), iso(291, 69, 26)], p.screen);
  for (let row = 0; row < 3; row++) line(ctx, [iso(297, 70, 47 - row * 7), iso(325, 70, 47 - row * 7)], reachable > row / 3 ? p.teal : '#547a8f', 2);
  if (border > 0) {
    ctx.save();
    ctx.globalAlpha = border;
    gateway(ctx, p, mesh, time);
    ctx.restore();
  }
  const routed = Math.min(1, mesh * 1.4);
  route(ctx, [[74, 18, 74], [136, 65, 54], [191, 139, 53]], p.teal, routed * 0.85, time);
  route(ctx, [[365, 16, 76], [279, 93, 53], [191, 139, 53]], p.teal, routed * 0.85, time + 0.7);
  route(ctx, [[19, 177, 43], [100, 159, 48], [191, 139, 53]], p.teal, routed * 0.85, time + 1.3);
  route(ctx, [[191, 139, 53], [276, 139, 51], [347, 104, 49]], p.teal, mesh * 0.95, time);
  route(ctx, [[350, 89, 49], [345, 60, 48], [327, 52, 40]], p.blue, reachable * 0.95, time);
  [thermostatAt, iso(369, 13, 80), plugAt].forEach((at, index) => radioPulse(ctx, at, color, time + index * 0.4, 1 - reachable * 0.7));
  if (time > 2 && time < 10) label(ctx, 371, 81, 'Room sensors cannot reach IP', p.amber, p);
  else if (time >= 10 && time < 17) label(ctx, 371, 81, 'A neighbor passes the message', p.teal, p);
  else if (time >= 17) label(ctx, 371, 81, 'Thread reaches the IP network', p.teal, p);
  label(ctx, 364, 390, 'Thread mesh', mesh > 0.7 ? p.teal : p.amber, p);
  if (border > 0.5) label(ctx, 659, 367, 'Border router', p.blue, p);
  label(ctx, 667, 198, 'IP network', reachable > 0.5 ? p.teal : p.muted, p);
}
