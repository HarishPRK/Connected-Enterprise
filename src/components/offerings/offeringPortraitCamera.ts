import { sampleActor, type StoryContext, type StoryPoint } from './OfferingStoryMotion';

interface StoryShot { target: StoryPoint; distance: number; yaw: number; pitch: number; }

/** Recompose authored shots for a narrow frame, without changing their cuts or clock. */
export function portraitStoryCamera(context: StoryContext, time: number, aspect: number, shot: StoryShot): StoryShot {
  // Use the portrait composition as a complete shot. Blending east/west views
  // at intermediate aspect ratios crosses the storefront and clips the helper.
  const weight = aspect < 1.4 ? 1 : 0;
  if (!weight) return shot;
  if(context.offering==='routing'&&((time>=6&&time<14)||time>=20.7))return {...shot,distance:shot.distance*.75};
  if(context.offering==='automation'){
    const controller=time>=3&&time<(context.variant==='occupied'?4.6:4.3)||context.variant==='occupied'&&time>=12&&time<17||context.variant!=='occupied'&&time>=16.4&&time<18.3;
    if(controller)return {...shot,distance:Math.max(.35,shot.distance*.6)};
  }
  if (context.offering === 'failover' && time >= 1.25 && time < 2.95) {
    // Widening this checkout shot put the lens through the brass pendant post.
    // A consistent alternate side angle clears both posts throughout the take.
    return {...shot, yaw:shot.yaw + .32 * weight};
  }
  if (context.offering === 'video' && context.variant === 'man-down' && time >= 13.05) {
    const helper = sampleActor('staff', context, time).at;
    const guest: StoryPoint = [1.05, .28, 6];
    // Bias toward the guest and below floor level to leave caption clearance.
    const center: StoryPoint = [guest[0] * .7 + helper[0] * .3, -.15, guest[2] * .7 + helper[2] * .3];
    const separation = Math.hypot(helper[0] - guest[0], helper[2] - guest[2]);
    return {
      target:shot.target.map((value, index) => value + (center[index] - value) * weight) as StoryPoint,
      distance:shot.distance + (6.2 + Math.min(5.5, separation) * .25 - shot.distance) * weight,
      // The open aisle on the west stays clear of storefront and pendant beams.
      yaw:shot.yaw + (-1.75 - shot.yaw) * weight,
      pitch:shot.pitch + (.55 - shot.pitch) * weight,
    };
  }
  return shot;
}
