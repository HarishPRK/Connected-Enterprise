import { storyProgress, type StoryContext } from './OfferingStoryMotion';

export function storeLightLevel(context: StoryContext, time: number) {
  if (context.offering !== 'automation') return 1;
  const progress = storyProgress(time, 10.5, 15.5);
  const eased = progress * progress * (3 - 2 * progress);
  return context.variant === 'after-hours' ? 1 - eased * .7 : .3 + eased * .7;
}
