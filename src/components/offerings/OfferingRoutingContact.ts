import { Matrix4, Quaternion, Vector3 } from 'three';
import { posePointGrip } from './OfferingFingerGrip';
import { reachWrist, type Rig } from './OfferingSkinnedActor';
import type { ActorId } from './OfferingStoryMotion';

const ramp=(t:number,a:number,b:number)=>{const u=Math.max(0,Math.min(1,(t-a)/(b-a)));return u*u*(3-2*u);};
const down=new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3(0,1,0),new Vector3(0,0,1),new Vector3(1,0,0)));
const typingDown=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),-.5).multiply(down);
const laptopDown=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),-.8).multiply(down);
const leftDown=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),-.8).multiply(new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3(0,-1,0),new Vector3(0,0,1),new Vector3(-1,0,0))));
const neutral=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI);
// Actual skin tip at the authored press angles (Staff skin vertices
// 6282 / 1711). The sheet-grip pad is 1 mm above this point and cannot be used
// to place a finger against a solid key without letting its tip sink inside.
const indexTip=(side:'Right'|'Left')=>new Vector3(side==='Right'?-.006194313812256:.006194313812256,-.1304613158226,.033532121133807);
const keyLift=(time:number)=>Math.max(0,Math.sin(time*10))*.003;

export const ROUTING_CONTACT={
  keyboardKey:[8.04,1.126,4.819] as const,
  speakerKey:[8.42,1.1394,7.041] as const,
  laptopKey:[7.07,1.08278048613,.26] as const,
};

// The first half of the gesture lifts behind the front edge. Only then does
// the hand move across the worktop. The same path runs backwards on release.
function reachOverDesk(rig:Rig,side:'Right'|'Left',weight:number,target:Vector3,orientation:Quaternion,lift:Vector3){
  const move=ramp(weight,.5,1);
  reachWrist(rig,Math.min(1,weight*2),side,lift.lerp(target,move),neutral.clone().slerp(orientation,move));
}

/** Contact uses the same anatomical wrist frame as the tested service laptop.
 * No handheld props are used: the phone stays on its desk in speaker mode. */
export function poseRoutingContact(rig:Rig,id:ActorId,variant:string,time:number){
  if(id==='technician'){
    const weight=ramp(time,5.5,6.3),pad=indexTip('Right').applyQuaternion(laptopDown);
    const target=new Vector3(...ROUTING_CONTACT.laptopKey).sub(pad);target.y+=keyLift(time);
    reachOverDesk(rig,'Right',weight,target,laptopDown,new Vector3(6.73,1.3,.76));
    posePointGrip(rig,'Right',weight);
  }
  if(id==='staff'){
    const weight=ramp(time,.5,1.3)*(1-ramp(time,3,3.7))+ramp(time,14,14.4)*(1-ramp(time,15.2,15.8));
    const pad=indexTip('Right').applyQuaternion(typingDown);
    const target=new Vector3(...ROUTING_CONTACT.keyboardKey).sub(pad);target.y+=keyLift(time);
    reachOverDesk(rig,'Right',Math.min(1,weight),target,typingDown,new Vector3(8.05,1.32,5.15));
    posePointGrip(rig,'Right',Math.min(1,weight));
  }
  if(id==='caller'&&variant==='voice'){
    const weight=ramp(time,13.7,14.1)*(1-ramp(time,14.8,15.3));
    const pad=indexTip('Left').applyQuaternion(leftDown);
    reachOverDesk(rig,'Left',weight,new Vector3(...ROUTING_CONTACT.speakerKey).sub(pad),leftDown,new Vector3(8.76,1.36,7.65));
    posePointGrip(rig,'Left',weight);
  }
}
