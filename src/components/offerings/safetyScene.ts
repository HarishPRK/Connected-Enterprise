import {
  camera, clamp, contactShadow, desk, detection, ellipse, gateway, iso, label,
  line, mix, polygon, progress, scenePresentation, smooth, type Palette, type Point,
} from './scenePrimitives';

/** Screen-space joint poses make contact, balance and weight readable at small sizes. */
interface Pose {
  hip: Point;
  chest: Point;
  head: Point;
  nearElbow: Point;
  nearHand: Point;
  farElbow: Point;
  farHand: Point;
  nearKnee: Point;
  nearFoot: Point;
  farKnee: Point;
  farFoot: Point;
  headAngle: number;
  nearShoe: number;
  farShoe: number;
}

const pt = (x: number, y: number): Point => ({ x, y });
// The leading sole meets the peel exactly at the end of the approach.
const walkPhase = (time: number) => time * 7.2 + Math.PI * 4.5 - 1.8 * 7.2;
const jointNames = ['hip', 'chest', 'head', 'nearElbow', 'nearHand', 'farElbow', 'farHand', 'nearKnee', 'nearFoot', 'farKnee', 'farFoot'] as const;

function blendPose(a: Pose, b: Pose, t: number): Pose {
  const result = { ...a };
  for (const joint of jointNames) result[joint] = pt(mix(a[joint].x, b[joint].x, t), mix(a[joint].y, b[joint].y, t));
  result.headAngle = mix(a.headAngle, b.headAngle, t);
  result.nearShoe = mix(a.nearShoe, b.nearShoe, t);
  result.farShoe = mix(a.farShoe, b.farShoe, t);
  return result;
}

function walkPose(phase: number): Pose {
  const swing = Math.sin(phase);
  const bob = Math.cos(phase * 2) * 1.3;
  const nearLift = Math.max(0, Math.cos(phase)) * 7;
  const farLift = Math.max(0, -Math.cos(phase)) * 7;
  return {
    hip: pt(0, -58 + bob), chest: pt(2, -94 + bob), head: pt(5, -113 + bob),
    nearKnee: pt(6 + swing * 10, -29 - nearLift), nearFoot: pt(5 + swing * 17, -3 - nearLift),
    farKnee: pt(-5 - swing * 10, -29 - farLift), farFoot: pt(-5 - swing * 17, -4 - farLift),
    nearElbow: pt(-8 - swing * 8, -73 + bob), nearHand: pt(4 - swing * 11, -53 + bob),
    farElbow: pt(16 + swing * 9, -77 + bob), farHand: pt(15 + swing * 13, -57 + bob),
    headAngle: 0.02, nearShoe: -nearLift * 0.016, farShoe: -farLift * 0.016,
  };
}

// Each beat changes a different support/contact relationship. There is no
// whole-character rotation: the planted ankle, skid, knees and hands all move independently.
const fallBeats: Array<{ at: number; pose: Pose }> = [
  { at: 1.8, pose: walkPose(walkPhase(1.8)) },
  { at: 2.12, pose: {
    hip: pt(2, -55), chest: pt(-7, -90), head: pt(-4, -109),
    nearElbow: pt(14, -93), nearHand: pt(29, -112), farElbow: pt(-26, -78), farHand: pt(-37, -60),
    nearKnee: pt(29, -35), nearFoot: pt(50, -7), farKnee: pt(-13, -31), farFoot: pt(-20, -3),
    headAngle: -0.18, nearShoe: -0.32, farShoe: 0,
  } },
  { at: 2.43, pose: {
    hip: pt(-2, -53), chest: pt(-19, -85), head: pt(-19, -106),
    nearElbow: pt(-5, -112), nearHand: pt(18, -128), farElbow: pt(-40, -80), farHand: pt(-51, -102),
    nearKnee: pt(31, -43), nearFoot: pt(59, -21), farKnee: pt(-8, -23), farFoot: pt(-21, -3),
    headAngle: -0.34, nearShoe: -0.48, farShoe: -0.03,
  } },
  { at: 2.7, pose: {
    hip: pt(-5, -45), chest: pt(-25, -75), head: pt(-34, -94),
    nearElbow: pt(-20, -103), nearHand: pt(-43, -119), farElbow: pt(-43, -52), farHand: pt(-65, -66),
    nearKnee: pt(25, -53), nearFoot: pt(51, -34), farKnee: pt(9, -23), farFoot: pt(4, -3),
    headAngle: -0.5, nearShoe: -0.56, farShoe: -0.18,
  } },
  { at: 2.99, pose: {
    hip: pt(-3, -32), chest: pt(-30, -55), head: pt(-44, -71),
    nearElbow: pt(-35, -31), nearHand: pt(-48, -9), farElbow: pt(-43, -69), farHand: pt(-63, -48),
    nearKnee: pt(25, -48), nearFoot: pt(49, -31), farKnee: pt(19, -15), farFoot: pt(45, -7),
    headAngle: -0.68, nearShoe: -0.49, farShoe: -0.1,
  } },
  { at: 3.23, pose: {
    hip: pt(0, -9), chest: pt(-31, -28), head: pt(-47, -42),
    nearElbow: pt(-43, -14), nearHand: pt(-53, 0), farElbow: pt(-15, -11), farHand: pt(6, -18),
    nearKnee: pt(26, -24), nearFoot: pt(53, -3), farKnee: pt(22, -5), farFoot: pt(53, 1),
    headAngle: -0.65, nearShoe: 0.02, farShoe: 0.02,
  } },
  { at: 3.43, pose: {
    hip: pt(0, -15), chest: pt(-27, -38), head: pt(-37, -55),
    nearElbow: pt(-42, -18), nearHand: pt(-53, 0), farElbow: pt(-7, -22), farHand: pt(14, -21),
    nearKnee: pt(29, -32), nearFoot: pt(54, -3), farKnee: pt(25, -8), farFoot: pt(54, 1),
    headAngle: -0.44, nearShoe: 0, farShoe: 0,
  } },
  { at: 3.85, pose: {
    hip: pt(0, -11), chest: pt(-29, -32), head: pt(-41, -49),
    nearElbow: pt(-43, -16), nearHand: pt(-54, 0), farElbow: pt(-7, -28), farHand: pt(16, -24),
    nearKnee: pt(30, -28), nearFoot: pt(56, -3), farKnee: pt(25, -7), farFoot: pt(55, 1),
    headAngle: -0.43, nearShoe: 0, farShoe: 0,
  } },
];

function incidentPose(time: number) {
  if (time <= 1.8) return walkPose(walkPhase(time));
  for (let n = 1; n < fallBeats.length; n++) {
    if (time < fallBeats[n].at) {
      const a = fallBeats[n - 1];
      const b = fallBeats[n];
      const t = clamp((time - a.at) / (b.at - a.at));
      // Gravity accelerates the descent; the other beats ease through deliberate poses.
      const eased = n === 4 ? t * t : smooth(t);
      return blendPose(a.pose, b.pose, eased);
    }
  }
  const pose = { ...fallBeats[fallBeats.length - 1].pose };
  const breath = Math.sin(time * 2.6) * 0.55;
  pose.chest = pt(pose.chest.x, pose.chest.y + breath);
  pose.head = pt(pose.head.x, pose.head.y + breath);
  return pose;
}

function shoe(ctx: CanvasRenderingContext2D, foot: Point, angle: number, far: boolean, reverse = false) {
  ctx.save();
  ctx.translate(foot.x, foot.y);
  ctx.rotate(angle);
  if (reverse) ctx.scale(-1, 1);
  ctx.beginPath();
  ctx.moveTo(-6, -3);
  ctx.lineTo(3, -3);
  ctx.quadraticCurveTo(8, -1, 13, 0);
  ctx.quadraticCurveTo(17, 2, 14, 5);
  ctx.lineTo(-6, 5);
  ctx.closePath();
  ctx.fillStyle = far ? '#243746' : '#2b4354';
  ctx.fill();
  line(ctx, [pt(-5, 5), pt(13, 5)], far ? '#81929a' : '#bdcbd0', 1.8);
  ctx.restore();
}

/** A small character rig: shaded limbs, rounded clothing, a separately posed head and face. */
function character(ctx: CanvasRenderingContext2D, base: Point, pose: Pose, time: number, responder = false, relief = false) {
  ctx.save();
  ctx.translate(base.x, base.y);
  const shirt = responder ? '#299b89' : '#3c86b5';
  const light = responder ? '#64bda9' : '#77b1d5';
  const shade = responder ? '#217c73' : '#2b658b';
  const skin = '#dfaa83';
  const skinShade = '#c58d6d';
  const dx = pose.chest.x - pose.hip.x;
  const dy = pose.chest.y - pose.hip.y;
  const length = Math.hypot(dx, dy);
  const normal = pt(-dy / length, dx / length);
  const offset = (point: Point, amount: number) => pt(point.x + normal.x * amount, point.y + normal.y * amount);
  const nearShoulder = offset(pose.chest, -10);
  const farShoulder = offset(pose.chest, 9);
  const nearHip = offset(pose.hip, -5);
  const farHip = offset(pose.hip, 5);

  line(ctx, [farHip, pose.farKnee, pose.farFoot], '#2a4559', 11);
  shoe(ctx, pose.farFoot, pose.farShoe, true, responder && time < 19.4);
  line(ctx, [farShoulder, pose.farElbow, pose.farHand], shade, 10);
  ellipse(ctx, pose.farHand, 4.5, 5, skinShade);
  line(ctx, [nearHip, pose.nearKnee, pose.nearFoot], '#3b5c72', 12);
  line(ctx, [pt(nearHip.x - 2, nearHip.y), pt(pose.nearKnee.x - 2, pose.nearKnee.y)], '#527187', 2.2);
  shoe(ctx, pose.nearFoot, pose.nearShoe, false, responder);

  const a = offset(pose.chest, -12);
  const b = offset(pose.chest, 12);
  const c = offset(pose.hip, 10);
  const d = offset(pose.hip, -10);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.quadraticCurveTo(pose.chest.x + dx * 0.15, pose.chest.y + dy * 0.15, b.x, b.y);
  ctx.quadraticCurveTo(b.x + dx * -0.45 + 2, b.y + dy * -0.45, c.x, c.y);
  ctx.quadraticCurveTo(pose.hip.x - dx * 0.12, pose.hip.y - dy * 0.12, d.x, d.y);
  ctx.quadraticCurveTo(a.x + dx * -0.5 - 2, a.y + dy * -0.5, a.x, a.y);
  ctx.fillStyle = shirt;
  ctx.fill();
  line(ctx, [offset(pose.chest, -8), offset(pose.hip, -7)], light, 4);
  line(ctx, [offset(pose.chest, 2), offset(pose.hip, 2)], shade, 1.2);
  line(ctx, [nearShoulder, pose.nearElbow, pose.nearHand], light, 10.5);
  ellipse(ctx, pose.nearHand, 4.7, 5.1, skin);

  // The head follows its own anticipation and recovery, rather than rotating with a torso.
  line(ctx, [pose.chest, pt(pose.head.x, pose.head.y + 8)], skinShade, 8);
  ctx.save();
  ctx.translate(pose.head.x, pose.head.y);
  ctx.rotate(pose.headAngle);
  if (responder) ctx.scale(-1, 1);
  ellipse(ctx, pt(0, 0), 10.5, 12.4, skin);
  ellipse(ctx, pt(-8.5, 1), 3, 4, skinShade);
  ctx.beginPath();
  ctx.moveTo(-10, -1);
  ctx.bezierCurveTo(-15, -14, -4, -17, 4, -13);
  ctx.bezierCurveTo(13, -13, 12, -8, 10, -5);
  ctx.bezierCurveTo(5, -7, 4, -9, 0, -7);
  ctx.lineTo(-5, -5);
  ctx.lineTo(-7, 3);
  ctx.closePath();
  ctx.fillStyle = responder ? '#4d4037' : '#3b4d58';
  ctx.fill();
  ellipse(ctx, pt(10, 2.5), 2.6, 2.3, skin);
  const surprised = !responder && time > 1.86 && time < 3.55;
  const blink = time % 4.2 > 3.98;
  if (blink && !surprised) line(ctx, [pt(4, 0), pt(7, 0)], '#34444b', 1.3);
  else ellipse(ctx, pt(6, 0), 1.1, surprised ? 2.1 : 1.4, '#34444b');
  line(ctx, [pt(3.5, surprised ? -5.5 : -4), pt(7.5, surprised ? -6.8 : -3.8)], '#455056', 1.2);
  if (surprised) ellipse(ctx, pt(7, 6.8), 1.7, 2.5, '#845744');
  else {
    ctx.beginPath();
    ctx.moveTo(3.5, 7);
    ctx.quadraticCurveTo(6, relief || responder ? 9 : 5.5, 8.5, 6.5);
    ctx.strokeStyle = '#976748';
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }
  ctx.restore();
  if (responder) {
    const badge = pt(pose.chest.x + 4, pose.chest.y + 12);
    line(ctx, [pt(badge.x - 3, badge.y), pt(badge.x + 3, badge.y)], '#e4faf0', 2.5);
    line(ctx, [pt(badge.x, badge.y - 3), pt(badge.x, badge.y + 3)], '#e4faf0', 2.5);
  }
  ctx.restore();
}

function bananaPeel(ctx: CanvasRenderingContext2D, time: number) {
  const skid = progress(time, 1.94, 2.8);
  const x = 443 + progress(time, 1.8, 2.12) * 29 + progress(time, 2.12, 2.43) * 12 + progress(time, 2.43, 2.8) * 7;
  const y = 354 + skid * 8;
  contactShadow(ctx, pt(x, y), 14, 3, 0.12);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(skid * 0.65);
  ctx.beginPath();
  ctx.moveTo(-2, -6);
  ctx.bezierCurveTo(-6, -8, -10, -3, -17, -2);
  ctx.quadraticCurveTo(-15, 4, -3, 1);
  ctx.quadraticCurveTo(-4, 9, 9, 7);
  ctx.quadraticCurveTo(3, 5, 3, -1);
  ctx.quadraticCurveTo(13, 4, 18, -4);
  ctx.quadraticCurveTo(7, -1, 1, -8);
  ctx.closePath();
  ctx.fillStyle = '#f2c64d';
  ctx.fill();
  ctx.strokeStyle = '#b48a31';
  ctx.lineWidth = 1;
  ctx.stroke();
  line(ctx, [pt(-1, -8), pt(0, -13), pt(3, -14)], '#99743d', 2.5);
  line(ctx, [pt(-1, -4), pt(-8, -1)], '#ffe79c', 1.5);
  line(ctx, [pt(1, -3), pt(8, 1)], '#ffe79c', 1.5);
  ctx.restore();
}

function loosePaper(ctx: CanvasRenderingContext2D, x: number, y: number, rotation: number, folder = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.fillStyle = folder ? '#c59861' : '#f9faf2';
  ctx.beginPath();
  ctx.roundRect(-8, -12, 17, 23, 1.5);
  ctx.fill();
  if (folder) {
    ctx.fillStyle = '#e3c08c';
    ctx.fillRect(-7, -12, 8, 3);
  } else {
    line(ctx, [pt(-4, -5), pt(5, -5)], '#a5b8bd', 1);
    line(ctx, [pt(-4, -1), pt(5, -1)], '#b5c5c7', 1);
    line(ctx, [pt(-4, 3), pt(1, 3)], '#b5c5c7', 1);
  }
  ctx.restore();
}

function droppedFolder(ctx: CanvasRenderingContext2D, time: number, actor: Point, pose: Pose) {
  if (time < 2.1) {
    loosePaper(ctx, actor.x + pose.nearHand.x + 3, actor.y + pose.nearHand.y + 10, 0.13, true);
    return;
  }
  const release = 2.1;
  for (let n = 0; n < 3; n++) {
    const flight = clamp((time - release) / (1.1 + n * 0.13));
    const x = mix(459, 508 + n * 13, flight);
    const y = mix(260, 371 + n * 5, flight) - Math.sin(flight * Math.PI) * (48 + n * 8);
    const rotation = mix(-0.45, 1.1 + n * 1.1, flight) + Math.sin(flight * Math.PI * 3) * 0.2;
    if (flight === 1) contactShadow(ctx, pt(x, y + 7), 12, 3, 0.07);
    loosePaper(ctx, x, y, rotation, n === 0);
  }
}

function responderPose(time: number): Pose {
  const walking = walkPose((time - 17) * 8.3);
  // Mirror each joint to face the person. Kneeling has two independent supports:
  // one flat foot and the opposite knee, followed by a hand reaching the shoulder.
  for (const joint of jointNames) walking[joint] = pt(-walking[joint].x, walking[joint].y);
  walking.headAngle *= -1;
  const kneeling: Pose = {
    hip: pt(3, -24), chest: pt(-20, -52), head: pt(-31, -70),
    nearElbow: pt(-42, -48), nearHand: pt(-59, -30), farElbow: pt(-12, -27), farHand: pt(-22, -13),
    nearKnee: pt(-21, -24), nearFoot: pt(-31, -3), farKnee: pt(24, -4), farFoot: pt(46, -4),
    headAngle: -0.28, nearShoe: 0, farShoe: -0.05,
  };
  const pose = blendPose(walking, kneeling, progress(time, 19.25, 20.3));
  if (time >= 20.3) {
    const check = Math.sin((time - 20.3) * 2) * 0.8;
    pose.head = pt(pose.head.x - check, pose.head.y + check);
    pose.nearHand = pt(pose.nearHand.x, pose.nearHand.y + check * 0.35);
  }
  return pose;
}

export function safetyScene(ctx: CanvasRenderingContext2D, p: Palette, time: number) {
  const solution = progress(time, 10, 11.5);
  const alarm = progress(time, 12, 13.2);
  const assistance = progress(time, 19.5, 20.5);
  const actor = pt(mix(335, 426, progress(time, 0, 1.8)) + progress(time, 1.8, 3.23) * 5, 351);
  const pose = incidentPose(time);
  // Follow the clear aisle beside the cabinet, then turn toward the person.
  // Sort against the furniture's floor depth so the approach cannot walk over it.
  const approach = progress(time, 17, 19.45);
  const aisle = clamp(approach / 0.6);
  const turn = clamp((approach - 0.6) / 0.4);
  const door = iso(325, 12);
  const corner = iso(320, 145);
  const helper = approach < 0.6
    ? pt(mix(door.x, corner.x, aisle), mix(door.y, corner.y, aisle))
    : pt(mix(corner.x, 474, turn), mix(corner.y, 350, turn));
  const helperWorldY = approach < 0.6 ? mix(12, 145, aisle) : mix(145, 180, turn);
  const drawHelper = () => {
    if (time < 17) return;
    contactShadow(ctx, helper, mix(23, 44, progress(time, 19.3, 20.3)), 7, 0.16);
    character(ctx, helper, responderPose(time), time, true, true);
  };

  if (helperWorldY < 123) drawHelper();
  desk(ctx, p);
  gateway(ctx, p, solution, time);
  if (solution > 0) {
    ctx.save();
    ctx.globalAlpha = solution * 0.07;
    const lens = iso(51, 38, 99);
    polygon(ctx, [lens, pt(356, 383), pt(536, 366)], p.blue);
    ctx.globalAlpha = solution * 0.3;
    line(ctx, [lens, pt(356, 383), pt(536, 366), lens], p.blue, 1);
    ctx.restore();
    // In the unified store the shared conduit is drawn by the store renderer.
    if (scenePresentation(ctx)?.routes !== false) {
      const routePoints = [pt(493, 355), iso(245, 212, 2), iso(327, 212, 2), iso(327, 109, 2), iso(352, 109, 2)];
      ctx.save();
      ctx.globalAlpha = alarm * 0.75;
      line(ctx, routePoints, assistance > 0.5 ? p.teal : p.blue, 2);
      for (let n = 0; n < 2; n++) {
        const t = (time * 0.65 + n * 0.5) % 1;
        const segment = Math.min(3, Math.floor(t * 4));
        const start = routePoints[segment];
        const end = routePoints[segment + 1];
        ellipse(ctx, pt(mix(start.x, end.x, (t * 4) % 1), mix(start.y, end.y, (t * 4) % 1)), 3.2, 3.2, assistance > 0.5 ? p.teal : p.blue);
      }
      ctx.restore();
    }
  }

  bananaPeel(ctx, time);
  const landing = progress(time, 2.8, 3.25);
  const airborne = Math.sin(progress(time, 2.45, 3.23) * Math.PI);
  contactShadow(ctx, pt(actor.x + 4, actor.y + 2), 22 + landing * 40, 6 + landing * 2, 0.18 - airborne * 0.08);
  if (time > 3.22 && time < 3.75) {
    const impact = (time - 3.22) / 0.53;
    ctx.save();
    ctx.globalAlpha = (1 - impact) * 0.22;
    ctx.beginPath();
    ctx.ellipse(actor.x + 4, actor.y + 2, 24 + impact * 39, 6 + impact * 8, 0, 0, Math.PI * 2);
    ctx.strokeStyle = p.muted;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }
  character(ctx, actor, pose, time, false, assistance > 0.6);
  droppedFolder(ctx, time, actor, pose);

  if (helperWorldY >= 123) drawHelper();
  camera(ctx, p, solution);
  detection(ctx, actor.x - 66, actor.y - 72, 146, 87, assistance > 0.5 ? p.teal : p.blue, solution * (1 - progress(time, 19.4, 20.7)));

  if (time >= 3.85 && time < 10.6) label(ctx, 414, 427, 'A fall goes unnoticed', p.amber, p);
  else if (time >= 10.6 && time < 13.2) label(ctx, 414, 427, 'Fall detected locally', p.blue, p);
  else if (time >= 13.2 && time < 20.3) label(ctx, 414, 427, 'Response team alerted', p.blue, p);
  else if (time >= 20.3) label(ctx, 414, 427, 'Someone is there to help', p.teal, p);
  if (alarm > 0 && time < 17) label(ctx, 665, 405, 'Alert delivered', p.blue, p);
}
