import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createPathOverrideController } from '../../src/ui/pathOverrideController';
import type { PathCommand, PathOverrideControllerOptions, PathTelemetry } from '../../src/ui/pathOverrideController';

class ManualClock {
  now = 100_000;
  private nextId = 0;
  private tasks = new Map<number, { at: number; callback: () => void }>();
  schedule = (callback: () => void, delay: number) => {
    const id = ++this.nextId;
    this.tasks.set(id, { at: this.now + delay, callback });
    return id;
  };
  cancel = (handle: unknown) => { this.tasks.delete(handle as number); };
  advance(milliseconds: number) {
    const target = this.now + milliseconds;
    for (;;) {
      const next = [...this.tasks.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) break;
      this.now = next[1].at;
      this.tasks.delete(next[0]);
      next[1].callback();
    }
    this.now = target;
  }
}

function deferredTransport() {
  type Call = { command: PathCommand; resolve(value: { pending: boolean }): void; reject(error: unknown): void };
  const calls: Call[] = [];
  let active = 0;
  let maximumActive = 0;
  const send = (command: PathCommand) => {
    active++;
    maximumActive = Math.max(maximumActive, active);
    return new Promise<{ pending: boolean }>((resolve, reject) => { calls.push({ command, resolve, reject }); })
      .finally(() => { active--; });
  };
  return { send, calls, get maximumActive() { return maximumActive; } };
}

const initialTelemetry: PathTelemetry = { activeTunnel: 'xfrm1-fiber', receivedAt: 100, sourceTimestampMs: 90 };
function fixture(overrides: Partial<PathOverrideControllerOptions> = {}) {
  const clock = new ManualClock();
  const transport = deferredTransport();
  const controller = createPathOverrideController({
    scope: 'gateway-a', telemetry: initialTelemetry, send: transport.send,
    now: () => clock.now, schedule: clock.schedule, cancel: clock.cancel, ...overrides,
  });
  return { controller, transport, clock };
}

test('shows an exact requested tunnel immediately and serializes only the latest queued reversal', async () => {
  const { controller, transport } = fixture();
  controller.request('fiber', 'tunnel1', 'xfrm1-fiber');
  controller.request('5g', 'tunnel3', 'xfrm1-cell');
  assert.equal(controller.getSnapshot().visualTunnel, 'xfrm1-cell');
  assert.equal(controller.getSnapshot().phase, 'queued');
  controller.request('fiber', 'tunnel2', 'xfrm2-fiber');
  assert.equal(controller.getSnapshot().visualTunnel, 'xfrm2-fiber');
  assert.deepEqual(transport.calls.map((call) => call.command), ['tunnel1']);
  transport.calls[0].resolve({ pending: false });
  await nextTurn();
  assert.deepEqual(transport.calls.map((call) => call.command), ['tunnel1', 'tunnel2']);
  assert.equal(controller.getSnapshot().phase, 'sending');
  controller.updateTelemetry({ activeTunnel: 'xfrm1-cell', receivedAt: 110, sourceTimestampMs: 100 });
  assert.equal(controller.getSnapshot().visualTunnel, 'xfrm2-fiber');
  transport.calls[1].resolve({ pending: true });
  await nextTurn();
  controller.updateTelemetry({ activeTunnel: 'xfrm2-fiber', receivedAt: 120, sourceTimestampMs: 110 });
  assert.equal(controller.getSnapshot().phase, 'confirmed');
  assert.equal(transport.maximumActive, 1);
  controller.dispose();
});

test('a mode ACK alone never confirms FORCE, and replayed or partial source timestamps cannot confirm it', async () => {
  const { controller, transport } = fixture();
  controller.request('5g', 'tunnel3', 'xfrm1-cell');
  transport.calls[0].resolve({ pending: false });
  await nextTurn();
  assert.equal(controller.getSnapshot().phase, 'awaiting-telemetry');
  for (const telemetry of [
    { activeTunnel: 'xfrm1-cell', receivedAt: 101, sourceTimestampMs: 90 },
    { activeTunnel: 'xfrm1-cell', receivedAt: 102, sourceTimestampMs: 89 },
    { activeTunnel: 'xfrm1-cell', receivedAt: 100, sourceTimestampMs: 91 },
    { activeTunnel: 'xfrm1-cell', receivedAt: 103 },
  ]) {
    controller.updateTelemetry(telemetry);
    assert.equal(controller.getSnapshot().phase, 'awaiting-telemetry');
    assert.equal(controller.getSnapshot().visualTunnel, 'xfrm1-cell');
  }
  controller.updateTelemetry({ activeTunnel: 'xfrm1-cell', receivedAt: 104, sourceTimestampMs: 91 });
  assert.equal(controller.getSnapshot().phase, 'confirmed');
  assert.match(controller.getSnapshot().message, /ALSO ACKNOWLEDGED/);
  controller.dispose();
});

test('new matching route telemetry can confirm before ACK and a delayed failure cannot undo that evidence', async () => {
  const { controller, transport, clock } = fixture();
  controller.request('5g', 'tunnel3', 'xfrm1-cell');
  controller.updateTelemetry({ activeTunnel: 'xfrm1-cell', receivedAt: 101, sourceTimestampMs: 91 });
  assert.equal(controller.getSnapshot().phase, 'confirmed');
  assert.match(controller.getSnapshot().message, /RESPONSE IS STILL PENDING/);
  clock.advance(30_001);
  transport.calls[0].reject(new Error('A delayed HTTP rejection'));
  await nextTurn();
  assert.equal(controller.getSnapshot().phase, 'confirmed');
  assert.equal(controller.getSnapshot().visualTunnel, 'xfrm1-cell');
  assert.match(controller.getSnapshot().message, /COMMAND RESPONSE FAILED.*MODE ACK WAS NOT RECEIVED/);
  assert.doesNotMatch(controller.getSnapshot().message, /RESPONSE IS STILL PENDING/);
  controller.dispose();
});

test('a later ACK clarifies an already observed route without fabricating a second path change', async () => {
  const { controller, transport } = fixture();
  controller.request('5g', 'tunnel4', 'xfrm2-cell');
  controller.updateTelemetry({ activeTunnel: 'xfrm2-cell', receivedAt: 101, sourceTimestampMs: 91 });
  transport.calls[0].resolve({ pending: false });
  await nextTurn();
  assert.equal(controller.getSnapshot().phase, 'confirmed');
  assert.match(controller.getSnapshot().message, /ALSO ACKNOWLEDGED/);
  assert.equal(controller.getSnapshot().requestedTunnel, 'xfrm2-cell');
  controller.dispose();
});

test('202 FORCE can settle from new telemetry while explicitly preserving the absent mode ACK', async () => {
  const { controller, transport } = fixture();
  controller.request('5g', 'tunnel3', 'xfrm1-cell');
  transport.calls[0].resolve({ pending: true });
  await nextTurn();
  assert.equal(controller.getSnapshot().phase, 'awaiting-ack');
  controller.updateTelemetry({ activeTunnel: 'xfrm1-cell', receivedAt: 101, sourceTimestampMs: 91 });
  assert.equal(controller.getSnapshot().phase, 'confirmed');
  assert.match(controller.getSnapshot().message, /MODE ACK WAS NOT RECEIVED/);
  controller.dispose();
});

test('AUTO uses reported routing, never treats active telemetry as a mode ACK, and confirms only a successful ACK', async () => {
  const { controller, transport, clock } = fixture();
  controller.request('auto', 'auto');
  assert.equal(controller.getSnapshot().forcedTunnel, null);
  assert.equal(controller.getSnapshot().visualTunnel, 'xfrm1-fiber');
  transport.calls[0].resolve({ pending: true });
  await nextTurn();
  controller.updateTelemetry({ activeTunnel: 'xfrm2-cell', receivedAt: 101, sourceTimestampMs: 91 });
  assert.equal(controller.getSnapshot().phase, 'awaiting-ack');
  assert.equal(controller.getSnapshot().visualTunnel, 'xfrm2-cell');
  clock.advance(30_000);
  assert.equal(controller.getSnapshot().phase, 'unconfirmed');
  controller.request('auto', 'auto');
  transport.calls[1].resolve({ pending: false });
  await nextTurn();
  assert.equal(controller.getSnapshot().phase, 'confirmed');
  assert.equal(controller.getSnapshot().mode, 'auto');
  assert.equal(controller.getSnapshot().visualTunnel, 'xfrm2-cell');
  controller.dispose();
});

test('a 30-second dispatch deadline releases optimistic routing to current telemetry and retains an uncertainty warning', async () => {
  const { controller, transport, clock } = fixture();
  controller.request('5g', 'tunnel3', 'xfrm1-cell');
  transport.calls[0].resolve({ pending: false });
  await nextTurn();
  controller.updateTelemetry({ activeTunnel: 'xfrm2-fiber', receivedAt: 110, sourceTimestampMs: 100 });
  clock.advance(29_999);
  assert.equal(controller.getSnapshot().visualTunnel, 'xfrm1-cell');
  clock.advance(1);
  assert.equal(controller.getSnapshot().phase, 'unconfirmed');
  assert.equal(controller.getSnapshot().visualTunnel, 'xfrm2-fiber');
  assert.equal(controller.getSnapshot().requestedTunnel, 'xfrm1-cell');
  assert.match(controller.getSnapshot().message, /COULD NOT BE CONFIRMED.*REPORTED ROUTE/);
  controller.updateTelemetry({ activeTunnel: 'xfrm1-cell', receivedAt: 120, sourceTimestampMs: 110 });
  assert.equal(controller.getSnapshot().phase, 'unconfirmed');
  assert.equal(controller.getSnapshot().visualTunnel, 'xfrm1-cell');
  controller.dispose();
});

test('hard rejection restores the previous completed choice while showing the current actual path', async () => {
  const { controller, transport } = fixture();
  controller.request('fiber', 'tunnel2', 'xfrm2-fiber');
  transport.calls[0].resolve({ pending: false });
  await nextTurn();
  controller.updateTelemetry({ activeTunnel: 'xfrm2-fiber', receivedAt: 110, sourceTimestampMs: 100 });
  controller.request('5g', 'tunnel3', 'xfrm1-cell');
  controller.updateTelemetry({ activeTunnel: 'xfrm1-fiber', receivedAt: 120, sourceTimestampMs: 110 });
  transport.calls[1].reject(new Error('Gateway refused the command'));
  await nextTurn();
  assert.equal(controller.getSnapshot().phase, 'failed');
  assert.equal(controller.getSnapshot().mode, 'fiber');
  assert.equal(controller.getSnapshot().forcedTunnel, 'xfrm2-fiber');
  assert.equal(controller.getSnapshot().visualTunnel, 'xfrm1-fiber');
  assert.equal(controller.getSnapshot().requestedTunnel, 'xfrm1-cell');
  controller.dispose();
});

test('transport timeouts are uncertain delivery, rather than false hard rejections or successes', async () => {
  const { controller, transport } = fixture();
  controller.request('5g', 'tunnel3', 'xfrm1-cell');
  const error = new Error('The request timed out');
  error.name = 'TimeoutError';
  transport.calls[0].reject(error);
  await nextTurn();
  assert.equal(controller.getSnapshot().phase, 'unconfirmed');
  assert.equal(controller.getSnapshot().mode, '5g');
  assert.equal(controller.getSnapshot().visualTunnel, 'xfrm1-fiber');
  assert.match(controller.getSnapshot().message, /MAY STILL HAVE REACHED/);
  controller.dispose();
});

test('confirmed selection follows later reported changes instead of overriding physical truth indefinitely', async () => {
  const { controller, transport } = fixture();
  controller.request('5g', 'tunnel3', 'xfrm1-cell');
  transport.calls[0].resolve({ pending: false });
  await nextTurn();
  controller.updateTelemetry({ activeTunnel: 'xfrm1-cell', receivedAt: 110, sourceTimestampMs: 100 });
  controller.updateTelemetry({ activeTunnel: 'xfrm2-fiber', receivedAt: 120, sourceTimestampMs: 110 });
  assert.equal(controller.getSnapshot().visualTunnel, 'xfrm2-fiber');
  assert.equal(controller.getSnapshot().forcedTunnel, 'xfrm1-cell');
  assert.match(controller.getSnapshot().message, /CURRENT REPORTED ROUTE: XFRM2-FIBER/);
  controller.dispose();
});

test('scope changes discard old unsent intents and responses, then serialize the new scope request', async () => {
  const { controller, transport } = fixture();
  const nextTransport = deferredTransport();
  controller.request('fiber', 'tunnel2', 'xfrm2-fiber');
  controller.request('5g', 'tunnel3', 'xfrm1-cell');
  controller.configure({ scope: 'gateway-b', telemetry: { activeTunnel: 'b-cell', receivedAt: 10, sourceTimestampMs: 5 }, send: nextTransport.send });
  assert.equal(controller.getSnapshot().phase, 'idle');
  assert.equal(controller.getSnapshot().visualTunnel, 'b-cell');
  controller.request('fiber', 'tunnel1', 'b-fiber');
  assert.equal(nextTransport.calls.length, 0);
  transport.calls[0].resolve({ pending: false });
  await nextTurn();
  assert.deepEqual(transport.calls.map((call) => call.command), ['tunnel2']);
  assert.deepEqual(nextTransport.calls.map((call) => call.command), ['tunnel1']);
  assert.equal(controller.getSnapshot().scope, 'gateway-b');
  assert.equal(controller.getSnapshot().visualTunnel, 'b-fiber');
  nextTransport.calls[0].resolve({ pending: false });
  await nextTurn();
  controller.dispose();
});

test('disposal drops queued sends, removes listeners, and ignores all later results and requests', async () => {
  const { controller, transport, clock } = fixture();
  let notifications = 0;
  controller.subscribe(() => { notifications++; });
  controller.request('fiber', 'tunnel2', 'xfrm2-fiber');
  controller.request('5g', 'tunnel3', 'xfrm1-cell');
  const before = controller.getSnapshot();
  const notificationCount = notifications;
  controller.dispose();
  transport.calls[0].resolve({ pending: false });
  await nextTurn();
  clock.advance(90_000);
  controller.request('auto', 'auto');
  controller.updateTelemetry({ activeTunnel: 'xfrm2-cell', receivedAt: 110, sourceTimestampMs: 100 });
  assert.equal(transport.calls.length, 1);
  assert.equal(notifications, notificationCount);
  assert.equal(controller.getSnapshot(), before);
});

test('sample previews never invoke transport, including AUTO and unavailable requested routes', () => {
  const { controller, transport, clock } = fixture({ sample: true });
  controller.request('5g', 'tunnel4', 'unavailable-cell');
  assert.equal(controller.getSnapshot().phase, 'preview');
  assert.equal(controller.getSnapshot().visualTunnel, 'unavailable-cell');
  clock.advance(90_000);
  assert.equal(transport.calls.length, 0);
  controller.request('auto', 'auto');
  assert.equal(controller.getSnapshot().visualTunnel, 'xfrm1-fiber');
  assert.equal(controller.getSnapshot().requestedTunnel, null);
  assert.equal(transport.calls.length, 0);
  controller.dispose();
});

test('an unavailable live tunnel stays an explicit request and never silently picks a healthy alternative', async () => {
  const { controller, transport, clock } = fixture();
  controller.request('5g', 'tunnel4', 'unavailable-cell');
  transport.calls[0].resolve({ pending: false });
  await nextTurn();
  controller.updateTelemetry({ activeTunnel: 'healthy-cell', receivedAt: 110, sourceTimestampMs: 100 });
  assert.equal(controller.getSnapshot().visualTunnel, 'unavailable-cell');
  assert.equal(controller.getSnapshot().phase, 'awaiting-telemetry');
  clock.advance(30_000);
  assert.equal(controller.getSnapshot().visualTunnel, 'healthy-cell');
  assert.equal(controller.getSnapshot().phase, 'unconfirmed');
  controller.dispose();
});

test('freshness compares feed ordering rather than browser wall-clock time', () => {
  const { controller, clock } = fixture();
  assert.equal(clock.now, 100_000);
  controller.request('5g', 'tunnel3', 'xfrm1-cell');
  controller.updateTelemetry({ activeTunnel: 'xfrm1-cell', receivedAt: 101, sourceTimestampMs: 91 });
  assert.equal(controller.getSnapshot().phase, 'confirmed');
  controller.dispose();
});

test('missing-source zero sentinels use receipt freshness and can confirm a new reported route', async () => {
  const { controller, transport } = fixture({ telemetry: { activeTunnel: 'xfrm1-fiber', receivedAt: 100, sourceTimestampMs: 0 } });
  controller.request('5g', 'tunnel3', 'xfrm1-cell');
  transport.calls[0].resolve({ pending: false });
  await nextTurn();
  controller.updateTelemetry({ activeTunnel: 'xfrm1-cell', receivedAt: 101, sourceTimestampMs: 0 });
  assert.equal(controller.getSnapshot().phase, 'confirmed');
  assert.equal(controller.getSnapshot().visualTunnel, 'xfrm1-cell');
  controller.dispose();
});

test('development lifecycle reactivation does not resurrect an old queued command or response', async () => {
  const { controller, transport } = fixture();
  controller.request('fiber', 'tunnel2', 'xfrm2-fiber');
  controller.request('5g', 'tunnel3', 'xfrm1-cell');
  controller.dispose();
  controller.activate();
  assert.equal(controller.getSnapshot().phase, 'idle');
  controller.request('auto', 'auto');
  transport.calls[0].resolve({ pending: false });
  await nextTurn();
  assert.deepEqual(transport.calls.map((call) => call.command), ['tunnel2', 'auto']);
  assert.equal(controller.getSnapshot().mode, 'auto');
  transport.calls[1].resolve({ pending: false });
  await nextTurn();
  assert.equal(controller.getSnapshot().phase, 'confirmed');
  controller.dispose();
});
