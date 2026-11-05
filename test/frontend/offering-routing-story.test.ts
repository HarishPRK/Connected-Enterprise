import assert from 'node:assert/strict';
import test from 'node:test';
import { ROUTING_TIMING, sampleRouting } from '../../src/components/offerings/OfferingRoutingStory.ts';
import { sampleFilmCue } from '../../src/components/offerings/OfferingFilmSequence.ts';
import { OFFERING_CHAPTERS } from '../../src/components/offerings/offeringCatalog.ts';
import { getOfferingUseCase } from '../../src/components/offerings/offeringUseCases.ts';

test('routing responds to observed load while both links and local recording stay available', () => {
  const baseline = sampleRouting(0);
  const busy = sampleRouting(7);
  const selected = sampleRouting(11);
  assert.equal(baseline.paymentPath, 'Fiber');
  assert.ok(baseline.fiber.latencyMs < baseline.fiveG.latencyMs, 'cellular is not assumed faster at baseline');
  assert.ok(busy.fiber.latencyMs > busy.fiveG.latencyMs);
  assert.ok(busy.fiber.jitterMs > busy.fiveG.jitterMs);
  assert.equal(busy.paymentState, 'held');
  assert.equal(busy.ordersState, 'queued');
  assert.equal(selected.paymentPath, '5G');
  assert.equal(selected.ordersPath, '5G');
  assert.equal(selected.archivePath, 'Fiber');
  assert.equal(selected.archiveCapSource, 'Archive uploader');
  assert.equal(selected.archiveCapMbps, 12);
  assert.ok(selected.archiveMbps < busy.archiveMbps);
  assert.ok(selected.fiber.utilizationPercent < busy.fiber.utilizationPercent);
  for (let frame = 0; frame <= 480; frame++) {
    const state = sampleRouting(frame / 20);
    assert.equal(state.illustrative, true);
    assert.equal(state.fiber.online, true);
    assert.equal(state.fiveG.online, true);
    assert.equal(state.fiber.lossPercent, 0);
    assert.equal(state.fiveG.lossPercent, 0);
    assert.equal(state.localRecording, true);
    assert.equal(state.archivePath, 'Fiber');
    assert.ok(state.archiveMbps > 0);
  }
});

test('the route is selected before one authorization; approval precedes receipt and queue release', () => {
  assert.ok(ROUTING_TIMING.policy < ROUTING_TIMING.authorization);
  assert.ok(ROUTING_TIMING.authorization < ROUTING_TIMING.approval);
  assert.ok(ROUTING_TIMING.approval < ROUTING_TIMING.receipt);
  assert.ok(ROUTING_TIMING.receipt < ROUTING_TIMING.queueResumes);
  let previousCount = 0;
  let submissions = 0;
  for (let frame = 0; frame <= 480; frame++) {
    const time = frame / 20;
    const state = sampleRouting(time);
    assert.equal(state.authorizationSent, time >= ROUTING_TIMING.authorization);
    assert.equal(state.authorizationCount, time >= ROUTING_TIMING.authorization ? 1 : 0);
    if (state.authorizationCount > previousCount) submissions++;
    previousCount = state.authorizationCount;
    if (state.authorizationSent) {
      assert.equal(state.policyApplied, true);
      assert.equal(state.paymentPath, '5G');
    }
    if (state.paymentApproved) assert.equal(state.authorizationSent, true);
    if (state.receiptPrinted) assert.equal(state.paymentApproved, true);
    if (state.queueResumed) assert.equal(state.receiptPrinted, true);
    if (state.orderAccepted) assert.equal(state.orderSent, true);
  }
  assert.equal(submissions, 1, 'the animation must not model a retry or duplicate authorization');
  assert.equal(sampleRouting(ROUTING_TIMING.authorization - .01).paymentState, 'route-ready');
  assert.equal(sampleRouting(ROUTING_TIMING.authorization).paymentState, 'authorizing');
  assert.equal(sampleRouting(ROUTING_TIMING.approval).paymentState, 'approved');
});

test('seeking backward restores routing state and all perspectives retain the same physical payoff', () => {
  const before = sampleRouting(7);
  const after = sampleRouting(20);
  assert.deepEqual(sampleRouting(7), before);
  assert.deepEqual(sampleRouting(20), after);
  const chapter = OFFERING_CHAPTERS.find(item => item.id === 'routing');
  assert.ok(chapter);
  assert.deepEqual(chapter.variants.map(item => item.id), ['payment', 'orders', 'archive']);
  for (const variant of chapter.variants) {
    assert.ok(getOfferingUseCase(chapter, variant).title.length > 0);
    const context = { offering: 'routing' as const, variant: variant.id };
    assert.match(sampleFilmCue(context, 8.5).subtitle, /96 ms.*32 ms/);
    assert.match(sampleFilmCue(context, 12.55).title, /one authorization/i);
    assert.match(sampleFilmCue(context, 13.1).title, /Approved/);
    assert.match(sampleFilmCue(context, 15).title, /receipt/);
    assert.match(sampleFilmCue(context, 17).title, variant.id === 'orders' ? /order #1042/i : /next shopper/i);
    for (let frame = 0; frame <= 480; frame++) {
      const cue = sampleFilmCue(context, frame / 20);
      assert.doesNotMatch(`${cue.title} ${cue.subtitle}`, /supplier|stock sync|retry|backup disappears|connection lost/i);
    }
  }
});
