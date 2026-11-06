import { Mesh, type BufferGeometry, type Object3D } from 'three';

/** Only use on a privately cloned Laptop. Dispose the returned geometries when
 * that instance unmounts; source mesh buffers in the shared GLB are untouched. */
export function clearLaptopDisplayGraphics(laptop: Object3D): BufferGeometry[] {
  const owned: BufferGeometry[] = [];
  laptop.traverse(object => {
    if (!(object instanceof Mesh)) return;
    if (object.name === 'Laptop_Skybluestatus') object.visible = false;
    if (object.name !== 'Laptop_Brushedtitanium') return;
    // Blender batches trackpad and decorative screen lines by material. Keep
    // trackpad triangles below y=.14 and remove only the old display graphics.
    const geometry = object.geometry.clone();
    const positions = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const keep: number[] = [];
    for (let offset = 0; offset < (index?.count ?? positions.count); offset += 3) {
      const a = index ? index.getX(offset) : offset;
      const b = index ? index.getX(offset + 1) : offset + 1;
      const c = index ? index.getX(offset + 2) : offset + 2;
      if (Math.max(positions.getY(a), positions.getY(b), positions.getY(c)) < .14) keep.push(a, b, c);
    }
    geometry.setIndex(keep);
    object.geometry = geometry;
    owned.push(geometry);
  });
  return owned;
}
