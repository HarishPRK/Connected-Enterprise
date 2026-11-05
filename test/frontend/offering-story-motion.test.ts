import assert from 'node:assert/strict';
import test from 'node:test';
import { OFFERING_CHAPTERS } from '../../src/components/offerings/offeringCatalog.ts';
import {
  monitoredPoint,
  sampleActor,
  sampleStoryCamera,
  STORY_ACTORS,
  type StoryContext,
  type StoryPoint,
} from '../../src/components/offerings/OfferingStoryMotion.ts';

const cases: StoryContext[] = OFFERING_CHAPTERS.flatMap(chapter =>
  chapter.variants.map(variant => ({ offering: chapter.id, variant: variant.id })),
);
const floorDistance = (a: StoryPoint, b: StoryPoint) => Math.hypot(a[0] - b[0], a[2] - b[2]);

test('a failed checkout holds the customer before recovery, then releases the customer and advances the queue', () => {
  const context: StoryContext = { offering: 'failover', variant: 'fiber' };
  const waiting = sampleActor('shopper', context, 7);
  const stillWaiting = sampleActor('shopper', context, 9);
  const leaving = sampleActor('shopper', context, 22);
  assert.equal(waiting.walk, 0, 'the customer must wait during the interrupted payment');
  assert.deepEqual(waiting.at, stillWaiting.at, 'the customer must not drift through checkout during the failure');
  assert.ok(leaving.walk > 0 && floorDistance(waiting.at, leaving.at) > 3, 'the customer leaves after the payment response');

  const queued = sampleActor('queue1', context, 8);
  const nextAtCounter = sampleActor('queue1', context, 22);
  assert.ok(floorDistance(nextAtCounter.at, waiting.at) < floorDistance(queued.at, waiting.at), 'the next customer moves toward the vacated checkout');
});

test('the fall precedes the human response and assistance reaches the affected customer', () => {
  const context: StoryContext = { offering: 'video', variant: 'man-down' };
  const walking = sampleActor('shopper', context, 2);
  const fallen = sampleActor('shopper', context, 7);
  const responderBeforeAlert = sampleActor('staff', context, 7);
  const responderTravelling = sampleActor('staff', context, 14);
  const assisting = sampleActor('staff', context, 22);
  assert.equal(walking.fall, 0);
  assert.ok(fallen.fall > .9, 'the person is on the ground before the response phase');
  assert.equal(responderBeforeAlert.kneel, 0);
  assert.ok(responderTravelling.walk > 0, 'a staff member visibly travels to the incident');
  assert.ok(assisting.kneel > .9, 'the responder adopts an assistance pose');
  assert.ok(floorDistance(assisting.at, fallen.at) < 2, 'assistance must reach the person, not stop elsewhere in the store');
  assert.ok(floorDistance(responderBeforeAlert.at, fallen.at) > floorDistance(assisting.at, fallen.at));
  assert.ok(sampleActor('shopper', context, 22).fall > .9, 'arrival of help must not instantly erase the incident');
});

test('each EA:GLE investigation brings the technician to the selected asset', () => {
  for (const variant of ['gateway', 'fiber', '5g', 'it', 'ot']) {
    const context: StoryContext = { offering: 'eagle', variant };
    const asset = monitoredPoint(variant);
    const beforeDispatch = sampleActor('technician', context, 6);
    const inspecting = sampleActor('technician', context, 22);
    assert.ok(inspecting.visible && inspecting.tablet > 0, `${variant}: the technician has the inspection context`);
    assert.ok(floorDistance(inspecting.at, asset) < 2.5, `${variant}: the technician reaches the selected equipment`);
    assert.ok(floorDistance(inspecting.at, asset) < floorDistance(beforeDispatch.at, asset), `${variant}: dispatch moves toward the affected asset`);
  }
});

test('scrubbing backward reconstructs every actor pose independently of previously sampled scenes', () => {
  for (const context of cases) {
    for (const actor of STORY_ACTORS) {
      const early = structuredClone(sampleActor(actor.id, context, 7.5));
      sampleActor(actor.id, context, 22);
      sampleActor(actor.id, { offering: 'video', variant: 'crowd' }, 18);
      assert.deepEqual(sampleActor(actor.id, context, 7.5), early, `${context.offering}/${context.variant}/${actor.id}`);
    }
  }
});

test('every offered case has a finite, usable story camera throughout the full timeline', () => {
  assert.equal(cases.length, 20, 'all currently offered variants are covered');
  for (const context of cases) {
    for (let time = 0; time <= 24; time += .5) {
      const camera = sampleStoryCamera(context, time);
      assert.ok(camera.target.every(Number.isFinite), `${context.offering}/${context.variant}@${time}: target`);
      assert.ok(Number.isFinite(camera.yaw), `${context.offering}/${context.variant}@${time}: heading`);
      assert.ok(Number.isFinite(camera.distance) && camera.distance > 0, `${context.offering}/${context.variant}@${time}: distance`);
    }
  }
});
