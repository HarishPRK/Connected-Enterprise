import assert from 'node:assert/strict';
import test from 'node:test';
import type { DeviceView } from '../../src/ui/useDevices';
import {
  gatewayTwinHostRoster,
  MAX_GATEWAY_TWIN_HOSTS,
} from '../../src/ui/gatewayTwinHosts';

function device(overrides: Partial<DeviceView> = {}): DeviceView {
  return {
    id: 'wifi-AA:BB:CC:DD:EE:01',
    name: 'Kitchen sensor',
    kind: 'generic',
    domain: 'OT',
    autoDomain: 'OT',
    overridden: false,
    ip: '192.168.1.10',
    mac: 'AA:BB:CC:DD:EE:01',
    status: 'ok',
    connectedForHours: 1,
    conn: 'wifi',
    locationSource: 'prpl',
    inventoryTopics: ['prplhome/ipsec/metrics'],
    ...overrides,
  };
}

const scope = {
  locationSource: 'prpl' as const,
  inventoryTopic: 'prplhome/ipsec/metrics',
  inventoryTopicsSeen: ['prplhome/ipsec/metrics'],
};

test('distinguishes an unseen topic from an authoritative empty roster', () => {
  assert.equal(gatewayTwinHostRoster([], {
    ...scope,
    inventoryTopicsSeen: [],
  }), null);
  assert.deepEqual(gatewayTwinHostRoster([], scope), []);
});

test('scopes the roster to the exact prplhome device topic', () => {
  const result = gatewayTwinHostRoster([
    device(),
    device({
      id: 'wrong-feed',
      mac: 'AA:BB:CC:DD:EE:02',
      inventoryTopics: ['prpl/ipsec/metrics'],
    }),
    device({
      id: 'auxiliary-only',
      mac: 'AA:BB:CC:DD:EE:03',
      inventoryTopics: undefined,
    }),
    device({
      id: 'wrong-location',
      mac: 'AA:BB:CC:DD:EE:04',
      locationSource: 'rdk',
      inventoryTopics: ['prplhome/ipsec/metrics'],
    }),
  ], scope);

  assert.deepEqual(result?.map((host) => host.id), ['ce-aabbccddee01']);
});

test('preserves effective IT/OT overrides and maps live radio telemetry', () => {
  const result = gatewayTwinHostRoster([
    device({
      name: 'Reclassified controller',
      kind: 'laptop',
      domain: 'OT',
      autoDomain: 'IT',
      overridden: true,
      telemetry: {
        wifiApIndex: 4,
        rssiDbm: -47.5,
        rxMbps: 1.25,
        txMbps: 0.5,
      },
    }),
  ], scope);

  assert.deepEqual(result, [{
    id: 'ce-aabbccddee01',
    path: 'Device.Hosts.Host.1.',
    name: 'Reclassified controller',
    kind: 'laptop',
    domain: 'OT',
    layer1: 'wifi6',
    rssiDbm: -47.5,
    rxBps: 1_250_000,
    txBps: 500_000,
    active: true,
  }]);
});

test('orders active hosts deterministically, maps status, and caps the glyph pool', () => {
  const devices = Array.from({ length: MAX_GATEWAY_TWIN_HOSTS + 3 }, (_, index) =>
    device({
      id: `device-${index}`,
      mac: `AA:BB:CC:DD:EE:${String(index).padStart(2, '0')}`,
      status: index === 0 ? 'err' : 'ok',
    }));

  const result = gatewayTwinHostRoster(devices, scope);
  assert.equal(result?.length, MAX_GATEWAY_TWIN_HOSTS);
  assert.equal(result?.[0]?.id, 'ce-aabbccddee01');
  assert.ok(result?.every((host) => host.active));

  const offlineOnly = gatewayTwinHostRoster([
    device({ status: 'off' }),
  ], scope);
  assert.equal(offlineOnly?.[0]?.active, false);
});

test('balances a full glyph pool across IT and OT domains', () => {
  const devices = Array.from({ length: 24 }, (_, index) =>
    device({
      id: `balanced-${index}`,
      mac: `AA:BB:CC:DD:EF:${String(index).padStart(2, '0')}`,
      domain: index < 12 ? 'IT' : 'OT',
      autoDomain: index < 12 ? 'IT' : 'OT',
    }));

  const result = gatewayTwinHostRoster(devices, scope) ?? [];
  assert.equal(result.filter((host) => host.domain === 'IT').length, 8);
  assert.equal(result.filter((host) => host.domain === 'OT').length, 8);
});
