import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createNodeModel, disposeModel, updateNodeModel } from '../../src/components/widgets/failoverSceneModels';
import type { FailoverSceneNode, FailoverSceneTheme } from '../../src/components/widgets/failoverSceneTypes';

const theme: FailoverSceneTheme = {
  light: false, text: '#eef0f7', muted: '#adb4c6', enterprise: '#c9ba91', operator: '#939cc8',
  ok: '#85d9ff', warn: '#ddb56b', err: '#df898e',
};
const fixture = (kind: FailoverSceneNode['kind'], active = true): FailoverSceneNode => ({
  id: kind === 'devices' ? 'it-devices' : kind, label: kind.toUpperCase(), kind, active,
  position: [0, 0, 0], color: '#85d9ff', status: 'ok', detail: 'FIBER',
});
function materials(model: THREE.Group): THREE.MeshStandardMaterial[] {
  const result = new Set<THREE.MeshStandardMaterial>();
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material instanceof THREE.MeshStandardMaterial) result.add(material);
    }
  });
  return [...result];
}

test('switching the route transfers illumination and resets the former tunnel without rebuilding it', () => {
  const fiber = fixture('tunnel');
  const cellular = { ...fiber, id: 'cell-tunnel', detail: 'CELLULAR', active: false };
  const first = createNodeModel(fiber, theme);
  const second = createNodeModel(cellular, theme);
  const firstMaterials = materials(first);
  const secondMaterials = materials(second);
  const firstLight = firstMaterials.find(material => material.userData.activityLight)!;
  const secondLight = secondMaterials.find(material => material.userData.activityLight)!;
  const firstShell = firstMaterials.find(material => material.userData.onlineColor)!;
  assert.ok(firstLight.emissiveIntensity > secondLight.emissiveIntensity);
  const carryingPaint = firstShell.color.getHex();
  updateNodeModel(first, { ...fiber, active: false }, theme);
  updateNodeModel(second, { ...cellular, active: true }, theme);
  assert.ok(firstLight.emissiveIntensity < secondLight.emissiveIntensity);
  assert.notEqual(firstShell.color.getHex(), carryingPaint);
  assert.deepEqual(materials(first), firstMaterials);
  assert.deepEqual(materials(second), secondMaterials);
  disposeModel(first); disposeModel(second);
});

test('route equipment lights up while its base surface remains dark', () => {
  for (const kind of ['devices', 'gateway', 'fiber', 'cellular', 'sdwan', 'internet', 'cloud'] as const) {
    const node = fixture(kind, false);
    const model = createNodeModel(node, theme);
    const light = materials(model).find(material => material.userData.activityLight)!;
    const base = (model.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const baseColor = base.color.getHex();
    const standbyIntensity = light.emissiveIntensity;
    updateNodeModel(model, { ...node, active: true }, theme);
    assert.ok(light.emissiveIntensity > standbyIntensity, kind);
    assert.equal(base.color.getHex(), baseColor, kind);
    assert.equal(base.emissiveIntensity, 1); // Default intensity; black emission keeps the platform unlit.
    assert.equal(base.emissive.getHex(), 0);
    disposeModel(model);
  }
});

test('idle equipment cannot retain active illumination after telemetry disappears', () => {
  const node = fixture('gateway');
  const model = createNodeModel(node, theme);
  updateNodeModel(model, { ...node, status: 'idle' }, theme);
  for (const material of materials(model)) {
    if (material.userData.activityLight || material.userData.onlineColor || material.userData.accentColor) {
      assert.equal(material.emissiveIntensity, 0);
    }
  }
  disposeModel(model);
});

test('a carrying tunnel keeps its active light and error status remains independently visible', () => {
  const node = { ...fixture('tunnel'), status: 'err' as const };
  const model = createNodeModel(node, theme);
  const light = materials(model).find(material => material.userData.activityLight)!;
  const status = materials(model).find(material => material.userData.statusColor)!;
  assert.ok(light.emissiveIntensity > 0);
  assert.equal(status.emissive.getHexString(), theme.err.slice(1));
  updateNodeModel(model, { ...node, active: false }, theme);
  assert.equal(light.emissiveIntensity, 0);
  assert.equal(status.emissive.getHexString(), theme.err.slice(1));
  disposeModel(model);
});
