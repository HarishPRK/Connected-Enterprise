import assert from 'node:assert/strict';
import test from 'node:test';
import { DoubleSide, Matrix4, Mesh, PerspectiveCamera, Raycaster, SkinnedMesh, Vector3 } from 'three';
import { loadGeometryGlb } from './loadGeometryGlb.ts';
import { prepareActor, setRig } from '../../src/components/offerings/OfferingSkinnedActor.ts';
import { poseRoutingContact } from '../../src/components/offerings/OfferingRoutingContact.ts';
import { sampleActor, sampleStoryCamera, type StoryContext } from '../../src/components/offerings/OfferingStoryMotion.ts';
import { portraitStoryCamera } from '../../src/components/offerings/offeringPortraitCamera.ts';
import { SERVICE_CART } from '../../src/components/offerings/OfferingEquipment.ts';

function cameraAt(context: StoryContext, time: number, aspect: number, previousAngle = false) {
  const authored = sampleStoryCamera(context, time);
  const shot = portraitStoryCamera(context, time, aspect, previousAngle ? { ...authored, yaw: -.8 } : authored);
  const distance = shot.distance * Math.max(1, .65 / Math.max(aspect, .4));
  const azimuth = .586 + shot.yaw;
  const eye = new Vector3(...shot.target).addScaledVector(new Vector3(Math.sin(azimuth) * Math.cos(shot.pitch), Math.sin(shot.pitch), Math.cos(azimuth) * Math.cos(shot.pitch)), distance);
  const camera = new PerspectiveCamera(40, aspect, .1, 250);
  camera.position.copy(eye); camera.lookAt(...shot.target); camera.updateMatrixWorld();
  return { eye, camera };
}

// Actual physical screen coordinates, including its authored tilt and the
// installed laptop scale. Check the whole screen, not only its centre ray.
const screenPoints = [-.95, 0, .95].flatMap(x => [-.95, 0, .95].map(y =>
  new Vector3(x * .55, y * .325, 0).applyMatrix4(new Matrix4().makeRotationX(-.13))
    .add(new Vector3(0, .490972, -.321563)).multiplyScalar(SERVICE_CART.laptopWidth / 1.23)
    .add(new Vector3(SERVICE_CART.at[0], SERVICE_CART.top, SERVICE_CART.at[2]))));

test('routing patchboard stays visible past the actual operator skin and clothes at wide and narrow aspects', async () => {
  const cast = await loadGeometryGlb(new URL('../../src/assets/offerings/enterprise-actors.studio.glb', import.meta.url));
  const actor = prepareActor(cast.scene.getObjectByName('Technician')!, 'Technician', 'technician');
  // Routing hides the unused carried case, exactly as OfferingStoryEffects does.
  if (actor.joints.BagMount) actor.joints.BagMount.object.visible = false;
  const meshes: Mesh[] = [];
  actor.object.traverse(node => {
    if (!(node instanceof Mesh)) return;
    // Double-sided triangles also detect a lens accidentally placed inside a shirt.
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.side = DoubleSide;
    meshes.push(node);
  });
  const ray = new Raycaster();
  const blocked = (eye: Vector3, point: Vector3) => {
    ray.set(eye, point.clone().sub(eye).normalize());
    ray.near = .001; ray.far = eye.distanceTo(point) - .005;
    const hits = ray.intersectObjects(meshes.filter(mesh => {
      for (let node: Mesh['parent'] = mesh; node; node = node.parent) if (!node.visible) return false;
      return true;
    }), false);
    return hits.length > 0;
  };
  let previousShotWasBlocked = false;
  for (const variant of ['teams', 'archive', 'voice']) {
    const context: StoryContext = { offering: 'routing', variant };
    for (const time of [6, 6.5, 9.8, 11, 12, 13.9, 20.7, 22, 24]) {
      const pose = sampleActor('technician', context, time);
      setRig(actor.joints, pose, time); actor.object.position.fromArray(pose.at); actor.object.rotation.y = pose.heading;
      poseRoutingContact(actor.joints, 'technician', variant, time); actor.object.updateMatrixWorld(true);
      for (const mesh of meshes) if (mesh instanceof SkinnedMesh) { mesh.skeleton.update(); mesh.computeBoundingSphere(); mesh.computeBoundingBox(); }
      // Scene aspect ratios, excluding the separate caption below the phone canvas.
      for (const aspect of [.85, 1, 1.39, 1.45, 1.6, 2]) {
        const { eye, camera } = cameraAt(context, time, aspect);
        for (const point of screenPoints) {
          assert(!blocked(eye, point), `${variant}@${time}, aspect ${aspect}: operator blocks patchboard`);
          const projected = point.clone().project(camera);
          assert(Math.abs(projected.x) < .99 && Math.abs(projected.y) < .99 && projected.z < 1,
            `${variant}@${time}, aspect ${aspect}: patchboard cropped`);
        }
      }
      if (variant === 'teams' && time === 9.8) {
        previousShotWasBlocked = screenPoints.some(point => blocked(cameraAt(context, time, 1.6, true).eye, point));
      }
    }
  }
  assert(previousShotWasBlocked, 'regression fixture must detect the released shoulder-obstruction shot');
});
