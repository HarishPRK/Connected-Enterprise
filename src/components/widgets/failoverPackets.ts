import * as THREE from 'three';
import { PACKET_PALETTE } from './failoverTwinPalette';
import type { FailoverTrafficClass } from './failoverSceneTypes';

/** Shared geometry/materials within one owned set of packets; disposal stays with the scene. */
export function createPacketFactory() {
  const pill = new THREE.CapsuleGeometry(0.095, 0.3, 3, 8);
  const block = new THREE.BoxGeometry(0.18, 0.18, 0.18);
  const halo = new THREE.CapsuleGeometry(0.16, 0.38, 3, 8);
  const materials = new Map<FailoverTrafficClass, { core: THREE.MeshBasicMaterial; glow: THREE.MeshBasicMaterial }>();
  return (traffic: FailoverTrafficClass): THREE.Group => {
    let paint = materials.get(traffic);
    if (!paint) {
      paint = {
        core: new THREE.MeshBasicMaterial({ color: PACKET_PALETTE[traffic], toneMapped: false }),
        glow: new THREE.MeshBasicMaterial({ color: PACKET_PALETTE[traffic], toneMapped: false, transparent: true, opacity: 0.16, depthWrite: false }),
      };
      materials.set(traffic, paint);
    }
    const packet = new THREE.Group();
    packet.userData.trafficClass = traffic;
    if (traffic === 'ot') {
      // A paired square pulse keeps OT identifiable without relying on colour alone.
      for (const y of [-0.13, 0.13]) {
        const core = new THREE.Mesh(block, paint.core);
        core.position.y = y;
        packet.add(core);
      }
    } else packet.add(new THREE.Mesh(pill, paint.core));
    packet.add(new THREE.Mesh(halo, paint.glow));
    return packet;
  };
}
