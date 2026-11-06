import type { ActorId, ActorPose, StoryPoint } from './OfferingStoryMotion';
import { PARTS } from './OfferingEquipment';
import { sampleSmart, SMART_TIMING, type SmartVariant } from './OfferingSmartStory';
import manifest from '../../assets/offerings/offerings-kit.manifest.json';

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => n * n * (3 - 2 * n);
const progress = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const mix = (a: StoryPoint, b: StoryPoint, p: number) => a.map((v, i) => v + (b[i] - v) * p) as StoryPoint;

/** Same normalization as useCinematicModel: center X/Z, floor Y, max extent. */
function installedPoint(id: string, local: StoryPoint): StoryPoint {
  const part = PARTS.find(p => p.id === id)!;
  const bounds = manifest.prefabs[part.model as keyof typeof manifest.prefabs];
  const scale = part.size / Math.max(...bounds.size), yaw = part.yaw ?? 0;
  const x = (local[0] - (bounds.min[0] + bounds.max[0]) / 2) * scale;
  const z = (local[2] - (bounds.min[2] + bounds.max[2]) / 2) * scale;
  return [part.at[0] + x * Math.cos(yaw) + z * Math.sin(yaw), part.at[1] + (local[1] - bounds.min[1]) * scale, part.at[2] - x * Math.sin(yaw) + z * Math.cos(yaw)];
}

export const SMART_POINTS = {
  console: installedPoint('it', [0, 1.269, .607]),
  consoleStand: [9.82, .04, -4.84] as StoryPoint,
  hvac: [-9.15, 1.3, -5.0] as StoryPoint,
  hvacReadout: [-7.98, 2.08, -5.04] as StoryPoint,
  trolley: [-9.36, .04, -4.81] as StoryPoint,
  cooler: [-1.35, 1.5, -6.8] as StoryPoint,
  coolerReadout: [-1.35, 2.96, -6.87] as StoryPoint,
  energy: [-10.6, 1.3, .55] as StoryPoint,
  energyDisplay: [-12.2, 1.45, .2] as StoryPoint,
  energyStand: [-9.5, .04, -.2] as StoryPoint,
  meter: installedPoint('meter', [0, .70, .216]),
} as const;

export function smartTrolleyPoint(time: number): StoryPoint {
  return [SMART_POINTS.trolley[0] - 2.2 * sampleSmart('hvac', time).hvac.obstructionProgress, .04, SMART_POINTS.trolley[2]];
}

/** The handle rotates around the actual exported CoolerLeftDoor pivot. */
export function smartCoolerHandle(time: number): StoryPoint {
  const angle = sampleSmart('cooler', time).cooler.doorAngle;
  const px = -.578, py = .26, pz = .45, dx = .513, dy = .82, dz = .06;
  return installedPoint('cooler', [px + dx * Math.cos(angle) + dz * Math.sin(angle), py + dy, pz - dx * Math.sin(angle) + dz * Math.cos(angle)]);
}

function basePose(at: StoryPoint, heading: number): ActorPose {
  return { at: [...at], heading, walk: 0, distance: 0, phase: 0, tap: 0, fall: 0, collapse: 0, kneel: 0, tablet: 0, phone: 0, carry: 0, receipt: 0, concern: 0, lookY: 0, visible: true };
}
type Stop = [time: number, x: number, z: number];
function walk(stops: Stop[], time: number, finalHeading: number): ActorPose {
  let distance = 0;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i], length = Math.hypot(b[1] - a[1], b[2] - a[2]);
    if (time > b[0]) { distance += length; continue; }
    const p = progress(time, a[0], b[0]), k = ease(p);
    const heading = length > .01 ? Math.atan2(b[1] - a[1], b[2] - a[2]) : finalHeading;
    const pose = basePose([a[1] + (b[1] - a[1]) * k, .04, a[2] + (b[2] - a[2]) * k], heading);
    // Clock units are three real seconds; bound the gait to metres/second.
    pose.walk = Math.min(1, length * 6 * p * (1 - p) / Math.max(.001, 3 * (b[0] - a[0])));
    pose.distance = distance + length * k;
    return pose;
  }
  const last = stops[stops.length - 1], pose = basePose([last[1], .04, last[2]], finalHeading);
  pose.distance = distance;
  return pose;
}

function actionStand(variant: SmartVariant, time: number): StoryPoint {
  if (variant === 'hvac') { const p = smartTrolleyPoint(time); return [p[0] + .9, .04, p[2] + .08]; }
  if (variant === 'cooler') { const p = smartCoolerHandle(time); return [p[0] + .27, .04, p[2] + .46]; }
  return [...SMART_POINTS.energyStand];
}

/** Root StoryMotion delegates Smart actors here. Type imports avoid a runtime cycle. */
export function sampleSmartActor(id: ActorId, variant: string, time: number): ActorPose {
  const state = sampleSmart(variant, time), t = state.time, v = state.variant;
  const pose = basePose([3.1, .04, 8.1], -.8);
  pose.visible = false;
  if (id === 'technician') {
    const consoleStand = SMART_POINTS.consoleStand, end = actionStand(v, 15.5);
    const destinationHeading = v === 'hvac' ? -Math.PI / 2 : Math.PI;
    const path: Stop[] = [[0, 9.2, -4.35], [5.5, 9.2, -4.35], [7, consoleStand[0], consoleStand[2]], [10.5, consoleStand[0], consoleStand[2]], [11, 8.6, -4.2], [14.5, end[0], -4.2], [15.5, end[0], end[2]]];
    const result = walk(path, t, t <= 10.5 ? 2.825 : destinationHeading);
    if (t >= 15.5) {
      result.at = actionStand(v, t);
      result.heading = destinationHeading;
      result.walk = v === 'energy' || t < 16 || t > 18 ? 0 : Math.sin(progress(t, 16, 18) * Math.PI) * .25;
      result.distance += v === 'hvac' ? 2.2 * state.hvac.obstructionProgress : v === 'cooler' ? .5 * state.verification.progress : 0;
    }
    result.tablet = state.operatorAtConsole || (v !== 'energy' && t >= 15.2 && t < 18.4) ? 0 : 1;
    result.tap = v === 'energy' && t >= 15.5 && t < 17.3 ? .25 : 0;
    result.lookY = state.operatorAtConsole ? 0 : -.12;
    return result;
  }
  if (id === 'shopper' && v === 'cooler') {
    const handle = smartCoolerHandle(Math.min(t, 3));
    const standing: StoryPoint = [handle[0] + .27, .04, handle[2] + .46];
    if (t <= 3.5) return { ...basePose(standing, Math.PI), lookY: -.12 };
    return walk([[3.5, standing[0], standing[2]], [5.8, 1.6, -4.2], [9, 5.5, .5], [12, 5.5, 5.8]], t, .3);
  }
  return pose;
}

export interface SmartContact { side: 'Right' | 'Left'; at: StoryPoint; weight: number; grip: 'touch' | 'handle'; }
/** Reach targets are on the exterior hardware, not the device's center. */
export function sampleSmartContact(id: ActorId, variant: string, time: number): SmartContact | null {
  const state = sampleSmart(variant, time), t = state.time;
  if (id === 'technician' && state.operatorAtConsole) return { side: 'Right', at: [SMART_POINTS.console[0] - .18, SMART_POINTS.console[1] - .08, SMART_POINTS.console[2] + .005], weight: ease(progress(t, 7.3, 8)) * (1 - ease(progress(t, 9.8, 10.4))), grip: 'touch' };
  if (state.variant === 'cooler' && (id === 'shopper' && t < 3.5 || id === 'technician' && t >= 15.5 && t < 18.5)) {
    const weight = id === 'shopper' ? ease(progress(t, .4, 1)) * (1 - ease(progress(t, 3, 3.5))) : ease(progress(t, 15.5, 16)) * (1 - ease(progress(t, 18, 18.5)));
    return { side: 'Right', at: smartCoolerHandle(t), weight, grip: 'handle' };
  }
  if (id === 'technician' && state.variant === 'hvac' && t >= 15.5 && t < 18.5) {
    const p = smartTrolleyPoint(t);
    return { side: 'Right', at: [p[0] + .59, 1.08, p[2] + .18], weight: ease(progress(t, 15.5, 16)) * (1 - ease(progress(t, 18, 18.5))), grip: 'handle' };
  }
  return null;
}

export interface SmartCameraShot { target: StoryPoint; distance: number; yaw: number; pitch: number; }
function blendShot(a: SmartCameraShot, b: SmartCameraShot, amount: number): SmartCameraShot {
  const p = ease(clamp(amount));
  return { target: mix(a.target, b.target, p), distance: a.distance + (b.distance - a.distance) * p, yaw: a.yaw + Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) * p, pitch: a.pitch + (b.pitch - a.pitch) * p };
}
export function sampleSmartCamera(variant: string, time: number): SmartCameraShot {
  const s = sampleSmart(variant, time), t = s.time;
  const target = [...SMART_POINTS[s.variant]] as StoryPoint;
  const actor = sampleSmartActor('technician', variant, t);
  const equipment: SmartCameraShot = { target, distance: s.variant === 'energy' ? 7.1 : s.variant === 'cooler' ? 5.4 : 5.0, yaw: -.55, pitch: .24 };
  const console: SmartCameraShot = { target: [...SMART_POINTS.console], distance: 1.55, yaw: .15, pitch: .08 };
  const following: SmartCameraShot = { target: [actor.at[0], 1.2, actor.at[2]], distance: 5.8, yaw: -.6, pitch: .25 };
  const action: SmartCameraShot = { target: mix(target, [actor.at[0], 1.1, actor.at[2]], .25), distance: s.variant === 'energy' ? 6.9 : 4.5, yaw: s.variant === 'cooler' ? -.55 : .45, pitch: .24 };
  const verification: SmartCameraShot = s.variant === 'energy' ? console : { target: s.variant === 'hvac' ? mix(SMART_POINTS.hvac, SMART_POINTS.hvacReadout, .3) : [-1.35, 2.2, -6.8], distance: s.variant === 'hvac' ? 3.8 : 3.5, yaw: -.35, pitch: .12 };
  if (t < 5.4) return equipment;
  if (t < 6.4) return blendShot(equipment, console, progress(t, 5.4, 6.4));
  if (t < 10.3) return console;
  if (t < 11.2) return blendShot(console, following, progress(t, 10.3, 11.2));
  if (t < 14.7) return following;
  if (t < 15.5) return blendShot(following, action, progress(t, 14.7, 15.5));
  if (t < 20.3) return action;
  if (t < 21.3) return blendShot(action, verification, progress(t, 20.3, 21.3));
  return verification;
}

export { SMART_TIMING };
