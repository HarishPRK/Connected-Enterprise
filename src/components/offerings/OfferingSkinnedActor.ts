import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, Quaternion, SkinnedMesh, Vector3, type Object3D } from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { ActorId, ActorPose, ActorRole } from './OfferingStoryMotion';
import { sampleActorRig } from './OfferingActorMotion';
import { DIGITS, PHALANGES, fingerGripPose, poseFingerGrip } from './OfferingFingerGrip';

// The anatomical surfaces and textures are shared; every performer gets its own
// skeleton. CE's established semantic pivots remain the animation/contact API.
type Joint={object:Object3D;y:number};
const JOINTS=['Hips','Torso','Head','LeftUpperArm','LeftForearm','LeftHand','RightUpperArm','RightForearm','RightHand','LeftThigh','LeftShin','LeftAnkle','RightThigh','RightShin','RightAnkle','Tablet','BagMount','Handset','Receipt','PaymentCard'] as const;
export type Rig=Partial<Record<string,Joint>>;
export function prepareActor(source:Object3D,role:ActorRole,id:ActorId,cast?:Object3D){
  const object=cloneSkeleton(source),joints:Rig={},ownedMaterials:MeshStandardMaterial[]=[];
  const shirts:Record<string,string>={shopper:'#39899a',queue1:'#aa6752',queue2:'#66876b',crowd1:'#a48d47',crowd2:'#715a89',crowd3:'#4f718d',crowd4:'#9a756c'};
  const complexions:Partial<Record<ActorId,string>>={queue1:'Staff_Skin_crew',queue2:'Technician_Skin_chef',crowd1:'Security_Skin_customer',crowd2:'Staff_Skin_crew',crowd3:'Technician_Skin_chef',crowd4:'Security_Skin_customer'};
  const skin=complexions[id]?cast?.getObjectByName(complexions[id]) as Mesh:undefined;
  object.traverse(node=>{if(node instanceof Mesh){node.castShadow=true;node.receiveShadow=true;if(node instanceof SkinnedMesh)node.frustumCulled=false;if(role==='Customer'){const original=Array.isArray(node.material)?node.material:[node.material];const materials=original.map(material=>{if(!(material instanceof MeshStandardMaterial))return material;
    if(/tailored shirt|fabric seams/.test(material.name)){const copy=material.clone();copy.color.lerp(new Color(shirts[id]||'#39899a'),.8);ownedMaterials.push(copy);return copy;}
    if(skin&&/anatomical guest/.test(material.name)){const copy=material.clone();copy.map=(skin.material as MeshStandardMaterial).map;ownedMaterials.push(copy);return copy;}
    if(/anatomical crop/.test(material.name)&&id!=='shopper'){const copy=material.clone();copy.color.set(id==='queue1'?'#51463b':id==='queue2'?'#9d8064':'#6c625a');ownedMaterials.push(copy);return copy;}
    return material;});node.material=Array.isArray(node.material)?materials:materials[0];}}});
  for(const name of JOINTS){const joint=object.getObjectByName(`${role}_${name}`);if(joint)joints[name]={object:joint,y:joint.position.y};}
  for(const side of ['Right','Left'])for(const digit of DIGITS)for(const phalanx of [...PHALANGES,'Pad']){
    const name=`${side}${digit}${phalanx}`,joint=object.getObjectByName(`${role}_${name}`);if(joint)joints[name]={object:joint,y:joint.position.y};
  }
  // Put the tablet underside on the anatomical palm plane. The old rigid
  // hands were thicker and the device floated above the replacement's fingers.
  if(joints.Tablet)joints.Tablet.object.position.z=-.065;
  const handset=new Mesh(new BoxGeometry(.065,.24,.055),new MeshStandardMaterial({color:'#17212b',roughness:.45}));handset.name=`${role}_Handset`;handset.position.set(.015,-.29,.025);handset.rotation.z=.12;joints.RightForearm?.object.add(handset);joints.Handset={object:handset,y:handset.position.y};
  const receipt=new Mesh(new BoxGeometry(.09,.17,.0006),new MeshStandardMaterial({color:'#f6f0e5',roughness:.9}));
  receipt.rotation.y=Math.PI/2;
  receipt.position.copy(fingerGripPose('Left',.0006).center).add(new Vector3(0,-.075,-.028));
  joints.LeftHand?.object.add(receipt);joints.Receipt={object:receipt,y:receipt.position.y};
  const card=new Group();
  const body=new Mesh(new BoxGeometry(.0856,.054,.001),new MeshStandardMaterial({color:'#284a70',metalness:.5,roughness:.3}));
  const chip=new Mesh(new BoxGeometry(.015,.013,.0002),new MeshStandardMaterial({color:'#d8bd83',metalness:.8,roughness:.28}));
  chip.position.set(-.025,.006,.0006);card.add(body,chip);
  card.position.copy(fingerGripPose('Right').center).add(new Vector3(0,-.022,-.028));card.rotation.y=Math.PI/2;
  joints.RightHand?.object.add(card);joints.PaymentCard={object:card,y:card.position.y};
  card.visible=false;receipt.visible=false;handset.visible=false;
  return {object,joints,handset,receipt,card,ownedMaterials};
}
export function setRig(rig:Rig,pose:ActorPose,time:number){
  for(const [name,joint] of Object.entries(rig)){if(!joint)continue;if(!['Receipt','PaymentCard'].includes(name))joint.object.rotation.set(0,0,0);joint.object.position.y=joint.y;}
  const x=(name:keyof Rig,value:number)=>{const joint=rig[name];if(joint)joint.object.rotation.x=value;};
  const state=sampleActorRig(pose,time);
  x('LeftThigh',state.leftThigh);x('RightThigh',state.rightThigh);
  x('LeftShin',state.leftShin);x('RightShin',state.rightShin);
  x('LeftAnkle',state.leftAnkle);x('RightAnkle',state.rightAnkle);
  x('LeftUpperArm',state.leftArm);x('RightUpperArm',state.rightArm);
  x('LeftForearm',state.leftForearm);x('RightForearm',state.rightForearm);
  if(rig.Hips)rig.Hips.object.position.y+=state.hipsY;
  if(rig.Torso)rig.Torso.object.rotation.set(state.torsoX,state.torsoY,state.torsoZ);
  if(rig.Head)rig.Head.object.rotation.set(state.headX,state.headY,0);
  if(rig.RightUpperArm)rig.RightUpperArm.object.rotation.z=state.rightArmZ;
  if(rig.LeftUpperArm)rig.LeftUpperArm.object.rotation.z=state.leftArmZ;
  if(rig.LeftHand)rig.LeftHand.object.rotation.y=-Math.PI/2*Math.max(pose.tablet,pose.receipt);
  if(rig.RightHand)rig.RightHand.object.rotation.y=Math.PI/2*pose.tap;
  if(rig.Tablet)rig.Tablet.object.visible=pose.tablet>.1;
  if(rig.Handset)rig.Handset.object.visible=pose.phone>.1;
  if(rig.Receipt)rig.Receipt.object.visible=pose.receipt>.55;
  // Close before the receipt leaves its printer; every visible carried frame
  // has opposed pad contact, including the first pickup frame.
  poseFingerGrip(rig,'Left',Math.min(1,pose.receipt/.55),.0006);
}
// Solve the two actual Blender arm pivots against a reader in world space.
// Both rotations are rebuilt from the absolute pose, so reverse scrubs are safe.
export function reachReader(rig:Rig,weight:number,side:'Right'|'Left'='Right',destination:[number,number,number]=[7.2,1.64,5.065]){
  const arm=rig[`${side}UpperArm`]?.object,forearm=rig[`${side}Forearm`]?.object;
  if(!arm||!forearm||!arm.parent||weight<=0)return;
  arm.parent.updateWorldMatrix(true,true);
  const rest=forearm.position.clone(),hand=new Vector3(0,-.332,.013);
  const target=arm.parent.worldToLocal(new Vector3(...destination)).sub(arm.position);
  const lengthA=rest.length(),lengthB=hand.length(),distance=Math.min(target.length(),lengthA+lengthB-.001);
  const direction=target.normalize();
  const pole=new Vector3(.85,-.45,0).addScaledVector(direction,-new Vector3(.85,-.45,0).dot(direction)).normalize();
  const along=(lengthA*lengthA-lengthB*lengthB+distance*distance)/(2*distance);
  const elbow=direction.clone().multiplyScalar(along).addScaledVector(pole,Math.sqrt(Math.max(0,lengthA*lengthA-along*along)));
  const upper=new Quaternion().setFromUnitVectors(rest.normalize(),elbow.clone().normalize());
  const lowerDirection=direction.multiplyScalar(distance).sub(elbow).applyQuaternion(upper.clone().invert()).normalize();
  const lower=new Quaternion().setFromUnitVectors(hand.normalize(),lowerDirection);
  arm.quaternion.slerp(upper,weight);forearm.quaternion.slerp(lower,weight);
}

/** Position the anatomical wrist, then orient the palm independently. The
 * ordinary reader solver aims a point inside an open hand; connector work
 * needs a full wrist frame so fingertips stop at the plug, outside its case. */
export function reachWrist(rig:Rig,weight:number,side:'Right'|'Left',destination:Vector3,orientation:Quaternion) {
  const arm=rig[`${side}UpperArm`]?.object,forearm=rig[`${side}Forearm`]?.object,hand=rig[`${side}Hand`]?.object;
  if(!arm?.parent||!forearm||!hand||weight<=0)return;
  arm.parent.updateWorldMatrix(true,true);
  const rest=forearm.position.clone(),wrist=hand.position.clone();
  const target=arm.parent.worldToLocal(destination.clone()).sub(arm.position);
  const lengthA=rest.length(),lengthB=wrist.length(),distance=Math.max(.025,Math.min(target.length(),lengthA+lengthB-.005));
  const direction=target.normalize(),pole=new Vector3(side==='Right'?.85:-.85,-.45,0);
  pole.addScaledVector(direction,-pole.dot(direction)).normalize();
  const along=(lengthA*lengthA-lengthB*lengthB+distance*distance)/(2*distance);
  const elbow=direction.clone().multiplyScalar(along).addScaledVector(pole,Math.sqrt(Math.max(0,lengthA*lengthA-along*along)));
  const upper=new Quaternion().setFromUnitVectors(rest.normalize(),elbow.clone().normalize());
  const lowerDirection=direction.multiplyScalar(distance).sub(elbow).applyQuaternion(upper.clone().invert()).normalize();
  const lower=new Quaternion().setFromUnitVectors(wrist.normalize(),lowerDirection);
  arm.quaternion.slerp(upper,weight);forearm.quaternion.slerp(lower,weight);
  forearm.updateWorldMatrix(true,true);
  const local=forearm.getWorldQuaternion(new Quaternion()).invert().multiply(orientation);
  hand.quaternion.slerp(local,weight);
}
