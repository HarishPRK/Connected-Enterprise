import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, Group, SkinnedMesh, Vector3 } from 'three';
import { loadGeometryGlb } from './loadGeometryGlb.ts';
import { prepareActor, setRig } from '../../src/components/offerings/OfferingSkinnedActor.ts';
import { poseSmartContact } from '../../src/components/offerings/OfferingSmartContact.ts';
import { sampleSmartActor, sampleSmartContact, smartTrolleyPoint, sampleSmartCamera } from '../../src/components/offerings/OfferingSmartMotion.ts';
import { sampleSmart } from '../../src/components/offerings/OfferingSmartStory.ts';

const cast = loadGeometryGlb(new URL('../../src/assets/offerings/enterprise-actors.studio.glb', import.meta.url));
const kit = loadGeometryGlb(new URL('../../src/assets/offerings/offerings-kit.glb', import.meta.url));

test('the skinned hand stays outside the cooler glazing and packing carton throughout reach and release', async () => {
  const castScene = (await cast).scene;
  const cooler = (await kit).scene.getObjectByName('Cooler')!.clone(true), bounds = new Box3().setFromObject(cooler), center = bounds.getCenter(new Vector3()), scale = 3.05 / Math.max(...bounds.getSize(new Vector3()).toArray());
  cooler.position.sub(new Vector3(center.x, bounds.min.y, center.z));
  const mounted = new Group(); mounted.add(cooler); mounted.scale.setScalar(scale); mounted.position.set(-1.35, .03, -7.6);
  const door = mounted.getObjectByName('CoolerLeftDoor')!;
  for (const scenario of [
    { variant: 'hvac', role: 'Technician', id: 'technician', start: 15.5, frames: 60 },
    { variant: 'cooler', role: 'Technician', id: 'technician', start: 15.5, frames: 60 },
    { variant: 'cooler', role: 'Customer', id: 'shopper', start: .4, frames: 62 },
  ] as const) {
    const { variant, role, id, start, frames } = scenario;
    const actor = prepareActor(castScene.getObjectByName(role)!, role, id);
    const skins: SkinnedMesh[] = []; actor.object.traverse(node => { if (node instanceof SkinnedMesh) skins.push(node); });
    const vertices = skins.map(mesh => {
      const ids: number[] = [];
      for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
        let weight = 0;
        for (let j = 0; j < 4; j++) {
          const bone = mesh.skeleton.bones[mesh.geometry.attributes.skinIndex.getComponent(i, j)];
          if (/Right(?:Hand|Thumb|Index|Middle|Ring|Little)/.test(bone.name)) weight += mesh.geometry.attributes.skinWeight.getComponent(i, j);
        }
        if (weight > .5) ids.push(i);
      }
      return { mesh, ids };
    });
    let panelPenetrations = 0, handlePenetrations = 0, maxPadError = 0, worst = '';
    for (let step = 0; step <= frames; step++) {
      const time = start + step / 20, pose = sampleSmartActor(id, variant, time);
      setRig(actor.joints, pose, time); actor.object.position.fromArray(pose.at); actor.object.rotation.y = pose.heading;
      poseSmartContact(actor.joints, id, variant, time); actor.object.updateMatrixWorld(true);
      door.rotation.y = sampleSmart('cooler', time).cooler.doorAngle; mounted.updateMatrixWorld(true);
      const trolley = smartTrolleyPoint(time), contact = sampleSmartContact(id, variant, time);
      if (contact?.weight === 1) {
        const thumb = actor.joints.RightThumbPad!.object.getWorldPosition(new Vector3()), index = actor.joints.RightIndexPad!.object.getWorldPosition(new Vector3());
        for(const pad of [thumb,index])maxPadError = Math.max(maxPadError, Math.abs(Math.hypot(pad.x-contact.at[0],pad.z-contact.at[2])-(variant==='cooler'?.018*scale:.026)));
      }
      for (const { mesh, ids } of vertices) {
        mesh.skeleton.update();
        for (const i of ids) {
          const world = mesh.localToWorld(mesh.getVertexPosition(i, new Vector3()));
          const local = variant === 'cooler' ? door.worldToLocal(world.clone()) : world.clone().sub(new Vector3(...trolley));
          const insidePanel = variant === 'cooler'
            ? local.x > -.02 && local.x < .576 && local.y > .0 && local.y < 1.56 && local.z < .022 && local.z > -.08
            : Math.abs(local.x) < .51 && local.y > .295 && local.y < 1.645 && Math.abs(local.z) < .17;
          if (insidePanel) { panelPenetrations++; worst = `${variant} ${time.toFixed(2)} ${mesh.name} vertex${i} ${local.toArray()}`; }
          const handleDistance = variant === 'cooler' ? Math.hypot(local.x - .513, local.z - .06) : Math.hypot(local.x - .59, local.z - .18);
          const withinHandle = variant === 'cooler' ? local.y > .65 && local.y < 1 : local.y > .93 && local.y < 1.15;
          if (withinHandle && handleDistance < (variant === 'cooler' ? .017 : .025)) handlePenetrations++;
        }
      }
    }
    assert.equal(panelPenetrations, 0, worst);
    assert.equal(handlePenetrations, 0, `${variant} fingers penetrate the solid grip`);
    assert(maxPadError < .004, `${variant} opposed pads miss the handle by ${maxPadError}m`);
  }
});

test('Smart camera transitions have no abrupt target, radius or orbit changes', () => {
  for (const variant of ['hvac', 'cooler', 'energy']) {
    for (const boundary of [5.4, 6.4, 10.3, 11.2, 14.7, 15.5, 20.3, 21.3]) {
      const before = sampleSmartCamera(variant, boundary - .0001), after = sampleSmartCamera(variant, boundary + .0001);
      assert(new Vector3(...before.target).distanceTo(new Vector3(...after.target)) < .005);
      assert(Math.abs(before.distance - after.distance) < .005);
      assert(Math.abs(before.yaw - after.yaw) < .005);
      assert(Math.abs(before.pitch - after.pitch) < .005);
    }
  }
});
