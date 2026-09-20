import {
  box, clamp, contactShadow, desk, ellipse, gateway, iso, label, line, mix,
  pos, progress, route, type Palette, type Point,
} from './scenePrimitives';

/** A small articulated actor. Reaching changes the elbow and wrist, not the whole body. */
function operator(
  ctx: CanvasRenderingContext2D, base: Point, time: number, reach: number,
  waiting: number, walking: number, technician = false,
) {
  const stride = Math.sin(time * 7) * walking * 9;
  const toe = Math.max(0, Math.sin(time * 4)) * waiting * 3;
  const breath = Math.sin(time * 2) * 0.6;
  const shirt = technician ? '#3c9587' : '#ba7956';
  const light = technician ? '#65bbaa' : '#d79c76';
  const shade = technician ? '#287b72' : '#955a43';
  contactShadow(ctx, base, 23, 8, 0.18);
  ctx.save();
  ctx.translate(base.x, base.y);
  line(ctx, [{ x: 8, y: -46 }, { x: 9 - stride * 0.7, y: -23 }, { x: 9 - stride, y: -4 }], '#28465a', 12);
  line(ctx, [{ x: 8 - stride, y: -3 }, { x: 19 - stride, y: -3 }], '#1b3344', 8);
  line(ctx, [{ x: -7, y: -45 }, { x: -10 + stride * 0.6, y: -22 }, { x: -11 + stride, y: -4 - toe }], '#38596c', 12);
  line(ctx, [{ x: -17 + stride, y: -3 - toe }, { x: -7 + stride, y: -3 }], '#213d50', 8);
  ctx.translate(-reach * 2, breath);
  // A hand on the hip and a tapping toe make the hold-up understandable without a caption.
  line(ctx, [{ x: 11, y: -76 }, { x: 23 + waiting * 5, y: -59 }, { x: 14, y: -44 - waiting * 5 }], shade, 10);
  ellipse(ctx, { x: 14, y: -43 - waiting * 5 }, 4.5, 5.5, '#cf9771');
  ctx.beginPath();
  ctx.moveTo(-13, -82); ctx.quadraticCurveTo(0, -87, 12, -80);
  ctx.quadraticCurveTo(17, -66, 11, -44); ctx.lineTo(-12, -44);
  ctx.quadraticCurveTo(-16, -65, -13, -82);
  ctx.fillStyle = shirt; ctx.fill();
  line(ctx, [{ x: -11, y: -79 }, { x: -10, y: -50 }], light, 4);
  const elbow = { x: mix(-20, -29, reach), y: mix(-60, -57, reach) };
  const hand = { x: mix(-18, technician ? -35 : -54, reach), y: mix(-43, technician ? -85 : -91, reach) };
  line(ctx, [{ x: -12, y: -76 }, elbow, hand], light, 10);
  ellipse(ctx, hand, 4.5, 5.2, '#dfa985');
  line(ctx, [{ x: -1, y: -83 }, { x: -1, y: -89 }], '#c9926e', 8);
  ctx.save();
  ctx.translate(-2, -99);
  ctx.rotate(-reach * 0.12 + waiting * Math.sin(time * 0.7) * 0.06);
  ellipse(ctx, { x: 0, y: 0 }, 11, 13, '#dfac88');
  ctx.beginPath(); ctx.ellipse(1, -3, 11, 10, 0.1, Math.PI, Math.PI * 2.13);
  ctx.fillStyle = '#3a454a'; ctx.fill();
  ellipse(ctx, { x: -9.7, y: 3 }, 2.8, 3.2, '#dfac88');
  ellipse(ctx, { x: -6, y: 0 }, 1.2, 1.3, '#293b43');
  line(ctx, [{ x: -8, y: 6 }, { x: -3, y: 6 + waiting * 1.4 }], '#915b49', 1.2);
  if (technician) {
    ctx.beginPath(); ctx.ellipse(0, -6, 12, 10, 0, Math.PI, Math.PI * 2);
    ctx.fillStyle = '#eacb73'; ctx.fill();
    line(ctx, [{ x: -14, y: -6 }, { x: 13, y: -6 }], '#d1ad52', 3);
  }
  ctx.restore();
  if (technician) {
    line(ctx, [{ x: 6, y: -74 }, { x: 6, y: -50 }], '#d6eae3', 2);
    ctx.fillStyle = '#e6efe8'; ctx.fillRect(1, -71, 7, 9);
  } else {
    ctx.save(); ctx.translate(hand.x - 3, hand.y - 5); ctx.rotate(-0.18 + reach * 0.1);
    ctx.fillStyle = '#f4de9d'; ctx.beginPath(); ctx.roundRect(-10, -6, 21, 14, 3); ctx.fill();
    ctx.fillStyle = '#b38a3d'; ctx.fillRect(-6, -2, 5, 4);
    line(ctx, [{ x: 3, y: 3 }, { x: 7, y: 3 }], '#aa8240', 1);
    ctx.restore();
  }
  ctx.restore();
}

function networkCable(ctx: CanvasRenderingContext2D, p: Palette, time: number) {
  const split = progress(time, 2.6, 3.5);
  const joint = iso(203, 106, 3);
  const a = { x: joint.x - split * 18, y: joint.y - split * 1 };
  const b = { x: joint.x + split * 18, y: joint.y + split * 10 };
  const color = split > 0.9 ? p.red : p.blue;
  line(ctx, [iso(8, 77, 3), iso(95, 77, 3), iso(95, 106, 3), a], p.hardwareSide, 6);
  line(ctx, [b, iso(332, 106, 3), iso(346, 106, 41)], p.hardwareSide, 6);
  line(ctx, [iso(8, 77, 4), iso(95, 77, 4), iso(95, 106, 4), a], color, 2.4);
  line(ctx, [b, iso(332, 106, 4), iso(346, 106, 41)], split ? p.muted : p.blue, 2.4);
  // Two chunky RJ45 ends actually pull apart, with exposed contacts facing the gap.
  [a, b].forEach((plug, index) => {
    ctx.save(); ctx.translate(plug.x, plug.y); ctx.rotate(0.38 + (index ? Math.PI : 0));
    ctx.fillStyle = p.hardwareTop; ctx.beginPath(); ctx.roundRect(-17, -7, 19, 14, 3); ctx.fill();
    ctx.fillStyle = p.hardwareSide; ctx.fillRect(-17, -5, 5, 10);
    if (index) {
      for (let i = 0; i < 3; i++) line(ctx, [{ x: 0, y: -4 + i * 4 }, { x: 5, y: -4 + i * 4 }], '#d0aa58', 1.6);
    } else {
      ctx.fillStyle = p.screen; ctx.fillRect(-2, -5, 4, 10);
    }
    ctx.restore();
  });
  if (time > 2.8 && time < 4.4) {
    const flash = Math.sin(clamp((time - 2.8) / 1.6) * Math.PI);
    ctx.save(); ctx.globalAlpha = flash;
    [-1, 1].forEach(side => {
      line(ctx, [{ x: joint.x + side * 9, y: joint.y - 14 }, { x: joint.x + side * 15, y: joint.y - 24 }], p.amber, 2.5);
    });
    ctx.restore();
  }
}

function cellularAntenna(ctx: CanvasRenderingContext2D, p: Palette, opacity: number, time: number) {
  if (!opacity) return;
  ctx.save(); ctx.globalAlpha = opacity;
  const top = iso(276, 7, 119);
  line(ctx, [iso(276, 7, 9), top], p.hardwareSide, 5);
  box(ctx, 267, 1, 75, 18, 13, 34, p.hardwareTop, p.hardware, p.hardwareSide);
  line(ctx, [{ x: top.x, y: top.y + 2 }, { x: top.x, y: top.y - 12 }], p.ink, 3);
  for (let i = 0; i < 3; i++) {
    const pulse = (time * 0.65 + i / 3) % 1;
    ctx.globalAlpha = opacity * (1 - pulse) * 0.7;
    [-1, 1].forEach(side => {
      ctx.beginPath();
      ctx.arc(top.x, top.y - 5, 11 + pulse * 27, side > 0 ? -0.8 : Math.PI - 0.8, side > 0 ? 0.8 : Math.PI + 0.8);
      ctx.strokeStyle = p.blue; ctx.lineWidth = 2; ctx.stroke();
    });
  }
  ctx.restore();
}

function receipt(ctx: CanvasRenderingContext2D, p: Palette, amount: number, time: number) {
  const base = iso(185, 187, 71);
  const height = amount * 40;
  if (height <= 0) return;
  ctx.save(); ctx.translate(base.x, base.y); ctx.rotate(-0.08);
  ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(-8, -height);
  for (let x = -8; x < 9; x += 4) { ctx.lineTo(x + 2, -height - 2); ctx.lineTo(x + 4, -height); }
  ctx.lineTo(10, 0); ctx.closePath(); ctx.fillStyle = '#f7faf7'; ctx.fill();
  for (let n = 0; n < 4; n++) {
    if (height > 12 + n * 6) line(ctx, [{ x: -4, y: -8 - n * 6 }, { x: n % 2 ? 3 : 6, y: -8 - n * 6 }], p.muted, 1.2);
  }
  if (time > 19) line(ctx, [{ x: -3, y: -height + 9 }, { x: 0, y: -height + 12 }, { x: 5, y: -height + 6 }], p.teal, 1.5);
  ctx.restore();
}

export function connectivityScene(ctx: CanvasRenderingContext2D, p: Palette, time: number) {
  const solution = progress(time, 10, 11.8);
  const failed = time >= 3;
  const recovered = progress(time, 16.6, 17.2);
  const relay = progress(time, 12.2, 15);
  const arrival = progress(time, 0, 1.8);
  const reach = progress(time, 1.5, 2.6) * (1 - progress(time, 5, 6))
    + progress(time, 16.4, 17.5) * (1 - progress(time, 19, 20));
  const leave = progress(time, 21, 23.5);
  networkCable(ctx, p, time);
  route(ctx, [[188, 197, 3], [260, 197, 3], [260, 126, 3], [357, 126, 3], [357, 114, 46]], recovered ? p.teal : p.blue, failed && !recovered ? 0.2 : 0.68, time, !failed || recovered > 0);
  desk(ctx, p);
  gateway(ctx, p, solution, time);
  cellularAntenna(ctx, p, solution, time);
  route(ctx, [[276, 13, 96], [322, 28, 86], [356, 91, 77]], p.teal, relay * 0.75, time);
  pos(ctx, p, !failed || recovered > 0.8);
  // A shopping bag anchors the counter in a checkout story.
  box(ctx, 109, 176, 60, 21, 18, 29, '#d7bf90', '#b9996c', '#c9ab7e');
  const bagTop = iso(117, 181, 89);
  ctx.beginPath(); ctx.arc(bagTop.x, bagTop.y + 1, 6, Math.PI, Math.PI * 2);
  ctx.strokeStyle = '#8d724e'; ctx.lineWidth = 2; ctx.stroke();
  const counterScreen = iso(153, 173, 91);
  if (failed && recovered < 0.5) {
    ctx.save(); ctx.translate(counterScreen.x, counterScreen.y);
    ctx.beginPath(); ctx.arc(0, 0, 10, -Math.PI / 2, Math.PI * 1.5);
    ctx.strokeStyle = '#e3bc83'; ctx.lineWidth = 2; ctx.stroke();
    line(ctx, [{ x: 0, y: -5 }, { x: 0, y: 0 }, { x: 4, y: 2 }], '#e3bc83', 1.5);
    ctx.restore();
  }
  const actor = iso(mix(284, 244, arrival) + leave * 91, mix(258, 180, arrival) + leave * 28);
  operator(ctx, actor, time, reach, progress(time, 4, 5) * (1 - recovered), arrival < 1 ? 1 : leave > 0 && leave < 1 ? 1 : 0);
  receipt(ctx, p, progress(time, 17.6, 19.3), time);

  // Customer's tiny thought clock reinforces the delay without claiming a duration.
  if (time > 6 && time < 10) {
    const clock = { x: actor.x + 33, y: actor.y - 113 };
    ellipse(ctx, clock, 14, 14, p.white);
    line(ctx, [{ x: clock.x, y: clock.y - 7 }, clock, { x: clock.x + 6, y: clock.y + 3 }], p.amber, 2);
    ellipse(ctx, { x: clock.x - 12, y: clock.y + 16 }, 3, 3, p.white);
  }
  if (time >= 3.6 && time < 10.5) label(ctx, 525, 181, 'Payment waiting', p.amber, p);
  else if (time >= 11 && time < 17) label(ctx, 607, 109, 'Trying cellular', p.blue, p);
  else if (time >= 17) label(ctx, 493, 173, 'Checkout resumes', p.teal, p);
  if (time >= 4 && time < 16.5) label(ctx, 587, 345, 'Primary link down', p.red, p);
}

/** Integral of smoothstep: fan angle stays continuous during speed changes and scrubbing. */
function integratedRamp(time: number, start: number, end: number) {
  const duration = end - start;
  const u = clamp((time - start) / duration);
  return duration * (u ** 3 - u ** 4 / 2) + Math.max(0, time - end);
}

function stressedHvac(ctx: CanvasRenderingContext2D, p: Palette, time: number, strain: number, settled: number) {
  const shake = Math.sin(time * 31) * strain * 1.45;
  const fanAngle = 3 * time + 8 * integratedRamp(time, 1.4, 3.8) - 8.7 * integratedRamp(time, 19.4, 22);
  contactShadow(ctx, iso(83, 207), 47, 20);
  ctx.save(); ctx.translate(shake, Math.cos(time * 26) * strain * 0.65);
  box(ctx, 27, 141, 0, 84, 88, 104, p.hardwareTop, p.hardware, p.hardwareSide);
  box(ctx, 22, 137, 103, 94, 95, 7, p.hardwareTop, p.hardwareSide, p.hardwareSide);
  const fan = iso(69, 230, 66);
  ellipse(ctx, fan, 27, 29, p.dark ? '#1d3648' : '#90afbf');
  ellipse(ctx, fan, 23, 25, '#2e5064');
  ctx.save(); ctx.translate(fan.x, fan.y); ctx.rotate(fanAngle);
  for (let i = 0; i < 5; i++) {
    ctx.rotate(Math.PI * 2 / 5);
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-14, -2, -22, -18, -6, -21);
    ctx.bezierCurveTo(7, -20, 11, -5, 0, 0);
    ctx.fillStyle = p.dark ? '#8ba7b6' : '#bfd2db'; ctx.fill();
  }
  ctx.restore();
  ellipse(ctx, fan, 5, 5, p.hardwareTop);
  [-12, 0, 12].forEach(x => line(ctx, [{ x: fan.x + x, y: fan.y - 21 }, { x: fan.x + x, y: fan.y + 21 }], '#638395', 1));
  for (let i = 0; i < 4; i++) line(ctx, [iso(41, 230, 17 + i * 5), iso(94, 230, 17 + i * 5)], p.hardwareSide, 2);
  ellipse(ctx, iso(99, 230, 90), 3, 3, strain > 0.6 ? p.red : settled ? p.teal : p.blue);
  ctx.restore();

  // Heat rises off the casing; the cooling flow below is a separate physical stream.
  if (strain > 0) {
    ctx.save();
    for (let i = 0; i < 5; i++) {
      const rise = (time * 0.42 + i * 0.17) % 1;
      const origin = iso(39 + i * 14, 173, 111);
      ctx.globalAlpha = strain * Math.sin(rise * Math.PI) * 0.55;
      ctx.beginPath(); ctx.moveTo(origin.x, origin.y - rise * 38);
      ctx.bezierCurveTo(origin.x - 8, origin.y - rise * 38 - 10, origin.x + 9, origin.y - rise * 38 - 20, origin.x, origin.y - rise * 38 - 31);
      ctx.strokeStyle = p.amber; ctx.lineWidth = 3; ctx.stroke();
    }
    ctx.restore();
    if (strain > 0.6) {
      ctx.save(); ctx.globalAlpha = strain * 0.5;
      [-1, 1].forEach(side => {
        const x = fan.x + side * 34;
        ctx.beginPath(); ctx.moveTo(x, fan.y - 22);
        ctx.quadraticCurveTo(x + side * (5 + Math.sin(time * 8)), fan.y, x, fan.y + 20);
        ctx.strokeStyle = p.amber; ctx.lineWidth = 2; ctx.stroke();
      });
      ctx.restore();
    }
  }
}

function energyMeter(ctx: CanvasRenderingContext2D, p: Palette, strain: number, settled: number) {
  const center = iso(153, 175, 62);
  box(ctx, 143, 166, 0, 20, 17, 14, p.hardwareTop, p.hardware, p.hardwareSide);
  line(ctx, [iso(153, 175, 14), iso(153, 175, 58)], p.hardwareSide, 5);
  ctx.save(); ctx.translate(center.x, center.y);
  ctx.fillStyle = p.hardwareSide; ctx.beginPath(); ctx.roundRect(-25, -29, 50, 59, 6); ctx.fill();
  ctx.fillStyle = p.hardwareTop; ctx.beginPath(); ctx.roundRect(-23, -31, 45, 57, 5); ctx.fill();
  ctx.fillStyle = p.screen; ctx.beginPath(); ctx.roundRect(-18, -24, 35, 30, 3); ctx.fill();
  // A real needle gauge lives on the equipment meter, rather than an overlaid dashboard.
  ctx.beginPath(); ctx.arc(0, -5, 12, Math.PI, Math.PI * 2); ctx.strokeStyle = '#79a391'; ctx.lineWidth = 3; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -5, 12, Math.PI * 1.73, Math.PI * 2); ctx.strokeStyle = p.red; ctx.lineWidth = 3; ctx.stroke();
  const needle = Math.PI + mix(0.35, 0.91, strain) * Math.PI;
  line(ctx, [{ x: 0, y: -5 }, { x: Math.cos(needle) * 10, y: -5 + Math.sin(needle) * 10 }], '#e7f2f2', 1.6);
  ellipse(ctx, { x: 0, y: -5 }, 2, 2, '#e7f2f2');
  ctx.font = '600 7px Inter, ui-sans-serif, system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = p.ink;
  ctx.fillText('LOAD', 0, 16);
  ellipse(ctx, { x: 0, y: 22 }, 5, 5, '#486b80');
  line(ctx, [{ x: 0, y: 22 }, { x: Math.sin(settled * 2) * 3.5, y: 22 - Math.cos(settled * 2) * 3.5 }], '#d8e9ef', 1.4);
  ctx.restore();
}

export function energyScene(ctx: CanvasRenderingContext2D, p: Palette, time: number) {
  const solution = progress(time, 10, 11.5);
  const settled = progress(time, 19.4, 22);
  const strain = progress(time, 1.4, 3.8) * (1 - settled);
  // Enter at the door, use the aisle beside the gateway, then turn onto open floor.
  const throughAisle = progress(time, 17, 17.75);
  const towardMeter = progress(time, 17.75, 18.9);
  const technicianY = mix(10, 146, throughAisle) + 60 * towardMeter;
  const drawTechnician = () => {
    if (time < 17) return;
    const base = iso(mix(324, 321, throughAisle) - 99 * towardMeter, technicianY);
    const reach = progress(time, 18.9, 19.4) * (1 - progress(time, 21.3, 22));
    operator(ctx, base, time, reach, 0, towardMeter < 1 ? 1 : 0, true);
  };
  route(ctx, [[106, 197, 3], [154, 197, 3], [154, 174, 3]], p.hardwareSide, 0.6, time, false);
  route(ctx, [[120, 186, 57], [151, 186, 57], [151, 141, 3], [302, 141, 3], [352, 110, 43]], settled > 0.8 ? p.teal : p.blue, solution * 0.65, time);
  // Preserve depth at the door; the gateway naturally occludes the person behind it.
  if (technicianY < 123) drawTechnician();
  desk(ctx, p);
  gateway(ctx, p, solution, time);
  stressedHvac(ctx, p, time, strain, settled);
  energyMeter(ctx, p, strain, settled);
  if (solution > 0) {
    ctx.save(); ctx.globalAlpha = solution;
    box(ctx, 112, 178, 55, 12, 19, 24, p.hardwareTop, p.dark ? '#457985' : '#95c0c8', p.dark ? '#386777' : '#6a9fae');
    ellipse(ctx, iso(125, 189, 67), 3, 3, settled > 0.8 ? p.teal : p.blue);
    ctx.restore();
  }
  if (technicianY >= 123) drawTechnician();
  box(ctx, 230, 246, 0, 68, 38, 3, p.hardwareTop, p.hardwareSide, p.hardwareSide);
  for (let i = 0; i < 7; i++) line(ctx, [iso(237 + i * 8, 250, 4), iso(237 + i * 8, 280, 4)], p.hardwareSide, 2);
  if (settled > 0) {
    ctx.save();
    for (let i = 0; i < 4; i++) {
      const drift = (time * 0.48 + i * 0.19) % 1;
      const vent = iso(242 + i * 14, 266, 8);
      ctx.globalAlpha = settled * Math.sin(drift * Math.PI) * 0.55;
      ctx.beginPath(); ctx.moveTo(vent.x, vent.y - drift * 17);
      ctx.bezierCurveTo(vent.x - 12, vent.y - drift * 17 - 16, vent.x + 9, vent.y - drift * 17 - 31, vent.x, vent.y - drift * 17 - 46);
      ctx.strokeStyle = p.blue; ctx.lineWidth = 2.5; ctx.stroke();
    }
    ctx.restore();
  }
  if (time >= 3.5 && time < 10.5) label(ctx, 291, 113, 'Running too hard', p.amber, p);
  else if (time >= 11 && time < 17) label(ctx, 291, 113, 'Load anomaly detected', p.blue, p);
  else if (time >= 17 && time < 18.9) label(ctx, 291, 113, 'Technician on site', p.blue, p);
  else if (time >= 18.9 && time < 22) label(ctx, 291, 113, 'Adjusting the setpoint', p.blue, p);
  else if (time >= 22) label(ctx, 291, 113, 'Back to a steady rhythm', p.teal, p);
}
