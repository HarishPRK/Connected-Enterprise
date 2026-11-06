/** Every authored sequence keeps its 24-unit choreography and plays in 30 s. */
export const STORY_DURATION = 24;
export const STORY_PLAYBACK_SECONDS = 30;
export const STORY_UNITS_PER_SECOND = STORY_DURATION / STORY_PLAYBACK_SECONDS;

export function clampStoryTime(time: number): number {
  return Number.isFinite(time) ? Math.max(0, Math.min(STORY_DURATION, time)) : 0;
}

/** Advance by elapsed active time, independent of the display's refresh rate.
 * Reset previousTimestamp to null on pause, seek, or document/viewport suspension.
 * The first resumed frame establishes a new baseline instead of catching up. */
export function advanceStoryClock(time: number, previousTimestamp: number | null, timestamp: number): number {
  const current = clampStoryTime(time);
  if (previousTimestamp === null || !Number.isFinite(timestamp) || !Number.isFinite(previousTimestamp)) return current;
  const next = current + Math.max(0, timestamp - previousTimestamp) / 1000 * STORY_UNITS_PER_SECOND;
  return next >= STORY_DURATION - 1e-9 ? STORY_DURATION : next;
}

export function storyElapsedSeconds(time: number): number {
  return clampStoryTime(time) / STORY_UNITS_PER_SECOND;
}

export function formatStoryElapsed(time: number): string {
  return `0:${String(Math.floor(storyElapsedSeconds(time))).padStart(2, '0')} / 0:${STORY_PLAYBACK_SECONDS}`;
}
