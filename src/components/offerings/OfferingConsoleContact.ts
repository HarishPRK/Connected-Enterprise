import { Matrix4, Quaternion, Vector3 } from 'three';
import { posePointGrip } from './OfferingFingerGrip';
import { reachWrist, type Rig } from './OfferingSkinnedActor';
import manifest from '../../assets/offerings/enterprise-actors.studio.manifest.json';

const ramp=(time:number,start:number,end:number)=>{const u=Math.max(0,Math.min(1,(time-start)/(end-start)));return u*u*(3-2*u);};
export const CONSOLE_TOUCH=[9.98,1.39,-5.34] as const;

/** Index-pad selection of the rack console, with the folded fingers kept
 * outside its glass. The five-centimetre clearance prevents display clipping. */
export function poseConsoleContact(rig:Rig,time:number) {
  const weight=ramp(time,9.3,9.8)*(1-ramp(time,12.2,12.8));
  if(!weight)return;
  const orientation=new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(
    new Vector3(0,1,0),new Vector3(0,0,1),new Vector3(1,0,0),
  ));
  const pad=new Vector3(...manifest.roles.Technician.hands.Right.pads.Index.handLocal).applyQuaternion(orientation);
  const wrist=new Vector3(...CONSOLE_TOUCH).sub(pad);
  reachWrist(rig,weight,'Right',wrist,orientation);
  posePointGrip(rig,'Right',weight);
}
