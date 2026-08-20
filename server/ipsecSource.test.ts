import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_IPSEC_DEVICE_TOPICS,
  DEFAULT_IPSEC_TOPICS,
  IpsecSource,
} from './ipsecSource.js';

type TestableIpsecSource = {
  handleMessage: (topic: string, payload: ArrayBuffer) => void;
};

test('prplhome metrics drive IT/OT inventory', () => {
  assert.ok(DEFAULT_IPSEC_TOPICS.includes('prplhome/ipsec/metrics'));
  assert.ok(DEFAULT_IPSEC_DEVICE_TOPICS.includes('prplhome/ipsec/metrics'));
  assert.ok(!(DEFAULT_IPSEC_DEVICE_TOPICS as readonly string[]).includes('prpl/ipsec/metrics'));

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
  assert.equal(failoverUpdate.gatewayKey, 'prplhome/ipsec/metrics:qdr-mckinney');
  assert.equal(failoverUpdate.state.source, 'prpl');
  assert.equal((failoverUpdate.state as { topic?: string }).topic, 'prplhome/ipsec/metrics');
  assert.equal(failoverUpdate.state.metrics.active_tunnel, 'vti-fiber1');
  assert.equal(failoverUpdate.state.metrics.tunnels[0]?.latency_ms, 18);

  assert.ok(inventoryUpdate, 'the device stream should receive Wi-Fi clients');
  assert.equal(inventoryUpdate.source, 'prplhome/ipsec/metrics:wifi');
  const inventory = inventoryUpdate.payload as { devices: { mac: string; telemetry?: { rssiDbm?: number } }[] };
  assert.equal(inventory.devices.length, 1);
  assert.equal(inventory.devices[0]?.mac, 'AA:BB:CC:DD:EE:FF');
  assert.equal(inventory.devices[0]?.telemetry?.rssiDbm, -58);
});

test('prpl failover metrics never enter IT/OT inventory', () => {
  const source = new IpsecSource();
  let failoverUpdate = false;
  let inventoryUpdate = false;
  source.onUpdate(() => { failoverUpdate = true; });
  source.onInventory(() => { inventoryUpdate = true; });

  const payload = new TextEncoder().encode(JSON.stringify({
    timestamp_ms: 1_786_640_400_000,
    active_tunnel: 'xfrm1-fiber',
    tunnels: [],
    wan: { ifname: 'eth1', link_up: true, rx_bytes: 1024, tx_bytes: 2048 },
    gateway: { name: 'prpl-ospv2-gateway' },
    wifi: {
      clients: [{
        mac: 'AA:BB:CC:DD:EE:FF', ip: '192.168.10.24', hostname: 'must-not-ingest',
        active: true, authenticated: true, rssi: -58, snr: 31,
        rx_bytes: 4096, tx_bytes: 8192,
      }],
    },
  }));
  (source as unknown as TestableIpsecSource).handleMessage(
    'prpl/ipsec/metrics',
    payload.buffer as ArrayBuffer,
  );

  assert.equal(failoverUpdate, true);
  assert.equal(inventoryUpdate, false);
});

test('an empty prplhome roster clears stale IT/OT clients', () => {
  const source = new IpsecSource();
  const rosterSizes: number[] = [];
  source.onInventory(({ payload }) => {
    rosterSizes.push((payload as { devices: unknown[] }).devices.length);
  });

  const send = (clients: object[]) => {
    const payload = new TextEncoder().encode(JSON.stringify({
      gateway: { name: 'qdr-mckinney' },
      wifi: { clients },
    }));
    (source as unknown as TestableIpsecSource).handleMessage(
      'prplhome/ipsec/metrics',
      payload.buffer as ArrayBuffer,
    );
  };

  send([{
    mac: 'AA:BB:CC:DD:EE:01',
    hostname: 'temporary-client',
    active: true,
    authenticated: true,
    rssi: -55,
    snr: 32,
    rx_bytes: 1,
    tx_bytes: 1,
  }]);
  send([]);

  assert.deepEqual(rosterSizes, [1, 0]);
});

test('same gateway identity on two MQTT topics remains isolated', () => {
  const source = new IpsecSource();
  const updates: { gatewayKey: string; state: { topic?: string; metrics: { wan: { rx_bytes: number } } } }[] = [];
  source.onUpdate((update) => updates.push(update));

  const makePayload = (rxBytes: number) => new TextEncoder().encode(JSON.stringify({
    timestamp_ms: 1_786_640_400_000 + rxBytes,
    tunnels: [],
    wan: { ifname: 'eth1', link_up: true, rx_bytes: rxBytes, tx_bytes: 1 },
    gateway: { name: 'shared-gateway', mac: '00:11:22:33:44:55' },
  }));

  for (const [topic, rxBytes] of [
    ['prpl/ipsec/metrics', 31_000_000_000],
    ['prplhome/ipsec/metrics', 612_000_000],
  ] as const) {
    const payload = makePayload(rxBytes);
    (source as unknown as TestableIpsecSource).handleMessage(topic, payload.buffer as ArrayBuffer);
  }

  assert.equal(updates.length, 2);
  assert.notEqual(updates[0]?.gatewayKey, updates[1]?.gatewayKey);
  assert.equal(updates[0]?.state.topic, 'prpl/ipsec/metrics');
  assert.equal(updates[1]?.state.topic, 'prplhome/ipsec/metrics');
  assert.equal(updates[0]?.state.metrics.wan.rx_bytes, 31_000_000_000);
  assert.equal(updates[1]?.state.metrics.wan.rx_bytes, 612_000_000);
});

test('snapshot retains the latest clean WAN rate and WAN-absent updates do not refresh it', () => {
  const source = new IpsecSource();
  const encode = (payload: object) => {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    return bytes.buffer as ArrayBuffer;
  };
  const handle = (payload: object) => {
    (source as unknown as TestableIpsecSource).handleMessage(
      'prpl/ipsec/metrics',
      encode(payload),
    );
  };

  handle({
    timestamp_ms: 1_786_640_400_000,
    wan: { ifname: 'eth1', link_up: true, rx_bytes: 10_000_000, tx_bytes: 20_000_000 },
    gateway: { name: 'rate-gateway' },
  });
  handle({
    timestamp_ms: 1_786_640_405_000,
    wan: { ifname: 'eth1', link_up: true, rx_bytes: 10_625_000, tx_bytes: 21_250_000 },
    gateway: { name: 'rate-gateway' },
  });

  const gatewayKey = 'prpl/ipsec/metrics:rate-gateway';
  const measured = source.getSnapshot().gateways[gatewayKey];
  assert.ok(measured?.wanRate);
  assert.equal(measured.wanRate.rxMbps, 1);
  assert.equal(measured.wanRate.txMbps, 2);
  assert.equal(measured.wanRate.spanSeconds, 5);
  const observedAt = measured.wanRate.observedAt;

  handle({
    timestamp_ms: 1_786_640_410_000,
    active_tunnel: 'xfrm1-fiber',
    tunnels: [{ ifname: 'xfrm1-fiber', present: true, reachable: true }],
    gateway: { name: 'rate-gateway' },
  });

  const afterTunnelOnly = source.getSnapshot().gateways[gatewayKey];
  assert.equal(afterTunnelOnly?.wanRate?.observedAt, observedAt);
  assert.equal(afterTunnelOnly?.wanRate?.sourceTimestampMs, 1_786_640_405_000);
});
