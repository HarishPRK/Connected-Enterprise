import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_IPSEC_TOPICS, IpsecSource } from './ipsecSource.js';

type TestableIpsecSource = {
  handleMessage: (topic: string, payload: ArrayBuffer) => void;
};

test('prplhome metrics drive Dynamic Failover and IT/OT inventory', () => {
  assert.ok(DEFAULT_IPSEC_TOPICS.includes('prplhome/ipsec/metrics'));

  const source = new IpsecSource();
  let failoverUpdate: {
    gatewayKey: string;
    state: { source?: string; metrics: { active_tunnel: string; tunnels: { latency_ms: number }[] } };
  } | undefined;
  let inventoryUpdate: { source: string; payload: unknown } | undefined;

  source.onUpdate((update) => {
    failoverUpdate = update;
  });
  source.onInventory((update) => {
    inventoryUpdate = update;
  });

  const payload = new TextEncoder().encode(JSON.stringify({
    timestamp_ms: 1_786_640_400_000,
    active_tunnel: 'vti-fiber1',
    tunnel_count: 1,
    tunnels: [{
      ifname: 'vti-fiber1',
      present: true,
      reachable: true,
      latency_ms: 18,
      loss_percent: 0,
      rx_bytes: 1024,
      tx_bytes: 2048,
    }],
    wan: {
      ifname: 'eth0',
      link_up: true,
      rx_bytes: 1024,
      tx_bytes: 2048,
      rx_packets: 10,
      tx_packets: 20,
    },
    gateway: {
      name: 'qdr-mckinney',
      mac: '00:11:22:33:44:55',
      prim_wan_ip: '192.0.2.10',
      sec_wan_ip: '198.51.100.10',
    },
    wifi: {
      total_clients: 1,
      active_clients: 1,
      weak_signal_clients: 0,
      clients_with_errors: 0,
      high_retrans_clients: 0,
      clients: [{
        mac: 'AA:BB:CC:DD:EE:FF',
        ip: '192.168.10.24',
        hostname: 'test-client',
        ap_index: 0,
        ssid: 'CE-Test',
        active: true,
        authenticated: true,
        rssi: -58,
        snr: 31,
        standard: '802.11ax',
        downlink_rate: 54000,
        uplink_rate: 48000,
        rx_bytes: 4096,
        tx_bytes: 8192,
        rx_packets: 40,
        tx_packets: 80,
        errors_sent: 0,
        retrans_count: 0,
        failed_retrans_count: 0,
        health: 'good',
      }],
    },
  }));

  (source as unknown as TestableIpsecSource).handleMessage(
    'prplhome/ipsec/metrics',
    payload.buffer as ArrayBuffer,
  );

  assert.ok(failoverUpdate, 'the failover stream should receive a gateway update');
  assert.equal(failoverUpdate.gatewayKey, 'prpl:qdr-mckinney');
  assert.equal(failoverUpdate.state.source, 'prpl');
  assert.equal(failoverUpdate.state.metrics.active_tunnel, 'vti-fiber1');
  assert.equal(failoverUpdate.state.metrics.tunnels[0]?.latency_ms, 18);

  assert.ok(inventoryUpdate, 'the device stream should receive Wi-Fi clients');
  assert.equal(inventoryUpdate.source, 'prplhome/ipsec/metrics:wifi');
  const inventory = inventoryUpdate.payload as { devices: { mac: string; telemetry?: { rssiDbm?: number } }[] };
  assert.equal(inventory.devices.length, 1);
  assert.equal(inventory.devices[0]?.mac, 'AA:BB:CC:DD:EE:FF');
  assert.equal(inventory.devices[0]?.telemetry?.rssiDbm, -58);
});
