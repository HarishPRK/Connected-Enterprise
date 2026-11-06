import assert from 'node:assert/strict';
import test from 'node:test';
import { ROUTING_CASES,ROUTING_CLIENTS,ROUTING_TIMING,sampleRouting,type RoutingVariant } from '../../src/components/offerings/OfferingRoutingStory.ts';

const variants:RoutingVariant[]=['teams','archive','voice'];
for(const variant of variants)test(`${variant} stages desired, published and illustrated routes separately`,()=>{
  const scenario=ROUTING_CASES[variant],initial=ROUTING_CLIENTS.find(client=>client.id===scenario.client)!.initialRoute;
  const selected=(time:number)=>sampleRouting(time,variant).clients.find(client=>client.selected)!;
  assert.equal(selected(9.75).desiredRoute,initial);
  const desired=selected(10.5);assert.equal(desired.desiredRoute,scenario.target);assert.equal(desired.publishedRoute,initial);assert.equal(desired.illustratedRoute,initial);
  assert.equal(sampleRouting(10.5,variant).publishRequested,false);
  assert.equal(sampleRouting(11,variant).publishRequested,true);assert.equal(sampleRouting(11,variant).brokerAccepted,false);
  assert.equal(selected(11.99).publishedRoute,initial);
  const published=selected(12);assert.equal(published.publishedRoute,scenario.target);assert.equal(published.illustratedRoute,initial);
  assert.equal(sampleRouting(12,variant).stage,'broker-accepted');
  assert.equal(selected(13.99).illustratedRoute,initial);
  assert.equal(selected(14).illustratedRoute,scenario.target);
  assert.equal(sampleRouting(14,variant).stage,'illustrating');
  assert.equal(sampleRouting(17,variant).stage,'outcome');
});

test('all four tunnels stay online with representative RTT values; unrelated and locked clients never move',()=>{
  for(const variant of variants)for(let frame=0;frame<=480;frame++){
    const state=sampleRouting(frame/20,variant);
    assert.equal(state.clients.length,5);assert.equal(state.tunnels.length,4);
    assert.equal(state.clients.filter(client=>client.selected).length,1);
    assert.deepEqual(state.tunnels.map(tunnel=>tunnel.rtt),[4.2,4.3,41.1,48.7]);
    assert(state.tunnels.every(tunnel=>tunnel.online));
    for(const client of state.clients)if(!client.selected||client.locked){
      assert.equal(client.desiredRoute,client.initialRoute);assert.equal(client.publishedRoute,client.initialRoute);assert.equal(client.illustratedRoute,client.initialRoute);
    }
    for(const id of ['kitchen-pos','dock-door'])assert.equal(state.clients.find(client=>client.id===id)!.locked,true);
    assert.equal(state.gatewayAcknowledgement,'not-reported');assert.equal(state.evidenceLabel,'Awaiting gateway evidence');
    assert.doesNotMatch(state.status,/gateway (?:applied|acknowledged)|route applied|live route verified/i);
    assert(!('policyApplied' in state));assert(!('paymentApproved' in state));assert(!('archiveCapMbps' in state));
  }
});

test('a locked VoIP preview cannot stage a route until the explicit operator unlock',()=>{
  const blocked=sampleRouting(6,'voice');
  assert.equal(blocked.previewBlocked,true);assert.equal(blocked.selectionAllowed,false);assert.equal(blocked.stage,'locked-preview');
  assert.equal(blocked.clients.find(client=>client.id==='meeting-room')!.locked,true);
  assert.equal(blocked.clients.find(client=>client.id==='meeting-room')!.desiredRoute,'vti-cell2');
  const unlocked=sampleRouting(7,'voice');
  assert.equal(unlocked.unlockRequested,true);assert.equal(unlocked.previewBlocked,false);assert.equal(unlocked.selectionAllowed,true);
  assert.equal(unlocked.clients.find(client=>client.id==='meeting-room')!.locked,false);
  assert.equal(unlocked.clients.find(client=>client.id==='meeting-room')!.desiredRoute,'vti-cell2');
  assert.equal(unlocked.publishRequested,false);
  assert(ROUTING_TIMING.unlock<ROUTING_TIMING.selectionStart);
});

test('business motion shows a rejoin, continuous recording and a new call rather than live connection migration',()=>{
  assert.equal(sampleRouting(3.9,'teams').teams.state,'live');
  for(const time of [4,6,9,11,12,13.99]){
    const state=sampleRouting(time,'teams');assert.equal(state.teams.frozen,true);assert.equal(state.teams.motionTime,4);
  }
  assert.equal(sampleRouting(14,'teams').teams.state,'rejoining');
  assert.equal(sampleRouting(14,'teams').teams.motionTime,4);
  assert.equal(sampleRouting(15,'teams').teams.motionTime,5);
  assert.equal(sampleRouting(16,'teams').teams.state,'live');assert.equal(sampleRouting(16,'teams').teams.rejoinProgress,1);
  let previous=0;
  for(let frame=0;frame<=480;frame++){
    const state=sampleRouting(frame/20,'archive');assert.equal(state.archive.recording,true);
    assert(state.archive.uploadProgress>previous||frame===0);previous=state.archive.uploadProgress;
    assert.equal(state.archive.flow,frame/20>=14?'new-flow':'existing-flow');
  }
  assert.equal(sampleRouting(13.99,'voice').voice.newCallStarted,false);
  assert.equal(sampleRouting(14,'voice').voice.state,'dialing');
  assert.equal(sampleRouting(14,'voice').voice.waveform,0);
  assert.equal(sampleRouting(15.5,'voice').voice.state,'connected');assert(sampleRouting(17,'voice').voice.waveform>0);
  assert.equal(sampleRouting(5,'archive').teams.frozen,false,'an unrelated Teams client should not inherit another story’s symptom');
});

test('backward seeks reconstruct every stage and callers cannot mutate future samples',()=>{
  const times=[0,4,6,7,9,9.75,10.5,11,12,14,15.5,17,24];
  for(const variant of variants){
    const forward=times.map(time=>sampleRouting(time,variant));
    for(let index=times.length-1;index>=0;index--)assert.deepEqual(sampleRouting(times[index],variant),forward[index]);
    const disposable=sampleRouting(0,variant);disposable.clients[0].desiredRoute='vti-fiber2';disposable.tunnels[0].rtt=99;
    assert.deepEqual(sampleRouting(0,variant),forward[0]);
  }
  assert.deepEqual(sampleRouting(-2,'unknown'),sampleRouting(0,'teams'));
  assert.deepEqual(sampleRouting(100,'voice'),sampleRouting(24,'voice'));
});
