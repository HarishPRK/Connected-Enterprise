import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleSmart, SMART_TIMING } from '../../src/components/offerings/OfferingSmartStory.ts';
import { sampleSmartActor, sampleSmartCamera, sampleSmartContact, smartCoolerHandle, smartTrolleyPoint, SMART_POINTS } from '../../src/components/offerings/OfferingSmartMotion.ts';

test('HVAC action clears only the external obstruction and precedes gradual cooling', () => {
  assert.equal(sampleSmart('hvac', 0).hvac.obstructed, true);
  const waiting = sampleSmart('hvac', 15.9);
  assert.equal(waiting.actionStarted, false);
  assert.equal(waiting.hvac.obstructionProgress, 0);
  assert.equal(waiting.hvac.zoneC, 27.3);
  const clear = sampleSmart('hvac', 18);
  assert.equal(clear.hvac.obstructed, false);
  assert.equal(clear.hvac.airflow, 1);
  assert.equal(clear.hvac.zoneC, 27.3, 'clearing an intake is not an instant temperature reset');
  let previous = clear.hvac.zoneC;
  for (let t = 18; t <= 24; t += .1) {
    const state = sampleSmart('hvac', t);
    assert(state.hvac.zoneC <= previous);
    assert(state.hvac.zoneC > state.hvac.targetC);
    assert.equal(state.verification.temperatureStable, false);
    assert.equal(state.verification.followUpRequired, true);
    previous = state.hvac.zoneC;
  }
  assert.equal(sampleSmart('hvac', 24).hvac.zoneC, 24.2);
});

test('cooler door physically closes before delayed recovery and never certifies stock', () => {
  assert.equal(sampleSmart('cooler', 0).cooler.doorOpen, false);
  assert.equal(sampleSmart('cooler', 3).cooler.doorAngle, -.68);
  assert.equal(sampleSmart('cooler', 15.99).cooler.doorAngle, -.68);
  assert(sampleSmart('cooler', 17).cooler.doorAngle < 0);
  const closed = sampleSmart('cooler', 18);
  assert.equal(closed.cooler.doorAngle, 0);
  assert.equal(closed.cooler.airLoss, 0);
  assert.equal(closed.cooler.airC, 7.4);
  assert.equal(sampleSmart('cooler', 18.79).cooler.airC, 7.4);
  const end = sampleSmart('cooler', 24);
  assert.equal(end.cooler.airC, 4.8);
  assert(end.cooler.airC > end.cooler.targetC);
  assert.equal(end.cooler.stockCondition, 'not-assessed');
  assert.equal(end.verification.followUpRequired, true);
});

test('after-hours request affects selected loads only and power follows their response', () => {
  for (let t = 0; t < 16; t += .1) {
    const { energy } = sampleSmart('energy', t);
    assert.equal(energy.requested, false);
    assert.equal(energy.lightingLevel, 1);
    assert.equal(energy.displayLevel, 1);
    assert.equal(energy.hvacLoad, 1);
    assert.equal(energy.totalKw, 9.4);
  }
  assert.equal(sampleSmart('energy', 16).energy.requested, true);
  assert.equal(sampleSmart('energy', 16).energy.totalKw, 9.4);
  assert.equal(sampleSmart('energy', 16.99).energy.setpointC, 22, 'a request alone does not change the displayed setting');
  assert.equal(sampleSmart('energy', 17).energy.setpointC, 26, 'physical thermostat and console share the applied example setting');
  const transition = sampleSmart('energy', 18);
  assert(transition.energy.lightingLevel < 1 && transition.energy.lightingLevel > .2);
  assert.equal(transition.actionComplete, false);
  const end = sampleSmart('energy', 24);
  assert.equal(end.energy.displayLevel, 0);
  assert(Math.abs(end.energy.lightingLevel - .2) < 1e-9);
  assert.equal(end.energy.totalKw, 4.63);
  for (let t = 0; t <= 24; t += .1) {
    const energy = sampleSmart('energy', t).energy;
    assert.equal(energy.essentialKw, 3.8);
    assert.equal(energy.coolersOn, true);
    assert.equal(energy.networkOn, true);
    assert.equal(energy.walkwayOn, true);
    assert(energy.totalKw > energy.essentialKw);
    assert.equal(energy.proposedControls, true);
  }
});

test('equipment and actors reconstruct deterministic state on backwards seeking', () => {
  for (const variant of ['hvac', 'cooler', 'energy']) {
    const times = [0, 3, 4, 7, 10.5, 15.5, 16.1, 17, 18, 21, 24];
    const samples = times.map(time => ({ state: sampleSmart(variant, time), actor: sampleSmartActor('technician', variant, time), camera: sampleSmartCamera(variant, time) }));
    for (let i = samples.length - 1; i >= 0; i--) {
      assert.deepEqual(sampleSmart(variant, times[i]), samples[i].state);
      assert.deepEqual(sampleSmartActor('technician', variant, times[i]), samples[i].actor);
      assert.deepEqual(sampleSmartCamera(variant, times[i]), samples[i].camera);
    }
    let lastAngle = -1;
    for (let t = 0; t <= 24; t += .01) {
      const state = sampleSmart(variant, t);
      const angle = variant === 'energy' ? state.energy.hvacFanAngle : state.hvac.fanAngle;
      assert(angle >= lastAngle, 'rotor angle may slow but must not jump backwards');
      lastAngle = angle;
    }
  }
  assert.deepEqual(sampleSmart('unknown', Number.NaN), sampleSmart('hvac', 0));
  assert.deepEqual(sampleSmart('cooler', Infinity), sampleSmart('cooler', SMART_TIMING.duration));
});

test('operator contact follows the exported cooler handle and the trolley stays outside the grille', () => {
  for (let t = 16; t <= 18; t += .05) {
    const contact = sampleSmartContact('technician', 'cooler', t)!;
    assert.deepEqual(contact.at, smartCoolerHandle(t));
    assert.equal(contact.weight, 1);
    const pose = sampleSmartActor('technician', 'cooler', t);
    assert(pose.at[2] > contact.at[2], 'operator must remain in front of the door');
    assert(Math.hypot(pose.at[0] - contact.at[0], pose.at[2] - contact.at[2]) < .65);
  }
  assert.equal(smartTrolleyPoint(0)[2], SMART_POINTS.trolley[2]);
  assert(smartTrolleyPoint(0)[2] - .2 > -5.08, 'packing trolley may block airflow but must not intersect the fixed grille');
  assert(smartTrolleyPoint(24)[0] + .55 < -10.325, 'the complete trolley clears the HVAC footprint');
  const contact = sampleSmartContact('technician', 'hvac', 17)!;
  assert.equal(contact.at[0], smartTrolleyPoint(17)[0] + .59);
  assert.equal(sampleSmartContact('technician', 'energy', 17), null, 'tablet action does not invent a wall-screen touch');
});
