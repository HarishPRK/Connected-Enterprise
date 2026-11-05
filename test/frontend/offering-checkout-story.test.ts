import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleCheckout, isCheckoutStory } from '../../src/components/offerings/OfferingCheckoutStory.ts';
import { sampleActor, sampleStoryCamera, type StoryContext } from '../../src/components/offerings/OfferingStoryMotion.ts';
import { sampleFilmCue } from '../../src/components/offerings/OfferingFilmSequence.ts';

const fiber:StoryContext={offering:'failover',variant:'fiber'};
test('a tapped payment waits, retries after a route exists, then prints only after approval',()=>{
  assert.equal(sampleCheckout(fiber,3).stage,'ready');
  assert.equal(sampleCheckout(fiber,3.8).stage,'reading');
  assert.equal(sampleCheckout(fiber,7).stage,'waiting');
  assert.equal(sampleCheckout(fiber,10.5).stage,'retrying');
  assert.equal(sampleCheckout(fiber,10.5).route,'5G');
  assert.equal(sampleCheckout(fiber,12.9).approved,false);
  assert.equal(sampleCheckout(fiber,13).stage,'approved');
  assert.equal(sampleCheckout(fiber,13.5).paper,0);
  assert.equal(sampleCheckout(fiber,15.5).paper,1);
  assert.ok(sampleActor('shopper',fiber,16.95).receipt>.9);
});
test('losing the backup never blocks an active fiber payment',()=>{
  const context:StoryContext={offering:'failover',variant:'5g'};
  for(const time of [4,7,10,13,20]){
    const payment=sampleCheckout(context,time);
    assert.equal(payment.delayed,false);
    assert.equal(payment.route,'Fiber');
    assert.notEqual(payment.stage,'waiting');
    assert.notEqual(payment.stage,'retrying');
  }
});
test('the card reaches the reader once and replaying or reverse seeking reconstructs that contact',()=>{
  const contact=sampleCheckout(fiber,3.8);
  assert.equal(contact.cardReach,1);
  assert.equal(contact.cardVisible,true);
  assert.equal(sampleActor('shopper',fiber,3.8).walk,0);
  for(const time of [5,12.5,13,23])assert.equal(sampleCheckout(fiber,time).cardReach,0);
  sampleCheckout(fiber,23);
  assert.deepEqual(sampleCheckout(fiber,3.8),contact);
  assert.equal(isCheckoutStory({offering:'routing',variant:'payment'}),true);
  assert.equal(isCheckoutStory({offering:'video',variant:'man-down'}),false);
});
test('the film reveals payment details at the reader and then returns to the human outcome',()=>{
  assert.ok(sampleStoryCamera(fiber,3.8).distance<2);
  assert.ok(sampleStoryCamera(fiber,13.5).distance<2);
  assert.ok(sampleStoryCamera(fiber,22).distance>10);
  assert.equal(sampleCheckout(fiber,10.8).networkShot,true);
  assert.equal(sampleCheckout(fiber,13.5).networkShot,false);
  assert.match(sampleFilmCue(fiber,13.5).title,/Approved/);
  assert.match(sampleFilmCue(fiber,15.5).title,/receipt/);
  for(const time of [-1,0,3.8,7,11,14,17,30]){
    const cue=sampleFilmCue(fiber,time);
    assert.ok(!cue.title.includes('\uFFFD')&&!cue.subtitle.includes('\uFFFD'));
  }
});


test('the recovery shot includes the CPE and 5G tower inside the horizontal field of view',()=>{
  for(const time of [10.05,10.8,12.45]){
    const shot=sampleStoryCamera(fiber,time);
    assert.ok(shot.distance>14,'recovery must reveal the full radio path');
    assert.ok(shot.target[0]>9&&shot.target[0]<12);
  }
});

test('all video scenarios show the dedicated analytics appliance before returning to the human response',()=>{
  for(const variant of ['man-down','intruder','crowd']){
    const context:StoryContext={offering:'video',variant};
    assert.match(sampleFilmCue(context,11).subtitle,/Dell analytics server/);
    assert.ok(sampleStoryCamera(context,11).target[2]<0);
    assert.notDeepEqual(sampleStoryCamera(context,17),sampleStoryCamera(context,11));
  }
});
