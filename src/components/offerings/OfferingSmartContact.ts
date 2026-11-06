import { Matrix4, Quaternion, Vector3 } from 'three';
import { PHALANGES, posePointGrip } from './OfferingFingerGrip';
import { reachWrist, type Rig } from './OfferingSkinnedActor';
import { sampleSmartContact } from './OfferingSmartMotion';
import { sampleSmart } from './OfferingSmartStory';
import type { ActorId } from './OfferingStoryMotion';
import manifest from '../../assets/offerings/enterprise-actors.studio.manifest.json';

const consoleOrientation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, -1, 0)));
const coolerOrientation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(0, 1, 0)));
const trolleyOrientation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3(-1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 1, 0)));
const indexTip = new Vector3(-.006194313812256, -.1304613158226, .033532121133807);
const handleCenter = new Vector3(-.028, -.095, .0397264789044857);

function frame(direction: Vector3, normal: Vector3) {
  const x = direction.clone().normalize(), y = normal.clone().addScaledVector(x, -normal.dot(x)).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, x.clone().cross(y)));
}

function poseHandleGrip(rig: Rig, weight: number, radius: number, center: Vector3) {
  const chains = manifest.roles.Technician.hands.Right.chains;
  for (const digit of ['Thumb', 'Index'] as const) {
    const chain = chains[digit].map(point => new Vector3(...point));
    const pad = manifest.roles.Technician.hands.Right.pads[digit];
    // The index first meets the near tangent; it curls around only as the
    // wrist reaches its working position. A fixed far-side target would ask
    // the finger to pass through the bar while its chain is still out of reach.
    const approachAngle = Math.min(100, Math.max(0, (handleCenter.y - center.y) * 2500));
    const angle = (digit === 'Thumb' ? 110 : -45 + approachAngle) * Math.PI / 180;
    const normal = new Vector3(-Math.cos(angle), -Math.sin(angle), 0);
    const tangent = digit === 'Thumb' ? new Vector3(-Math.sin(angle), Math.cos(angle), 0) : new Vector3(Math.sin(angle), -Math.cos(angle), 0);
    const tipQ = frame(tangent, normal).multiply(frame(chain[3].clone().sub(chain[2]), new Vector3(...pad.normal)).invert());
    const targetPad = new Vector3(center.x + (radius + .001) * Math.cos(angle), center.y + (radius + .001) * Math.sin(angle), pad.handLocal[2]);
    const end = targetPad.sub(new Vector3(...pad.handLocal).sub(chain[2]).applyQuaternion(tipQ));
    const ray = end.clone().sub(chain[0]), distance = ray.length(), l1 = chain[1].distanceTo(chain[0]), l2 = chain[2].distanceTo(chain[1]); ray.normalize();
    const along = Math.max(-l1, Math.min(l1, (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance)));
    const pole = digit === 'Index' ? new Vector3(1, 0, 0) : chain[1].clone().sub(chain[0]); pole.addScaledVector(ray, -pole.dot(ray)).normalize();
    const elbow = chain[0].clone().addScaledVector(ray, along).addScaledVector(pole, Math.sqrt(Math.max(0, l1 * l1 - along * along)));
    const absolute = [new Quaternion().setFromUnitVectors(chain[1].clone().sub(chain[0]).normalize(), elbow.clone().sub(chain[0]).normalize()), new Quaternion().setFromUnitVectors(chain[2].clone().sub(chain[1]).normalize(), end.clone().sub(elbow).normalize()), tipQ];
    PHALANGES.forEach((phalanx, index) => {
      const rotation = index ? absolute[index - 1].clone().invert().multiply(absolute[index]) : absolute[index];
      rig[`Right${digit}${phalanx}`]?.object.quaternion.slerp(rotation, weight);
    });
  }
  for (const digit of ['Middle', 'Ring', 'Little'] as const) {
    const chain = chains[digit].map(point => new Vector3(...point));
    const joints = [chain[0].clone()];
    const clearanceRadius = radius + .012;
    for (let link = 1; link < 4; link++) {
      const previous = joints[link - 1], dx = previous.x - center.x, dy = previous.y - center.y;
      const r0 = Math.hypot(dx, dy), r1 = Math.max(clearanceRadius, link === 1 ? r0 : 0);
      const length = chain[link].distanceTo(chain[link - 1]), dz = chain[link].z - chain[link - 1].z;
      const planar = Math.sqrt(Math.max(.000001, length * length - dz * dz));
      const delta = Math.acos(Math.max(-1, Math.min(1, (r0 * r0 + r1 * r1 - planar * planar) / (2 * r0 * r1))));
      const angle = Math.atan2(dy, dx) - delta;
      joints.push(new Vector3(center.x + r1 * Math.cos(angle), center.y + r1 * Math.sin(angle), chain[link].z));
    }
    const absolute = PHALANGES.map((_, index) => new Quaternion().setFromUnitVectors(chain[index + 1].clone().sub(chain[index]).normalize(), joints[index + 1].clone().sub(joints[index]).normalize()));
    PHALANGES.forEach((phalanx, index) => {
      const rotation = index ? absolute[index - 1].clone().invert().multiply(absolute[index]) : absolute[index];
      rig[`Right${digit}${phalanx}`]?.object.quaternion.slerp(rotation, weight);
    });
  }
}

/** Targets are defined at the skinned fingertip or opposed pads. Translate
 * the anatomical wrist to that point, keeping the palm outside solid hardware. */
export function poseSmartContact(rig: Rig, id: ActorId, variant: string, time: number) {
  const contact = sampleSmartContact(id, variant, time);
  if (!contact || contact.weight <= 0) return;
  const touch = contact.grip === 'touch';
  const doorRotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), sampleSmart('cooler', time).cooler.doorAngle);
  const orientation = touch ? consoleOrientation : variant === 'cooler' ? doorRotation.clone().multiply(coolerOrientation) : trolleyOrientation;
  const radius = variant === 'cooler' ? .018 * 3.05 / 2 : .026;
  const localPoint = touch ? indexTip : handleCenter;
  const wrist = new Vector3(...contact.at).sub(localPoint.clone().applyQuaternion(orientation));
  // Approach from the front/outer side before closing the fingers. Rewinding
  // follows the same exterior path instead of dragging a hand through a panel.
  const closing = Math.max(0, Math.min(1, contact.weight * 2 - 1));
  const normal = !touch && variant === 'cooler' ? new Vector3(0, 0, 1).applyQuaternion(doorRotation) : new Vector3(0, 0, 1);
  wrist.addScaledVector(normal, (variant === 'cooler' && !touch ? .3 : .12) * (1 - closing));
  wrist.y += .06 * (1 - closing);
  reachWrist(rig, Math.min(1, contact.weight * 2), contact.side, wrist, orientation);
  if (touch) posePointGrip(rig, contact.side, contact.weight);
  else {
    const hand = rig.RightHand?.object;
    if (hand) { hand.updateWorldMatrix(true, true); poseHandleGrip(rig, Math.min(1, contact.weight * 2), radius, hand.worldToLocal(new Vector3(...contact.at))); }
  }
}
