import assert from 'node:assert/strict';
import test from 'node:test';
import type { Device } from '../../src/types';
import {
  buildSpatialNodes, deviceLabel, getDeviceFlow, GATEWAY, SPATIAL_HEIGHT, SPATIAL_WIDTH,
} from '../../src/components/widgets/spatialNetworkModel';

function device(id: string, overrides: Partial<Device> = {}): Device {
  return {
    id, name: `Device ${id}`, kind: 'generic', domain: 'IT',
    ip: '192.168.1.10', mac: `AA:BB:CC:${id}`, status: 'ok',
    connectedForHours: 1, conn: 'wifi', ...overrides,
  };
}

function roster(count: number, domain: Device['domain'] = 'IT'): Device[] {
  return Array.from({ length: count }, (_, index) =>
    device(`${domain}-${String(index).padStart(3, '0')}`, { domain }));
}

function geometry(devices: readonly Device[]) {
  return buildSpatialNodes(devices).map(({ device: entry, ...point }) => ({ id: entry.id, ...point }));
}

test('layout is deterministic across input order and never mutates the inventory', () => {
  const input = [...roster(45), ...roster(10, 'OT')];
  const before = structuredClone(input);
  assert.deepEqual(geometry(input), geometry([...input].reverse()));
  assert.deepEqual(input, before);
  assert.equal(new Set(buildSpatialNodes(input).map(node => node.device.id)).size, input.length);
});

test('health, names, kind and telemetry updates preserve positions for an unchanged selected roster', () => {
  const input = roster(45);
  const updated = input.map((entry, index) => ({
    ...entry,
    name: `Renamed ${44 - index}`,
    kind: 'tablet' as const,
    status: (index % 2 ? 'err' : 'warn') as Device['status'],
    telemetry: { rxMbps: index, txMbps: index / 2 },
  }));
  assert.deepEqual(geometry(input), geometry(updated));
});

test('every supported inventory size has finite, distinct centers within its domain bounds', () => {
  for (let count = 0; count <= 64; count += 1) {
    for (const domain of ['IT', 'OT'] as const) {
      const nodes = buildSpatialNodes(roster(count, domain));
      assert.equal(nodes.length, Math.min(count, 60));
      assert.equal(new Set(nodes.map(node => `${node.x},${node.y}`)).size, nodes.length);
      for (const node of nodes) {
        assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
        assert.ok(node.x >= (domain === 'IT' ? 50 : 545));
        assert.ok(node.x <= (domain === 'IT' ? 355 : 850));
        assert.ok(node.y >= 90 && node.y <= 398);
        assert.ok(node.phase >= 0 && node.phase < 1);
        assert.ok(node.size >= 26 && node.size <= 56);
        for (const other of nodes) {
          if (other === node) continue;
          assert.ok(Math.hypot(other.x - node.x, other.y - node.y) >= node.size,
            `overlapping glyphs: ${node.device.id}, ${other.device.id}`);
        }
      }
    }
  }
  assert.equal(SPATIAL_WIDTH, 900);
  assert.equal(SPATIAL_HEIGHT, 500);
  assert.deepEqual(GATEWAY, { x: 450, y: 255 });
});

test('capped selection prioritizes exceptions independently in each domain and preserves source totals', () => {
  const input = [...roster(80), ...roster(75, 'OT')];
  input[79] = { ...input[79], status: 'err' };
  input[78] = { ...input[78], status: 'warn' };
  input[77] = { ...input[77], status: 'off' };
  input[154] = { ...input[154], status: 'err' };
  const nodes = buildSpatialNodes(input);
  assert.equal(input.length, 155);
  assert.equal(nodes.filter(node => node.device.domain === 'IT').length, 60);
  assert.equal(nodes.filter(node => node.device.domain === 'OT').length, 60);
  for (const id of ['IT-079', 'IT-078', 'IT-077', 'OT-074']) {
    assert.ok(nodes.some(node => node.device.id === id));
  }
  assert.deepEqual(geometry(input), geometry([...input].reverse()));
});

test('effective domain overrides control placement independently of kind and connection', () => {
  const input = [
    device('override', { kind: 'laptop', domain: 'OT', conn: 'wired' }),
    device('sensor', { kind: 'fire_sensor', domain: 'IT', conn: 'thread' }),
  ];
  const nodes = buildSpatialNodes(input);
  assert.ok(nodes.find(node => node.device.id === 'override')!.x > GATEWAY.x);
  assert.ok(nodes.find(node => node.device.id === 'sensor')!.x < GATEWAY.x);
  assert.equal(nodes.find(node => node.device.id === 'sensor')!.device.conn, 'thread');
});

test('gateway and device reachability suppress flow despite retained positive throughput', () => {
  const onlineDevice = device('active', { telemetry: { rxMbps: 2.5, txMbps: 1 } });
  assert.equal(getDeviceFlow(onlineDevice, true).active, true);
  assert.equal(getDeviceFlow({ ...onlineDevice, status: 'warn' }, true).active, true);
  for (const status of ['err', 'off'] as const) {
    assert.deepEqual(getDeviceFlow({ ...onlineDevice, status }, true), {
      active: false, measured: true, rxMbps: 2.5, txMbps: 1,
    });
  }
  assert.equal(getDeviceFlow(onlineDevice, false).active, false);
});

test('unknown or invalid throughput stays unknown instead of becoming measured zero', () => {
  assert.deepEqual(getDeviceFlow(device('unknown'), true), { active: true, measured: false });
  for (const invalid of [undefined, -1, NaN, Infinity, -Infinity]) {
    const entry = device('invalid', { telemetry: {
      rxMbps: invalid, txMbps: invalid, linkDownMbps: 866, linkUpMbps: 432,
      rxBytes: 100_000, txBytes: 50_000,
    } });
    assert.deepEqual(getDeviceFlow(entry, true), { active: true, measured: false });
  }
});

test('zero is measured idle only when both directions are known; partial rates retain their missing direction', () => {
  assert.deepEqual(getDeviceFlow(device('idle', { telemetry: { rxMbps: 0, txMbps: 0 } }), true), {
    active: false, measured: true, rxMbps: 0, txMbps: 0,
  });
  assert.deepEqual(getDeviceFlow(device('rx', { telemetry: { rxMbps: 0 } }), true), {
    active: true, measured: true, rxMbps: 0,
  });
  assert.deepEqual(getDeviceFlow(device('tx', { telemetry: { txMbps: 3.5, rxMbps: NaN } }), true), {
    active: true, measured: true, txMbps: 3.5,
  });
});

test('device labels remain usable for discovered devices without a hostname or MAC', () => {
  assert.equal(deviceLabel(device('id', { name: '  Meeting room  ' })), 'Meeting room');
  assert.equal(deviceLabel(device('id', { name: ' ', mac: ' AA:BB ' })), 'AA:BB');
  assert.equal(deviceLabel(device('id', { name: '', mac: '' })), 'id');
});
