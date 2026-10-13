import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createNodeModel, updateNodeModel } from './failoverSceneModels';
import { createEquipmentMotion } from './failoverEquipmentMotion';
import { TWIN_PALETTE } from './failoverTwinPalette';
import { TWIN_LAYOUT } from './failoverSceneLayout';
import type {
  FailoverSceneData,
  FailoverSceneLink,
  FailoverSceneNode,
  FailoverSceneRenderer,
  FailoverSceneTheme,
} from './failoverSceneTypes';

type SceneNode = {
  object: THREE.Group;
  label: THREE.Sprite;
  labelText: string;
  kind: FailoverSceneNode['kind'];
  internalFlow?: { startX: number; endX: number; y: number; z: number };
  internalPackets: THREE.Mesh<THREE.CapsuleGeometry, THREE.MeshBasicMaterial>[];
  internalPhase: number;
  internalActive: boolean;
  motion: ReturnType<typeof createEquipmentMotion>;
};

type SceneLink = {
  object: THREE.Group;
  rail: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>;
  curve: THREE.CatmullRomCurve3;
  packets: THREE.Mesh<THREE.CapsuleGeometry, THREE.MeshBasicMaterial>[];
  length: number;
  phase: number;
  active: boolean;
  available: boolean;
  signature: string;
  from: string;
  to: string;
  carrierMaterial: THREE.MeshStandardMaterial;
  edgeMaterial: THREE.MeshStandardMaterial;
};

const UP = new THREE.Vector3(0, 1, 0);
const TARGET = new THREE.Vector3(TWIN_LAYOUT.room.centerX, 0.8, 0);
// The user's preferred front elevation keeps the premises level and reveals equipment tops.
const START_POSITION = TARGET.clone().add(new THREE.Vector3(0, 20, 30));
const WORLD_WIDTH = TWIN_LAYOUT.room.width;
const MAX_PIXEL_RATIO = 1.5;
const STUDIO = { exposure: 0.9, environment: 0.24, hemisphere: 0.95, key: 2.35, rim: 0.9, fill: 0.55 };
const ROOM_BOUNDS = {
  min: [TWIN_LAYOUT.room.centerX - WORLD_WIDTH / 2 - 0.05, -0.04, -TWIN_LAYOUT.room.depth / 2 - 0.15],
  max: [TWIN_LAYOUT.room.centerX + WORLD_WIDTH / 2 + 0.05, 2.52, TWIN_LAYOUT.room.depth / 2 - 0.05],
} as const;
const EQUIPMENT_LABEL_WIDTH = 3.8;

function disposeObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  object.traverse((child) => {
    if (child instanceof THREE.InstancedMesh) child.dispose();
    const drawable = child as THREE.Mesh;
    if (drawable.geometry) geometries.add(drawable.geometry);
    if (!drawable.material) return;
    const childMaterials = Array.isArray(drawable.material) ? drawable.material : [drawable.material];
    for (const material of childMaterials) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
}

function labelSprite(text: string, color: string, worldWidth: number, premise = false) {
  const canvas = document.createElement('canvas');
  canvas.width = premise ? 1024 : 640;
  canvas.height = 112;
  const context = canvas.getContext('2d');
  if (context) {
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = color;
    let fontSize = premise ? 42 : 44;
    context.font = `700 ${fontSize}px "Space Grotesk", "Segoe UI", sans-serif`;
    while (context.measureText(text).width > canvas.width - 32 && fontSize > 22) {
      context.font = `700 ${--fontSize}px "Space Grotesk", "Segoe UI", sans-serif`;
    }
    const textWidth = Math.min(canvas.width - 12, context.measureText(text).width + 38);
    const plateHeight = fontSize + 22;
    const plateX = (canvas.width - textWidth) / 2;
    const plateY = (canvas.height - plateHeight) / 2;
    context.fillStyle = TWIN_PALETTE.panel;
    context.beginPath();
    context.rect(plateX, plateY, textWidth, plateHeight);
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = TWIN_PALETTE.border;
    context.strokeRect(plateX + 1, plateY + 1, textWidth - 2, plateHeight - 2);
    context.fillStyle = TWIN_PALETTE.metal;
    for (const x of [plateX + 7, plateX + textWidth - 7]) {
      context.beginPath();
      context.arc(x, canvas.height / 2, 1.7, 0, Math.PI * 2);
      context.fill();
    }
    context.fillStyle = color;
    context.fillText(text.toUpperCase(), canvas.width / 2, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, toneMapped: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(worldWidth, worldWidth * canvas.height / canvas.width, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function concreteTexture(width: number, depth: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = '#dddee4';
    context.fillRect(0, 0, 256, 256);
    // Deterministic aggregate and broad trowel patches belong to the concrete surface.
    let seed = 719;
    for (let index = 0; index < 2700; index++) {
      seed = Math.imul(seed, 1664525) + 1013904223;
      const x = (seed >>> 0) % 256;
      seed = Math.imul(seed, 1664525) + 1013904223;
      const y = (seed >>> 0) % 256;
      context.fillStyle = index % 3 ? 'rgba(58,60,70,0.035)' : 'rgba(244,244,249,0.09)';
      context.fillRect(x, y, index % 5 ? 1 : 3, index % 5 ? 1 : 2);
    }
    for (const [x, y, radius] of [[40, 62, 64], [202, 194, 72], [128, 152, 85]]) {
      const patch = context.createRadialGradient(x, y, 0, x, y, radius);
      patch.addColorStop(0, 'rgba(75,75,81,0.055)');
      patch.addColorStop(1, 'rgba(75,75,81,0)');
      context.fillStyle = patch;
      context.fillRect(0, 0, 256, 256);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(width / 4, depth / 4);
  texture.anisotropy = 4;
  return texture;
}

function createPremise(width: number, centerX: number, label: string, color: string, theme: FailoverSceneTheme) {
  const group = new THREE.Group();
  group.position.x = centerX;
  const depth = TWIN_LAYOUT.premisesDepth;
  const texture = concreteTexture(width, depth);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(width, 0.055, depth), new THREE.MeshStandardMaterial({
    color: TWIN_PALETTE.floor, map: texture, bumpMap: texture, bumpScale: 0.016,
    roughness: 0.96, metalness: 0.015, envMapIntensity: 0.08,
  }));
  slab.position.y = 0.2725;
  slab.receiveShadow = true;
  group.add(slab);
  const marking = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  for (const z of [-depth / 2 + 0.12, depth / 2 - 0.12]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(width - 0.24, 0.008, 0.055), marking);
    line.position.set(0, 0.306, z);
    group.add(line);
  }
  for (const x of [-width / 2 + 0.12, width / 2 - 0.12]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.008, depth - 0.24), marking);
    line.position.set(x, 0.306, 0);
    group.add(line);
  }
  const jointMaterial = new THREE.MeshBasicMaterial({ color: TWIN_PALETTE.floorEdge, transparent: true, opacity: 0.55, toneMapped: false });
  for (let x = -width / 2 + 4; x < width / 2 - 0.2; x += 4) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.004, depth - 0.3), jointMaterial);
    seam.position.set(x, 0.303, 0);
    group.add(seam);
  }
  for (const z of [-2.5, 2.5]) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(width - 0.25, 0.004, 0.016), jointMaterial);
    seam.position.set(0, 0.303, z);
    group.add(seam);
  }
  const title = labelSprite(label, theme.text, Math.min(width - 1, 8), true);
  title.position.set(0, 0.55, depth / 2 + 0.45);
  group.add(title);
  return group;
}

function createIndustrialRoom() {
  const room = new THREE.Group();
  const { width, depth, centerX } = TWIN_LAYOUT.room;
  const back = -depth / 2;
  const wallWidth = width - 0.85;
  const bayWidth = (wallWidth - 0.15) / 10;
  const wallStart = centerX - (wallWidth - 0.15) / 2;
  const texture = concreteTexture(width, depth);
  const concrete = new THREE.MeshStandardMaterial({
    color: TWIN_PALETTE.floor, map: texture, bumpMap: texture, bumpScale: 0.012,
    roughness: 0.97, metalness: 0.01, envMapIntensity: 0.08,
  });
  const paintedWall = new THREE.MeshStandardMaterial({ color: TWIN_PALETTE.wall, roughness: 0.94, metalness: 0.025, envMapIntensity: 0.12 });
  const steel = new THREE.MeshStandardMaterial({ color: TWIN_PALETTE.wallFrame, roughness: 0.52, metalness: 0.62, envMapIntensity: 0.35 });
  const traySteel = new THREE.MeshStandardMaterial({ color: TWIN_PALETTE.metal, roughness: 0.6, metalness: 0.65, envMapIntensity: 0.28 });
  const glazing = new THREE.MeshPhysicalMaterial({ color: TWIN_PALETTE.window, roughness: 0.34, metalness: 0.12, transparent: true, opacity: 0.24, depthWrite: false });
  function box(size: [number, number, number], position: [number, number, number], material: THREE.Material | THREE.Material[], shadow = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    room.add(mesh);
    return mesh;
  }
  const floorEdge = new THREE.MeshStandardMaterial({ color: TWIN_PALETTE.floorEdge, roughness: 0.96, envMapIntensity: 0.08 });
  box([width, 0.25, depth], [centerX, 0.125, -0.1], [floorEdge, floorEdge, concrete, floorEdge, floorEdge, floorEdge], false);
  // A cutaway rear elevation leaves the network stations fully visible from the preferred view.
  box([wallWidth, 0.55, 0.12], [centerX, 0.575, back + 0.08], paintedWall);
  box([wallWidth, 0.13, 0.16], [centerX, 2.435, back + 0.12], steel);
  box([wallWidth, 0.06, 0.12], [centerX, 0.86, back + 0.13], steel);
  for (let index = 0; index <= 10; index++) {
    const x = wallStart + index * bayWidth;
    box([0.12, 2.2, 0.17], [x, 1.4, back + 0.12], steel);
    if (index === 10) continue;
    const center = x + bayWidth / 2;
    box([bayWidth - 0.17, 1.38, 0.035], [center, 1.58, back + 0.09], glazing, false);
    box([0.038, 1.38, 0.06], [center, 1.58, back + 0.15], steel);
    box([bayWidth - 0.17, 0.04, 0.06], [center, 1.57, back + 0.15], steel);
  }
  // Functional cable containment along the room's rear wall, away from the visible route channels.
  for (const z of [back + 0.32, back + 0.64]) box([wallWidth - 0.25, 0.045, 0.038], [centerX, 2.08, z], traySteel);
  const rungs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.033, 0.03, 0.35), traySteel, 40);
  const transform = new THREE.Matrix4();
  for (let index = 0; index < 40; index++) {
    transform.makeTranslation(wallStart + 0.4 + index * (wallWidth - 0.95) / 39, 2.06, back + 0.48);
    rungs.setMatrixAt(index, transform);
  }
  rungs.instanceMatrix.needsUpdate = true;
  room.add(rungs);
  for (let index = 0; index <= 5; index++) box([0.08, 0.08, 0.5], [wallStart + index * bayWidth * 2, 2.015, back + 0.3], steel);
  return room;
}

function contactShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 8, 64, 64, 63);
    gradient.addColorStop(0, 'rgba(0,0,0,0.6)');
    gradient.addColorStop(0.45, 'rgba(0,0,0,0.23)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(canvas);
}

function linkSignature(link: FailoverSceneLink, from: FailoverSceneNode, to: FailoverSceneNode) {
  return `${from.id}:${to.id}:${from.position.join(',')}:${to.position.join(',')}:${link.active}:${link.available}:${link.color}`;
}

function carrierGeometry(curve: THREE.CatmullRomCurve3, segments = 32) {
  const vertices = new Float32Array((segments + 1) * 6);
  const indices: number[] = [];
  const left: THREE.Vector3[] = [];
  const right: THREE.Vector3[] = [];
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const lateral = new THREE.Vector3();
  for (let index = 0; index <= segments; index++) {
    const t = index / segments;
    curve.getPointAt(t, point);
    curve.getTangentAt(t, tangent);
    lateral.set(-tangent.z, 0, tangent.x).normalize().multiplyScalar(0.085);
    left.push(point.clone().add(lateral));
    right.push(point.clone().sub(lateral));
    vertices.set([left[index].x, left[index].y - 0.027, left[index].z, right[index].x, right[index].y - 0.027, right[index].z], index * 6);
    if (index < segments) {
      const offset = index * 2;
      indices.push(offset, offset + 2, offset + 1, offset + 1, offset + 2, offset + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { geometry, left, right };
}

function buildLink(link: FailoverSceneLink, from: FailoverSceneNode, to: FailoverSceneNode, theme: FailoverSceneTheme): SceneLink {
  const source = new THREE.Vector3(...from.position);
  const destination = new THREE.Vector3(...to.position);
  const direction = destination.clone().sub(source);
  direction.y = 0;
  direction.normalize();
  if (from.kind === 'tunnel') source.x += 1.7;
  else source.addScaledVector(direction, 0.88);
  if (to.kind === 'tunnel') destination.x -= 1.7;
  else destination.addScaledVector(direction, -0.93);
  source.y += from.kind === 'tunnel' ? 0.62 : 0.42;
  destination.y += to.kind === 'tunnel' ? 0.62 : 0.42;
  const delta = destination.clone().sub(source);
  const a = source.clone().addScaledVector(delta, 0.28);
  const b = source.clone().addScaledVector(delta, 0.72);
  a.y += 0.08;
  b.y += 0.08;
  // Tangents leave equipment along the route direction; each connection is a single smooth rail.
  a.z = source.z + delta.z * 0.1;
  b.z = source.z + delta.z * 0.9;
  const curve = new THREE.CatmullRomCurve3([source, a, b, destination], false, 'centripetal');
  const group = new THREE.Group();
  const active = link.active && link.available;
  const color = link.available ? link.color : theme.muted;
  const carrier = carrierGeometry(curve);
  const carrierMaterial = new THREE.MeshStandardMaterial({
    color: TWIN_PALETTE.wallFrame, metalness: 0.65, roughness: 0.55, envMapIntensity: 0.25, side: THREE.DoubleSide,
  });
  const base = new THREE.Mesh(carrier.geometry, carrierMaterial);
  base.receiveShadow = true;
  group.add(base);
  const edgeMaterial = new THREE.MeshStandardMaterial({ color: TWIN_PALETTE.metal, roughness: 0.58, metalness: 0.7, envMapIntensity: 0.32 });
  for (const points of [carrier.left, carrier.right]) {
    const edgeCurve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    group.add(new THREE.Mesh(new THREE.TubeGeometry(edgeCurve, 32, 0.012, 5, false), edgeMaterial));
  }
  if (curve.getLength() > 2) {
    const supports = new THREE.InstancedMesh(new THREE.BoxGeometry(0.045, 1, 0.045), carrierMaterial, 2);
    const transform = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    for (let index = 0; index < 2; index++) {
      curve.getPointAt((index + 1) / 3, position);
      const height = Math.max(0.02, position.y - 0.327);
      position.y = 0.3 + height / 2;
      scale.set(1, height, 1);
      transform.compose(position, rotation, scale);
      supports.setMatrixAt(index, transform);
    }
    supports.instanceMatrix.needsUpdate = true;
    group.add(supports);
  }
  const material = new THREE.MeshBasicMaterial({
    color, toneMapped: false,
    transparent: !active, opacity: link.available ? (active ? 1 : 0.5) : 0.24,
    depthWrite: active,
  });
  const rail = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, active ? 0.023 : 0.012, 6, false), material);
  group.add(rail);
  const packets: SceneLink['packets'] = [];
  if (active) {
    const packetGeometry = new THREE.CapsuleGeometry(0.065, 0.22, 3, 6);
    const packetMaterial = new THREE.MeshBasicMaterial({
      color: TWIN_PALETTE.text, toneMapped: false,
    });
    for (let index = 0; index < 4; index++) {
      const packet = new THREE.Mesh(packetGeometry, packetMaterial);
      group.add(packet);
      packets.push(packet);
    }
  }
  return {
    object: group, rail, curve, packets, length: curve.getLength(), phase: 0,
    active, available: link.available, signature: linkSignature(link, from, to),
    from: link.from, to: link.to, carrierMaterial, edgeMaterial,
  };
}

/** The renderer owns only scene presentation. Route selection remains in the application. */
export function createFailoverSceneRenderer(
  host: HTMLElement,
  initialData: FailoverSceneData,
  initialTheme: FailoverSceneTheme,
  onSelect: (id: string) => void,
  onFailure: () => void,
  onHover?: (id: string | null) => void,
  onFocus?: (id: string) => void,
  onFlowDrop?: (id: string) => boolean,
  onFlowDrag?: (targetId: string | null, dragging: boolean) => void,
): FailoverSceneRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'default' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = STUDIO.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.domElement.className = 'failover-network-canvas';
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', 'INTERACTIVE 3D NETWORK, ENTERPRISE PREMISES TO OPERATOR PREMISES. SELECT EQUIPMENT USING THE NETWORK CONTROLS.');
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.cursor = 'grab';
  // Vertical touch scrolling remains available while one-finger horizontal drags orbit the stage.
  renderer.domElement.style.touchAction = 'pan-y';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-WORLD_WIDTH / 2, WORLD_WIDTH / 2, 4, -4, 0.1, 120);
  camera.position.copy(START_POSITION);
  camera.lookAt(TARGET);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(TARGET);
  controls.enableDamping = false;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.zoomToCursor = true;
  controls.minZoom = 0.25;
  controls.maxZoom = 24;
  controls.minPolarAngle = Math.PI / 12;
  controls.maxPolarAngle = Math.PI * 85 / 180;
  controls.autoRotateSpeed = 0.32;
  controls.rotateSpeed = 0.48;
  controls.touches.ONE = THREE.TOUCH.ROTATE;
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  renderer.domElement.style.touchAction = 'pan-y';
  controls.update();

  const environmentGenerator = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = environmentGenerator.fromScene(room, 0.04);
  scene.environment = environment.texture;
  scene.environmentIntensity = STUDIO.environment;
  room.dispose();
  environmentGenerator.dispose();

  const hemi = new THREE.HemisphereLight('#e7e9f4', TWIN_PALETTE.floorEdge, STUDIO.hemisphere);
  scene.add(hemi);
  const key = new THREE.DirectionalLight('#f4f0e7', STUDIO.key);
  key.position.set(-8, 17, 11);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -20;
  key.shadow.camera.right = 20;
  key.shadow.camera.top = 15;
  key.shadow.camera.bottom = -15;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 50;
  key.shadow.normalBias = 0.04;
  key.shadow.bias = -0.0003;
  key.shadow.radius = 4;
  key.target.position.copy(TARGET);
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight('#bcc5e1', STUDIO.rim);
  rim.position.set(4, 10, -12);
  scene.add(rim);
  const fill = new THREE.DirectionalLight('#dce1ef', STUDIO.fill);
  fill.position.set(-14, 7, 14);
  scene.add(fill);

  const stage = new THREE.Group();
  const nodeRoot = new THREE.Group();
  const linkRoot = new THREE.Group();
  const shadows = new THREE.Group();
  scene.add(stage, shadows, linkRoot, nodeRoot);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(130, 90), new THREE.MeshBasicMaterial({
    color: TWIN_PALETTE.backdrop, toneMapped: false,
  }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.18;
  ground.receiveShadow = true;
  scene.add(ground);

  const selectionMaterial = new THREE.MeshBasicMaterial({ color: TWIN_PALETTE.selection, transparent: true, opacity: 0.86, depthWrite: false, toneMapped: false });
  const selection = new THREE.Mesh(new THREE.RingGeometry(1.31, 1.36, 64), selectionMaterial);
  selection.rotation.x = -Math.PI / 2;
  selection.visible = false;
  scene.add(selection);
  const hoverMaterial = new THREE.MeshBasicMaterial({ color: TWIN_PALETTE.text, transparent: true, opacity: 0.86, depthWrite: false, toneMapped: false });
  const hoverRing = new THREE.Mesh(new THREE.RingGeometry(1.43, 1.47, 64), hoverMaterial);
  hoverRing.rotation.x = -Math.PI / 2;
  hoverRing.visible = false;
  scene.add(hoverRing);
  const flowGuide = new THREE.Group();
  flowGuide.visible = false;
  scene.add(flowGuide);
  const flowPacket = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.42, 4, 10),
    new THREE.MeshBasicMaterial({ color: TWIN_PALETTE.text, depthTest: false, toneMapped: false }));
  flowPacket.rotation.z = -Math.PI / 2;
  flowPacket.renderOrder = 20;
  flowPacket.visible = false;
  scene.add(flowPacket);

  const nodeMap = new Map<string, SceneNode>();
  const linkMap = new Map<string, SceneLink>();
  let stationMarkers: THREE.InstancedMesh | null = null;
  const stationRanges = new Map<string, number>();
  const stationPaint = new THREE.Color(TWIN_PALETTE.enterprise);
  const selectedStationPaint = new THREE.Color(TWIN_PALETTE.selection);
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const packetPosition = new THREE.Vector3();
  const packetTangent = new THREE.Vector3();
  let data = initialData;
  let theme = initialTheme;
  let selectedId: string | null = null;
  let hoveredId: string | null = null;
  let disposed = false;
  let failed = false;
  let visible = true;
  let motionRequested = true;
  let orbitRequested = false;
  let dragging = false;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let raf = 0;
  let hoverRaf = 0;
  let hoverClientX = 0;
  let hoverClientY = 0;
  let lastFrame = 0;
  let themeSignature = '';
  let modelSignature = '';
  let activeLinkCount = 0;
  let activeInternalCount = 0;
  let animatedEquipmentCount = 0;
  let equipmentTime = 0;
  let hasInitialSelection = false;
  let hasFitProjection = false;
  let flowDragging = false;
  let flowTargetId: string | null = null;
  let flowPointerId: number | null = null;
  let flowClientX = 0;
  let flowClientY = 0;

  function validFlowTarget(id: string | null) {
    return data.mode === 'live' && data.nodes.some(node => node.id === id && node.kind === 'tunnel' && node.switchable && !node.active);
  }

  function refreshFlowGuide() {
    flowGuide.children.slice().forEach(child => { flowGuide.remove(child); disposeObject(child); });
    if (!flowDragging) return;
    for (const node of data.nodes) {
      if (!validFlowTarget(node.id)) continue;
      const selected = node.id === flowTargetId;
      const box = new THREE.BoxGeometry(3.9, 1.6, 1.9);
      const geometry = new THREE.EdgesGeometry(box);
      box.dispose();
      const outline = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
        color: selected ? TWIN_PALETTE.text : TWIN_PALETTE.selection,
        transparent: true, opacity: selected ? 1 : 0.55, depthTest: false, toneMapped: false,
      }));
      outline.position.set(node.position[0], node.position[1] + 0.8, node.position[2]);
      flowGuide.add(outline);
    }
  }

  function beginFlowDrag(clientX: number, clientY: number) {
    if (disposed || failed || flowDragging || dragging || !onFlowDrop || data.mode !== 'live' || !data.nodes.some(node => validFlowTarget(node.id))) return false;
    flowDragging = true;
    controls.enabled = false;
    controls.autoRotate = false;
    orbitRequested = false;
    onFocus?.('flow');
    setHovered(null);
    flowGuide.visible = flowPacket.visible = true;
    renderer.domElement.dataset.flowDragging = 'true';
    refreshFlowGuide();
    onFlowDrag?.(null, true);
    moveFlowDrag(clientX, clientY);
    return true;
  }

  function moveFlowDrag(clientX: number, clientY: number) {
    if (!flowDragging) return;
    flowClientX = clientX;
    flowClientY = clientY;
    // nodeAt also updates the ray for the floating packet, including points outside the viewport.
    const hit = nodeAt(clientX, clientY);
    const bounds = renderer.domElement.getBoundingClientRect();
    const inside = clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom;
    const target = inside && validFlowTarget(hit) ? hit : null;
    if (flowTargetId !== target) {
      flowTargetId = target;
      refreshFlowGuide();
      onFlowDrag?.(target, true);
    }
    raycaster.ray.intersectPlane(new THREE.Plane(UP, -1.25), flowPacket.position);
    renderer.domElement.style.cursor = target ? 'copy' : 'grabbing';
    invalidate();
  }

  function endFlowDrag(commit: boolean) {
    if (!flowDragging) return;
    // Recheck current telemetry at release; a tunnel may disappear during a drag.
    const target = flowTargetId;
    flowDragging = false;
    flowTargetId = null;
    flowGuide.visible = flowPacket.visible = false;
    refreshFlowGuide();
    controls.enabled = true;
    delete renderer.domElement.dataset.flowDragging;
    const captured = flowPointerId;
    flowPointerId = null;
    if (captured !== null && renderer.domElement.hasPointerCapture(captured)) renderer.domElement.releasePointerCapture(captured);
    renderer.domElement.style.cursor = 'grab';
    if (commit && validFlowTarget(target) && target) onFlowDrop?.(target);
    onFlowDrag?.(null, false);
    invalidate();
  }

  function flowAt(clientX: number, clientY: number, touch: boolean) {
    if (!onFlowDrop || data.mode !== 'live') return false;
    const bounds = renderer.domElement.getBoundingClientRect();
    const point = new THREE.Vector3();
    const threshold = touch ? 20 : 12;
    // Hit-test the continuous active rail, rather than requiring a moving packet to be caught.
    for (const link of linkMap.values()) {
      if (!link.active || !(link.from.startsWith('tunnel:') || link.to.startsWith('tunnel:'))) continue;
      for (let index = 0; index <= 48; index++) {
        link.curve.getPointAt(index / 48, point).project(camera);
        if (Math.hypot(bounds.left + (point.x + 1) * bounds.width / 2 - clientX,
          bounds.top + (1 - point.y) * bounds.height / 2 - clientY) <= threshold) return true;
      }
    }
    return false;
  }

  function canAnimate() {
    return !disposed && !failed && visible && !document.hidden && !media.matches &&
      ((motionRequested && (activeLinkCount > 0 || activeInternalCount > 0 || animatedEquipmentCount > 0 || orbitRequested)) || dragging);
  }

  function positionPackets(delta: number) {
    for (const link of linkMap.values()) {
      if (!link.active) continue;
      if (delta) link.phase = (link.phase + delta * 2.2 / Math.max(link.length, 0.5)) % 1;
      for (let index = 0; index < link.packets.length; index++) {
        const packet = link.packets[index];
        const t = (link.phase + index / link.packets.length) % 1;
        link.curve.getPointAt(t, packetPosition);
        link.curve.getTangentAt(t, packetTangent);
        packet.position.copy(packetPosition);
        packet.quaternion.setFromUnitVectors(UP, packetTangent);
      }
    }
    for (const node of nodeMap.values()) {
      if (!node.internalActive || !node.internalFlow) continue;
      const flow = node.internalFlow;
      if (delta) node.internalPhase = (node.internalPhase + delta * 1.7 / Math.max(flow.endX - flow.startX, 0.5)) % 1;
      for (let index = 0; index < node.internalPackets.length; index++) {
        const packet = node.internalPackets[index];
        const t = (node.internalPhase + index / node.internalPackets.length) % 1;
        packet.position.set(THREE.MathUtils.lerp(flow.startX, flow.endX, t), flow.y, flow.z);
      }
    }
  }

  function renderFrame(time: number) {
    raf = 0;
    if (disposed || failed || !visible || document.hidden) return;
    const delta = lastFrame ? Math.min((time - lastFrame) / 1000, 0.06) : 0;
    lastFrame = time;
    const moving = motionRequested && !media.matches;
    controls.autoRotate = moving && orbitRequested && !flowDragging;
    if (controls.autoRotate) controls.update(delta);
    if (moving) equipmentTime += delta;
    positionPackets(moving ? delta : 0);
    for (const node of nodeMap.values()) node.motion.render(equipmentTime, media.matches);
    renderer.render(scene, camera);
    if (canAnimate() && !raf) raf = window.requestAnimationFrame(renderFrame);
    else lastFrame = 0;
  }

  function invalidate() {
    if (disposed || failed || raf || !visible || document.hidden) return;
    raf = window.requestAnimationFrame(renderFrame);
  }

  function setSelection(id: string | null) {
    selectedId = id;
    const node = data.nodes.find((item) => item.id === id);
    selection.visible = Boolean(node);
    if (node) selection.position.set(node.position[0], node.position[1] + 0.032, node.position[2]);
    // Selection brightens the physical carrier metal, without changing signal color or traffic state.
    for (const link of linkMap.values()) {
      const connected = id !== null && (link.from === id || link.to === id);
      link.carrierMaterial.color.set(connected ? TWIN_PALETTE.enclosure : TWIN_PALETTE.wallFrame);
      link.edgeMaterial.color.set(connected ? TWIN_PALETTE.text : TWIN_PALETTE.metal);
      link.carrierMaterial.roughness = connected ? 0.48 : 0.55;
    }
    if (stationMarkers) {
      for (const [stationId, first] of stationRanges) {
        for (let index = 0; index < 8; index++) stationMarkers.setColorAt(first + index, stationId === id ? selectedStationPaint : stationPaint);
      }
      if (stationMarkers.instanceColor) stationMarkers.instanceColor.needsUpdate = true;
    }
    invalidate();
  }

  function setHovered(id: string | null) {
    const changed = hoveredId !== id;
    hoveredId = id;
    const node = data.nodes.find((item) => item.id === id);
    hoverRing.visible = Boolean(node);
    if (node) {
      hoverRing.position.set(node.position[0], node.position[1] + 0.019, node.position[2]);
      hoverRing.scale.set(node.kind === 'tunnel' ? 1.25 : 1, node.kind === 'tunnel' ? 0.5 : 1, 1);
    }
    renderer.domElement.style.cursor = dragging ? 'grabbing' : node ? 'pointer' : 'grab';
    if (changed) onHover?.(id);
    invalidate();
  }

  function selectNode(id: string | null) {
    const changed = selectedId !== id;
    const canFocus = hasInitialSelection && changed && id !== null && host.clientWidth < 650;
    if (id !== null) hasInitialSelection = true;
    setSelection(id);
    if (canFocus && id) focusNode(id);
  }

  function projectedBounds(nodes: FailoverSceneNode[], includePremises: boolean) {
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const point = new THREE.Vector3();
    function include(x: number, y: number, z: number) {
      point.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
    function includeSprite(sprite: THREE.Sprite) {
      const scale = sprite.getWorldScale(new THREE.Vector3());
      sprite.getWorldPosition(point).applyMatrix4(camera.matrixWorldInverse);
      minX = Math.min(minX, point.x - scale.x / 2);
      maxX = Math.max(maxX, point.x + scale.x / 2);
      minY = Math.min(minY, point.y - scale.y / 2);
      maxY = Math.max(maxY, point.y + scale.y / 2);
    }
    if (includePremises) {
      for (const x of [ROOM_BOUNDS.min[0], ROOM_BOUNDS.max[0]]) {
        for (const z of [ROOM_BOUNDS.min[2], ROOM_BOUNDS.max[2]]) {
          include(x, ROOM_BOUNDS.min[1], z);
          include(x, ROOM_BOUNDS.max[1], z);
        }
      }
      stage.traverse((object) => { if (object instanceof THREE.Sprite) includeSprite(object); });
    }
    for (const node of nodes) {
      const radiusX = node.kind === 'tunnel' ? 1.7 : node.kind === 'cloud' || node.kind === 'internet' ? 1.3 : 1.15;
      const radiusZ = node.kind === 'tunnel' ? 0.6 : 1.15;
      const height = node.kind === 'cellular' ? 2.4 : node.kind === 'cloud' ? 2.3 : node.kind === 'internet' ? 2 : node.kind === 'tunnel' ? 1.35 : 1.5;
      for (const x of [-radiusX, radiusX]) {
        for (const z of [-radiusZ, radiusZ]) {
          include(node.position[0] + x, node.position[1], node.position[2] + z);
          include(node.position[0] + x, node.position[1] + height, node.position[2] + z);
        }
      }
      const existing = nodeMap.get(node.id);
      if (existing) includeSprite(existing.label);
    }
    if (!Number.isFinite(minX + minY + maxX + maxY)) return { minX: -15, maxX: 15, minY: -4, maxY: 4 };
    return { minX, minY, maxX, maxY };
  }

  function centerProjection(bounds: ReturnType<typeof projectedBounds>) {
    const shift = new THREE.Vector3((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, 0)
      .applyQuaternion(camera.quaternion);
    camera.position.add(shift);
    controls.target.add(shift);
    controls.update();
  }

  function fitProjection(center: boolean) {
    const aspect = Math.max(1, host.clientWidth) / Math.max(1, host.clientHeight);
    const bounds = projectedBounds(data.nodes, true);
    const projectedWidth = Math.max(1, bounds.maxX - bounds.minX);
    const projectedHeight = Math.max(1, bounds.maxY - bounds.minY);
    const width = Math.max(projectedWidth, projectedHeight * aspect) * 1.1;
    const height = width / aspect;
    if (center) centerProjection(bounds);
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.updateProjectionMatrix();
  }

  function focusNode(id: string) {
    if (disposed || failed) return;
    const nodes = id === 'tunnels' ? data.nodes.filter((node) => node.kind === 'tunnel') : data.nodes.filter((node) => node.id === id);
    if (!nodes.length) return;
    orbitRequested = false;
    controls.autoRotate = false;
    const target = new THREE.Vector3();
    for (const node of nodes) target.add(new THREE.Vector3(node.position[0], node.position[1] + 0.75, node.position[2]));
    target.divideScalar(nodes.length);
    const offset = camera.position.clone().sub(controls.target);
    controls.target.copy(target);
    camera.position.copy(target).add(offset);
    controls.update();
    const bounds = projectedBounds(nodes, false);
    centerProjection(bounds);
    const width = Math.max(1.2, bounds.maxX - bounds.minX) * 1.28;
    const height = Math.max(1.2, bounds.maxY - bounds.minY) * 1.28;
    camera.zoom = THREE.MathUtils.clamp(Math.min((camera.right - camera.left) / width, (camera.top - camera.bottom) / height), 0.25, 24);
    camera.updateProjectionMatrix();
    onFocus?.(id);
    invalidate();
  }

  function rebuildStage() {
    stage.children.slice().forEach((child) => { stage.remove(child); disposeObject(child); });
    stage.add(
      createIndustrialRoom(),
      createPremise(TWIN_LAYOUT.enterprise.width, TWIN_LAYOUT.enterprise.centerX, 'ENTERPRISE PREMISES', theme.enterprise, theme),
      createPremise(TWIN_LAYOUT.operator.width, TWIN_LAYOUT.operator.centerX, 'OPERATOR PREMISES', theme.operator, theme),
    );
    scene.background = new THREE.Color(TWIN_PALETTE.backdrop);
    scene.fog = new THREE.Fog(TWIN_PALETTE.backdrop, 46, 100);
    ground.material.color.set(TWIN_PALETTE.backdrop);
    renderer.toneMappingExposure = STUDIO.exposure;
    hemi.intensity = STUDIO.hemisphere;
    key.intensity = STUDIO.key;
    rim.intensity = STUDIO.rim;
    fill.intensity = STUDIO.fill;
    scene.environmentIntensity = STUDIO.environment;
    selectionMaterial.color.set(TWIN_PALETTE.selection);
  }

  function rebuildNodes() {
    nodeRoot.children.slice().forEach((child) => { nodeRoot.remove(child); disposeObject(child); });
    shadows.children.slice().forEach((child) => { shadows.remove(child); disposeObject(child); });
    nodeMap.clear();
    stationRanges.clear();
    stationMarkers = null;
    if (data.nodes.length) {
      stationMarkers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({
        color: '#ffffff', transparent: true, opacity: 0.32, toneMapped: false,
      }), data.nodes.length * 8);
      const transform = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const scale = new THREE.Vector3();
      const rotation = new THREE.Quaternion();
      let instance = 0;
      for (const node of data.nodes) {
        stationRanges.set(node.id, instance);
        const radiusX = node.kind === 'tunnel' ? 1.87 : 1.35;
        const radiusZ = node.kind === 'tunnel' ? 0.83 : 1.25;
        const arm = 0.3;
        for (const sideX of [-1, 1]) {
          for (const sideZ of [-1, 1]) {
            position.set(node.position[0] + sideX * (radiusX - arm / 2), node.position[1] + 0.008, node.position[2] + sideZ * radiusZ);
            scale.set(arm, 0.006, 0.025);
            transform.compose(position, rotation, scale);
            stationMarkers.setMatrixAt(instance, transform);
            stationMarkers.setColorAt(instance++, stationPaint);
            position.set(node.position[0] + sideX * radiusX, node.position[1] + 0.008, node.position[2] + sideZ * (radiusZ - arm / 2));
            scale.set(0.025, 0.006, arm);
            transform.compose(position, rotation, scale);
            stationMarkers.setMatrixAt(instance, transform);
            stationMarkers.setColorAt(instance++, stationPaint);
          }
        }
      }
      stationMarkers.instanceMatrix.needsUpdate = true;
      shadows.add(stationMarkers);
    }
    const texture = contactShadowTexture();
    for (const node of data.nodes) {
      const object = createNodeModel(node, theme);
      const motion = createEquipmentMotion(object, node);
      object.position.set(...node.position);
      const internalFlow = object.userData.tunnelFlow as SceneNode['internalFlow'];
      const internalPackets: SceneNode['internalPackets'] = [];
      if (internalFlow) {
        const geometry = new THREE.CapsuleGeometry(0.088, 0.22, 3, 7);
        const material = new THREE.MeshBasicMaterial({ color: node.color, toneMapped: false });
        for (let index = 0; index < 3; index++) {
          const packet = new THREE.Mesh(geometry, material);
          packet.rotation.z = -Math.PI / 2;
          object.add(packet);
          internalPackets.push(packet);
        }
      }
      object.traverse((child) => { child.userData.nodeId = node.id; });
      const label = labelSprite(node.label.toUpperCase(), theme.text, EQUIPMENT_LABEL_WIDTH);
      const height = node.kind === 'tunnel' ? 0.36 : node.kind === 'cellular' ? 3.03 : node.kind === 'cloud' ? 2.95 : node.kind === 'internet' ? 2.65 : 2.12;
      label.position.set(0, height, node.kind === 'tunnel' ? 0.74 : 0);
      label.userData.nodeId = node.id;
      object.add(label);
      nodeRoot.add(object);
      nodeMap.set(node.id, { object, label, labelText: node.label, kind: node.kind, internalFlow, internalPackets, internalPhase: 0, internalActive: false, motion });
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.8), new THREE.MeshBasicMaterial({
        map: texture, transparent: true, opacity: theme.light ? 0.55 : 0.75, depthWrite: false,
      }));
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(node.position[0] + 0.12, node.position[1] + 0.007, node.position[2] + 0.17);
      shadows.add(shadow);
    }
    if (!data.nodes.length) texture.dispose();
  }

  function update(nextData: FailoverSceneData, nextTheme: FailoverSceneTheme) {
    if (disposed || failed) return;
    data = nextData;
    theme = nextTheme;
    const nextThemeSignature = JSON.stringify(theme);
    const nextModelSignature = data.nodes.map((node) => `${node.id}:${node.kind}:${node.position.join(',')}`).join('|');
    const themeChanged = nextThemeSignature !== themeSignature;
    const layoutChanged = modelSignature !== nextModelSignature;
    if (themeChanged) rebuildStage();
    if (themeChanged || layoutChanged) {
      rebuildNodes();
      renderer.shadowMap.needsUpdate = true;
    }
    themeSignature = nextThemeSignature;
    modelSignature = nextModelSignature;
    const ids = new Set(data.links.map((link) => link.id));
    for (const [id, existing] of linkMap) {
      if (!ids.has(id) || themeChanged) {
        linkRoot.remove(existing.object);
        disposeObject(existing.object);
        linkMap.delete(id);
      }
    }
    const nodeData = new Map(data.nodes.map((node) => [node.id, node]));
    for (const link of data.links) {
      const from = nodeData.get(link.from);
      const to = nodeData.get(link.to);
      if (!from || !to) {
        const orphan = linkMap.get(link.id);
        if (orphan) {
          linkRoot.remove(orphan.object);
          disposeObject(orphan.object);
          linkMap.delete(link.id);
        }
        continue;
      }
      const signature = linkSignature(link, from, to);
      const existing = linkMap.get(link.id);
      if (existing?.signature === signature) continue;
      const phase = existing?.phase || 0;
      if (existing) { linkRoot.remove(existing.object); disposeObject(existing.object); }
      const next = buildLink(link, from, to, theme);
      next.phase = phase;
      linkMap.set(link.id, next);
      linkRoot.add(next.object);
    }
    activeLinkCount = 0;
    const activeNodeIds = new Set<string>();
    for (const link of linkMap.values()) if (link.active) {
      activeLinkCount++;
      activeNodeIds.add(link.from);
      activeNodeIds.add(link.to);
    }
    activeInternalCount = 0;
    animatedEquipmentCount = 0;
    for (const node of data.nodes) {
      const existing = nodeMap.get(node.id);
      if (!existing) continue;
      const displayedNode = { ...node, active: node.active !== false && activeNodeIds.has(node.id) };
      updateNodeModel(existing.object, displayedNode, theme);
      existing.motion.update(displayedNode);
      const routeState = node.metrics?.find(metric => metric.label === 'STATE')?.value;
      const suffix = routeState === 'REQUESTED ROUTE' ? 'REQUESTED' : routeState === 'POLICY ROUTE' ? 'POLICY' : 'ACTIVE';
      const labelText = node.kind === 'tunnel' && displayedNode.active && node.status !== 'idle'
        ? `${node.label} · ${suffix}` : node.label;
      if (labelText !== existing.labelText) {
        const nextLabel = labelSprite(labelText.toUpperCase(), theme.text, EQUIPMENT_LABEL_WIDTH);
        nextLabel.position.copy(existing.label.position);
        nextLabel.userData.nodeId = node.id;
        existing.object.remove(existing.label);
        disposeObject(existing.label);
        existing.object.add(nextLabel);
        existing.label = nextLabel;
        existing.labelText = labelText;
      }
      existing.motion.render(equipmentTime, media.matches);
      if (existing.motion.animated) animatedEquipmentCount++;
      existing.internalActive = Boolean(existing.internalFlow && node.active && node.status !== 'idle');
      if (existing.internalActive) activeInternalCount++;
      for (const packet of existing.internalPackets) {
        packet.visible = existing.internalActive;
        packet.material.color.set(node.color);
      }
    }
    positionPackets(0);
    setSelection(selectedId);
    setHovered(hoveredId);
    if (flowDragging) {
      if (data.mode !== 'live' || !data.nodes.some(node => validFlowTarget(node.id))) endFlowDrag(false);
      else { refreshFlowGuide(); moveFlowDrag(flowClientX, flowClientY); }
    }
    invalidate();
  }

  function resize() {
    if (disposed || failed) return;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    fitProjection(!hasFitProjection);
    hasFitProjection = true;
    renderer.setSize(width, height, false);
    invalidate();
  }

  function visibilityChanged() {
    if (document.hidden) endFlowDrag(false);
    if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
    lastFrame = 0;
    invalidate();
  }

  function contextLost(event: Event) {
    event.preventDefault();
    if (disposed || failed) return;
    failed = true;
    endFlowDrag(false);
    if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
    if (hoverRaf) { window.cancelAnimationFrame(hoverRaf); hoverRaf = 0; }
    onHover?.(null);
    onFailure();
  }

  function pointerDown(event: PointerEvent) {
    if (event.isPrimary && event.button === 0 && flowAt(event.clientX, event.clientY, event.pointerType === 'touch') && beginFlowDrag(event.clientX, event.clientY)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      pointerStartX = event.clientX;
      pointerStartY = event.clientY;
      flowPointerId = event.pointerId;
      renderer.domElement.setPointerCapture(event.pointerId);
      return;
    }
    if (flowDragging) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (event.button < 0 || event.button > 2) return;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    dragging = true;
    invalidate();
  }

  function nodeAt(clientX: number, clientY: number) {
    const bounds = renderer.domElement.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    pointer.set((clientX - bounds.left) / bounds.width * 2 - 1, -(clientY - bounds.top) / bounds.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(nodeRoot.children, true)
      .find((intersection) => typeof intersection.object.userData.nodeId === 'string');
    return hit ? hit.object.userData.nodeId as string : null;
  }

  function refreshHover() {
    hoverRaf = 0;
    if (disposed || failed || dragging || !visible || document.hidden) return;
    setHovered(nodeAt(hoverClientX, hoverClientY));
  }

  function pointerMove(event: PointerEvent) {
    if (flowDragging && flowPointerId === event.pointerId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      moveFlowDrag(event.clientX, event.clientY);
      return;
    }
    hoverClientX = event.clientX;
    hoverClientY = event.clientY;
    if (dragging) {
      if (Math.hypot(event.clientX - pointerStartX, event.clientY - pointerStartY) > 5) setHovered(null);
      return;
    }
    if (!hoverRaf) hoverRaf = window.requestAnimationFrame(refreshHover);
  }

  function pointerLeave() {
    if (flowDragging) return;
    if (hoverRaf) { window.cancelAnimationFrame(hoverRaf); hoverRaf = 0; }
    setHovered(null);
  }

  function pointerUp(event: PointerEvent) {
    if (flowDragging && flowPointerId === event.pointerId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      moveFlowDrag(event.clientX, event.clientY);
      endFlowDrag(Math.hypot(event.clientX - pointerStartX, event.clientY - pointerStartY) > 5);
      return;
    }
    if (!dragging) return;
    dragging = false;
    const distance = Math.hypot(event.clientX - pointerStartX, event.clientY - pointerStartY);
    const id = nodeAt(event.clientX, event.clientY);
    setHovered(id);
    if (distance > 5 || event.button !== 0) return;
    if (id) onSelect(id);
    invalidate();
  }

  function cancelPointer() { dragging = false; endFlowDrag(false); setHovered(null); }
  function escapeFlow(event: KeyboardEvent) { if (event.key === 'Escape') endFlowDrag(false); }

  function doubleClick(event: MouseEvent) {
    const id = nodeAt(event.clientX, event.clientY);
    if (!id) return;
    onSelect(id);
    focusNode(id);
  }

  const observer = new ResizeObserver(resize);
  observer.observe(host);
  const intersection = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    visibilityChanged();
  }, { rootMargin: '0px' });
  intersection.observe(host);
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  renderer.domElement.addEventListener('pointerdown', pointerDown, true);
  renderer.domElement.addEventListener('pointerup', pointerUp, true);
  renderer.domElement.addEventListener('pointercancel', cancelPointer);
  renderer.domElement.addEventListener('lostpointercapture', cancelPointer);
  renderer.domElement.addEventListener('pointermove', pointerMove, true);
  renderer.domElement.addEventListener('pointerleave', pointerLeave);
  renderer.domElement.addEventListener('dblclick', doubleClick);
  document.addEventListener('visibilitychange', visibilityChanged);
  window.addEventListener('keydown', escapeFlow);
  media.addEventListener('change', visibilityChanged);
  controls.addEventListener('change', invalidate);
  update(initialData, initialTheme);
  resize();

  const api: FailoverSceneRenderer & { focus(id: string): void } = {
    update,
    select: selectNode,
    focus: focusNode,
    reset() {
      orbitRequested = false;
      controls.autoRotate = false;
      camera.position.copy(START_POSITION);
      camera.zoom = 1;
      camera.updateProjectionMatrix();
      controls.target.copy(TARGET);
      controls.update();
      fitProjection(true);
      invalidate();
    },
    zoom(direction) {
      camera.zoom = THREE.MathUtils.clamp(camera.zoom * (direction === 'in' ? 1.2 : 1 / 1.2), 0.25, 24);
      camera.updateProjectionMatrix();
      invalidate();
    },
    setMotion(enabled) { motionRequested = enabled; visibilityChanged(); },
    setOrbit(enabled) { orbitRequested = enabled; visibilityChanged(); },
    beginFlowDrag,
    moveFlowDrag,
    endFlowDrag,
    resize,
    dispose() {
      if (disposed) return;
      disposed = true;
      endFlowDrag(false);
      if (raf) window.cancelAnimationFrame(raf);
      if (hoverRaf) window.cancelAnimationFrame(hoverRaf);
      observer.disconnect();
      intersection.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      renderer.domElement.removeEventListener('pointerdown', pointerDown, true);
      renderer.domElement.removeEventListener('pointerup', pointerUp, true);
      renderer.domElement.removeEventListener('pointercancel', cancelPointer);
      renderer.domElement.removeEventListener('lostpointercapture', cancelPointer);
      renderer.domElement.removeEventListener('pointermove', pointerMove, true);
      renderer.domElement.removeEventListener('pointerleave', pointerLeave);
      renderer.domElement.removeEventListener('dblclick', doubleClick);
      document.removeEventListener('visibilitychange', visibilityChanged);
      window.removeEventListener('keydown', escapeFlow);
      media.removeEventListener('change', visibilityChanged);
      controls.removeEventListener('change', invalidate);
      controls.dispose();
      key.shadow.dispose();
      disposeObject(scene);
      environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      nodeMap.clear();
      linkMap.clear();
    },
  };
  return api;
}
