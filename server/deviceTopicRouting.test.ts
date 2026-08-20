import assert from 'node:assert/strict';
import test from 'node:test';
import { deviceSource, inventoryTopicFromSource } from './deviceSource.js';
import { ipsecSource } from './ipsecSource.js';
import { matchesDeviceInventory } from '../src/ui/deviceInventory.js';

type TestableIpsecSource = {
  handleMessage: (topic: string, payload: ArrayBuffer) => void;
};

test('device provenance retains the exact prplhome inventory topic', () => {
  assert.equal(
    inventoryTopicFromSource('prplhome/ipsec/metrics:wifi'),
    'prplhome/ipsec/metrics',
  );
  assert.equal(
    inventoryTopicFromSource('prpl/devices/inventory:inventory'),
    'prpl/devices/inventory',
  );
  assert.equal(inventoryTopicFromSource('rdk:matter'), undefined);
});

test('McKinney device selectors reject prpl clients and accept prplhome clients', () => {
  const prplhome = {
    locationSource: 'prpl' as const,
    inventoryTopics: ['prplhome/ipsec/metrics'],
  };
  const prpl = {
    locationSource: 'prpl' as const,
    inventoryTopics: ['prpl/ipsec/metrics'],
  };

  assert.equal(matchesDeviceInventory(prplhome, 'prpl', 'prplhome/ipsec/metrics'), true);
  assert.equal(matchesDeviceInventory(prpl, 'prpl', 'prplhome/ipsec/metrics'), false);
  assert.equal(matchesDeviceInventory(prplhome, 'rdk', 'rdk/ipsec/metrics'), false);
});

test('device snapshots expose prplhome provenance end to end', () => {
  const payload = new TextEncoder().encode(JSON.stringify({
    gateway: { name: 'qdr-mckinney' },
    wifi: {
      clients: [{
        mac: 'AA:BB:CC:DD:EE:77',
        hostname: 'provenance-test',
        active: true,
        authenticated: true,
        rssi: -51,
        snr: 35,
        rx_bytes: 10,
        tx_bytes: 20,
      }],
    },
  }));

  (ipsecSource as unknown as TestableIpsecSource).handleMessage(
    'prplhome/ipsec/metrics',
    payload.buffer as ArrayBuffer,
  );

  const snapshot = deviceSource.getSnapshot();
  const device = snapshot.devices.find((row) => row.mac === 'AA:BB:CC:DD:EE:77');
  assert.ok(device);
  assert.deepEqual(device.inventoryTopics, ['prplhome/ipsec/metrics']);
  assert.equal(device.locationSource, 'prpl');
  assert.ok(snapshot.inventoryTopicsSeen.includes('prplhome/ipsec/metrics'));
});
