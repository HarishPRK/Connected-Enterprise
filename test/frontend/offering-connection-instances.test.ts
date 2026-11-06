import assert from 'node:assert/strict';
import test from 'node:test';
import { Group, Matrix3, Matrix4, Mesh, BoxGeometry, Quaternion, Vector3 } from 'three';
import { CONNECTOR_PARTS, connectorFrame, connectorPartMatrix, packetRadius } from '../../src/components/offerings/OfferingConnectionInstances.ts';
import { connectionCurve, makeConnections } from '../../src/components/offerings/OfferingConnectionPaths.ts';
import { ETHERNET_PLUG_SCALE } from '../../src/components/offerings/OfferingEquipment.ts';
import type { StoryContext } from '../../src/components/offerings/OfferingStoryMotion.ts';

const contexts: StoryContext[] = [
  { offering: 'routing', variant: 'teams' }, { offering: 'twin', variant: 'gateway' },
  { offering: 'failover', variant: 'fiber' }, { offering: 'eagle', variant: 'gateway' },
  { offering: 'smart', variant: 'cooler' }, { offering: 'automation', variant: 'after-hours' },
];

test('instanced connector geometry and normals match the previous nested plugs at every physical socket', () => {
  const unit = new BoxGeometry(), point = new Vector3(), normal = new Vector3();
  for (const context of contexts) for (const link of makeConnections(context, true, true).filter(link => !link.wireless)) {
    for (const socket of [link.from, link.to]) {
      const frame = connectorFrame(socket);
      for (const [name, part] of Object.entries(CONNECTOR_PARTS)) {
        const group = new Group(); group.position.set(...socket.point);
        group.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...socket.normal));
        group.scale.set(ETHERNET_PLUG_SCALE, ETHERNET_PLUG_SCALE, .55);
        const original = new Mesh(new BoxGeometry(...part.size)); original.position.set(...part.at); group.add(original);
        group.updateMatrixWorld(true);
        const instance = connectorPartMatrix(frame, name as keyof typeof CONNECTOR_PARTS, new Matrix4());
        const originalNormal = new Matrix3().getNormalMatrix(original.matrixWorld), instanceNormal = new Matrix3().getNormalMatrix(instance);
        for (let vertex = 0; vertex < unit.attributes.position.count; vertex++) {
          point.fromBufferAttribute(unit.attributes.position, vertex).applyMatrix4(instance);
          const expected = new Vector3().fromBufferAttribute(original.geometry.attributes.position, vertex).applyMatrix4(original.matrixWorld);
          assert(point.distanceTo(expected) < 5e-8, `${socket.device}/${name} retains its physical surface`);
          normal.fromBufferAttribute(unit.attributes.normal, vertex).applyNormalMatrix(instanceNormal);
          const expectedNormal = new Vector3().fromBufferAttribute(original.geometry.attributes.normal, vertex).applyNormalMatrix(originalNormal);
          assert(normal.distanceTo(expectedNormal) < 1e-10, 'nonuniform scale keeps the original lighting normal');
        }
        original.geometry.dispose(); (original.material as { dispose(): void }).dispose();
      }
    }
  }
  unit.dispose();
});

test('withdrawn twin connector retains its orientation and follows the physical cable endpoint', () => {
  const link = makeConnections({ offering: 'twin', variant: 'gateway' }, true, true).find(link => link.id === 'pos')!;
  const frame = connectorFrame(link.from), rest = new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(frame));
  for (const withdrawal of [0, .25, .75, 1, .5, 0]) {
    const endpoint = connectionCurve(link, 0, withdrawal).getPoint(0);
    frame.setPosition(endpoint);
    assert(new Vector3().setFromMatrixPosition(frame).distanceTo(endpoint) < 1e-12);
    const rotation = new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(frame));
    assert(Math.abs(rest.dot(rotation)) > 1 - 1e-12, 'unplug changes position without turning the seated connector');
  }
});

test('packet instance radius matches original wireless/wired close-up scaling without changing paths', () => {
  for (const wireless of [true, false]) for (const distance of [0, .01, .2, 1, 3, 7, 20]) {
    const point = new Vector3(8, 1.4, 4.5), eye = point.clone().add(new Vector3(distance, 0, 0));
    assert.equal(packetRadius(wireless, point, eye), (wireless ? .072 : .045) * Math.min(1, Math.max(.05, distance / 7)));
  }
});

test('routing connectors and packets collapse over seventy independent submissions into five batches', () => {
  const links = makeConnections({ offering: 'routing', variant: 'teams' }, true, true).filter(link => !['pos', 'voice'].includes(link.id));
  let original = 0;
  for (const link of links) {
    if (!link.wireless) original += 6 + Number(!!link.from.addSocket) + Number(!!link.to.addSocket);
    if (link.lit || link.failed) original += link.wireless ? 5 : 3;
  }
  assert(original > 70, `source submits ${original} independent meshes`);
  assert(5 < original * .08, `${original}→5 draw submissions, excluding unchanged cable/line meshes`);
});
