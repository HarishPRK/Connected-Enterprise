import assert from 'node:assert/strict';
import test from 'node:test';
import { createTelemetryPublisher } from '../../src/ui/telemetryPublisher';
import { getDeviceInventorySnapshot, mergeDeviceInventorySnapshot, refreshDeviceInventory, subscribeDeviceInventory, type DeviceSnapshot, type UseDevicesResult } from '../../src/ui/useDevices';
import { getGatewayTelemetrySnapshot, nextGatewayFreshnessDelay, subscribeGatewayTelemetry } from '../../src/ui/useGatewayTelemetry';
import { getIpsecMetricsSnapshot, refreshIpsecMetrics, subscribeIpsecMetrics } from '../../src/ui/useIpsecMetrics';
import type { IpsecGatewayState } from '../../src/types';

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, Array<(event: { data: string }) => void>>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) { FakeEventSource.instances.push(this); }
  addEventListener(name: string, listener: (event: { data: string }) => void) { this.listeners.set(name, [...this.listeners.get(name) ?? [], listener]); }
  close() { this.closed = true; }
  send(name: string, value: unknown) { for (const listener of this.listeners.get(name) ?? []) listener({ data: JSON.stringify(value) }); }
}
const device = { id: 'a', mac: 'AA:BB:CC:DD:EE:FF', name: 'Client', ip: '10.0.0.2', kind: 'laptop' as const, conn: 'wifi' as const, domain: 'IT' as const, autoDomain: 'IT' as const, overridden: false, status: 'ok' as const, connectedForHours: 1, locationSource: 'prpl' as const, inventoryTopics: ['prplhome/ipsec/metrics'], telemetry: { rssiDbm: -50 } };
const deviceSnapshot = (receivedAt: number, devices = [device]): DeviceSnapshot => ({ receivedAt, devices, source: 'gateway', connected: true, lastInventoryAt: receivedAt, inventoryTopicsSeen: ['prplhome/ipsec/metrics'], overrides: {} });

test('delivery bursts notify once while preserving every per-topic reducer update', () => {
  const queued: Array<() => void> = [];
  const store = createTelemetryPublisher<Record<string, number>>({}, (run) => { queued.push(run); return () => {}; });
  let notifications = 0;
  store.subscribe(() => notifications++);
  store.update((old) => ({ ...old, fiber: 1 }));
  store.update((old) => ({ ...old, cellular: 2 }));
  store.update((old) => ({ ...old, fiber: 3 }));
  assert.equal(queued.length, 1);
  assert.deepEqual(store.getSnapshot(), {});
  queued[0]();
  assert.deepEqual(store.getSnapshot(), { fiber: 3, cellular: 2 });
  assert.equal(notifications, 1);
  store.publish(store.getSnapshot());
  assert.equal(queued.length, 1, 'unchanged snapshots schedule no work');
});

test('device merging preserves identities/provenance and rejects stale rosters without losing empty inventories', () => {
  const initial: UseDevicesResult = { devices: [], loaded: false, connected: false, source: 'seed', inventoryTopicsSeen: [], refresh: refreshDeviceInventory };
  const first = mergeDeviceInventorySnapshot(initial, deviceSnapshot(100));
  const heartbeat = mergeDeviceInventorySnapshot(first, deviceSnapshot(101, [{ ...device, telemetry: { ...device.telemetry }, inventoryTopics: [...device.inventoryTopics] }]));
  assert.equal(heartbeat.devices, first.devices);
  assert.equal(heartbeat.inventoryTopicsSeen, first.inventoryTopicsSeen);
  const empty = mergeDeviceInventorySnapshot(heartbeat, deviceSnapshot(102, []));
  assert.deepEqual(empty.devices, []);
  assert.deepEqual(empty.inventoryTopicsSeen, ['prplhome/ipsec/metrics']);
  assert.equal(mergeDeviceInventorySnapshot(empty, deviceSnapshot(100)), empty);
});

test('multiple device consumers share one connection and refresh updates all of them', async () => {
  const previousFetch = globalThis.fetch;
  const previousSource = globalThis.EventSource;
  FakeEventSource.instances = [];
  let requests = 0;
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  globalThis.fetch = async () => { requests++; return new Response(JSON.stringify(deviceSnapshot(requests === 1 ? 200 : 204, requests === 1 ? [device] : []))); };
  let firstCalls = 0, secondCalls = 0;
  const first = subscribeDeviceInventory(() => firstCalls++);
  const second = subscribeDeviceInventory(() => secondCalls++);
  try {
    await settle();
    assert.equal(requests, 1);
    assert.equal(FakeEventSource.instances.length, 1);
    const source = FakeEventSource.instances[0];
    const baselineCalls = firstCalls;
    source.send('snapshot', deviceSnapshot(201));
    source.send('snapshot', deviceSnapshot(202));
    source.send('snapshot', deviceSnapshot(203));
    await settle();
    assert.equal(firstCalls, baselineCalls + 1);
    assert.equal(secondCalls, firstCalls);
    assert.equal(getDeviceInventorySnapshot().lastReceivedAt, 203);
    await refreshDeviceInventory();
    assert.deepEqual(getDeviceInventorySnapshot().devices, []);
    assert.equal(firstCalls, secondCalls);
    first();
    assert.equal(source.closed, false);
    second();
    assert.equal(source.closed, true);
  } finally { first(); second(); globalThis.fetch = previousFetch; globalThis.EventSource = previousSource; }
});

test('gateway freshness schedules actual class boundaries, not one-second renders', () => {
  assert.equal(nextGatewayFreshnessDelay([], 100), undefined);
  assert.equal(nextGatewayFreshnessDelay([100], 100), 150001);
  assert.equal(nextGatewayFreshnessDelay([100], 150101), undefined);
  assert.equal(nextGatewayFreshnessDelay([10000], 100), 4900);
  assert.equal(nextGatewayFreshnessDelay([100, 200], 100), 150001);
});

test('gateway delivery batches retain port samples/rates and stable LAN identities on status changes', async () => {
  const previousSource = globalThis.EventSource;
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  FakeEventSource.instances = [];
  let calls = 0;
  const stop = subscribeGatewayTelemetry(() => calls++);
  try {
    const source = FakeEventSource.instances[0];
    source.onopen?.();
    source.send('state', { state: 'connected' });
    const now = Date.now();
    const sample = (topic: string, receivedAt: number, packets: number) => ({ topic, receivedAt, payload: { Name: topic.endsWith('eth0_1') ? 'eth0_1' : 'eth0_2', Status: 'Up', MaxBitRate: 1000, Stats: { PacketsReceived: packets } } });
    source.send('device-telemetry', sample('prplos/ethernet/eth0_1', now - 1000, 10));
    source.send('device-telemetry', sample('prplos/ethernet/eth0_1', now, 30));
    source.send('device-telemetry', sample('prplos/ethernet/eth0_2', now, 50));
    await settle();
    const first = getGatewayTelemetrySnapshot();
    assert.equal(calls, 1);
    assert.equal(first.ports.length, 2);
    assert.equal(first.portsByInterface.eth0_1?.rxPps, 20, 'both samples were parsed before the batched render');
    source.send('state', { state: 'connected', lastMessageAt: now + 1 });
    await settle();
    assert.equal(getGatewayTelemetrySnapshot().ports, first.ports);
    assert.equal(getGatewayTelemetrySnapshot().freshness, first.freshness);
    const statusCalls = calls;
    source.send('device-telemetry', { topic: 'prplos/wifi/ap1', receivedAt: now + 2, payload: { clients: [] } });
    source.send('device-telemetry', sample('prplos/ethernet/eth0_1', now - 10, 1));
    await settle();
    assert.equal(calls, statusCalls, 'irrelevant topics and old deliveries schedule no Home update');
    assert.equal(getGatewayTelemetrySnapshot().ports, first.ports);
  } finally { stop(); globalThis.EventSource = previousSource; }
});

test('IPsec bursts retain all topics and late hydration cannot overwrite newer gateway telemetry', async () => {
  const previousFetch = globalThis.fetch;
  const previousSource = globalThis.EventSource;
  FakeEventSource.instances = [];
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  let hydrate!: (value: Response) => void;
  let requests = 0;
  globalThis.fetch = () => { requests++; return new Promise((resolve) => { hydrate = resolve; }); };
  const gateway = (topic: string, receivedAt: number, counter: number): IpsecGatewayState => ({ topic, receivedAt, metrics: { gateway: { name: topic, mac: '', prim_wan_ip: '', sec_wan_ip: '' }, wan: { rx_bytes: counter }, tunnels: [] } as unknown as IpsecGatewayState['metrics'] });
  let calls = 0;
  const stop = subscribeIpsecMetrics(() => calls++);
  try {
    const source = FakeEventSource.instances[0];
    source.send('update', { gatewayKey: 'fiber', state: gateway('prpl/ipsec/metrics', 200, 20) });
    source.send('update', { gatewayKey: 'wifi', state: gateway('prplhome/ipsec/metrics', 201, 30) });
    source.send('update', { gatewayKey: 'fiber', state: gateway('prpl/ipsec/metrics', 202, 40) });
    source.send('status', { connected: false, reason: 'Broker reconnecting' });
    hydrate(new Response(JSON.stringify({ receivedAt: 100, gateways: { fiber: gateway('prpl/ipsec/metrics', 100, 1) }, connected: true })));
    await settle();
    assert.equal(calls, 1);
    assert.equal(getIpsecMetricsSnapshot().list.length, 2);
    assert.equal(getIpsecMetricsSnapshot().gateways.fiber.metrics.wan.rx_bytes, 40);
    assert.equal(getIpsecMetricsSnapshot().lastReceivedAt, 202);
    assert.equal(getIpsecMetricsSnapshot().connected, false);
    assert.equal(getIpsecMetricsSnapshot().lastError, 'Broker reconnecting', 'late hydration does not roll back a newer connection error');
    const refresh = refreshIpsecMetrics();
    hydrate(new Response(JSON.stringify({ receivedAt: 300, gateways: { fiber: gateway('prpl/ipsec/metrics', 300, 60), wifi: gateway('prplhome/ipsec/metrics', 301, 70) }, connected: true })));
    await refresh;
    assert.equal(requests, 2);
    assert.equal(getIpsecMetricsSnapshot().gateways.fiber.receivedAt, 300);
    assert.equal(getIpsecMetricsSnapshot().gateways.wifi.receivedAt, 301);
  } finally { stop(); globalThis.fetch = previousFetch; globalThis.EventSource = previousSource; }
});

test('equal-stamped HTTP device rosters cannot resurrect devices removed by a stream during the request', async () => {
  const previousFetch = globalThis.fetch;
  const previousSource = globalThis.EventSource;
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  FakeEventSource.instances = [];
  let respond!: (response: Response) => void;
  globalThis.fetch = () => new Promise((resolve) => { respond = resolve; });
  const stop = subscribeDeviceInventory(() => {});
  try {
    const source = FakeEventSource.instances[0];
    source.send('snapshot', deviceSnapshot(400, []));
    respond(new Response(JSON.stringify(deviceSnapshot(400))));
    await settle();
    assert.deepEqual(getDeviceInventorySnapshot().devices, [], 'hydration keeps the equal-stamped stream removal');

    const tiedRefresh = refreshDeviceInventory();
    source.send('snapshot', deviceSnapshot(500, []));
    respond(new Response(JSON.stringify(deviceSnapshot(500))));
    await tiedRefresh;
    assert.deepEqual(getDeviceInventorySnapshot().devices, [], 'manual refresh also keeps the stream removal');

    const newerRefresh = refreshDeviceInventory();
    source.send('snapshot', deviceSnapshot(600, []));
    respond(new Response(JSON.stringify(deviceSnapshot(601))));
    await newerRefresh;
    assert.equal(getDeviceInventorySnapshot().devices.length, 1, 'a genuinely newer HTTP roster still applies');
    assert.equal(getDeviceInventorySnapshot().lastReceivedAt, 601, 'manual refresh flushes before resolving');
  } finally { stop(); globalThis.fetch = previousFetch; globalThis.EventSource = previousSource; }
});

test('equal-stamped IPsec hydration guards touched topics while hydrating untouched/new topics and newer refresh data', async () => {
  const previousFetch = globalThis.fetch;
  const previousSource = globalThis.EventSource;
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  FakeEventSource.instances = [];
  let respond!: (response: Response) => void;
  globalThis.fetch = () => new Promise((resolve) => { respond = resolve; });
  const gateway = (topic: string, receivedAt: number, counter: number): IpsecGatewayState => ({ topic, receivedAt, metrics: { gateway: { name: topic, mac: '', prim_wan_ip: '', sec_wan_ip: '' }, wan: { rx_bytes: counter }, tunnels: [] } as unknown as IpsecGatewayState['metrics'] });
  const stop = subscribeIpsecMetrics(() => {});
  try {
    const source = FakeEventSource.instances[0];
    source.send('update', { gatewayKey: 'fiber', state: gateway('prpl/ipsec/metrics', 400, 40) });
    respond(new Response(JSON.stringify({ receivedAt: 400, gateways: { fiber: gateway('prpl/ipsec/metrics', 400, 1), wifi: gateway('prplhome/ipsec/metrics', 400, 2), other: gateway('rdk/ipsec/metrics', 400, 3) }, connected: true })));
    await settle();
    assert.equal(getIpsecMetricsSnapshot().gateways.fiber.metrics.wan.rx_bytes, 40);
    assert.equal(getIpsecMetricsSnapshot().gateways.wifi.metrics.wan.rx_bytes, 2);
    assert.equal(getIpsecMetricsSnapshot().gateways.other.metrics.wan.rx_bytes, 3);

    const duplicateRefresh = refreshIpsecMetrics();
    source.send('update', { gatewayKey: 'fiber', state: gateway('prpl/ipsec/metrics', 400, 40) });
    respond(new Response(JSON.stringify({ receivedAt: 400, gateways: { fiber: gateway('prpl/ipsec/metrics', 400, 1), wifi: gateway('prplhome/ipsec/metrics', 400, 2), other: gateway('rdk/ipsec/metrics', 400, 3) }, connected: true })));
    await duplicateRefresh;
    assert.equal(getIpsecMetricsSnapshot().gateways.fiber.metrics.wan.rx_bytes, 40, 'a repeated SSE delivery still establishes the equal-timestamp ordering guard');

    const tiedRefresh = refreshIpsecMetrics();
    source.send('update', { gatewayKey: 'fiber', state: gateway('prpl/ipsec/metrics', 500, 50) });
    respond(new Response(JSON.stringify({ receivedAt: 500, gateways: { fiber: gateway('prpl/ipsec/metrics', 500, 1), wifi: gateway('prplhome/ipsec/metrics', 600, 60) }, connected: true })));
    await tiedRefresh;
    assert.equal(getIpsecMetricsSnapshot().gateways.fiber.metrics.wan.rx_bytes, 50);
    assert.equal(getIpsecMetricsSnapshot().gateways.wifi.metrics.wan.rx_bytes, 60);

    const newerRefresh = refreshIpsecMetrics();
    source.send('update', { gatewayKey: 'fiber', state: gateway('prpl/ipsec/metrics', 600, 60) });
    respond(new Response(JSON.stringify({ receivedAt: 601, gateways: { fiber: gateway('prpl/ipsec/metrics', 601, 61), wifi: gateway('prplhome/ipsec/metrics', 600, 60) }, connected: true })));
    await newerRefresh;
    assert.equal(getIpsecMetricsSnapshot().gateways.fiber.metrics.wan.rx_bytes, 61);

    const removedRefresh = refreshIpsecMetrics();
    source.send('snapshot', { receivedAt: 700, gateways: {}, connected: false });
    respond(new Response(JSON.stringify({ receivedAt: 700, gateways: { fiber: gateway('prpl/ipsec/metrics', 700, 1) }, connected: true })));
    await removedRefresh;
    assert.equal(getIpsecMetricsSnapshot().list.length, 0, 'equal-stamped HTTP data cannot resurrect an SSE removal');
    assert.equal(getIpsecMetricsSnapshot().connected, false, 'the newer stream status is retained');
  } finally { stop(); globalThis.fetch = previousFetch; globalThis.EventSource = previousSource; }
});
