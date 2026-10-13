import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFlowSwitch, tunnelSwitchIntent } from '../../src/ui/failoverFlowSwitch';
import type { FlowSwitchContext } from '../../src/ui/failoverFlowSwitch';
import { createPathOverrideController } from '../../src/ui/pathOverrideController';

const tunnels = ['xfrm2-cell', 'xfrm1-fiber', 'xfrm1-cell', 'xfrm2-fiber']
  .map((ifname) => ({ ifname, present: true, reachable: true }));
const live: FlowSwitchContext = { mode: 'live', tunnels, activeTunnel: 'xfrm1-fiber' };

test('fixed interface mapping is independent of payload order and missing siblings', () => {
  assert.deepEqual(resolveFlowSwitch('tunnel:xfrm2-cell', live), {
    mode: '5g', command: 'tunnel4', tunnel: 'xfrm2-cell',
  });
  assert.equal(resolveFlowSwitch('tunnel:xfrm2-fiber', { ...live, tunnels: [tunnels[3]] })?.command, 'tunnel2');
  assert.equal(tunnelSwitchIntent('vti1')?.command, 'tunnel1');
  assert.equal(tunnelSwitchIntent('vti2')?.command, 'tunnel2');
  assert.equal(tunnelSwitchIntent('vti3')?.mode, '5g');
  assert.equal(tunnelSwitchIntent('vti4')?.command, 'tunnel4');
});

test('unknown interfaces and ambiguous aliases never resolve to ordinal commands', () => {
  for (const ifname of ['fiber2', 'xfrm3-fiber', 'xfrm1-cell-backup', 'XFRM1-CELL', '']) {
    assert.equal(tunnelSwitchIntent(ifname), null);
    assert.equal(resolveFlowSwitch(`tunnel:${ifname}`, {
      ...live, tunnels: [{ ifname, present: true, reachable: true }],
    }), null);
  }
  assert.equal(resolveFlowSwitch('tunnel:xfrm2-fiber', {
    ...live, tunnels: [...tunnels, { ifname: 'vti2', present: true, reachable: true }],
  }), null);
});

test('target policy, missing, unavailable, current and duplicate requested drops are rejected', () => {
  const id = 'tunnel:xfrm1-cell';
  assert.equal(resolveFlowSwitch(id, { ...live, mode: 'target' }), null);
  assert.equal(resolveFlowSwitch(id, { ...live, tunnels: [] }), null);
  for (const state of [{ present: false, reachable: true }, { present: true, reachable: false }]) {
    assert.equal(resolveFlowSwitch(id, { ...live, tunnels: [{ ifname: 'xfrm1-cell', ...state }] }), null);
  }
  assert.equal(resolveFlowSwitch('tunnel:xfrm1-fiber', live), null);
  assert.equal(resolveFlowSwitch(id, { ...live, requestedTunnel: 'xfrm1-cell' }), null);
  assert.equal(resolveFlowSwitch('gateway', live), null);
});

test('a reversal can return to the reported path while another path is requested', () => {
  assert.equal(resolveFlowSwitch('tunnel:xfrm1-fiber', {
    ...live, activeTunnel: 'xfrm1-cell', requestedTunnel: 'xfrm1-cell',
  })?.command, 'tunnel1');
});

test('a resolved preview drop uses the controller without sending a gateway command', () => {
  let sends = 0;
  const controller = createPathOverrideController({
    scope: 'drag-preview', sample: true,
    telemetry: { activeTunnel: live.activeTunnel, receivedAt: 10 },
    send: async () => { sends++; return { pending: false }; },
  });
  const intent = resolveFlowSwitch('tunnel:xfrm2-cell', live);
  assert.ok(intent);
  controller.request(intent.mode, intent.command, intent.tunnel);
  assert.equal(controller.getSnapshot().visualTunnel, 'xfrm2-cell');
  assert.equal(controller.getSnapshot().phase, 'preview');
  assert.equal(sends, 0);
  controller.dispose();
});
