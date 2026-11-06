import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceStoryClock, clampStoryTime, formatStoryElapsed, STORY_DURATION, STORY_PLAYBACK_SECONDS, storyElapsedSeconds } from '../../src/components/offerings/OfferingPlayback.ts';

test('the full 24-unit story ends at 30 active seconds at 30, 60, 120 and 144 Hz', () => {
  for (const hz of [30, 60, 120, 144]) {
    let time = 0, previous: number | null = null;
    for (let frame = 0; frame <= hz * STORY_PLAYBACK_SECONDS; frame++) {
      const now = frame * 1000 / hz;
      time = advanceStoryClock(time, previous, now); previous = now;
      if (frame < hz * STORY_PLAYBACK_SECONDS) assert(time < STORY_DURATION, `completed early at ${hz} Hz`);
    }
    assert.equal(time, STORY_DURATION);
    assert.equal(storyElapsedSeconds(time), 30);
  }
});

test('variable refresh and slow rendering do not stretch the story beyond 30 seconds', () => {
  let time = 0, previous: number | null = null;
  for (const now of [0, 8, 17, 27, 40, 120, 340, 890, 1500, 4100, 9000, 14000, 19950, 20000, 29950, 30000]) {
    time = advanceStoryClock(time, previous, now); previous = now;
    assert(Math.abs(time - now / 1000 * .8) < 1e-9);
  }
  assert.equal(time, STORY_DURATION);
});

test('pause and visibility suspension reset the timestamp without losing story position or catching up', () => {
  let time = advanceStoryClock(0, 0, 5000);
  assert.equal(time, 4);
  // A minute in another tab is not part of the 30-second playback.
  time = advanceStoryClock(time, null, 65000);
  assert.equal(time, 4);
  time = advanceStoryClock(time, 65000, 70000);
  assert.equal(time, 8);
  // Repeated pause/resume leaves every remaining event available.
  time = advanceStoryClock(time, null, 130000);
  assert.equal(time, 8);
  assert.equal(advanceStoryClock(time, 130000, 150000), STORY_DURATION);
});

test('seeking backwards and replaying establish a fresh clock and accurate cinema labels', () => {
  assert.equal(advanceStoryClock(22, null, 30000), 22);
  assert.equal(advanceStoryClock(7.5, null, 31000), 7.5);
  assert.equal(advanceStoryClock(0, null, 40000), 0);
  assert.equal(advanceStoryClock(0, 40000, 70000), STORY_DURATION);
  assert.equal(formatStoryElapsed(0), '0:00 / 0:30');
  assert.equal(formatStoryElapsed(12), '0:15 / 0:30');
  assert.equal(formatStoryElapsed(24), '0:30 / 0:30');
  assert.equal(clampStoryTime(-5), 0);
  assert.equal(clampStoryTime(100), 24);
  assert.equal(advanceStoryClock(6, 1000, 999), 6);
  assert.equal(advanceStoryClock(6, 1000, NaN), 6);
});
