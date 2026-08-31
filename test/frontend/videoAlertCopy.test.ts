import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVideoAlertToast } from '../../src/features/videoAnalytics/videoAlertCopy';
import type { VideoRelayEvent } from '../../src/ui/useVideoAlerts';

function event(code: 'ON_1' | 'ON_2' | 'ON_3' | 'ON_4'): VideoRelayEvent {
  const channel = Number(code.at(-1)) as 1 | 2 | 3 | 4;
  const levels = ['attention', 'warning', 'clear', 'critical'] as const;
  return {
    id: 1,
    topic: 'relay/control',
    code,
    state: 'ON',
    channel,
    level: levels[channel - 1],
    encoding: 'raw',
    receivedAt: 1_786_640_400_000,
    retained: false,
  };
}

test('critical relay copy gives verified-feed context without claiming detector attribution', () => {
  const fall = buildVideoAlertToast(event('ON_4'), { id: 'nv-fall', name: 'Fall detection' });
  assert.equal(fall.kind, 'critical');
  assert.equal(fall.title, 'Critical video analytics alert');
  assert.match(fall.detail, /relay\/control ON_4/);
  assert.match(fall.detail, /Current verified feed: Fall detection/i);
  assert.match(fall.detail, /does not identify which detector originated/i);
  assert.match(fall.detail, /site safety procedure/i);

  const hairnet = buildVideoAlertToast(event('ON_4'), { id: 'ha-hairnet', name: 'Hairnet monitor' });
  assert.equal(hairnet.title, 'Critical video analytics alert');
  assert.match(hairnet.detail, /Current verified feed: Hairnet monitor/i);
  assert.match(hairnet.detail, /missing hairnet|required hair covering/i);

  const violence = buildVideoAlertToast(event('ON_4'), { id: 'nv-violence', name: 'Violence detection' });
  assert.equal(violence.title, 'Critical video analytics alert');
  assert.match(violence.detail, /Current verified feed: Violence detection/i);
  assert.match(violence.detail, /site security procedure/i);
});

test('relay levels map to attention, warning, clear, and critical toast states', () => {
  const stream = { id: 'nv-fall', name: 'Fall detection' };
  assert.equal(buildVideoAlertToast(event('ON_1'), stream).kind, 'warn');
  assert.equal(buildVideoAlertToast(event('ON_2'), stream).kind, 'warn');
  assert.equal(buildVideoAlertToast(event('ON_3'), stream).kind, 'success');
  assert.equal(buildVideoAlertToast(event('ON_4'), stream).kind, 'critical');
  assert.match(buildVideoAlertToast(event('ON_3'), stream).title, /all systems OK/i);
  assert.match(buildVideoAlertToast(event('ON_1'), stream).detail, /does not identify which detector originated/i);
});

test('an alert remains actionable when no feed is open', () => {
  const copy = buildVideoAlertToast(event('ON_4'));
  assert.equal(copy.title, 'Critical video analytics alert');
  assert.match(copy.detail, /No verified live feed is currently open/i);
  assert.match(copy.detail, /open the relevant live feed/i);
});

test('a replayed critical pulse is clearly labeled as recovered', () => {
  const replayed = buildVideoAlertToast({ ...event('ON_4'), replayed: true }, {
    id: 'nv-fall',
    name: 'Fall detection',
  });
  assert.equal(replayed.title, 'Recovered critical video analytics alert');
  assert.match(replayed.detail, /connection resumed/i);
  assert.match(replayed.detail, /Current verified feed: Fall detection/i);
  assert.match(replayed.detail, /does not identify which detector originated/i);
});
