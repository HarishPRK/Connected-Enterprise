import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyLiveIntent,
  formatLiveDeviceAnswer,
  formatLiveWanAnswer,
  runLiveTelemetryAnswer,
  type AskLiveToolRunner,
} from './askLiveResponse.js';

const liveWan = {
  availability: 'live',
  live: true,
  branch: { id: 'b-pln-01', name: 'Plano-01' },
  source: { mqtt_connected: true, age_seconds: 4 },
  gateways: [{
    name: 'gw-plano',
    active_tunnel: 'ipsec0',
    wan: { interface: 'erouter0', link_up: true, rx_mbps: 42.25, tx_mbps: 8.5 },
    tunnels: [
      { interface: 'ipsec0', present: true, reachable: true, latency_ms: 12, loss_percent: 0.1 },
      { interface: 'ipsec1', present: true, reachable: false, latency_ms: 80, loss_percent: 100 },
    ],
    cellular: {
      available: true,
      health: 'healthy',
      registration_state: 'registered',
      bearer_connected: true,
      rssi_dbm: -71,
    },
  }],
};

const liveDevices = {
  availability: 'live',
  live: true,
  branch: { id: 'b-pln-01', name: 'Plano-01' },
  source: { mqtt_connected: true, age_seconds: 3 },
  counts: { total: 3, healthy: 2, warning: 1, error: 0, offline: 0, needing_attention: 1 },
  devices_needing_attention: [{
    id: 'pos-2',
    name: 'POS-02',
    domain: 'IT',
    kind: 'payment',
    status: 'warn',
    ip: '10.10.1.42',
    connection: 'wifi',
    telemetry: { rssiDbm: -78, wifiHealth: 'high_retrans' },
  }],
};

test('classifies the existing Ask AI operational prompt families', () => {
  assert.equal(classifyLiveIntent('Are any IPsec tunnels unreachable right now?'), 'wan');
  assert.equal(classifyLiveIntent('How many devices are healthy, degraded, or offline?'), 'devices');
  assert.equal(classifyLiveIntent('How fresh is the latest telemetry for this branch?'), 'both');
  assert.equal(classifyLiveIntent('Are there any current incidents?'), 'both');
  assert.equal(classifyLiveIntent('Write an incident post-mortem'), 'unsupported');
  assert.equal(classifyLiveIntent('Explain BGP route reflection'), 'unsupported');
});

test('formats live WAN data with reachability, rates, and cellular state', () => {
  const answer = formatLiveWanAnswer(liveWan);
  assert.match(answer, /gw-plano/);
  assert.match(answer, /RX 42\.25 Mbps, TX 8\.50 Mbps/);
  assert.match(answer, /ipsec1.*unreachable.*100% loss/);
  assert.match(answer, /registration registered/);
  assert.match(answer, /get_live_branch_wan/);
});

test('formats live device counts and only the devices needing attention', () => {
  const answer = formatLiveDeviceAnswer(liveDevices);
  assert.match(answer, /3 total, 2 healthy, 1 warning/);
  assert.match(answer, /POS-02/);
  assert.match(answer, /RSSI -78 dBm/);
  assert.match(answer, /get_live_branch_devices/);
});

test('freshness questions read both branch-scoped tools and complete without an error event', async () => {
  const calls: string[] = [];
  const events: { event: string; data: Record<string, unknown> }[] = [];
  const runner: AskLiveToolRunner = async (name, branchId) => {
    calls.push(`${name}:${branchId}`);
    return name === 'get_live_branch_wan' ? liveWan : liveDevices;
  };

  await runLiveTelemetryAnswer({
    branchId: 'b-pln-01',
    messages: [{ role: 'user', content: 'How fresh is the latest telemetry for this branch?' }],
    emit: (event, data) => events.push({ event, data }),
    minimumResponseMs: 0,
  }, runner);

  assert.deepEqual(calls, [
    'get_live_branch_wan:b-pln-01',
    'get_live_branch_devices:b-pln-01',
  ]);
  assert.deepEqual(events.map(({ event }) => event), ['tool_using', 'tool_using', 'chunk', 'done']);
  assert.match(String(events[2].data.text), /^\*\*WAN\/IPsec/);
  assert.equal(events[3].data.mode, 'live-telemetry');
});

test('unsupported questions are declined without reading unrelated data', async () => {
  const events: { event: string; data: Record<string, unknown> }[] = [];
  const runner: AskLiveToolRunner = async () => assert.fail('tool should not run');

  await runLiveTelemetryAnswer({
    branchId: 'b-pln-01',
    messages: [{ role: 'user', content: 'Explain BGP route reflection' }],
    emit: (event, data) => events.push({ event, data }),
    minimumResponseMs: 0,
  }, runner);

  assert.deepEqual(events.map(({ event }) => event), ['chunk', 'done']);
  assert.match(String(events[0].data.text), /current WAN links/);
});

test('keeps the telemetry-reading state visible for the configured minimum time', async () => {
  const startedAt = Date.now();

  await runLiveTelemetryAnswer({
    branchId: 'b-pln-01',
    messages: [{ role: 'user', content: 'Are any IPsec tunnels unreachable?' }],
    emit: () => undefined,
    minimumResponseMs: 30,
  }, async () => liveWan);

  assert.ok(Date.now() - startedAt >= 25);
});
