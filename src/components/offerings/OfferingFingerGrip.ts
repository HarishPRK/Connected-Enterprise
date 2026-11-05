import { Matrix4, Quaternion, Vector3 } from 'three';
import manifest from '../../assets/offerings/enterprise-actors.studio.manifest.json';
import type { Rig } from './OfferingSkinnedActor';

export const DIGITS=['Thumb','Index','Middle','Ring','Little'] as const;
export const PHALANGES=['Proximal','Intermediate','Distal'] as const;
type Side='Left'|'Right';
type HandSpec={chains:Record<string,number[][]>;pads:Record<'Thumb'|'Index',{handLocal:number[]}>};
const hands=manifest.roles.Customer.hands as Record<Side,HandSpec>;
const sub=(a:Vector3,b:Vector3)=>a.clone().sub(b);
const clamp=(n:number,a=0,b=1)=>Math.max(a,Math.min(b,n));
function frame(direction:Vector3,normal:Vector3) {
  const x=direction.clone().normalize(),y=normal.clone().addScaledVector(x,-normal.dot(x)).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x,y,x.clone().cross(y)));
}

/** The same fitted MakeHuman phalanx geometry and pinch IK as Smart Kitchen,
 * expressed as actual glTF bones. Thumb and index meet opposite sheet faces;
 * the palm never serves as a mount. All poses derive from absolute time. */
export function fingerGripPose(side:Side,thickness=.001,connector=false) {
  const spec=hands[side],mirror=side==='Right'?1:-1;
  const local=(x:number,y:number,z:number)=>new Vector3(x*mirror,z,-y).multiplyScalar(.001);
  const unit=(x:number,y:number,z:number)=>local(x,y,z).normalize();
  const center=local(-21,-29.5,connector?-78:-79),padPoints=[new Vector3(...spec.pads.Thumb.handLocal),new Vector3(...spec.pads.Index.handLocal)];
  const poses=DIGITS.map((digit,index)=>{
    const chain=spec.chains[digit].map(p=>new Vector3(...p));
    let joints:Vector3[],tipQ:Quaternion|undefined;
    if(index<2){
      const thumb=index===0,direction=sub(chain[3],chain[2]),outward=thumb?unit(.35,1,0):unit(-1,0,0);
      tipQ=frame(thumb?unit(0,.12,-1):unit(0,-.16,1),unit(thumb?1:-1,0,0)).multiply(frame(direction,outward).invert());
      const tip=center.clone().addScaledVector(unit(1,0,0),(thumb?-1:1)*thickness/2);
      const j3=tip.clone().sub(sub(padPoints[index],chain[2]).applyQuaternion(tipQ));
      const ray=sub(j3,chain[0]),reach=ray.length(),l1=chain[1].distanceTo(chain[0]),l2=chain[2].distanceTo(chain[1]);ray.normalize();
      const along=clamp((l1*l1-l2*l2+reach*reach)/(2*reach),-l1,l1);
      const pole=thumb?unit(-1,-.45,0):unit(.25,.1,-1);pole.addScaledVector(ray,-pole.dot(ray)).normalize();
      const j2=chain[0].clone().addScaledVector(ray,along).addScaledVector(pole,Math.sqrt(Math.max(0,l1*l1-along*along)));
      joints=[chain[0],j2,j3];
    }else{
      joints=[chain[0]];
      const directions=connector?[[ -.07,.02,-1],[-.96,.025,-.28],[-.59,.01,.84]]:[[ -.03,.035,-1],[-.27,.05,-.96],[-.57,.02,-.82]];
      for(let link=0;link<3;link++){
        const d=directions[link],direction=unit(d[0],d[1],d[2]);
        if(!connector&&index===2)direction.x*=.63;
        joints.push(joints[link].clone().addScaledVector(direction.normalize(),chain[link].distanceTo(chain[link+1])));
      }
    }
    const absolute=PHALANGES.map((_,link)=>link===2&&tipQ?tipQ:new Quaternion().setFromUnitVectors(sub(chain[link+1],chain[link]).normalize(),sub(joints[link+1],joints[link]).normalize()));
    const rotations=absolute.map((q,link)=>link?absolute[link-1].clone().invert().multiply(q):q.clone());
    return {digit,rotations};
  });
  return {center,poses};
}

const cache=new Map<string,ReturnType<typeof fingerGripPose>>();
export function poseFingerGrip(rig:Rig,side:Side,weight:number,thickness=.001,connector=false) {
  if(weight<=0)return;
  const key=`${side}/${thickness}/${connector}`;
  let pose=cache.get(key);if(!pose){pose=fingerGripPose(side,thickness,connector);cache.set(key,pose);}
  for(const {digit,rotations} of pose.poses)PHALANGES.forEach((phalanx,index)=>{
    rig[`${side}${digit}${phalanx}`]?.object.quaternion.slerp(rotations[index],weight);
  });
}

export function posePointGrip(rig:Rig,side:Side,weight:number) {
  poseFingerGrip(rig,side,weight,.0096,true);
  for(const phalanx of PHALANGES)rig[`${side}Index${phalanx}`]?.object.quaternion.identity();
}

export function poseCardGrip(rig:Rig) {
  // Keep the card upright between the opposed pads. The general reader tap
  // gesture supinates an empty palm, which would lay a held card flat on it.
  if(rig.RightHand)rig.RightHand.object.rotation.y=0;
  poseFingerGrip(rig,'Right',1);
}
