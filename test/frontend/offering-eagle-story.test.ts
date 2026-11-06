import assert from 'node:assert/strict';
import test from 'node:test';
import { ANOMALY_REASON_LABELS } from '../../shared/eagleTelemetry.ts';
import { EAGLE_CASES, eaglePacketClock, sampleEagle } from '../../src/components/offerings/OfferingEagleStory.ts';

test('connected queues accumulate before investigation, without an instant recovery', () => {
  for (const variant of Object.keys(EAGLE_CASES)) {
    const baseline=sampleEagle(variant,2.9),delayed=sampleEagle(variant,6),attempt=sampleEagle(variant,17.8);
    assert.equal(baseline.endpointDelayMs,180);
    assert.equal(baseline.endpointQueues.reduce((sum,q)=>sum+q.pending,0),0);
    assert.ok(delayed.endpointDelayMs>=2200);
    assert.ok(delayed.endpointQueues.some(q=>q.pending>0));
    assert.equal(delayed.actionAttempted,false);
    assert.equal(attempt.actionAttempted,true);
    assert.equal(attempt.recoveryObserved,false);
    assert.equal(attempt.endpointDelayMs,delayed.endpointDelayMs,'pressing a console control is not evidence of recovery');
  }
});

test('received flags and fresh windows remain independent of mathematical crossings', () => {
  const crossing=sampleEagle('gateway',6),flagged=sampleEagle('gateway',8),improving=sampleEagle('gateway',20),verified=sampleEagle('gateway',22);
  assert.equal(crossing.thresholdCrossed,true);assert.equal(crossing.anomalyFlag,false);
  assert.equal(flagged.reasonLabel,ANOMALY_REASON_LABELS[2]);assert.equal(flagged.anomalyFlag,true);
  assert.ok(improving.anomalyMse<improving.anomalyThreshold);
  assert.equal(improving.anomalyFlag,true,'lower MSE must not silently clear the received flag');
  assert.equal(improving.freshWindows,1);assert.equal(improving.recoveryVerified,false);
  assert.equal(verified.freshWindows,2);assert.equal(verified.anomalyFlag,false);
  assert.equal(verified.recoveryVerified,true);
  assert.equal(verified.resolved,false,'observed illustrative recovery does not auto-close an actual investigation');
});

test('only the gateway case receives Memory Pressure; fiber attempts do not guarantee success', () => {
  for (const variant of ['fiber','5g','it','ot']) for (let t=0;t<=24;t+=.5) {
    const s=sampleEagle(variant,t);assert.ok(s.anomalyMse<s.anomalyThreshold);
    assert.equal(s.anomalyFlag,false);assert.equal(s.reasonLabel,'Normal');
  }
  const fiber=sampleEagle('fiber',24);
  assert.equal(fiber.actionComplete,true);assert.equal(fiber.recoveryObserved,false);
  assert.equal(fiber.endpointDelayMs,2200);assert.match(fiber.status,/escalate/);
  for (const variant of ['gateway','5g','it','ot']) {
    const state=sampleEagle(variant,24);
    assert.equal(state.recoveryVerified,true);assert.ok(state.endpointDelayMs<500);
    assert.equal(state.endpointQueues.reduce((sum,q)=>sum+q.pending,0),0);
  }
  assert.equal(sampleEagle('5g',6).checkoutAffected,false);
  assert.equal(sampleEagle('ot',6).checkoutAffected,false);
});

test('backwards seeking restores all evidence and malformed times are bounded', () => {
  for (const variant of Object.keys(EAGLE_CASES)) for (let frame=0;frame<=240;frame++) {
    const s=sampleEagle(variant,frame/10),{total,tcp,udp,icmp,other}=s.conntrack;
    assert.equal(total,tcp+udp+icmp+other);
    assert.equal(s.illustrative,true);assert.equal(s.productionCommandIssued,false);
    assert.equal(s.investigationOpen,true);
    assert.ok(s.windows.every(w=>w.at<=s.time));
    if(s.recoveryVerified)assert.ok(s.freshWindows>=2&&!s.anomalyFlag&&!s.thresholdCrossed);
  }
  const early=sampleEagle('gateway',5.2);sampleEagle('gateway',24);
  assert.deepEqual(sampleEagle('gateway',5.2),early);
  assert.deepEqual(sampleEagle('constructor',10),sampleEagle('gateway',10));
  assert.deepEqual(sampleEagle('gateway',NaN),sampleEagle('gateway',0));
  assert.deepEqual(sampleEagle('gateway',Infinity),sampleEagle('gateway',24));
  assert.deepEqual(sampleEagle('gateway',-5),sampleEagle('gateway',0));
});

test('packet progress is continuous and speeds up only after observed intervention', () => {
  for (const variant of Object.keys(EAGLE_CASES)) {
    let previous=0;
    for(let frame=0;frame<=240;frame++){
      const clock=eaglePacketClock(variant,frame/10);assert.ok(clock>=previous-1e-8);previous=clock;
    }
    const slow=eaglePacketClock(variant,17)-eaglePacketClock(variant,16);
    const after=eaglePacketClock(variant,24)-eaglePacketClock(variant,23);
    if(variant==='fiber')assert.ok(Math.abs(after-slow)<.001);
    else assert.ok(after>slow*4);
  }
});
