import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTOMATION_DEVICES,AUTOMATION_TIMING,AUTOMATION_TOPOLOGY,sampleAutomation } from '../../src/components/offerings/OfferingAutomationStory.ts';
import { sampleFilmCue } from '../../src/components/offerings/OfferingFilmSequence.ts';

test('presence and the vacancy dwell block closing before any device request',()=>{
  const baseline=sampleAutomation('after-hours',0);
  assert.equal(baseline.requestClose,false);assert.equal(baseline.presence,true);
  const held=sampleAutomation('after-hours',3);
  assert.equal(held.requestClose,true);assert.equal(held.guardHold,true);
  assert.equal(sampleAutomation('after-hours',4.29).doorClosed,true);
  assert.equal(sampleAutomation('after-hours',4.3).doorClosed,false);
  assert.equal(sampleAutomation('after-hours',5).doorClosed,false);
  assert.equal(sampleAutomation('after-hours',8.49).presence,true);
  assert.equal(sampleAutomation('after-hours',8.5).presence,false);
  assert.equal(sampleAutomation('after-hours',8.5).doorClosed,false);
  assert.equal(sampleAutomation('after-hours',9).doorClosed,true);
  assert.equal(sampleAutomation('after-hours',10.49).vacancyVerified,false);
  assert.equal(sampleAutomation('after-hours',10.5).vacancyVerified,true);
  for(let frame=0;frame<1100;frame++){
    const state=sampleAutomation('after-hours',frame/100);
    assert(Object.values(state.devices).every(device=>!device.requested&&device.on));
  }
});

test('each load separates request, acknowledgement and observed off state',()=>{
  for(const id of ['display','lamp','sign'] as const){
    const timing=AUTOMATION_TIMING[id];
    const before=sampleAutomation('after-hours',timing.request-.001).devices[id];
    assert.equal(before.requested,false);
    const request=sampleAutomation('after-hours',timing.request).devices[id];
    assert.equal(request.requested,true);assert.equal(request.ack,false);assert.equal(request.observed,false);assert.equal(request.on,true);
    const ack=sampleAutomation('after-hours',timing.ack).devices[id];
    assert.equal(ack.ack,true);assert.equal(ack.acknowledged,true);assert.equal(ack.observed,false);assert.equal(ack.on,true);
    const observed=sampleAutomation('after-hours',timing.observed).devices[id];
    assert.equal(observed.observed,true);assert.equal(observed.on,false);
  }
});

test('only Shelly has metered watts and its off confirmation waits for readback',()=>{
  assert(!('watts' in sampleAutomation('after-hours',24).devices.display));
  assert(!('watts' in sampleAutomation('after-hours',24).devices.lamp));
  const relayOff=sampleAutomation('after-hours',14.9);
  assert.equal(relayOff.devices.sign.observed,true);assert.equal(relayOff.devices.sign.watts,120);
  assert.equal(relayOff.devices.sign.confirmed,false);assert.equal(relayOff.confirmedCount,2);
  assert.equal(sampleAutomation('after-hours',15.5).devices.sign.watts,60);
  const zero=sampleAutomation('after-hours',16);
  assert.equal(zero.devices.sign.watts,0);assert.equal(zero.devices.sign.powerVerified,true);assert.equal(zero.confirmedCount,3);
  assert.equal(zero.allVerified,false);
  assert.equal(sampleAutomation('after-hours',16.5).stage,'complete');
});

test('occupied guard never issues any command or invents an off observation',()=>{
  for(let frame=0;frame<=2400;frame++){
    const state=sampleAutomation('occupied',frame/100);
    assert.equal(state.presence,true);assert.equal(state.vacancyVerified,false);assert.equal(state.confirmedCount,0);assert.equal(state.allVerified,false);
    for(const load of Object.values(state.devices)){
      assert.equal(load.requested,false);assert.equal(load.ack,false);assert.equal(load.observed,false);assert.equal(load.on,true);assert.equal(load.confirmed,false);
    }
    assert.equal(state.devices.sign.watts,120);
    if(state.requestClose){assert.equal(state.guardHold,true);assert.equal(state.stage,'guard-hold');}
  }
});

test('reverse scrubbing reconstructs the same evidence and preserves protocol roles',()=>{
  for(const variant of ['after-hours','occupied']){
    const samples=[0,3,8.5,10.5,11.7,13.2,14.9,15.5,16.5,24].map(t=>sampleAutomation(variant,t));
    for(let index=samples.length-1;index>=0;index--)assert.deepEqual(sampleAutomation(variant,samples[index].time),samples[index]);
  }
  assert.equal(AUTOMATION_DEVICES.display.protocol,'Matter');assert.equal(AUTOMATION_DEVICES.display.network,'Wi-Fi');
  assert.equal(AUTOMATION_DEVICES.lamp.protocol,'Matter');assert.equal(AUTOMATION_DEVICES.lamp.network,'Thread');
  assert.equal(AUTOMATION_DEVICES.sign.protocol,'MQTT');assert.equal(AUTOMATION_DEVICES.sign.device,'Shelly Plus 1PM');
  assert.equal(AUTOMATION_TOPOLOGY.occupancy.protocol,'Zigbee');assert.equal(AUTOMATION_TOPOLOGY.occupancy.productionIntegration,false);
  assert.equal(AUTOMATION_TOPOLOGY.threadBorderRouter.translatesMatter,false);
  assert.deepEqual(sampleAutomation('unknown',-10),sampleAutomation('after-hours',0));
  assert.deepEqual(sampleAutomation('after-hours',100),sampleAutomation('after-hours',24));
});

test('film captions distinguish acknowledgements from physical confirmation and keep occupied closure held',()=>{
  const context={offering:'automation',variant:'after-hours'} as const;
  for(const [time,device] of [[11.8,'Wi-Fi'],[13.3,'Thread'],[14.7,'Shelly']] as const){
    const cue=sampleFilmCue(context,time);
    assert.match(cue.title,new RegExp(device));assert.match(cue.title,/acknowledges/i);
    assert.doesNotMatch(cue.title,/is off|confirmed|complete/i,'an acknowledgement cannot assert physical closure');
  }
  assert.match(sampleFilmCue(context,12).title,/display.*off/i);
  assert.match(sampleFilmCue(context,15.5).subtitle,/60 W/);
  assert.match(sampleFilmCue(context,16.5).title,/3\s*\/\s*3.*confirmed off/i);
  for(let frame=30;frame<=240;frame++){
    const cue=sampleFilmCue({offering:'automation',variant:'occupied'},frame/10);
    assert.match(cue.chapter,/held/i);
    assert.doesNotMatch(cue.title,/store closed|confirmed off|shutdown complete/i);
  }
});
