import assert from 'node:assert/strict';
import test from 'node:test';
import { createLiveDataStore, type LiveDataHost } from '../../src/ui/liveDataStore.ts';

function fakeHost() {
  let seq = 0;
  let visible = true;
  let now = 1_000;
  let visibility: (() => void) | undefined;
  const intervals = new Map<number, { callback: () => void; delay: number }>();
  const timeouts = new Map<number, { callback: () => void; delay: number }>();
  const host: LiveDataHost = {
    now: () => now, random: () => 0.9, isVisible: () => visible,
    setInterval(callback, delay) { const id = ++seq; intervals.set(id, { callback, delay }); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(callback, delay) { const id = ++seq; timeouts.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    onVisibilityChange(callback) { visibility = callback; return () => { visibility = undefined; }; },
  };
  return {
    host, intervals, timeouts,
    setVisible(next: boolean) { visible = next; visibility?.(); },
    advance(ms: number) { now += ms; },
    tick(delay: number) { for (const timer of [...intervals.values()]) if (timer.delay === delay) timer.callback(); },
    fireTimeout(delay: number) {
      for (const [id, timer] of [...timeouts]) if (timer.delay === delay) { timeouts.delete(id); timer.callback(); }
    },
  };
}

test('Home status and incident-only consumers do not start synthetic metric timers', () => {
  const clock = fakeHost();
  const store = createLiveDataStore(clock.host);
  store.start(() => {});
  const unsubscribeIncident = store.subscribeIncident(() => {});
  assert.equal(store.getSnapshot().isLive, true);
  assert.equal(clock.intervals.size, 0);
  const unsubscribeSimulation = store.subscribeSimulation(() => {});
  assert.equal(clock.intervals.size, 2);
  unsubscribeSimulation();
  assert.equal(clock.intervals.size, 0);
  unsubscribeIncident(); store.stop();
  assert.equal(clock.timeouts.size, 0);
});

test('simulated metrics never notify incident subscribers and incident events never notify metric subscribers', () => {
  const clock = fakeHost();
  const store = createLiveDataStore(clock.host);
  let metricUpdates = 0; let incidentUpdates = 0;
  store.subscribeSimulation(() => metricUpdates++);
  store.subscribeIncident(() => incidentUpdates++);
  store.start(() => {});
  const initial = store.getSnapshot();
  clock.tick(4_000);
  assert.notEqual(store.getThroughput(), initial.throughputMbps);
  assert.equal(metricUpdates, 1);
  assert.equal(incidentUpdates, 0);
  clock.tick(5_000);
  assert.equal(metricUpdates, 2);
  assert.equal(incidentUpdates, 0);
  clock.fireTimeout(50_000);
  assert.equal(store.getIncidentTrigger(), 1);
  assert.equal(incidentUpdates, 1);
  assert.equal(metricUpdates, 2);
  store.stop();
});

test('hidden tabs cancel all simulated work and resume without a backlog of toasts', () => {
  const clock = fakeHost();
  const store = createLiveDataStore(clock.host);
  const toasts: unknown[] = [];
  store.subscribeSimulation(() => {});
  store.start((toast) => toasts.push(toast));
  assert.equal(clock.intervals.size, 2);
  assert.equal(clock.timeouts.size, 2);
  clock.setVisible(false);
  assert.equal(clock.intervals.size, 0);
  assert.equal(clock.timeouts.size, 0);
  clock.advance(120_000);
  clock.setVisible(true);
  assert.equal(clock.intervals.size, 2);
  assert.equal(clock.timeouts.size, 2);
  clock.fireTimeout(0); // Deliver the one incident due while away.
  assert.equal(toasts.length, 1);
  clock.setVisible(false); clock.setVisible(true);
  assert.equal(clock.timeouts.size, 1); // No repeat incident or accumulated toast backlog.
  store.stop();
  assert.equal(clock.intervals.size, 0);
  assert.equal(clock.timeouts.size, 0);
});

test('bandwidth updates preserve the history window while a 30-second bucket advances', () => {
  const clock = fakeHost();
  const store = createLiveDataStore(clock.host);
  store.subscribeSimulation(() => {}); store.start(() => {});
  const initial = store.getSnapshot().bandwidthSeries;
  for (let count = 0; count < 6; count++) { clock.advance(5_000); clock.tick(5_000); }
  const series = store.getSnapshot().bandwidthSeries;
  assert.equal(series.length, initial.length);
  assert.equal(series[0], initial[1]);
  assert.notEqual(series[series.length - 1], initial[initial.length - 1]);
  store.stop();
});
