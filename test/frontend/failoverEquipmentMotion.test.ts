import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createEquipmentMotion } from '../../src/components/widgets/failoverEquipmentMotion';
import { createNodeModel, disposeModel } from '../../src/components/widgets/failoverSceneModels';
import type { FailoverSceneNode, FailoverSceneTheme } from '../../src/components/widgets/failoverSceneTypes';

const theme: FailoverSceneTheme = {
  light: false, text: '#f4efdf', muted: '#717783', enterprise: '#528780',
  operator: '#9b8461', ok: '#43cf91', warn: '#edb64e', err: '#ed7272',
};
const kinds: Array<FailoverSceneNode['kind']> = [
  'devices', 'gateway', 'fiber', 'cellular', 'tunnel', 'sdwan', 'internet', 'cloud',
];

function node(kind: FailoverSceneNode['kind'], changes: Partial<FailoverSceneNode> = {}): FailoverSceneNode {
  return {
    id: kind === 'devices' ? 'it-devices' : kind, label: kind.toUpperCase(), kind,
    position: [0, 0, 0], color: '#49bd93', status: 'ok', active: true,
    detail: 'LOCAL TEST FIXTURE', ...changes,
  };
}

function fixture(input: FailoverSceneNode) {
  const group = createNodeModel(input, theme);
  const motion = createEquipmentMotion(group, input);
  return { group, motion };
}

function pose(group: THREE.Group) {
  const result: Array<Record<string, unknown>> = [];
  group.traverse(object => {
    const value: Record<string, unknown> = {
      name: object.name, position: object.position.toArray(), quaternion: object.quaternion.toArray(),
      scale: object.scale.toArray(), visible: object.visible,
    };
    if (object instanceof THREE.Mesh) {
      value.materials = (Array.isArray(object.material) ? object.material : [object.material]).map(material => {
        const basic = material as THREE.MeshBasicMaterial;
        const standard = material as THREE.MeshStandardMaterial;
        return {
          color: basic.color?.getHex(), emissive: standard.emissive?.getHex(),
          emissiveIntensity: standard.emissiveIntensity, opacity: material.opacity,
          transparent: material.transparent, visible: material.visible,
        };
      });
    }
    if (object instanceof THREE.InstancedMesh) value.instances = Array.from(object.instanceMatrix.array);
    result.push(value);
  });
  return result;
}

function resources(group: THREE.Group) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const instances = new Set<THREE.InstancedMesh>();
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    if (object instanceof THREE.InstancedMesh) instances.add(object);
  });
  return { geometries, materials, instances };
}

function transientSignals(group: THREE.Group) {
  const signals: THREE.Mesh[] = [];
  group.traverse(object => {
    if (object instanceof THREE.Mesh && object.userData.equipmentMotion && object.userData.effectRole !== 'optical-lead') signals.push(object);
  });
  return signals;
}

function assertFinite(value: unknown, path: string) {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} must be finite`);
  else if (Array.isArray(value)) value.forEach((entry, index) => assertFinite(entry, `${path}[${index}]`));
  else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) assertFinite(entry, `${path}.${key}`);
  }
}

test('each available active equipment kind has a distinct animated pose while tunnels leave traffic to the renderer', () => {
  const inputs = kinds.map(kind => node(kind));
  inputs.push(node('devices', { id: 'ot-devices', label: 'OT DEVICES' }));
  for (const input of inputs) {
    const { group, motion } = fixture(input);
    try {
      motion.render(0, false);
      const first = pose(group);
      motion.render(1.37, false);
      const later = pose(group);
      assertFinite(later, input.id);
      if (input.kind === 'tunnel') {
        assert.equal(motion.animated, false, 'tunnel traffic belongs to the renderer');
        assert.deepEqual(later, first, 'equipment motion must not invent tunnel traffic');
      } else {
        assert.equal(motion.animated, true, `${input.id} must keep the renderer animation loop eligible`);
        assert.notDeepEqual(later, first, `${input.id} must actually animate`);
      }
    } finally { disposeModel(group); }
  }
});

test('healthy standby only retains availability motion, not forwarding motion', () => {
  for (const kind of kinds) {
    const { group, motion } = fixture(node(kind, { active: false }));
    try {
      motion.render(0, false);
      const first = pose(group);
      motion.render(1.37, false);
      const later = pose(group);
      const ambient = kind === 'cellular' || kind === 'internet';
      assert.equal(motion.animated, ambient, `${kind} standby animation eligibility`);
      if (ambient) assert.notDeepEqual(later, first, `${kind} can show availability without traffic`);
      else assert.deepEqual(later, first, `${kind} standby must not imply forwarding`);
      for (const signal of transientSignals(group)) {
        assert.equal(signal.visible, signal.userData.effectRole === 'radio-wave', `${kind} standby must hide forwarding effects`);
      }
    } finally { disposeModel(group); }
  }
});

test('idle and error suppress equipment effects, including an active flag left over from telemetry', () => {
  for (const kind of kinds) for (const status of ['idle', 'err'] as const) {
    const input = node(kind);
    const { group, motion } = fixture(input);
    try {
      motion.render(2, false);
      motion.update({ ...input, status, active: true });
      motion.render(2, false);
      const suppressed = pose(group);
      motion.render(17, false);
      assert.equal(motion.animated, false, `${kind} ${status} must not request animation frames`);
      assert.deepEqual(pose(group), suppressed, `${kind} ${status} must not continue equipment effects`);
      for (const signal of transientSignals(group)) assert.equal(signal.visible, false, `${kind} ${status} must hide success effects`);
    } finally { disposeModel(group); }
  }
});

test('explicit zero reachable and WAN-down metrics suppress success effects without treating all warnings as down', () => {
  const samples: Array<[FailoverSceneNode['kind'], { label: string; value: string }]> = [
    ['fiber', { label: 'REACHABLE', value: '0 / 2' }],
    ['cellular', { label: 'REACHABLE', value: '0 / 2' }],
    ['internet', { label: 'WAN PATH', value: 'DOWN' }],
    ['cloud', { label: 'WAN PATH', value: 'DOWN' }],
    ['sdwan', { label: 'GATEWAY WAN', value: 'DOWN' }],
  ];
  for (const [kind, metric] of samples) {
    const input = node(kind, { status: 'warn' });
    const { group, motion } = fixture(input);
    try {
      assert.equal(motion.animated, true, `${kind} warning alone does not mean unavailable`);
      motion.update({ ...input, metrics: [metric] });
      motion.render(1, false);
      const down = pose(group);
      motion.render(2, false);
      assert.equal(motion.animated, false, `${kind} explicit unavailability suppresses equipment effects`);
      assert.deepEqual(pose(group), down);
      motion.update({ ...input, metrics: [] });
      assert.equal(motion.animated, true, `${kind} recovers from authoritative availability changes`);
    } finally { disposeModel(group); }
  }
});

test('elapsed time reproduces an exact frozen pose after forward and backward seeks', () => {
  for (const kind of kinds.filter(kind => kind !== 'tunnel')) {
    const reused = fixture(node(kind));
    const direct = fixture(node(kind));
    try {
      for (const time of [0, 0.04, 1.1, 8, 30, 4, 0.5]) reused.motion.render(time, false);
      reused.motion.render(5.25, false);
      direct.motion.render(5.25, false);
      const frozen = pose(reused.group);
      assert.deepEqual(frozen, pose(direct.group), `${kind} pose depends on elapsed time, not frame history`);
      for (let index = 0; index < 8; index++) reused.motion.render(5.25, false);
      assert.deepEqual(pose(reused.group), frozen, `${kind} stays frozen when the renderer clock is paused`);
    } finally { disposeModel(reused.group); disposeModel(direct.group); }
  }
});

test('reduced motion resets to the same static presentation at any time and resumes deterministically', () => {
  for (const kind of kinds) {
    const moving = fixture(node(kind));
    const reference = fixture(node(kind));
    try {
      moving.motion.render(6.2, false);
      moving.motion.render(6.2, true);
      reference.motion.render(0, true);
      const staticPose = pose(reference.group);
      assert.deepEqual(pose(moving.group), staticPose, `${kind} reduced motion clears the animated pose`);
      moving.motion.render(150, true);
      assert.deepEqual(pose(moving.group), staticPose, `${kind} reduced motion is independent of elapsed time`);
      moving.motion.render(6.2, false);
      reference.motion.render(6.2, false);
      assert.deepEqual(pose(moving.group), pose(reference.group), `${kind} resumes without accumulated drift`);
    } finally { disposeModel(moving.group); disposeModel(reference.group); }
  }
});

test('motion owns no detached or per-frame resources and ordinary model disposal releases each resource once', () => {
  for (const kind of kinds) {
    const { group, motion } = fixture(node(kind));
    const before = resources(group);
    for (let frame = 0; frame < 40; frame++) motion.render(frame / 10, frame > 30);
    motion.update(node(kind, { active: false }));
    motion.render(5, false);
    const after = resources(group);
    assert.deepEqual(after, before, `${kind} must not allocate scene resources during updates or rendering`);
    const counts = new Map<THREE.BufferGeometry | THREE.Material | THREE.InstancedMesh, number>();
    for (const resource of [...before.geometries, ...before.materials, ...before.instances]) {
      counts.set(resource, 0);
      const released = () => counts.set(resource, counts.get(resource)! + 1);
      if (resource instanceof THREE.BufferGeometry) resource.addEventListener('dispose', released);
      else if (resource instanceof THREE.Material) resource.addEventListener('dispose', released);
      else resource.addEventListener('dispose', released);
    }
    disposeModel(group);
    for (const count of counts.values()) assert.equal(count, 1, `${kind} descendant resources must be released exactly once`);
  }
});

test('activity cues preserve equipment identity and reported health paint', () => {
  for (const kind of kinds) {
    const input = node(kind);
    const { group, motion } = fixture(input);
    try {
      const authoritativePaint = [...resources(group).materials]
        .filter(material => material instanceof THREE.MeshStandardMaterial && (material.userData.statusColor || material.userData.onlineColor)) as THREE.MeshStandardMaterial[];
      const initial = authoritativePaint.map(material => [material.color.getHex(), material.emissive.getHex(), material.emissiveIntensity]);
      for (const time of [0, 0.1, 1, 3, 18]) motion.render(time, false);
      motion.update({ ...input, color: '#edb64e', active: false });
      motion.render(18, true);
      assert.deepEqual(authoritativePaint.map(material => [material.color.getHex(), material.emissive.getHex(), material.emissiveIntensity]), initial, `${kind} activity cues must not recolor physical equipment or its reported health`);
    } finally { disposeModel(group); }
  }
});
