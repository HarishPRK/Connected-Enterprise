import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, Mesh, SRGBColorSpace, type BufferGeometry, type Object3D } from 'three';
import { cinematicAssets, useCinematicModel } from './OfferingCinematicCanvas';
import { PARTS } from './OfferingEquipment';
import { sampleRouting } from './OfferingRoutingStory';
import kitManifest from '../../assets/offerings/offerings-kit.manifest.json';

const POS = PARTS.find(part => part.id === 'pos')!;
const SOURCE = kitManifest.prefabs.Laptop;
const SCALE = POS.size / Math.max(...SOURCE.size);
const CENTER_X = (SOURCE.min[0] + SOURCE.max[0]) / 2;
const CENTER_Z = (SOURCE.min[2] + SOURCE.max[2]) / 2;
// Blender make_laptop(): display center (0, .254, .49), normal toward -Y.
// glTF converts it to (0, .49, -.254), normal +Z, tilted -.13 around X.
// Follow useCinematicModel's exact centering and minimum-Y normalization.
const TILT = -.13;
const SURFACE_OFFSET = .0075;
const SCREEN_AT: [number, number, number] = [
  -CENTER_X,
  .49 - SOURCE.min[1] - Math.sin(TILT) * SURFACE_OFFSET,
  -.254 - CENTER_Z + Math.cos(TILT) * SURFACE_OFFSET,
];
const WIDTH = 1120;
const HEIGHT = 670;

/** Only use on a privately cloned Laptop. Dispose the returned geometries when
 * that instance unmounts; source mesh buffers in the shared GLB are untouched. */
// eslint-disable-next-line react-refresh/only-export-components
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

function paintOrder(ctx: CanvasRenderingContext2D, state: ReturnType<typeof sampleRouting>, texture?: CanvasTexture) {
  const accepted = state.orderAccepted;
  const sending = state.ordersState === 'syncing';
  const waiting = state.ordersState === 'queued' || state.ordersState === 'route-ready';
  const accent = accepted ? '#a0e3c6' : '#f2c994';
  ctx.fillStyle = '#102d29'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#afc8bf'; ctx.font = '600 32px sans-serif';
  ctx.fillText('ONLINE ORDERS', 50, 65);
  ctx.textAlign = 'right'; ctx.font = '26px sans-serif';
  ctx.fillText('EXAMPLE', WIDTH - 50, 65); ctx.textAlign = 'left';
  ctx.fillStyle = '#42645a'; ctx.fillRect(50, 96, WIDTH - 100, 2);
  ctx.fillStyle = '#fbf3df'; ctx.font = '600 72px sans-serif';
  ctx.fillText('Order #1042', 50, 195);
  ctx.fillStyle = accent; ctx.font = '600 82px sans-serif';
  ctx.fillText(accepted ? 'Accepted' : sending ? 'Submitting' : waiting ? 'Waiting' : 'New order', 50, 309);
  ctx.fillStyle = '#c5d8ce'; ctx.font = '32px sans-serif';
  ctx.fillText(accepted ? 'Received by the store' : sending ? 'Request sent over 5G' : waiting
    ? 'Held before submission' : 'Ready to request from service', 52, 369);
  ctx.fillStyle = '#25473e'; ctx.fillRect(50, 415, WIDTH - 100, 155);
  ctx.fillStyle = '#afc8bf'; ctx.font = '28px sans-serif';
  ctx.fillText('FULFILLMENT TICKET', 75, 462);
  ctx.fillStyle = accepted ? '#a0e3c6' : '#eee5ce'; ctx.font = '600 42px sans-serif';
  ctx.fillText(accepted ? 'Ready for picking' : 'Not issued yet', 75, 526);
  // A receipt-sized ticket icon is drawn inside the laptop display, not as a
  // separate prop or a floating confirmation card in the world.
  ctx.fillStyle = accepted ? '#efe7d0' : '#61786d';
  ctx.fillRect(940, 438, 76, 105);
  ctx.fillStyle = '#30574a';
  for (let line = 0; line < 4; line++) ctx.fillRect(952, 455 + line * 16, line === 3 ? 25 : 50, 5);
  ctx.fillStyle = '#afc8bf'; ctx.font = '25px sans-serif';
  ctx.fillText(`New requests: ${state.ordersPath}`, 50, 626);
  ctx.textAlign = 'right'; ctx.fillText('Illustrative workflow', WIDTH - 50, 626); ctx.textAlign = 'left';
  if (texture) texture.needsUpdate = true;
}

/** Replaces the routing scene's generic POS Laptop. The existing laptop mesh
 * remains 36 cm wide; the animated order UI sits on its actual glass surface.
 * Render this instead of Equipment(id="pos") while the routing story is active.
 */
export function OfferingRoutingScreens({ timeRef, onSelect }: {
  timeRef: RefObject<number>;
  onSelect?: (id: string) => void;
}) {
  const laptop = useCinematicModel(cinematicAssets.kit, 'Laptop', POS.size);
  const displayGeometry = useMemo(() => clearLaptopDisplayGraphics(laptop), [laptop]);
  const surface = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = WIDTH; canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d')!;
    paintOrder(ctx, sampleRouting(0));
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; texture.anisotropy = 8;
    return { ctx, texture };
  }, []);
  const previous = useRef('');
  useEffect(() => () => {
    surface.texture.dispose();
    displayGeometry.forEach(geometry => geometry.dispose());
  }, [surface, displayGeometry]);
  useFrame(() => {
    const state = sampleRouting(timeRef.current);
    const key = `${state.ordersState}/${state.ordersPath}`;
    if (previous.current === key) return;
    previous.current = key;
    paintOrder(surface.ctx, state, surface.texture);
  });
  return <group name="Routing order workstation" position={POS.at} rotation={[0, POS.yaw ?? 0, 0]}
    onClick={event => { event.stopPropagation(); if (event.delta < 5) onSelect?.('pos'); }}>
    <primitive object={laptop} dispose={null} />
    <group scale={SCALE}>
      <mesh name="Order 1042 on laptop display" position={SCREEN_AT} rotation={[TILT, 0, 0]}>
        <planeGeometry args={[1.1, .65]} />
        <meshBasicMaterial map={surface.texture} toneMapped={false} />
      </mesh>
    </group>
  </group>;
}
