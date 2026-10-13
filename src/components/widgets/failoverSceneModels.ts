import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { FailoverSceneNode, FailoverSceneTheme } from './failoverSceneTypes';
import { TWIN_PALETTE } from './failoverTwinPalette';

type Position = [number, number, number];
type ModelMaterials = {
  shell: THREE.MeshPhysicalMaterial;
  face: THREE.MeshStandardMaterial;
  recess: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  status: THREE.MeshStandardMaterial;
  plinth: THREE.MeshStandardMaterial;
  plinthTop: THREE.MeshStandardMaterial;
};

function identityColor(node: FailoverSceneNode): string {
  switch (node.kind) {
    case 'devices': return /(^|[-_])ot([_-]|$)/i.test(node.id) ? TWIN_PALETTE.ot : TWIN_PALETTE.it;
    case 'gateway': return TWIN_PALETTE.gateway;
    case 'fiber': return TWIN_PALETTE.fiber;
    case 'cellular': return TWIN_PALETTE.cellular;
    case 'tunnel': return /cellular|cell|5g/i.test(`${node.id} ${node.detail}`) ? TWIN_PALETTE.tunnelCellular : TWIN_PALETTE.tunnelFiber;
    case 'sdwan': return TWIN_PALETTE.sdwan;
    case 'internet': return TWIN_PALETTE.internet;
    case 'cloud': return TWIN_PALETTE.cloud;
  }
}

/** Identity paint stays distinct from telemetry LEDs and packet-path colors. */
function bodyMaterial(color: string, node: FailoverSceneNode, theme: FailoverSceneTheme): THREE.MeshPhysicalMaterial {
  const idleColor = theme.light ? TWIN_PALETTE.metal : TWIN_PALETTE.wallFrame;
  const material = new THREE.MeshPhysicalMaterial({
    color: node.status === 'idle' ? idleColor : color,
    metalness: 0.15,
    roughness: 0.68,
    clearcoat: 0.06,
    clearcoatRoughness: 0.6,
  });
  material.userData.onlineColor = color;
  material.userData.idleColor = idleColor;
  return material;
}

function materials(node: FailoverSceneNode, theme: FailoverSceneTheme): ModelMaterials {
  const accentColor = node.status === 'idle' ? theme.muted : node.color;
  const statusColor = node.status === 'ok' ? theme.ok
    : node.status === 'warn' ? theme.warn
      : node.status === 'err' ? theme.err : theme.muted;
  const accent = new THREE.MeshStandardMaterial({
    color: accentColor,
    metalness: 0.25,
    roughness: 0.65,
    emissive: accentColor,
    emissiveIntensity: node.active ? 0.32 : 0.1,
  });
  accent.userData.accentColor = true;
  const status = new THREE.MeshStandardMaterial({
    color: statusColor,
    emissive: statusColor,
    emissiveIntensity: node.status === 'idle' ? 0 : 0.65,
    roughness: 0.22,
  });
  status.userData.statusColor = true;
  const glass = new THREE.MeshPhysicalMaterial({
    color: accentColor,
    metalness: 0.05,
    roughness: 0.5,
    clearcoat: 0.04,
    clearcoatRoughness: 0.6,
    transparent: true,
    opacity: theme.light ? 0.24 : 0.18,
    depthWrite: false,
  });
  glass.userData.accentColor = true;
  const bodyColor = identityColor(node);
  const panelColor = new THREE.Color(bodyColor).lerp(new THREE.Color(TWIN_PALETTE.metal), 0.14).getHexString();
  const face = new THREE.MeshStandardMaterial({
    color: node.status === 'idle' ? TWIN_PALETTE.metal : `#${panelColor}`,
    metalness: 0.15,
    roughness: 0.72,
  });
  face.userData.onlineColor = `#${panelColor}`;
  face.userData.idleColor = TWIN_PALETTE.metal;
  return {
    shell: bodyMaterial(bodyColor, node, theme),
    face,
    recess: new THREE.MeshStandardMaterial({
      color: TWIN_PALETTE.recess,
      metalness: 0.2,
      roughness: 0.82,
    }),
    metal: new THREE.MeshStandardMaterial({
      color: TWIN_PALETTE.metal,
      metalness: 0.55,
      roughness: 0.58,
    }),
    accent,
    glass,
    status,
    plinth: new THREE.MeshStandardMaterial({ color: TWIN_PALETTE.floorEdge, metalness: 0.12, roughness: 0.88 }),
    plinthTop: new THREE.MeshStandardMaterial({ color: TWIN_PALETTE.enclosure, metalness: 0.22, roughness: 0.75 }),
  };
}

function mesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: Position = [0, 0, 0],
  rotation?: Position,
): THREE.Mesh {
  const item = new THREE.Mesh(geometry, material);
  item.position.set(...position);
  if (rotation) item.rotation.set(...rotation);
  item.castShadow = true;
  item.receiveShadow = true;
  parent.add(item);
  return item;
}

function box(
  parent: THREE.Object3D,
  size: Position,
  position: Position,
  material: THREE.Material,
  radius = 0.04,
): THREE.Mesh {
  return mesh(parent, new RoundedBoxGeometry(...size, 2, Math.min(radius, ...size.map((v) => v / 2))), material, position);
}

function cylinder(
  parent: THREE.Object3D,
  radius: number,
  height: number,
  position: Position,
  material: THREE.Material,
  rotation?: Position,
  topRadius = radius,
): THREE.Mesh {
  return mesh(parent, new THREE.CylinderGeometry(topRadius, radius, height, 20), material, position, rotation);
}

function sphere(
  parent: THREE.Object3D,
  radius: number,
  position: Position,
  material: THREE.Material,
): THREE.Mesh {
  return mesh(parent, new THREE.SphereGeometry(radius, 24, 16), material, position);
}

function tube(
  parent: THREE.Object3D,
  points: Position[],
  radius: number,
  material: THREE.Material,
  closed = false,
): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)), closed, 'centripetal');
  return mesh(parent, new THREE.TubeGeometry(curve, 36, radius, 6, closed), material);
}

function beam(parent: THREE.Object3D, from: Position, to: Position, radius: number, material: THREE.Material): THREE.Mesh {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const direction = b.clone().sub(a);
  const item = cylinder(parent, radius, direction.length(), a.add(b).multiplyScalar(0.5).toArray() as Position, material);
  item.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return item;
}

function ring(
  parent: THREE.Object3D,
  radius: number,
  thickness: number,
  position: Position,
  material: THREE.Material,
  rotation: Position = [0, 0, 0],
  arc = Math.PI * 2,
): THREE.Mesh {
  return mesh(parent, new THREE.TorusGeometry(radius, thickness, 8, 64, arc), material, position, rotation);
}

/** Repeated ports and cooling slots use a single draw call per material. */
function repeatedBoxes(parent: THREE.Object3D, size: Position, positions: Position[], material: THREE.Material): void {
  const items = new THREE.InstancedMesh(new THREE.BoxGeometry(...size), material, positions.length);
  const matrix = new THREE.Matrix4();
  positions.forEach((position, index) => items.setMatrixAt(index, matrix.makeTranslation(...position)));
  items.castShadow = true;
  items.receiveShadow = true;
  parent.add(items);
}

function plinth(group: THREE.Group, m: ModelMaterials): void {
  box(group, [2.08, 0.042, 1.88], [0, 0.021, 0], m.plinth, 0.02);
  box(group, [1.96, 0.012, 1.76], [0, 0.048, 0], m.plinthTop, 0.018);
  box(group, [1.48, 0.008, 0.014], [-0.1, 0.011, 0.938], m.metal, 0.004);
  repeatedBoxes(group, [0.045, 0.011, 0.045], [-0.91, 0.91].flatMap(x => [-0.79, 0.79].map(z => [x, 0.06, z] as Position)), m.metal);
  sphere(group, 0.028, [0.87, 0.075, 0.83], m.status);
}

function gateway(group: THREE.Group, m: ModelMaterials): void {
  box(group, [1.73, 0.37, 1.02], [0, 0.4, 0], m.shell, 0.075);
  box(group, [1.61, 0.045, 0.93], [0, 0.602, 0], m.face, 0.02);
  box(group, [1.62, 0.23, 0.018], [0, 0.396, 0.512], m.recess, 0.015);
  box(group, [1.61, 0.018, 0.025], [0, 0.535, 0.521], m.metal, 0.008);
  repeatedBoxes(group, [0.038, 0.008, 0.48], Array.from({ length: 10 }, (_, i) => [-0.3 + i * 0.068, 0.629, -0.035]), m.recess);
  for (let i = 0; i < 4; i += 1) {
    const x = -0.48 + i * 0.285;
    box(group, [0.23, 0.135, 0.036], [x, 0.391, 0.533], m.metal, 0.012);
    box(group, [0.183, 0.09, 0.041], [x, 0.39, 0.55], m.recess, 0.008);
  }
  repeatedBoxes(group, [0.01, 0.019, 0.014], Array.from({ length: 24 }, (_, i) => [
    -0.54 + Math.floor(i / 6) * 0.285 + (i % 6) * 0.023, 0.416, 0.58,
  ]), m.metal);
  box(group, [0.035, 0.065, 0.018], [-0.725, 0.4, 0.539], m.face, 0.008);
  box(group, [0.055, 0.07, 0.018], [0.718, 0.4, 0.539], m.metal, 0.01);
  for (const x of [-0.68, 0, 0.68]) {
    cylinder(group, 0.075, 0.09, [x, 0.628, -0.31], m.metal);
    const antenna = new THREE.Group();
    antenna.position.set(x, 0.64, -0.31);
    antenna.rotation.z = x === 0 ? 0 : -Math.sign(x) * 0.12;
    group.add(antenna);
    cylinder(antenna, 0.032, 0.69, [0, 0.355, 0], m.recess);
    cylinder(antenna, 0.034, 0.055, [0, 0.69, 0], m.metal);
  }
  repeatedBoxes(group, [0.12, 0.16, 0.12], [-0.67, 0.67].flatMap(x => [-0.35, 0.35].map(z => [x, 0.134, z] as Position)), m.plinthTop);
  for (const side of [-1, 1]) {
    box(group, [0.095, 0.42, 1.03], [side * 0.914, 0.405, 0], m.plinthTop, 0.014);
    tube(group, [[side * 0.92, 0.295, 0.54], [side * 0.982, 0.295, 0.65], [side * 0.982, 0.51, 0.65], [side * 0.92, 0.51, 0.54]], 0.019, m.metal);
  }
  repeatedBoxes(group, [0.032, 0.032, 0.018], [-0.91, 0.91].flatMap(x => [0.26, 0.55].map(y => [x, y, 0.527] as Position)), m.metal);
}

function fiber(group: THREE.Group, m: ModelMaterials): void {
  // A compact optical termination chassis, with no decorative cable loops.
  const chassis = box(group, [1.56, 0.8, 0.82], [0, 0.625, -0.03], m.shell, 0.065);
  chassis.name = 'optical-terminal-chassis';
  box(group, [1.42, 0.63, 0.025], [0, 0.63, 0.393], m.recess, 0.025);
  box(group, [1.43, 0.045, 0.76], [0, 1.047, -0.03], m.face, 0.025);
  box(group, [1.38, 0.018, 0.024], [0, 0.967, 0.413], m.metal, 0.006);
  repeatedBoxes(group, [0.041, 0.008, 0.46], Array.from({ length: 11 }, (_, i) => [-0.35 + i * 0.07, 1.075, -0.11]), m.recess);
  for (const x of [-0.46, -0.03]) {
    box(group, [0.3, 0.205, 0.11], [x, 0.7, 0.455], m.shell, 0.02);
    box(group, [0.215, 0.13, 0.018], [x, 0.7, 0.52], m.recess, 0.008);
    box(group, [0.175, 0.095, 0.022], [x, 0.7, 0.533], m.face, 0.006);
    cylinder(group, 0.025, 0.047, [x, 0.7, 0.56], m.metal, [Math.PI / 2, 0, 0]);
    box(group, [0.17, 0.034, 0.135], [x, 0.824, 0.469], m.metal, 0.012);
  }
  box(group, [0.32, 0.235, 0.09], [0.485, 0.663, 0.453], m.metal, 0.018);
  box(group, [0.252, 0.16, 0.021], [0.485, 0.663, 0.51], m.recess, 0.008);
  repeatedBoxes(group, [0.012, 0.034, 0.024], Array.from({ length: 8 }, (_, i) => [0.389 + i * 0.0275, 0.718, 0.527]), m.metal);
  repeatedBoxes(group, [0.42, 0.027, 0.014], [[-0.445, 0.411, 0.416], [-0.445, 0.473, 0.416], [0.04, 0.411, 0.416], [0.04, 0.473, 0.416]], m.metal);
  box(group, [0.044, 0.086, 0.018], [0.492, 0.423, 0.418], m.face, 0.009);
  for (const x of [-0.61, 0.61]) box(group, [0.19, 0.16, 0.57], [x, 0.138, -0.03], m.recess, 0.016);
}

function cellular(group: THREE.Group, m: ModelMaterials): void {
  const corners: Array<[number, number]> = [[-0.36, 0.29], [0.36, 0.29], [0, -0.36]];
  const at = (corner: number, y: number): Position => {
    const scale = 1 - (y - 0.21) * 0.32;
    return [corners[corner][0] * scale, y, corners[corner][1] * scale];
  };
  for (let corner = 0; corner < 3; corner += 1) {
    beam(group, at(corner, 0.055), at(corner, 2.18), 0.033, m.shell);
    for (let level = 0; level < 3; level += 1) {
      const y = 0.3 + level * 0.55;
      beam(group, at(corner, y), at((corner + 1) % 3, y + 0.5), 0.02, m.metal);
      beam(group, at(corner, y), at((corner + 1) % 3, y), 0.024, m.metal);
    }
  }
  cylinder(group, 0.23, 0.08, [0, 1.81, 0], m.recess);
  for (let panel = 0; panel < 3; panel += 1) {
    const antenna = new THREE.Group();
    antenna.rotation.y = panel * Math.PI * 2 / 3;
    group.add(antenna);
    box(antenna, [0.18, 0.53, 0.12], [0, 1.94, 0.255], m.face, 0.045);
    box(antenna, [0.105, 0.405, 0.014], [0, 1.94, 0.325], m.shell, 0.016);
  }
  for (const [index, radius] of [0.64, 0.85, 1.07].entries()) {
    const material = m.glass.clone();
    material.opacity = 0.65 - index * 0.16;
    const wave = ring(group, radius, 0.018, [0, 2.2, 0], material, [Math.PI / 2, 0, 0]);
    wave.name = `equipment-radio-wave-${index}`;
    wave.userData.baseRadius = radius;
  }
  cylinder(group, 0.023, 0.16, [0, 2.29, 0], m.metal);
}

function lock(parent: THREE.Object3D, m: ModelMaterials, centerY: number, z: number, scale = 1): void {
  ring(parent, 0.145 * scale, 0.03 * scale, [0, centerY + 0.2 * scale, z], m.metal, [0, 0, 0], Math.PI);
  box(parent, [0.41 * scale, 0.32 * scale, 0.16 * scale], [0, centerY, z], m.shell, 0.05 * scale);
  sphere(parent, 0.045 * scale, [0, centerY + 0.025 * scale, z + 0.087 * scale], m.recess);
  box(parent, [0.025 * scale, 0.065 * scale, 0.01 * scale], [0, centerY - 0.02 * scale, z + 0.09 * scale], m.recess, 0.003);
}

function tunnel(group: THREE.Group, m: ModelMaterials): void {
  group.userData.tunnelFlow = { startX: -1.3, endX: 1.3, y: 0.62, z: 0 };
  box(group, [3.4, 0.042, 1.1], [0, 0.021, 0], m.plinth, 0.02);
  box(group, [3.3, 0.012, 1.02], [0, 0.048, 0], m.plinthTop, 0.018);
  box(group, [2.98, 0.008, 0.96], [0, 0.058, 0], m.plinth, 0.01);
  box(group, [2.7, 0.008, 0.015], [-0.04, 0.013, 0.55], m.metal, 0.004);
  sphere(group, 0.028, [1.47, 0.081, 0.434], m.status);

  // An open, octagonal collar preserves a clear packet channel along X.
  const outer = new THREE.Shape();
  const inner = new THREE.Path();
  for (let side = 0; side <= 8; side += 1) {
    const angle = Math.PI / 8 + side * Math.PI / 4;
    const x = Math.cos(angle);
    const y = Math.sin(angle);
    if (side === 0) {
      outer.moveTo(x * 0.445, y * 0.445);
      inner.moveTo(x * 0.343, -y * 0.343);
    } else {
      outer.lineTo(x * 0.445, y * 0.445);
      inner.lineTo(x * 0.343, -y * 0.343);
    }
  }
  outer.holes.push(inner);
  const collarGeometry = new THREE.ExtrudeGeometry(outer, {
    depth: 0.145, bevelEnabled: true, bevelSegments: 1, steps: 1,
    bevelSize: 0.013, bevelThickness: 0.012,
  });
  for (const end of [-1, 1]) {
    const x = end * 1.47;
    mesh(group, collarGeometry, m.shell, [x - 0.0725, 0.62, 0], [0, Math.PI / 2, 0]);
    ring(group, 0.344, 0.012, [end * 1.563, 0.62, 0], m.accent, [0, Math.PI / 2, 0]);
    box(group, [0.22, 0.33, 0.75], [end * 1.23, 0.224, 0], m.shell, 0.02);
  }

  // The cover is cut away across its upper, front quadrant to reveal traffic.
  const coverMaterial = m.glass.clone();
  coverMaterial.side = THREE.DoubleSide;
  const cover = mesh(group, new THREE.CylinderGeometry(0.353, 0.353, 2.4, 32, 1, true, Math.PI * 0.1, Math.PI * 1.5), coverMaterial, [0, 0.62, 0], [0, 0, Math.PI / 2]);
  cover.castShadow = false;
  cover.receiveShadow = false;
  for (const z of [-0.23, 0.23]) {
    box(group, [2.84, 0.026, 0.026], [0, 0.382, z], m.accent, 0.009);
    box(group, [2.74, 0.04, 0.04], [0, 0.862, z], m.metal, 0.012);
  }
  for (const x of [-0.58, 0.58]) {
    const frame = mesh(group, collarGeometry, m.metal, [x - 0.022, 0.62, 0], [0, Math.PI / 2, 0]);
    frame.scale.z = 0.29;
  }
  repeatedBoxes(group, [0.065, 0.33, 0.045], [-1.1, 0, 1.1].flatMap((x) => [[x, 0.224, -0.48], [x, 0.224, 0.48]] as Position[]), m.metal);
  repeatedBoxes(group, [0.032, 0.032, 0.032], [-1.49, 1.49].flatMap((x) => [-0.23, 0.23].flatMap((z) => [[x, 0.91, z], [x, 0.33, z]] as Position[])), m.metal);

  // A compact module occupies the platform below the empty conduit lumen.
  box(group, [0.7, 0.16, 0.42], [0, 0.136, 0.283], m.plinthTop, 0.014);
  box(group, [0.64, 0.09, 0.39], [0, 0.225, 0.283], m.recess, 0.014);
  box(group, [0.48, 0.012, 0.28], [0, 0.279, 0.283], m.shell, 0.009);
  repeatedBoxes(group, [0.019, 0.022, 0.04], Array.from({ length: 18 }, (_, i) => [
    -0.252 + (i % 9) * 0.063, 0.247, i < 9 ? 0.063 : 0.504,
  ]), m.metal);
}

function shield(parent: THREE.Object3D, m: ModelMaterials): void {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.41);
  shape.lineTo(0.32, 0.27);
  shape.lineTo(0.3, -0.06);
  shape.quadraticCurveTo(0.24, -0.3, 0, -0.42);
  shape.quadraticCurveTo(-0.24, -0.3, -0.3, -0.06);
  shape.lineTo(-0.32, 0.27);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.065, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.018, bevelThickness: 0.018 });
  mesh(parent, geometry, m.shell, [0, 1.02, 0.1]);
  const front = mesh(parent, geometry.clone(), m.face, [0, 1.02, 0.172]);
  front.scale.set(0.85, 0.85, 0.17);
  lock(parent, m, 1.01, 0.234, 0.58);
}

function sdwan(group: THREE.Group, m: ModelMaterials): void {
  const cabinet = box(group, [1.16, 0.96, 0.72], [0, 0.62, -0.1], m.shell, 0.026);
  cabinet.name = 'sdwan-switch-cabinet';
  box(group, [1.04, 0.83, 0.024], [0, 0.64, 0.277], m.recess, 0.016);
  for (const y of [0.38, 0.615, 0.85]) box(group, [0.96, 0.17, 0.038], [0, y, 0.305], m.face, 0.011);
  repeatedBoxes(group, [0.072, 0.044, 0.021], Array.from({ length: 24 }, (_, i) => [-0.377 + (i % 8) * 0.107, 0.38 + Math.floor(i / 8) * 0.235, 0.333]), m.recess);
  repeatedBoxes(group, [0.038, 0.012, 0.022], Array.from({ length: 24 }, (_, i) => [-0.377 + (i % 8) * 0.107, 0.398 + Math.floor(i / 8) * 0.235, 0.347]), m.metal);
  repeatedBoxes(group, [0.11, 0.085, 0.11], [-0.48, 0.48].flatMap(x => [-0.36, 0.17].map(z => [x, 0.0975, z] as Position)), m.plinthTop);
  repeatedBoxes(group, [0.066, 1.13, 0.065], [[-0.614, 0.624, 0.305], [0.614, 0.624, 0.305]], m.plinthTop);
  box(group, [1.29, 0.053, 0.84], [0, 1.175, -0.08], m.plinthTop, 0.01);
  repeatedBoxes(group, [0.027, 0.027, 0.02], [-0.614, 0.614].flatMap(x => [0.16, 1.1].map(y => [x, y, 0.348] as Position)), m.metal);
  repeatedBoxes(group, [0.035, 0.28, 0.028], [[-0.516, 0.67, 0.366], [0.516, 0.67, 0.366]], m.metal);
  repeatedBoxes(group, [0.45, 0.024, 0.015], Array.from({ length: 5 }, (_, i) => [-0.23, 0.97 + i * 0.022, 0.306]), m.recess);
  for (const x of [-0.8, 0.8]) {
    for (const z of [-0.32, 0.45]) {
      box(group, [0.28, 0.39, 0.28], [x, 0.25, z], m.plinthTop, 0.016);
      box(group, [0.22, 0.014, 0.22], [x, 0.452, z], m.face, 0.008);
      tube(group, [[x, 0.35, z], [x * 0.92, 0.12, z], [x * 0.77, 0.1, z * 0.66], [x * 0.69, 0.43, z * 0.52]], 0.018, m.metal);
    }
  }
  const serviceBadge = new THREE.Group();
  serviceBadge.position.set(0.3, 0.815, 0.3);
  serviceBadge.scale.setScalar(0.18);
  group.add(serviceBadge);
  shield(serviceBadge, m);
}

/** Low-resolution geographic outlines become raised, sphere-following native meshes. */
function continentGeometry(radius: number): THREE.BufferGeometry {
  const outlines: Array<Array<[number, number]>> = [
    [[-168, 71], [-136, 69], [-126, 54], [-124, 42], [-112, 31], [-97, 16], [-84, 10], [-80, 25], [-66, 45], [-55, 52], [-69, 64], [-96, 73]],
    [[-81, 12], [-65, 9], [-47, -4], [-35, -11], [-43, -23], [-53, -35], [-68, -55], [-75, -43], [-79, -19]],
    [[-17, 36], [8, 37], [33, 31], [44, 11], [51, 10], [43, -14], [29, -34], [17, -35], [10, -12], [-6, 5], [-17, 15]],
    [[-11, 36], [-9, 53], [8, 58], [24, 71], [48, 68], [78, 75], [130, 70], [170, 59], [144, 44], [126, 39], [121, 20], [109, 5], [100, 14], [81, 7], [68, 24], [43, 13], [35, 30], [19, 41], [2, 44]],
    [[113, -22], [130, -12], [143, -13], [153, -28], [145, -39], [128, -34], [115, -35]],
    [[-53, 60], [-43, 59], [-20, 72], [-28, 82], [-50, 83], [-64, 73]],
  ];
  const vertices: number[] = [];
  const project = (point: THREE.Vector2): THREE.Vector3 => {
    const longitude = THREE.MathUtils.degToRad(point.x);
    const latitude = THREE.MathUtils.degToRad(point.y);
    return new THREE.Vector3(
      Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude), Math.cos(latitude) * Math.cos(longitude),
    ).multiplyScalar(radius);
  };
  const triangle = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2, depth: number): void => {
    if (depth) {
      const ab = a.clone().add(b).multiplyScalar(0.5);
      const bc = b.clone().add(c).multiplyScalar(0.5);
      const ca = c.clone().add(a).multiplyScalar(0.5);
      triangle(a, ab, ca, depth - 1);
      triangle(ab, b, bc, depth - 1);
      triangle(ca, bc, c, depth - 1);
      triangle(ab, bc, ca, depth - 1);
      return;
    }
    const points = [project(a), project(b), project(c)];
    const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
    if (normal.dot(points[0]) < 0) [points[1], points[2]] = [points[2], points[1]];
    for (const point of points) vertices.push(point.x, point.y, point.z);
  };
  for (const outline of outlines) {
    const points = outline.map(([longitude, latitude]) => new THREE.Vector2(longitude, latitude));
    for (const indices of THREE.ShapeUtils.triangulateShape(points, [])) {
      triangle(points[indices[0]], points[indices[1]], points[indices[2]], 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  // Radial normals keep the shallow embossing smooth under the studio lights.
  const normals = vertices.map((coordinate) => coordinate / radius);
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

function internet(group: THREE.Group, m: ModelMaterials, theme: FailoverSceneTheme, node: FailoverSceneNode): void {
  cylinder(group, 0.24, 0.22, [0, 0.168, 0], m.plinthTop);
  cylinder(group, 0.068, 0.23, [0, 0.355, 0], m.metal);
  const globe = new THREE.Group();
  globe.position.y = 1.11;
  globe.rotation.z = -0.17;
  group.add(globe);
  const globeSurface = bodyMaterial(TWIN_PALETTE.internet, node, theme);
  sphere(globe, 0.72, [0, 0, 0], globeSurface);
  const landSurface = bodyMaterial(TWIN_PALETTE.wall, node, theme);
  landSurface.roughness = 0.75;
  mesh(globe, continentGeometry(0.736), landSurface);
  for (const rotation of [0, Math.PI / 3, Math.PI * 2 / 3]) {
    ring(globe, 0.738, 0.014, [0, 0, 0], m.metal, [0, rotation, 0]);
  }
  for (const y of [-0.36, 0, 0.36]) {
    ring(globe, Math.sqrt(0.738 ** 2 - y ** 2), 0.013, [0, y, 0], m.metal, [Math.PI / 2, 0, 0]);
  }
  const orbit = new THREE.Group();
  orbit.name = 'equipment-internet-orbit';
  orbit.position.y = 1.11;
  orbit.rotation.set(0.2, 0, -0.26);
  group.add(orbit);
  ring(orbit, 1.05, 0.013, [0, 0, 0], m.metal, [Math.PI / 2, 0, 0]);
  for (let peer = 0; peer < 4; peer += 1) {
    const angle = peer * Math.PI / 2 + 0.25;
    const position: Position = [Math.cos(angle) * 1.05, 0, Math.sin(angle) * 1.05];
    box(orbit, [0.12, 0.12, 0.12], position, m.face, 0.025);
    sphere(orbit, 0.029, [position[0], position[1] + 0.079, position[2]], m.metal);
  }
}

function cloud(group: THREE.Group, m: ModelMaterials, theme: FailoverSceneTheme, node: FailoverSceneNode): void {
  const cloudSurface = bodyMaterial(TWIN_PALETTE.cloud, node, theme);
  const cloudSide = bodyMaterial(TWIN_PALETTE.enclosure, node, theme);
  // The entire cloud is one closed silhouette and one continuous beveled solid.
  const silhouette = new THREE.Shape();
  silhouette.moveTo(-0.65, 0);
  silhouette.lineTo(0.63, 0);
  silhouette.bezierCurveTo(0.84, 0, 0.98, 0.14, 0.98, 0.34);
  silhouette.bezierCurveTo(0.98, 0.56, 0.81, 0.72, 0.59, 0.72);
  silhouette.bezierCurveTo(0.51, 0.98, 0.29, 1.065, 0.035, 1.05);
  silhouette.bezierCurveTo(-0.22, 1.05, -0.41, 0.9, -0.44, 0.72);
  silhouette.bezierCurveTo(-0.66, 0.81, -0.88, 0.68, -0.88, 0.47);
  silhouette.bezierCurveTo(-1.025, 0.43, -1.015, 0.19, -0.91, 0.085);
  silhouette.bezierCurveTo(-0.84, 0.015, -0.76, 0, -0.65, 0);
  silhouette.closePath();
  const cloudGeometry = new THREE.ExtrudeGeometry(silhouette, {
    depth: 0.46, steps: 1, curveSegments: 18, bevelEnabled: true,
    bevelSegments: 4, bevelSize: 0.047, bevelThickness: 0.05,
  });
  const solid = new THREE.Mesh(cloudGeometry, [cloudSurface, cloudSide]);
  solid.name = 'cloud-continuous-solid';
  solid.position.set(0, 1.1, -0.23);
  solid.castShadow = true;
  solid.receiveShadow = true;
  group.add(solid);
  const perimeter = new THREE.CatmullRomCurve3(silhouette.getPoints(18).slice(0, -1).map((point) => new THREE.Vector3(point.x, point.y + 1.1, 0.287)), true, 'centripetal');
  mesh(group, new THREE.TubeGeometry(perimeter, 96, 0.009, 6, true), m.metal);
  for (const x of [-0.68, 0.68]) {
    box(group, [0.38, 0.62, 0.39], [x, 0.52, 0.08], m.shell, 0.035);
    box(group, [0.28, 0.53, 0.017], [x, 0.52, 0.286], m.recess, 0.015);
    repeatedBoxes(group, [0.22, 0.024, 0.021], Array.from({ length: 3 }, (_, i) => [x, 0.37 + i * 0.14, 0.3]), m.metal);
    tube(group, [[x, 0.835, 0.08], [x, 1.0, 0.08], [x * 0.9, 1.1, 0.05]], 0.02, m.metal);
  }
  repeatedBoxes(group, [0.33, 0.15, 0.32], [[-0.68, 0.133, 0.08], [0.68, 0.133, 0.08]], m.plinthTop);
  box(group, [0.35, 0.26, 0.35], [0, 0.188, 0.46], m.plinthTop, 0.014);
  box(group, [0.43, 0.43, 0.43], [0, 0.51, 0.46], m.face, 0.055);
  box(group, [0.31, 0.31, 0.02], [0, 0.51, 0.687], m.recess, 0.012);
  repeatedBoxes(group, [0.035, 0.035, 0.025], [[-0.065, 0.55, 0.709], [0.025, 0.55, 0.709], [-0.065, 0.46, 0.709], [0.025, 0.46, 0.709]], m.face);
  tube(group, [[0, 0.736, 0.46], [0, 0.94, 0.46], [0, 1.1, 0.26]], 0.02, m.metal);
}

function devices(group: THREE.Group, m: ModelMaterials, node: FailoverSceneNode): void {
  const industrial = /(^|[-_])ot([_-]|$)/i.test(node.id) || /\bOT\b/.test(node.label.toUpperCase());
  if (industrial) {
    box(group, [0.7, 1.03, 0.6], [-0.28, 0.73, -0.14], m.shell, 0.05);
    box(group, [0.56, 0.89, 0.025], [-0.28, 0.73, 0.179], m.face, 0.035);
    box(group, [0.42, 0.22, 0.019], [-0.28, 0.986, 0.2], m.recess, 0.022);
    box(group, [0.31, 0.12, 0.02], [-0.28, 0.986, 0.213], m.accent, 0.013);
    cylinder(group, 0.12, 0.045, [-0.29, 0.675, 0.22], m.metal, [Math.PI / 2, 0, 0]);
    cylinder(group, 0.092, 0.02, [-0.29, 0.675, 0.25], m.face, [Math.PI / 2, 0, 0]);
    beam(group, [-0.29, 0.675, 0.263], [-0.25, 0.735, 0.263], 0.007, m.recess);
    box(group, [0.03, 0.14, 0.03], [-0.08, 0.47, 0.216], m.metal, 0.009);
    cylinder(group, 0.23, 0.47, [0.57, 0.52, 0.29], m.face);
    cylinder(group, 0.242, 0.055, [0.57, 0.77, 0.29], m.metal);
    cylinder(group, 0.22, 0.07, [0.57, 0.24, 0.29], m.recess);
    cylinder(group, 0.018, 0.32, [0.57, 0.952, 0.29], m.metal);
    ring(group, 0.245, 0.017, [0.57, 0.42, 0.29], m.metal, [Math.PI / 2, 0, 0]);
    tube(group, [[0.53, 0.31, 0.29], [0.38, 0.21, 0.26], [0.13, 0.21, 0.04], [0.07, 0.45, -0.05]], 0.027, m.recess);
    repeatedBoxes(group, [0.08, 0.16, 0.08], [-0.53, -0.04].flatMap(x => [-0.37, 0.09].map(z => [x, 0.134, z] as Position)), m.plinthTop);
    cylinder(group, 0.18, 0.145, [0.57, 0.13, 0.29], m.plinthTop);
    repeatedBoxes(group, [0.13, 0.025, 0.027], Array.from({ length: 6 }, (_, i) => [-0.48, 0.34 + i * 0.045, 0.207]), m.recess);
    repeatedBoxes(group, [0.025, 0.1, 0.034], [[-0.58, 0.43, 0.211], [-0.58, 0.89, 0.211]], m.metal);
    tube(group, [[-0.065, 0.57, 0.225], [-0.015, 0.57, 0.265], [-0.015, 0.81, 0.265], [-0.065, 0.81, 0.225]], 0.014, m.metal);
    return;
  }
  cylinder(group, 0.21, 0.06, [-0.28, 0.086, -0.14], m.plinthTop);
  box(group, [0.095, 0.51, 0.08], [-0.28, 0.37, -0.14], m.metal, 0.014);
  box(group, [1.21, 0.71, 0.105], [-0.28, 0.91, -0.17], m.shell, 0.05);
  box(group, [1.1, 0.6, 0.016], [-0.28, 0.91, -0.106], m.recess, 0.025);
  box(group, [1.02, 0.51, 0.018], [-0.28, 0.928, -0.093], m.accent, 0.02);
  // Window panes are illustrative screens, without invented telemetry or text.
  box(group, [0.55, 0.35, 0.01], [-0.41, 0.928, -0.077], m.glass, 0.015);
  repeatedBoxes(group, [0.2, 0.06, 0.012], [[0.095, 1.055, -0.077], [0.095, 0.945, -0.077], [0.095, 0.835, -0.077]], m.face);
  const laptop = new THREE.Group();
  laptop.position.set(0.4, 0.205, 0.45);
  laptop.rotation.y = -0.22;
  group.add(laptop);
  box(laptop, [0.65, 0.045, 0.46], [0, 0.025, 0], m.shell, 0.025);
  repeatedBoxes(laptop, [0.085, 0.008, 0.04], Array.from({ length: 15 }, (_, i) => [-0.23 + (i % 5) * 0.112, 0.052, -0.09 + Math.floor(i / 5) * 0.065]), m.recess);
  box(laptop, [0.19, 0.006, 0.09], [0, 0.052, 0.13], m.metal, 0.01);
  const screen = new THREE.Group();
  screen.position.set(0, 0.06, -0.21);
  screen.rotation.x = -0.16;
  laptop.add(screen);
  box(screen, [0.65, 0.4, 0.035], [0, 0.2, 0], m.shell, 0.025);
  box(screen, [0.56, 0.31, 0.01], [0, 0.215, 0.025], m.accent, 0.014);
  box(group, [1.66, 0.07, 0.65], [0, 0.165, 0.46], m.plinthTop, 0.015);
  repeatedBoxes(group, [0.075, 0.09, 0.075], [-0.68, 0.68].flatMap(x => [0.23, 0.69].map(z => [x, 0.102, z] as Position)), m.metal);
  box(group, [0.3, 0.54, 0.44], [-0.68, 0.328, -0.38], m.shell, 0.018);
  box(group, [0.245, 0.45, 0.018], [-0.68, 0.328, -0.151], m.recess, 0.008);
  repeatedBoxes(group, [0.19, 0.026, 0.025], Array.from({ length: 6 }, (_, i) => [-0.68, 0.183 + i * 0.049, -0.133]), m.metal);
}

/** Procedural equipment sculptures. Origin is the floor; labels live in the renderer. */
export function createNodeModel(node: FailoverSceneNode, theme: FailoverSceneTheme): THREE.Group {
  const group = new THREE.Group();
  group.name = `equipment-${node.id}`;
  group.userData.modelKind = node.kind;
  const m = materials(node, theme);
  if (node.kind !== 'tunnel') plinth(group, m);
  switch (node.kind) {
    case 'devices': devices(group, m, node); break;
    case 'gateway': gateway(group, m); break;
    case 'fiber': fiber(group, m); break;
    case 'cellular': cellular(group, m); break;
    case 'tunnel': tunnel(group, m); break;
    case 'sdwan': sdwan(group, m); break;
    case 'internet': internet(group, m, theme, node); break;
    case 'cloud': cloud(group, m, theme, node); break;
  }
  // The palette also contains materials unused by some equipment kinds.
  const used = new Set<THREE.Material>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) used.add(material);
  });
  for (const material of Object.values(m)) if (!used.has(material)) material.dispose();
  return group;
}

/** Dispose unique GPU resources; shared pieces within a model are released once. */
export function disposeModel(group: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materialsToDispose = new Set<THREE.Material>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materialsToDispose.add(material);
    if (object instanceof THREE.InstancedMesh) object.dispose();
  });
  geometries.forEach((geometry) => geometry.dispose());
  materialsToDispose.forEach((material) => material.dispose());
}
