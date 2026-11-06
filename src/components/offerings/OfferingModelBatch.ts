import { BufferGeometry, Matrix4, Mesh, SkinnedMesh, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Collapse static fasteners and panels within each independently explodable
 * assembly. Geometry, materials, UVs and the named assembly pivots are retained.
 * The shared GLTF cache is never edited. Transparent parts keep their sorting. */
export function batchGatewayAssemblies(model: Object3D): BufferGeometry[] {
  const owned: BufferGeometry[] = [];
  const materialKeys = new Map<Material, string>();
  const materialKey = (material: Material) => {
    let key = materialKeys.get(material);
    if (!key) {
      const value: Partial<ReturnType<Material['toJSON']>> = material.toJSON({ textures: {}, images: {}, geometries: {}, materials: {}, shapes: {}, skeletons: {}, animations: {}, nodes: {} });
      delete value.uuid; delete value.name; delete value.metadata;
      key = JSON.stringify(value); materialKeys.set(material, key);
    }
    return key;
  };
  model.updateWorldMatrix(true, true);
  for (const assembly of model.children) {
    if (assembly instanceof Mesh) continue;
    const inverse = new Matrix4().copy(assembly.matrixWorld).invert();
    const buckets = new Map<string, Mesh[]>();
    assembly.traverse(node => {
      if (!(node instanceof Mesh) || node instanceof SkinnedMesh || node.children.length ||
        Array.isArray(node.material) || node.material.transparent || !node.visible ||
        Object.keys(node.geometry.morphAttributes).length || node.geometry.drawRange.count !== Infinity) return;
      // Moving a leaf out of a hidden subgroup must not reveal it. The named
      // top-level assembly itself remains the visibility/explosion boundary.
      for (let parent = node.parent; parent && parent !== assembly; parent = parent.parent) if (!parent.visible) return;
      const attributes = Object.entries((node.geometry as BufferGeometry).attributes).map(([name, value]) => `${name}:${value.itemSize}:${value.normalized}`).sort().join(',');
      const key = `${materialKey(node.material)}/${attributes}/${node.castShadow}/${node.receiveShadow}/${node.renderOrder}/${node.layers.mask}`;
      const list = buckets.get(key) ?? []; list.push(node); buckets.set(key, list);
    });
    for (const meshes of buckets.values()) {
      if (meshes.length < 2) continue;
      const geometries = meshes.map(mesh => {
        const matrix = new Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
        const geometry = mesh.geometry.clone();
        if (!geometry.index) geometry.setIndex(Array.from({ length: geometry.attributes.position.count }, (_, i) => i));
        geometry.applyMatrix4(matrix);
        // Negative-scale source objects reverse front faces in WebGL. Retain
        // that orientation after baking their transform into the vertices.
        if (matrix.determinant() < 0) {
          const index = geometry.index!;
          for (let i = 0; i < index.count; i += 3) {
            const second = index.getX(i + 1); index.setX(i + 1, index.getX(i + 2)); index.setX(i + 2, second);
          }
        }
        return geometry;
      });
      const merged = mergeGeometries(geometries, false);
      geometries.forEach(geometry => geometry.dispose());
      if (!merged) continue;
      merged.computeBoundingBox(); merged.computeBoundingSphere();
      const first = meshes[0], batch = new Mesh(merged, first.material);
      batch.name = `${assembly.name}_batch_${owned.length}`;
      batch.castShadow = first.castShadow; batch.receiveShadow = first.receiveShadow;
      batch.renderOrder = first.renderOrder; batch.layers.mask = first.layers.mask;
      batch.matrixAutoUpdate = false;
      meshes.forEach(mesh => mesh.removeFromParent());
      assembly.add(batch); owned.push(merged);
    }
  }
  return owned;
}
