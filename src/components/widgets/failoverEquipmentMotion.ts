import * as THREE from 'three';
import type { FailoverSceneNode } from './failoverSceneTypes';
import { TWIN_PALETTE } from './failoverTwinPalette';

export interface EquipmentMotion {
  readonly animated: boolean;
  update(node: FailoverSceneNode): void;
  render(timeSeconds: number, reducedMotion: boolean): void;
}

type Position = readonly [number, number, number];
type SignalMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
type Effect = {
  kind: 'radio' | 'fiber' | 'port' | 'screen' | 'indicator' | 'sensor' | 'fabric' | 'uplink';
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial | THREE.MeshPhysicalMaterial;
  index: number;
  baseRadius?: number;
  from?: Position;
  bend?: Position;
  to?: Position;
};

const TAU = Math.PI * 2;
const noRaycast: THREE.Mesh['raycast'] = () => {};
const fraction = (value: number) => value - Math.floor(value);

function availableEquipment(node: FailoverSceneNode): boolean {
  if (node.status === 'idle' || node.status === 'err') return false;
  if (node.metrics) {
    for (let index = 0; index < node.metrics.length; index++) {
      const metric = node.metrics[index];
      if (metric.label === 'REACHABLE' && Number.parseInt(metric.value, 10) === 0) return false;
      if ((metric.label === 'WAN PATH' || metric.label === 'GATEWAY WAN') && metric.value.trim().toUpperCase() === 'DOWN') return false;
    }
  }
  return true;
}

function signal(
  root: THREE.Group,
  geometry: THREE.BufferGeometry,
  role: string,
  position: Position,
): SignalMesh {
  const material = new THREE.MeshBasicMaterial({
    color: TWIN_PALETTE.route, transparent: true, opacity: 0,
    depthWrite: false, toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `equipment-motion-${role}`;
  mesh.position.set(...position);
  mesh.visible = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.raycast = noRaycast;
  mesh.userData.equipmentMotion = true;
  mesh.userData.effectRole = role;
  root.add(mesh);
  return mesh;
}

/** Small activity cues use the renderer's clock; this module owns no timers. */
export function createEquipmentMotion(group: THREE.Group, initialNode: FailoverSceneNode): EquipmentMotion {
  const root = new THREE.Group();
  root.name = 'equipment-motion';
  root.userData.equipmentMotion = true;
  const effects: Effect[] = [];
  let orbit: THREE.Object3D | undefined;
  let orbitBaseY = 0;
  let available = false;
  let dataActive = false;
  let ambient = false;
  let canAnimate = false;

  switch (initialNode.kind) {
    case 'cellular':
      for (let index = 0; index < 3; index++) {
        const wave = group.getObjectByName(`equipment-radio-wave-${index}`);
        if (!(wave instanceof THREE.Mesh) || !(wave.material instanceof THREE.MeshPhysicalMaterial)) continue;
        wave.userData.equipmentMotion = true;
        wave.userData.effectRole = 'radio-wave';
        wave.castShadow = false;
        wave.receiveShadow = false;
        wave.raycast = noRaycast;
        effects.push({ kind: 'radio', mesh: wave, material: wave.material, index, baseRadius: wave.userData.baseRadius });
      }
      break;
    case 'fiber': {
      const jacket = new THREE.MeshPhysicalMaterial({
        color: TWIN_PALETTE.metal, roughness: 0.56, metalness: 0.12,
        transparent: true, opacity: 0.3, depthWrite: false,
      });
      const leadGeometry = new THREE.CylinderGeometry(0.027, 0.027, 0.28, 12, 1, true);
      const pulseGeometry = new THREE.CapsuleGeometry(0.019, 0.048, 3, 8);
      for (let index = 0; index < 2; index++) {
        const x = index === 0 ? -0.46 : -0.03;
        const lead = new THREE.Mesh(leadGeometry, jacket);
        lead.name = `equipment-optical-lead-${index}`;
        lead.position.set(x, 0.7, 0.721);
        lead.rotation.x = Math.PI / 2;
        lead.raycast = noRaycast;
        lead.userData.equipmentMotion = true;
        lead.userData.effectRole = 'optical-lead';
        root.add(lead);
        const pulse = signal(root, pulseGeometry, 'optical-pulse', [x, 0.7, 0.72]);
        pulse.rotation.x = Math.PI / 2;
        effects.push({ kind: 'fiber', mesh: pulse, material: pulse.material, index });
      }
      break;
    }
    case 'gateway': {
      const geometry = new THREE.BoxGeometry(0.032, 0.018, 0.009);
      for (let index = 0; index < 4; index++) {
        const mesh = signal(root, geometry, 'gateway-port', [-0.48 + index * 0.285, 0.485, 0.54]);
        effects.push({ kind: 'port', mesh, material: mesh.material, index });
      }
      break;
    }
    case 'devices': {
      const industrial = /(^|[-_])ot([_-]|$)/i.test(initialNode.id) || /\bOT\b/.test(initialNode.label.toUpperCase());
      if (industrial) {
        const mesh = signal(root, new THREE.TorusGeometry(0.266, 0.012, 6, 24, Math.PI * 0.6), 'sensor-sweep', [0.57, 0.835, 0.29]);
        mesh.rotation.x = Math.PI / 2;
        effects.push({ kind: 'sensor', mesh, material: mesh.material, index: 0 });
      } else {
        const scan = signal(root, new THREE.BoxGeometry(0.99, 0.014, 0.003), 'screen-scan', [-0.28, 0.928, -0.066]);
        effects.push({ kind: 'screen', mesh: scan, material: scan.material, index: 0 });
        const indicator = signal(root, new THREE.BoxGeometry(0.035, 0.023, 0.003), 'screen-indicator', [0.17, 1.12, -0.061]);
        effects.push({ kind: 'indicator', mesh: indicator, material: indicator.material, index: 0 });
      }
      break;
    }
    case 'sdwan': {
      const geometry = new THREE.BoxGeometry(0.095, 0.024, 0.006);
      for (let index = 0; index < 3; index++) {
        const mesh = signal(root, geometry, 'fabric-port', [0, 0.398 + index * 0.235, 0.363]);
        effects.push({ kind: 'fabric', mesh, material: mesh.material, index });
      }
      break;
    }
    case 'internet':
      orbit = group.getObjectByName('equipment-internet-orbit');
      orbitBaseY = orbit?.rotation.y ?? 0;
      if (orbit) {
        orbit.userData.equipmentMotion = true;
        orbit.userData.effectRole = 'internet-orbit';
      }
      break;
    case 'cloud': {
      const geometry = new THREE.SphereGeometry(0.03, 10, 8);
      for (let index = 0; index < 3; index++) {
        const x = index === 0 ? -0.68 : index === 1 ? 0.68 : 0;
        const from: Position = index < 2 ? [x, 0.835, 0.08] : [0, 0.736, 0.46];
        const bend: Position = index < 2 ? [x, 1, 0.08] : [0, 0.94, 0.46];
        const to: Position = index < 2 ? [x * 0.9, 1.1, 0.05] : [0, 1.1, 0.26];
        const mesh = signal(root, geometry, 'service-uplink', from);
        effects.push({ kind: 'uplink', mesh, material: mesh.material, index, from, bend, to });
      }
      break;
    }
    case 'tunnel': break; // Authoritative tunnel packets remain renderer-owned.
  }
  if (root.children.length) group.add(root);

  const controller: EquipmentMotion = {
    get animated() { return canAnimate; },
    update(node) {
      available = availableEquipment(node);
      dataActive = available && node.active === true;
      ambient = available && (initialNode.kind === 'cellular' || initialNode.kind === 'internet');
      canAnimate = ambient && (effects.length > 0 || orbit !== undefined) || dataActive && effects.length > 0;
      for (let index = 0; index < effects.length; index++) {
        const effect = effects[index];
        effect.mesh.visible = effect.kind === 'radio' ? ambient : dataActive;
        effect.material.color.set(node.color);
      }
      if (!available && orbit) orbit.rotation.y = orbitBaseY;
    },
    render(timeSeconds, reducedMotion) {
      const time = Number.isFinite(timeSeconds) ? Math.max(0, timeSeconds) : 0;
      if (orbit) orbit.rotation.y = available && !reducedMotion ? orbitBaseY + (time * 0.1) % TAU : orbitBaseY;
      for (let index = 0; index < effects.length; index++) {
        const effect = effects[index];
        if (!effect.mesh.visible) continue;
        switch (effect.kind) {
          case 'radio': {
            const phase = reducedMotion ? effect.index / 2 : fraction(time * (dataActive ? 0.28 : 0.16) + effect.index / 3);
            const radius = 0.35 + phase * 0.69;
            effect.mesh.scale.setScalar(radius / (effect.baseRadius ?? 1));
            effect.material.opacity = reducedMotion ? 0.2 : (dataActive ? 0.54 : 0.3) * Math.sin(Math.PI * phase) ** 2;
            break;
          }
          case 'fiber': {
            const phase = reducedMotion ? 0.5 : fraction(time * 0.65 + effect.index * 0.5);
            effect.mesh.position.z = 0.825 - phase * 0.21;
            effect.material.opacity = reducedMotion ? 0.48 : 0.7 * Math.sin(Math.PI * phase);
            break;
          }
          case 'port': {
            const phase = fraction(time * 0.7 - effect.index / 4);
            effect.material.opacity = reducedMotion ? 0.32 : 0.1 + 0.7 * Math.max(0, 1 - Math.abs(phase - 0.5) * 4);
            break;
          }
          case 'screen': {
            const phase = reducedMotion ? 0.5 : fraction(time * 0.21);
            effect.mesh.position.y = 0.715 + phase * 0.43;
            effect.material.opacity = reducedMotion ? 0.22 : 0.36;
            break;
          }
          case 'indicator':
            effect.material.opacity = reducedMotion ? 0.32 : 0.22 + 0.2 * (Math.sin(time * 1.8) * 0.5 + 0.5);
            break;
          case 'sensor':
            effect.mesh.rotation.z = reducedMotion ? Math.PI / 5 : (time * 0.7) % TAU;
            effect.material.opacity = reducedMotion ? 0.35 : 0.48;
            break;
          case 'fabric': {
            const phase = reducedMotion ? 0.5 : fraction(time * 0.42 + effect.index / 3);
            effect.mesh.position.x = -0.37 + phase * 0.74;
            effect.material.opacity = reducedMotion ? 0.3 : 0.52 * Math.sin(Math.PI * phase);
            break;
          }
          case 'uplink': {
            const phase = reducedMotion ? 0.5 : fraction(time * 0.4 + effect.index / 3);
            const first = phase < 0.58;
            const from = first ? effect.from! : effect.bend!;
            const to = first ? effect.bend! : effect.to!;
            const amount = first ? phase / 0.58 : (phase - 0.58) / 0.42;
            effect.mesh.position.set(from[0] + (to[0] - from[0]) * amount, from[1] + (to[1] - from[1]) * amount, from[2] + (to[2] - from[2]) * amount);
            effect.material.opacity = reducedMotion ? 0.42 : 0.72 * Math.sin(Math.PI * phase);
            break;
          }
        }
      }
    },
  };
  controller.update(initialNode);
  controller.render(0, false);
  return controller;
}
