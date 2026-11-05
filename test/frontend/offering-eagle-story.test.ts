import assert from 'node:assert/strict';
import test from 'node:test';
import { ANOMALY_REASON_LABELS } from '../../shared/eagleTelemetry.ts';
import { EAGLE_CASES, EAGLE_TIMING, sampleEagle } from '../../src/components/offerings/OfferingEagleStory.ts';
import { sampleFilmCue } from '../../src/components/offerings/OfferingFilmSequence.ts';

test('the visible response slows before review; every investigation remains unresolved', () => {
  for (const variant of Object.keys(EAGLE_CASES)) {
    const before = sampleEagle(variant, 3.9);
    const delayed = sampleEagle(variant, 6);
    const outcome = sampleEagle(variant, 24);
    assert.equal(before.endpointDelayMs, before.baselineResponseMs);
    assert.equal(before.symptom, false);
    assert.ok(delayed.endpointDelayMs >= 2200);
    assert.equal(delayed.symptom, true);
    assert.equal(delayed.operatorAtConsole, false);
    assert.equal(delayed.diagnosticReviewed, false);
    assert.equal(sampleEagle(variant, EAGLE_TIMING.review).operatorAtConsole, true);
    assert.equal(sampleEagle(variant, EAGLE_TIMING.dispatch).diagnosticReviewed, true);
    assert.equal(outcome.endpointDelayMs, delayed.endpointDelayMs, 'inspection must not silently repair the delay');
    assert.equal(outcome.resolved, false);
    assert.equal(outcome.inspectionStarted, true);
    assert.equal(sampleEagle(variant, 17).inspectionStarted, false);
    assert.equal(sampleEagle(variant, 18).inspectionStarted, variant !== 'ot');
  }
});

test('a hardware threshold crossing and received detector flag remain distinct', () => {
  const crossing = sampleEagle('gateway', 5.5);
  assert.equal(crossing.thresholdCrossed, true);
  assert.equal(crossing.anomalyFlag, false);
  assert.equal(crossing.diagnosticStatus, 'Crossing; flag pending');
  const flagged = sampleEagle('gateway', 6);
  assert.equal(flagged.anomalyMse, 1.48);
  assert.equal(flagged.anomalyThreshold, 1.122);
  assert.equal(flagged.anomalyFlag, true);
  assert.equal(flagged.reasonCode, 2);
  assert.equal(flagged.reasonLabel, ANOMALY_REASON_LABELS[2]);
  for (const variant of ['fiber', '5g', 'it', 'ot']) {
    const state = sampleEagle(variant, 24);
    assert.ok(state.anomalyMse < state.anomalyThreshold);
    assert.equal(state.anomalyFlag, false, 'a slow interface/service is not automatically a hardware anomaly');
    assert.equal(state.reasonCode, 0);
    assert.equal(state.reasonLabel, 'Normal');
    assert.ok(state.endpointDelayMs > state.baselineResponseMs);
  }
  assert.equal(sampleEagle('5g', 24).checkoutAffected, false);
  assert.equal(sampleEagle('ot', 24).checkoutAffected, false);
});

test('connection totals are protocol sums and timeline seeking restores diagnostic evidence', () => {
  for (const variant of Object.keys(EAGLE_CASES)) for (let frame = 0; frame <= 240; frame++) {
    const state = sampleEagle(variant, frame / 10);
    const { total, tcp, udp, icmp, other } = state.conntrack;
    assert.equal(total, tcp + udp + icmp + other);
    assert.equal(state.illustrative, true);
    assert.equal(state.resolved, false);
  }
  const before = sampleEagle('gateway', 4.8);
  sampleEagle('gateway', 24);
  assert.deepEqual(sampleEagle('gateway', 4.8), before);
  assert.deepEqual(sampleEagle('unknown', 10), sampleEagle('gateway', 10));
  assert.deepEqual(sampleEagle('constructor', 10), sampleEagle('gateway', 10));
});

test('all five films show an operator reviewing the real EA:GLE fields before physical inspection', () => {
  for (const variant of Object.keys(EAGLE_CASES)) {
    const context = { offering: 'eagle' as const, variant };
    assert.match(sampleFilmCue(context, 7).subtitle, /diagnostic console.*IT rack/);
    assert.match(sampleFilmCue(context, 9).title, /reconstruction error.*threshold/);
    assert.match(sampleFilmCue(context, 10.5).title, /flag and reason/);
    assert.match(sampleFilmCue(context, 12).subtitle, /TCP.*UDP.*ICMP/);
    assert.match(sampleFilmCue(context, 14).subtitle, /leaves the console/);
    assert.match(sampleFilmCue(context, 23).title, /Investigation stays open/);
  }
});
