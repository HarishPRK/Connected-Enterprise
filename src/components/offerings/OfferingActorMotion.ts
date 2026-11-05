import type { ActorPose } from './OfferingStoryMotion';

/** Distance drives the gait: stopping freezes the step instead of skating. */
export function sampleActorRig(pose:ActorPose,time:number) {
  const cycle=pose.distance*Math.PI*2/1.28+pose.phase;
  const step=Math.sin(cycle),walk=pose.walk;
  const breath=Math.sin(time*1.65+pose.phase);
  const state={
    hipsY:Math.cos(cycle*2)*.012*walk+breath*.004,
    torsoX:.065*walk,torsoY:-step*.035*walk,torsoZ:Math.sin(time*.7+pose.phase)*.008*(1-walk),
    headX:breath*.008,headY:Math.sin(time*.46+pose.phase)*.055*(1-walk),
    leftThigh:step*.40*walk,rightThigh:-step*.40*walk,
    leftShin:Math.max(0,-step)*.78*walk,rightShin:Math.max(0,step)*.78*walk,
    leftAnkle:0,rightAnkle:0,
    leftArm:-step*.29*walk,rightArm:step*.29*walk,
    leftForearm:-.10-Math.max(0,step)*.15*walk,rightForearm:-.10-Math.max(0,-step)*.15*walk,
    rightArmZ:0,leftArmZ:0,
  };
  if(pose.tablet){state.leftArm=-.65;state.leftForearm=-1.15;state.headX=.17+breath*.012;state.headY=Math.sin(time*.5+pose.phase)*.025;}
  if(pose.tap){state.rightArm=-1.15*pose.tap;state.rightForearm=-.75*pose.tap;state.torsoX+=.08*pose.tap;state.headX+=.08*pose.tap;}
  if(pose.concern){state.leftArm=-.65*pose.concern;state.leftForearm=-1.45*pose.concern;state.rightArm=-.28*pose.concern;state.headX=.08*pose.concern;}
  state.headY+=pose.lookY;
  if(pose.carry){state.rightArm*=1-pose.carry*.9;state.rightForearm=-.1;state.rightArmZ=-.07*pose.carry;}
  if(pose.receipt){state.leftArm=-.22*pose.receipt;state.leftForearm=-.5*pose.receipt;}
  if(pose.phone){state.rightArm=.35*pose.phone;state.rightForearm=-3.15*pose.phone;state.headX=-.06;state.headY=Math.sin(time*.9)*.045;}
  if(pose.collapse){
    const crouch=pose.collapse*(1-pose.fall);
    state.hipsY-=.26*crouch;
    state.leftThigh=-.72*crouch-.1*pose.fall;state.rightThigh=-.64*crouch+.05*pose.fall;
    state.leftShin=1.18*crouch+.16*pose.fall;state.rightShin=1.12*crouch+.24*pose.fall;
    state.torsoX=.5*crouch;
    state.leftArm=-.9*crouch;state.rightArm=-1.05*crouch+.04*pose.fall;
    state.leftForearm=-.45*crouch;state.rightForearm=-.5*crouch;
    state.leftArmZ=-.7*pose.fall;state.rightArmZ=.7*pose.fall;
    state.headX=.16*crouch;state.headY=.18*pose.fall;
  }
  if(pose.kneel){
    const k=pose.kneel;
    state.hipsY-=.43*k;
    state.leftThigh=-1.45*k;state.leftShin=1.45*k;
    state.rightThigh=.02*k;state.rightShin=1.55*k;
    state.torsoX=.28*k;state.torsoY=0;state.headX=.28*k;state.headY=-.06*k;
    state.rightArm=-.62*k;state.rightForearm=-.55*k;
    state.leftArm=-.5*k;state.leftForearm=-.8*k;
  }
  state.leftAnkle=-state.leftThigh-state.leftShin;
  state.rightAnkle=-state.rightThigh-state.rightShin;
  // Follow the planted sole through the bend. This also keeps a crouch from
  // pushing the shoes through the floor when knee angles change.
  const leftLeg=.42*Math.cos(state.leftThigh)+.39*Math.cos(state.leftThigh+state.leftShin)+.08;
  const rightLeg=.42*Math.cos(state.rightThigh)+.39*Math.cos(state.rightThigh+state.rightShin)+.08;
  state.hipsY=(Math.max(leftLeg,rightLeg)-.89)*(1-pose.fall)+breath*.003;
  return state;
}
