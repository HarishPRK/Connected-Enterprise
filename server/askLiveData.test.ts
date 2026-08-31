import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeviceSnapshot } from './deviceSource.js';
import type { IpsecGatewayState } from '../src/types.js';
import { ASK_LIVE_STALE_MS, buildLiveBranchDevices, buildLiveBranchWan } from './askLiveData.js';

const NOW = Date.parse('2026-08-27T12:00:00.000Z');

function gateway(
  topic: string,
  receivedAt = NOW - 5_000,
  rxMbps = 42,
): IpsecGatewayState {
  return {
    topic,
    source: topic.startsWith('rdk/') ? 'rdk' : 'prpl',
    receivedAt,
    metrics: {
      timestamp_ms: receivedAt,
      active_tunnel: 'ipsec0',
      tunnel_count: 2,
      gateway: { name: 'gw-1', mac: 'AA:BB:CC:DD:EE:FF', prim_wan_ip: '1.2.3.4', sec_wan_ip: '5.6.7.8' },
      wan: { ifname: 'erouter0', link_up: true, rx_bytes: 1, tx_bytes: 2, rx_packets: 3, tx_packets: 4 },
      tunnels: [
        { ifname: 'ipsec0', present: true, reachable: true, latency_ms: 12, loss_percent: 0.1, rx_bytes: 1, tx_bytes: 2 },
      ],
    },
    wanRate: {
      rxMbps,
      txMbps: 8,
      spanSeconds: 10,
      sampleCount: 2,
      sourceTimestampMs: receivedAt,
      observedAt: receivedAt,
    },
  };
}

test('WAN result is request-time, fresh, and filtered to the selected branch topic', () => {
  const failover = gateway('prpl/ipsec/metrics', NOW - 5_000, 7);
  failover.metrics.active_tunnel = 'prpl-fiber';
  failover.metrics.tunnels[0].ifname = 'prpl-fiber';
  const wan = gateway('prplhome/ipsec/metrics', NOW - 3_000, 42);
  wan.metrics.active_tunnel = 'wrong-prplhome-tunnel';
  wan.metrics.tunnels[0].ifname = 'wrong-prplhome-tunnel';

  const result = buildLiveBranchWan('b-mck-03', {
    gateways: {
      mckinneyFailover: failover,
      mckinneyWan: wan,
      plano: gateway('rdk/ipsec/metrics'),
    },
    receivedAt: NOW,
    connected: true,
  }, NOW);

  if (!('source' in result) || !('gateways' in result)) assert.fail('expected a configured live WAN result');
  assert.equal(result.availability, 'live');
  assert.equal(result.live, true);
  assert.equal(result.source.failover_topic, 'prpl/ipsec/metrics');
  assert.equal(result.source.wan_topic, 'prplhome/ipsec/metrics');
  assert.equal(result.source.age_seconds, 5);
  assert.equal(result.source.failover_age_seconds, 5);
  assert.equal(result.source.wan_age_seconds, 3);
  assert.equal(result.gateways.length, 1);
  assert.equal(result.gateways[0].active_tunnel, 'prpl-fiber');
  assert.equal(result.gateways[0].tunnels[0].interface, 'prpl-fiber');
  assert.equal(result.gateways[0].wan.source_topic, 'prplhome/ipsec/metrics');
  assert.equal(result.gateways[0].wan.rx_mbps, 42);
});

test('McKinney never borrows a WAN rate from its failover topic', () => {
  const result = buildLiveBranchWan('b-mck-03', {
    gateways: {
      mckinneyFailover: gateway('prpl/ipsec/metrics', NOW - 5_000, 999),
    },
    receivedAt: NOW,
    connected: true,
  }, NOW);

  if (!('source' in result) || !('gateways' in result)) assert.fail('expected a configured WAN result');
  assert.equal(result.availability, 'waiting_for_data');
  assert.equal(result.live, false);
  assert.equal(result.source.wan_topic, 'prplhome/ipsec/metrics');
  assert.equal(result.source.wan_observed_at, null);
  assert.equal(result.gateways[0].wan.source_topic, 'prplhome/ipsec/metrics');
  assert.equal(result.gateways[0].wan.rx_mbps, null);
});

test('WAN result labels old cached telemetry as stale', () => {
  const result = buildLiveBranchWan('b-pln-01', {
    gateways: { plano: gateway('rdk/ipsec/metrics', NOW - ASK_LIVE_STALE_MS - 1_000) },
    receivedAt: NOW,
    connected: true,
  }, NOW);

  assert.equal(result.availability, 'stale');
  assert.equal(result.live, false);
});

test('device result never presents seed inventory as live', () => {
  const result = buildLiveBranchDevices('b-pln-01', {
    devices: [],
    receivedAt: NOW,
    source: 'seed',
    connected: true,
    inventoryTopicsSeen: [],
    overrides: {},
  }, NOW);

  if (!('counts' in result)) assert.fail('expected a configured device result');
  assert.equal(result.availability, 'waiting_for_live_inventory');
  assert.equal(result.live, false);
  assert.equal(result.counts.total, 0);
});

test('device result scopes inventory and highlights devices needing attention', () => {
  const base = {
    autoDomain: 'IT' as const,
    overridden: false,
    connectedForHours: 1,
    conn: 'wifi' as const,
    kind: 'laptop' as const,
  };
  const snapshot: DeviceSnapshot = {
    source: 'gateway',
    connected: true,
    receivedAt: NOW,
    lastInventoryAt: NOW - 7_000,
    inventoryTopicsSeen: ['prplhome/ipsec/metrics', 'rdk/ipsec/metrics'],
    overrides: {},
    devices: [
      { ...base, id: 'mck-1', name: 'MCK client', domain: 'IT', ip: '10.1.1.2', mac: 'AA:AA:AA:AA:AA:01', status: 'warn', locationSource: 'prpl', inventoryTopics: ['prplhome/ipsec/metrics'], telemetry: { rssiDbm: -80 } },
      { ...base, id: 'pln-1', name: 'Plano client', domain: 'IT', ip: '10.2.1.2', mac: 'AA:AA:AA:AA:AA:02', status: 'err', locationSource: 'rdk', inventoryTopics: ['rdk/ipsec/metrics'] },
    ],
  };

  const result = buildLiveBranchDevices('b-mck-03', snapshot, NOW, {
    gateways: { mckinneyDevices: gateway('prplhome/ipsec/metrics', NOW - 3_000) },
    receivedAt: NOW,
    connected: true,
  });

  if (!('source' in result) || !('counts' in result) || !('devices_needing_attention' in result)) {
    assert.fail('expected a configured live device result');
  }
  assert.equal(result.availability, 'live');
  assert.equal(result.source.age_seconds, 3);
  assert.equal(result.counts.total, 1);
  assert.equal(result.counts.needing_attention, 1);
  assert.equal(result.devices_needing_attention[0].name, 'MCK client');
  assert.equal(result.devices_needing_attention[0].telemetry?.rssiDbm, -80);
});
