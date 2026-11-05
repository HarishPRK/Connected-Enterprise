import { Matrix4, Quaternion, Vector3 } from 'three';
import { gatewayPort } from './OfferingConnectionPaths';
import { CONNECTOR_WITHDRAWAL, SERVICE_CART } from './OfferingEquipment';
import { reachWrist, type Rig } from './OfferingSkinnedActor';
import { sampleTwin } from './OfferingTwinStory';
import { poseFingerGrip } from './OfferingFingerGrip';

// A physical workstation at the same scale as the 1.75 m cast. The operator
// stands outside the bench; only the fingers enter the connector working area.
export const TWIN_OPERATOR = {
  keyboard: [7.27,.04,.71] as [number,number,number],
  repair: [6.82,.04,-2.14] as [number,number,number],
  repairHeading: Math.PI+.3,
};

export function gatewayWristTarget(time:number) {
  const socket=gatewayPort('pos'),normal=new Vector3(...socket.normal);
  const x=new Vector3(0,1,0),y=normal,z=x.clone().cross(y);
  const orientation=new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x,y,z));
  // The fitted connector pinch is 78 mm forward of the wrist. Its center
  // follows the exposed connector boot, including the physical withdrawal.
  const position=new Vector3(...socket.point).addScaledVector(normal,.126+sampleTwin(time).unplug*CONNECTOR_WITHDRAWAL).addScaledVector(z,-.0295);
  position.y+=.021;
  return {position,orientation,socket};
}

export function poseTwinContact(rig:Rig,time:number) {
  const state=sampleTwin(time),target=gatewayWristTarget(time);
  // Lift outside the worktop before moving in. Reversing the clock follows
  // this same clearance path, withdrawing first and lowering afterwards.
  const approach=Math.max(0,state.reach*2-1),blend=approach*approach*(3-2*approach);
  target.position.addScaledVector(new Vector3(...target.socket.normal),.32*(1-blend));
  target.position.y+=.16*(1-blend);
  const liftOrientation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),TWIN_OPERATOR.repairHeading).slerp(target.orientation,blend);
  reachWrist(rig,Math.min(1,state.reach*2),'Right',target.position,liftOrientation);
  poseFingerGrip(rig,'Right',state.reach,.0096,true);
  const down=new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(
    new Vector3(0,1,0),new Vector3(0,0,1),new Vector3(1,0,0),
  ));
  // Fingers point toward the keys, wrist rests in front of the laptop. The
  // screen and cart never need scaling tricks to accommodate a distant hand.
  const keystroke=(1+Math.sin(time*8))*.001;
  const keyboard=new Vector3(SERVICE_CART.at[0]-.05,SERVICE_CART.top+.040+keystroke,SERVICE_CART.at[2]+.19);
  reachWrist(rig,state.typing,'Right',keyboard,down);
}
