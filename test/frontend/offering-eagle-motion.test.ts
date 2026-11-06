import assert from 'node:assert/strict';
import test from 'node:test';
import { EAGLE_CASES } from '../../src/components/offerings/OfferingEagleStory.ts';
import { sampleEagleActor, sampleEagleCamera, sampleEagleCue, sampleEagleSignals } from '../../src/components/offerings/OfferingEagleMotion.ts';
import { sampleFilmCue } from '../../src/components/offerings/OfferingFilmSequence.ts';
import { sampleActor, sampleStoryCamera } from '../../src/components/offerings/OfferingStoryMotion.ts';

test('actual console touches coincide with the calibrated stance in both review and attempt', () => {
  for(const variant of Object.keys(EAGLE_CASES)) for(const time of [10.1,11.9,17,17.8]){
    const actor=sampleEagleActor('technician',variant,time);
    assert.deepEqual(actor.at,[9.82,.04,-4.84]);assert.equal(actor.heading,2.825);
    assert.equal(actor.walk,0);assert.equal(actor.tablet,0);
    assert.equal(actor.tap,0,'calibrated finger IK owns the gesture');
  }
});

test('local operator visits physical hardware and returns; distant inspector stays at the device', () => {
  for(const variant of ['gateway','it']){
    assert.deepEqual(sampleEagleActor('technician',variant,14.5).at,[8.55,.04,-2.18]);
    assert.deepEqual(sampleEagleActor('technician',variant,17).at,[9.82,.04,-4.84]);
  }
  for(const variant of ['fiber','5g','ot']){
    const inspector=sampleEagleActor('staff',variant,14);
    assert.equal(inspector.visible,true);assert.equal(inspector.tablet,1);
    assert.deepEqual(sampleEagleActor('staff',variant,23).at,inspector.at);
    assert.deepEqual(sampleEagleActor('technician',variant,14).at,[9.82,.04,-4.84]);
  }
});

test('every film has an investigation, specific attempt and evidence-based ending', () => {
  for(const variant of Object.keys(EAGLE_CASES)){
    assert.match(sampleEagleCue(variant,6.5).title,/evidence accumulate/);
    assert.match(sampleEagleCue(variant,10.5).title,/window.*reason/);
    assert.match(sampleEagleCue(variant,14).title,/physical device/);
    assert.match(sampleEagleCue(variant,17.5).subtitle,/scripted.*not a live command/);
    assert.match(sampleEagleCue(variant,18.5).title,/not a verified repair/);
    assert.deepEqual(sampleFilmCue({offering:'eagle',variant},17.5),sampleEagleCue(variant,17.5));
    assert.deepEqual(sampleActor('technician',{offering:'eagle',variant},17.5),sampleEagleActor('technician',variant,17.5));
    assert.deepEqual(sampleStoryCamera({offering:'eagle',variant},20),sampleEagleCamera(variant,20));
  }
  assert.match(sampleEagleCue('gateway',20.5).title,/flag has not cleared/);
  assert.match(sampleEagleCue('fiber',23).title,/escalation/);
  assert.match(sampleEagleCue('it',23).title,/observed recovery/);
});

test('camera, actors and signals are finite and reproducible throughout all five stories', () => {
  for(const variant of Object.keys(EAGLE_CASES)) for(let i=0;i<=240;i++){
    const t=i/10,camera=sampleEagleCamera(variant,t);
    assert.ok([...camera.target,camera.distance,camera.yaw,camera.pitch].every(Number.isFinite));
    assert.ok(camera.distance>=1.4);
    for(const actorId of ['technician','staff','shopper'] as const){
      const actor=sampleEagleActor(actorId,variant,t);
      assert.ok([...actor.at,actor.heading,actor.walk].every(Number.isFinite));
      assert.ok(actor.walk>=0&&actor.walk<=1);
    }
    assert.ok(sampleEagleSignals(variant,t).every(signal=>signal.at.every(Number.isFinite)));
  }
  const earlier=sampleEagleCamera('gateway',10.2);sampleEagleCamera('gateway',24);
  assert.deepEqual(sampleEagleCamera('gateway',10.2),earlier);
});
