import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleActorRig } from '../../src/components/offerings/OfferingActorMotion.ts';
import { sampleActor, type ActorPose, type StoryContext } from '../../src/components/offerings/OfferingStoryMotion.ts';

const checkout:StoryContext={offering:'failover',variant:'fiber'};
const angleDelta=(a:number,b:number)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));

test('the gait advances with distance, and a held position cannot continue stepping',()=>{
  const pose:ActorPose={...sampleActor('shopper',checkout,2),distance:2,walk:1};
  const first=sampleActorRig(pose,2),later=sampleActorRig(pose,20);
  assert.equal(first.leftThigh,later.leftThigh);
  assert.equal(first.rightShin,later.rightShin);
  assert.notEqual(first.leftThigh,sampleActorRig({...pose,distance:2.3},2).leftThigh);
  const waiting=sampleActor('shopper',checkout,8);
  for(const time of [8,9,10]){
    const rig=sampleActorRig(waiting,time);
    assert.equal(Math.abs(rig.leftThigh),0);
    assert.equal(Math.abs(rig.rightThigh),0);
  }
});

test('customers arrive without an abrupt direction change or synchronous footfalls',()=>{
  let previous=sampleActor('shopper',checkout,0);
  for(let t=1/120;t<3.71;t+=1/120){
    const next=sampleActor('shopper',checkout,t);
    assert.ok(angleDelta(previous.heading,next.heading)<.16,`turn must not snap at ${t}`);
    assert.ok(next.distance>=previous.distance,'travelled distance is monotonic');
    previous=next;
  }
  const a=sampleActor('shopper',checkout,2),b=sampleActor('queue1',checkout,2);
  assert.notEqual(a.phase,b.phase,'people use independent gait phases');
  const arriving=sampleActor('shopper',checkout,3.69),waiting=sampleActor('shopper',checkout,4);
  assert.ok(arriving.walk<.1,'the final step decelerates into checkout');
  assert.equal(waiting.walk,0);
});

test('the customer picks up their basket and receipt before leaving, and keeps both on the exit path',()=>{
  const before=sampleActor('shopper',checkout,13),basket=sampleActor('shopper',checkout,15.2),receipt=sampleActor('shopper',checkout,16.95),leaving=sampleActor('shopper',checkout,22);
  assert.equal(before.carry,0);
  assert.equal(before.receipt,0);
  assert.ok(basket.carry>.9 && basket.receipt<.1,'basket pickup happens before receipt pickup');
  assert.ok(receipt.carry>.9 && receipt.receipt>.9,'both are collected before departure');
  assert.ok(leaving.carry>.9 && leaving.receipt>.9 && leaving.walk>0,'collected props stay with the departing shopper');
});

test('a fall begins with collapse, and the responder settles into a grounded one-knee pose',()=>{
  const context:StoryContext={offering:'video',variant:'man-down'};
  const losingBalance=sampleActor('shopper',context,4.5),fallen=sampleActor('shopper',context,7);
  assert.ok(losingBalance.collapse>0 && losingBalance.fall<.1,'knees and torso react before the body tips');
  assert.ok(fallen.fall>.99 && fallen.at[1]<.25,'the prone body settles close to the floor');
  const assisting=sampleActor('staff',context,22),rig=sampleActorRig(assisting,22);
  const hip=assisting.at[1]+.9-.01+rig.hipsY;
  for(const side of ['left','right'] as const){
    const thigh=rig[`${side}Thigh`],shin=rig[`${side}Shin`];
    const sole=hip-.42*Math.cos(thigh)-.39*Math.cos(thigh+shin)-.08;
    assert.ok(sole>-.035&&sole<.085,`${side} sole must remain near the floor: ${sole}`);
  }
  assert.ok(Math.abs(rig.leftThigh-rig.rightThigh)>1,'one knee is raised while the other folds to the ground');
});
