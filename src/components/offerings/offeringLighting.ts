import type { StoryContext } from './OfferingStoryMotion';

export function storeLightLevel(context: StoryContext) {
  // Closing occurs in an evening setting. Only the three connected loads
  // switch; walkway, refrigeration and network lighting stay available.
  return context.offering === 'automation' ? .48 : 1;
}
