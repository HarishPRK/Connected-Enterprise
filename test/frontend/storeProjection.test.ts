import assert from 'node:assert/strict';
import test from 'node:test';
import { iso, projectStorePoint, unprojectStorePoint, withSceneProjection } from '../../src/components/offerings/scenePrimitives.ts';
import { STORE_ZONES } from '../../src/components/offerings/storeArchitecture.ts';

test('orbit projection round-trips every scenario center through a full turn for pointer selection', () => {
  for (let degrees = -360; degrees <= 360; degrees += 15) {
    for (const zone of Object.values(STORE_ZONES)) {
      const x = zone.x + 205; const y = zone.y + 150; const angle = degrees * Math.PI / 180;
      const screen = projectStorePoint(x, y, 0, angle);
      const world = unprojectStorePoint(screen.x, screen.y, angle);
      assert.ok(Math.abs(world.x - x) < 1e-8 && Math.abs(world.y - y) < 1e-8);
    }
  }
});

test('rotation keeps equipment upright and preserves original animation coordinates at zero degrees', () => {
  assert.deepEqual(iso(120, 85, 30), { x: 421 + 35 * .88, y: 165 + 205 * .44 - 30 });
  for (const angle of [0, .5, Math.PI, Math.PI * 2]) {
    const floor = projectStorePoint(150, 200, 0, angle);
    const top = projectStorePoint(150, 200, 90, angle);
    assert.equal(top.x, floor.x);
    assert.equal(top.y, floor.y - 90);
  }
});

test('nested scenario projection restores its parent and does not leak into other twins after a failure', () => {
  const original = iso(10, 20, 30);
  withSceneProjection({ angle: .7, x: 410, y: 330 }, () => {
    const parent = iso(10, 20, 30);
    assert.deepEqual(parent, projectStorePoint(420, 350, 30, .7));
    assert.throws(() => withSceneProjection({ angle: 2 }, () => { throw new Error('render failed'); }));
    assert.deepEqual(iso(10, 20, 30), parent);
  });
  assert.deepEqual(iso(10, 20, 30), original);
});
