import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Box3, BoxGeometry, BufferGeometry, DataTexture, Group, Mesh, MeshStandardMaterial, Vector3, type Material, type Object3D } from 'three';
import { batchGatewayAssemblies } from '../../src/components/offerings/OfferingModelBatch.ts';
import { GATEWAY_EXPLODE } from '../../src/components/offerings/OfferingEquipment.ts';
import { loadGeometryGlb } from './loadGeometryGlb.ts';

function materialKey(material: Material) {
  const value: Partial<ReturnType<Material['toJSON']>> = material.toJSON({ textures: {}, images: {}, geometries: {}, materials: {}, shapes: {}, skeletons: {}, animations: {}, nodes: {} });
  delete value.uuid; delete value.name; delete value.metadata;
  return JSON.stringify(value);
}

function measure(model: Object3D) {
  const materials = new Map<string, { triangles: number; position: number[]; moment: number[]; uv: number[] }>();
  let meshes = 0, triangles = 0;
  model.updateWorldMatrix(true, true);
  model.traverse(node => {
    if (!(node instanceof Mesh)) return;
    assert(!Array.isArray(node.material), 'this fixture uses single-material source primitives');
    meshes++;
    const key = materialKey(node.material), position = node.geometry.attributes.position, uv = node.geometry.attributes.uv, index = node.geometry.index;
    const count = index?.count ?? position.count;
    const entry = materials.get(key) ?? { triangles: 0, position: [0, 0, 0], moment: [0, 0, 0], uv: [0, 0] };
    entry.triangles += count / 3; triangles += count / 3;
    const point = new Vector3();
    for (let i = 0; i < count; i++) {
      const vertex = index ? index.getX(i) : i;
      point.fromBufferAttribute(position, vertex).applyMatrix4(node.matrixWorld);
      for (let axis = 0; axis < 3; axis++) { const n = point.getComponent(axis); entry.position[axis] += n; entry.moment[axis] += n * n; }
      if (uv) { entry.uv[0] += uv.getX(vertex); entry.uv[1] += uv.getY(vertex); }
    }
    materials.set(key, entry);
  });
  return { meshes, triangles, bounds: new Box3().setFromObject(model), materials };
}

function sameGeometry(a: ReturnType<typeof measure>, b: ReturnType<typeof measure>) {
  assert.equal(a.triangles, b.triangles, 'every source triangle is retained');
  assert(a.bounds.min.distanceTo(b.bounds.min) < 1e-6 && a.bounds.max.distanceTo(b.bounds.max) < 1e-6, 'world bounds remain unchanged');
  assert.equal(a.materials.size, b.materials.size, 'all material and texture variants remain');
  for (const [key, before] of a.materials) {
    const after = b.materials.get(key); assert(after, 'each original material has an equivalent batched surface');
    assert.equal(before.triangles, after.triangles, 'materials stay on the same triangle count');
    for (let axis = 0; axis < 3; axis++) {
      assert(Math.abs(before.position[axis] - after.position[axis]) / (3 * before.triangles) < 5e-7, 'vertex centroid is retained within Float32 transform precision');
      assert(Math.abs(before.moment[axis] - after.moment[axis]) / (3 * before.triangles) < 3e-6, 'vertex spatial distribution remains unchanged');
    }
    for (let axis = 0; axis < 2; axis++) assert(Math.abs(before.uv[axis] - after.uv[axis]) < 1e-6, 'UV values are retained');
  }
}

function sourceFingerprint(model: Object3D) {
  const hash = createHash('sha256');
  model.traverse(node => {
    hash.update(JSON.stringify([node.uuid, node.parent?.uuid, node.children.map(child => child.uuid), node.position.toArray(), node.quaternion.toArray(), node.scale.toArray()]));
    if (!(node instanceof Mesh)) return;
    hash.update(materialKey(node.material));
    for (const attribute of [...Object.values(node.geometry.attributes), node.geometry.index].filter(Boolean) as { array: ArrayBufferView }[]) {
      hash.update(Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
    }
  });
  return hash.digest('hex');
}

test('the shipped gateway keeps named explosion pivots, geometry and materials while reducing static mesh submissions', async () => {
  const gltf = await loadGeometryGlb(new URL('../../src/assets/offerings/gemtek-gateway.glb', import.meta.url));
  const source = gltf.scene.getObjectByName('GatewayTwin')!;
  const original = sourceFingerprint(source), reference = source.clone(true), batched = source.clone(true);
  const names = source.children.map(child => child.name);
  const before = measure(reference), owned = batchGatewayAssemblies(batched), after = measure(batched);
  assert.equal(before.meshes, 428); assert.equal(before.triangles, 228282);
  assert(after.meshes < before.meshes * .4, `${before.meshes}→${after.meshes} meshes must materially reduce submissions`);
  assert.deepEqual(batched.children.map(child => child.name), names);
  assert(owned.length > 0 && new Set(owned).size === owned.length);
  sameGeometry(before, after);
  const rests = new Map(reference.children.map(child => [child.name, child.position.clone()]));
  for (const amount of [.45, 1, 0]) {
    for (const [name, offset] of Object.entries(GATEWAY_EXPLODE)) {
      for (const model of [reference, batched]) {
        const assembly = model.getObjectByName(name); assert(assembly, `${name} remains independently explodable`);
        assembly.position.copy(rests.get(name)!).addScaledVector(new Vector3(...offset), amount);
      }
    }
    sameGeometry(measure(reference), measure(batched));
  }
  assert.equal(sourceFingerprint(source), original, 'cached GLTF buffers, material data and graph remain untouched');
  for (const geometry of owned) geometry.dispose();
});

test('batching preserves texture identity and UVs, separate glass, hidden subgroups and mirrored front faces', () => {
  const model = new Group(), assembly = new Group(), hidden = new Group(); assembly.name = 'GatewayBoard'; model.add(assembly); assembly.add(hidden); hidden.visible = false;
  const map = new DataTexture(new Uint8Array([255, 100, 50, 255]), 1, 1);
  const otherMap = new DataTexture(new Uint8Array([20, 90, 200, 255]), 1, 1);
  const material = new MeshStandardMaterial({ map, roughness: .41, metalness: .73 }); material.name = 'Circuit artwork';
  const equal = material.clone(); equal.name = 'Equivalent artwork';
  const different = material.clone(); different.map = otherMap;
  const glass = new MeshStandardMaterial({ transparent: true, opacity: .35, map });
  const geometry = new BoxGeometry(.2, .3, .4);
  const first = new Mesh(geometry, material), second = new Mesh(geometry, equal), third = new Mesh(geometry, different), window = new Mesh(geometry, glass), concealed = new Mesh(geometry, material);
  first.position.x = -.4; second.position.x = .4; second.scale.x = -1; third.position.z = .7; window.position.z = 1; hidden.add(concealed);
  assembly.add(first, second, third, window);
  const snapshot = sourceFingerprint(model), before = measure(model.clone(true));
  const copy = model.clone(true), owned = batchGatewayAssemblies(copy), after = measure(copy);
  sameGeometry(before, after);
  assert.equal(sourceFingerprint(model), snapshot);
  assert.equal(owned.length, 1);
  const batch = copy.getObjectByName('GatewayBoard_batch_0') as Mesh<BufferGeometry, MeshStandardMaterial>;
  assert.equal(batch.material.map, map); assert.equal(batch.material.roughness, .41); assert.equal(batch.material.metalness, .73);
  assert.equal(copy.children[0].children.filter(child => child instanceof Mesh).length, 3, 'glass and different-texture surfaces are not merged into artwork');
  const hiddenCopy = copy.children[0].children.find(child => child instanceof Group)!;
  assert.equal(hiddenCopy.visible, false); assert.equal(hiddenCopy.children.length, 1, 'hidden descendants stay beneath their visibility boundary');
  const positions = batch.geometry.attributes.position, normals = batch.geometry.attributes.normal, indices = batch.geometry.index!;
  for (let i = 0; i < indices.count; i += 3) {
    const [a, b, c] = [0, 1, 2].map(j => new Vector3().fromBufferAttribute(positions, indices.getX(i + j)));
    const face = b.sub(a).cross(c.sub(a)).normalize(), normal = new Vector3().fromBufferAttribute(normals, indices.getX(i));
    assert(face.dot(normal) > .999, 'mirrored geometry retains outward front-face winding');
  }
  owned.forEach(item => item.dispose());
});
