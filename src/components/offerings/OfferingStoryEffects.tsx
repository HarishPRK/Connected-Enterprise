import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { BoxGeometry, EdgesGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import actorsUrl from '../../assets/offerings/enterprise-actors.glb?url';
import { monitoredPoint, sampleActor, STORY_ACTORS, storyProgress, type ActorId, type ActorPose, type ActorRole, type StoryContext } from './OfferingStoryMotion';
import { sampleActorRig } from './OfferingActorMotion';

export interface StoryEffectsProps extends StoryContext { timeRef: RefObject<number>; onSelect: (id:string)=>void; }
type Joint={object:Object3D;y:number};
const JOINTS=['Hips','Torso','Head','LeftUpperArm','LeftForearm','RightUpperArm','RightForearm','LeftThigh','LeftShin','LeftAnkle','RightThigh','RightShin','RightAnkle','Tablet','BagMount','Handset','Receipt'] as const;
type Rig=Partial<Record<typeof JOINTS[number],Joint>>;
function prepareActor(source:Object3D,role:ActorRole,id:ActorId){
  const object=source.clone(true),joints:Rig={},ownedMaterials:MeshStandardMaterial[]=[];
  const shirts:Record<string,string>={shopper:'#39899a',queue1:'#aa6752',queue2:'#66876b',crowd1:'#a48d47',crowd2:'#715a89',crowd3:'#4f718d',crowd4:'#9a756c'};
  object.traverse(node=>{if(node instanceof Mesh){node.castShadow=true;node.receiveShadow=true;if(role==='Customer'){const original=Array.isArray(node.material)?node.material:[node.material];const materials=original.map(material=>{if(material instanceof MeshStandardMaterial&&/tailored shirt|fabric seams/.test(material.name)){const copy=material.clone();copy.color.set(shirts[id]||'#39899a');ownedMaterials.push(copy);return copy;}return material;});node.material=Array.isArray(node.material)?materials:materials[0];}}});
  for(const name of JOINTS){const joint=object.getObjectByName(`${role}_${name}`);if(joint)joints[name]={object:joint,y:joint.position.y};}
  const handset=new Mesh(new BoxGeometry(.065,.24,.055),new MeshStandardMaterial({color:'#17212b',roughness:.45}));handset.name=`${role}_Handset`;handset.position.set(.015,-.29,.025);handset.rotation.z=.12;joints.RightForearm?.object.add(handset);joints.Handset={object:handset,y:handset.position.y};
  const receipt=new Mesh(new BoxGeometry(.09,.17,.004),new MeshStandardMaterial({color:'#f6f0e5',roughness:.9}));receipt.position.set(0,-.36,.045);joints.LeftForearm?.object.add(receipt);joints.Receipt={object:receipt,y:receipt.position.y};
  return {object,joints,handset,receipt,ownedMaterials};
}
function setRig(rig:Rig,pose:ActorPose,time:number){
  for(const joint of Object.values(rig)){joint.object.rotation.set(0,0,0);joint.object.position.y=joint.y;}
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
  if(rig.Tablet)rig.Tablet.object.visible=pose.tablet>.1;
  if(rig.Handset)rig.Handset.object.visible=pose.phone>.1;
  if(rig.Receipt)rig.Receipt.object.visible=pose.receipt>.55;
}
function Actor({id,role,context,timeRef,onSelect}:{id:ActorId;role:ActorRole;context:StoryContext;timeRef:RefObject<number>;onSelect:(id:string)=>void}){
  const gltf=useLoader(GLTFLoader,actorsUrl),root=useRef<Group>(null),lean=useRef<Group>(null);
  const actor=useMemo(()=>{const source=gltf.scene.getObjectByName(role);if(!source)throw new Error(`Missing actor ${role}`);return prepareActor(source,role,id);},[gltf,role,id]);
  useEffect(()=>()=>{for(const prop of [actor.handset,actor.receipt]){prop.geometry.dispose();(prop.material as MeshStandardMaterial).dispose();}actor.ownedMaterials.forEach(material=>material.dispose());},[actor]);
  useFrame(()=>{
    if(!root.current||!lean.current)return;const time=timeRef.current,pose=sampleActor(id,context,time);
    root.current.visible=pose.visible;root.current.position.set(...pose.at);root.current.rotation.y=pose.heading;lean.current.rotation.x=pose.fall*Math.PI/2;
    setRig(actor.joints,pose,time);
  });
  return <group ref={root} onClick={event=>{event.stopPropagation();if(event.delta<5)onSelect(context.offering==='video'&&context.variant==='crowd'?'crowd':'person');}}><group ref={lean}><primitive object={actor.object} dispose={null}/></group></group>;
}

function cloneProp(source:Object3D){const copy=source.clone(true);copy.traverse(node=>{if(node instanceof Mesh){node.castShadow=true;node.receiveShadow=true;node.material=Array.isArray(node.material)?node.material.map(m=>m.clone()):node.material.clone();}});return copy;}
function paintDisplay(object:Object3D,color:string){object.traverse(child=>{if(child instanceof Mesh){const materials=Array.isArray(child.material)?child.material:[child.material];for(const material of materials)if(material instanceof MeshStandardMaterial){material.color.set(color);material.emissive.set(color);material.emissiveIntensity=.45;}}});}
function setVisibility(object:Object3D,visible:boolean){object.visible=visible;}
function CheckoutProps({context,timeRef}:{context:StoryContext;timeRef:RefObject<number>}){
  const gltf=useLoader(GLTFLoader,actorsUrl);
  const props=useMemo(()=>{
    const terminal=cloneProp(gltf.scene.getObjectByName('PaymentTerminal')!),printer=cloneProp(gltf.scene.getObjectByName('ReceiptPrinter')!),basket=cloneProp(gltf.scene.getObjectByName('ShoppingBasket')!);
    return {terminal,printer,basket,display:terminal.getObjectByName('PaymentTerminal_Display'),paper:printer.getObjectByName('ReceiptPrinter_Receipt')};
  },[gltf]);
  useEffect(()=>()=>{for(const object of [props.terminal,props.printer,props.basket])object.traverse(child=>{if(child instanceof Mesh)(Array.isArray(child.material)?child.material:[child.material]).forEach(m=>m.dispose());});},[props]);
  const last=useRef('');
  useFrame(()=>{
    const t=timeRef.current,isPayment=['failover','routing'].includes(context.offering);
    const slower=context.offering==='failover'?context.variant==='fiber':context.variant==='pos';
    const blocked=isPayment&&t>=4&&t<13&&slower;
    const approved=isPayment&&t>=(slower?13:6);const color=blocked?'#ffb34d':approved?'#54e8aa':'#42bdf3';
    if(props.display&&last.current!==color){paintDisplay(props.display,color);last.current=color;}
    const shopper=sampleActor('shopper',context,t),carry=isPayment?shopper.carry:0;
    if(props.paper){props.paper.scale.setY(isPayment?storyProgress(t,slower?13.8:7,slower?15.2:8.4):.08);setVisibility(props.paper,shopper.receipt<.55);}
    const handX=shopper.at[0]+Math.cos(shopper.heading)*.30+Math.sin(shopper.heading)*.04;
    const handZ=shopper.at[2]-Math.sin(shopper.heading)*.30+Math.cos(shopper.heading)*.04;
    const handY=.34+Math.sin(shopper.distance*9.8+shopper.phase)*.012*shopper.walk;
    props.basket.position.set(6.65+(handX-6.65)*carry,1.15+(handY-1.15)*carry+Math.sin(carry*Math.PI)*.12,4.45+(handZ-4.45)*carry);
    props.basket.rotation.set(0,shopper.heading*carry,0);
  });
  return <>
    <primitive object={props.terminal} position={[7.2,1.15,4.95]} scale={1.25} dispose={null}/>
    <primitive object={props.printer} position={[8.7,1.15,4.6]} scale={1.35} dispose={null}/>
    <primitive object={props.basket} position={[6.65,1.15,4.45]} scale={1.15} dispose={null}/>
  </>;
}

function Detection({context,timeRef}:{context:StoryContext;timeRef:RefObject<number>}){
  const target=useRef<Group>(null),density=useRef<Group>(null),border=useRef<MeshBasicMaterial>(null),alert=useRef<Mesh>(null);
  const edges=useMemo(()=>{const box=new BoxGeometry(1,1,1),edge=new EdgesGeometry(box);box.dispose();return edge;},[]);
  useEffect(()=>()=>edges.dispose(),[edges]);
  useFrame(()=>{
    const t=timeRef.current,video=context.offering==='video',crowd=context.variant==='crowd',intruder=context.variant==='intruder',pose=sampleActor('shopper',context,t);
    if(target.current){target.current.visible=video&&!crowd&&t>=10;target.current.position.set(pose.at[0]+Math.sin(pose.heading)*.75*pose.fall,pose.at[1]+(pose.fall>.5?.15:.95),pose.at[2]+Math.cos(pose.heading)*.75*pose.fall);target.current.rotation.y=pose.heading-(pose.fall>.5?Math.PI/2:0);target.current.scale.set(pose.fall>.5?2.2:.8,pose.fall>.5?.6:2.05,pose.fall>.5?1.05:.75);}
    if(density.current){density.current.visible=video&&crowd&&t>=10;density.current.scale.setScalar(1-storyProgress(t,17,24)*.2);}
    if(border.current)border.current.opacity=video&&intruder?.3+storyProgress(t,4,7)*.5:.16;
    if(alert.current){alert.current.visible=video&&t>=10;alert.current.position.set(intruder?11.4:4.8,intruder?4:4.1,intruder?-2.1:7.9);alert.current.scale.setScalar(.85+.15*Math.sin(t*5));}
  });
  return <>
    <group ref={target}><lineSegments geometry={edges}><lineBasicMaterial color={context.variant==='intruder'?'#ff756f':'#ffce79'} toneMapped={false}/></lineSegments></group>
    <group ref={density} position={[1,.065,7]}>
      {Array.from({length:24},(_,i)=><mesh key={i} position={[(i%6-2.5)*.83,0,(Math.floor(i/6)-1.5)*.8]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[.72,.68]}/><meshBasicMaterial color={i%3?'#ffbf62':'#fb845d'} transparent opacity={.26} depthWrite={false}/></mesh>)}
    </group>
    <mesh position={[9.5,.08,-2]}><boxGeometry args={[5.2,.035,.07]}/><meshBasicMaterial ref={border} color="#ff8b70" transparent opacity={.2} toneMapped={false}/></mesh>
    <mesh ref={alert}><sphereGeometry args={[.14,16,12]}/><meshBasicMaterial color="#ffbd69" toneMapped={false}/></mesh>
  </>;
}
function EquipmentFeedback({context,timeRef}:{context:StoryContext;timeRef:RefObject<number>}){
  const fault=useRef<Mesh>(null),scan=useRef<Mesh>(null),scanMaterial=useRef<MeshBasicMaterial>(null),meter=useRef<Group>(null),lock=useRef<Mesh>(null);
  useFrame(()=>{
    const t=timeRef.current,event=t>=4,response=t>=10;
    if(fault.current){const p=context.offering==='eagle'?monitoredPoint(context.variant):context.offering==='smart'?context.variant==='hvac'?[-9,1.9,-4.8]:context.variant==='cooler'?[-1.35,3.15,-7.6]:[-9.6,2,-1.1]:[14.6,2.3,-6];fault.current.visible=event&&['eagle','smart','failover'].includes(context.offering);fault.current.position.set(p[0],p[1]+.25,p[2]);fault.current.scale.setScalar(.8+.2*Math.sin(t*4));}
    if(scan.current){scan.current.visible=t>8&&['eagle','twin','automation','smart'].includes(context.offering);const k=(t*.5)%1;scan.current.scale.setScalar(.3+k*1.7);if(scanMaterial.current)scanMaterial.current.opacity=.45*(1-k);}
    if(lock.current){lock.current.visible=context.offering==='automation'&&response;const mat=lock.current.material as MeshBasicMaterial;mat.color.set(context.variant==='after-hours'?'#8ce3c6':'#68d6ff');lock.current.rotation.z=context.variant==='after-hours'?0:-.9;}
    if(meter.current){meter.current.visible=context.offering==='smart'&&context.variant==='energy';meter.current.children.forEach((bar,i)=>{bar.scale.y=.3+(i%3)*.18;bar.position.y=bar.scale.y*.7;});}
  });
  return <>
    <mesh ref={fault}><sphereGeometry args={[.13,16,12]}/><meshBasicMaterial color="#ff8871" toneMapped={false}/></mesh>
    <mesh ref={scan} position={[6.7,1.15,-3]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[1,1.025,56]}/><meshBasicMaterial ref={scanMaterial} color="#69d9ff" transparent opacity={.3} depthWrite={false}/></mesh>
    <mesh ref={lock} position={[-8.55,1.55,-.91]}><boxGeometry args={[.25,.12,.04]}/><meshBasicMaterial color="#8ce3c6" toneMapped={false}/></mesh>
    <group ref={meter} position={[-9.6,1.1,-.9]}>{[0,1,2,3].map(i=><mesh key={i} position={[i*.11-.16,.4,0]}><boxGeometry args={[.07,1.4,.025]}/><meshBasicMaterial color={i<2?'#8ce3c6':'#ffca79'} toneMapped={false}/></mesh>)}</group>
  </>;
}

export default function OfferingStoryEffects({offering,variant,timeRef,onSelect}:StoryEffectsProps){
  const context=useMemo(()=>({offering,variant}),[offering,variant]);
  return <>
    {STORY_ACTORS.map(actor=><Actor key={actor.id} id={actor.id} role={offering==='automation'&&actor.id==='shopper'?'Staff':actor.role} context={context} timeRef={timeRef} onSelect={onSelect}/>)}
    <CheckoutProps context={context} timeRef={timeRef}/>
    <Detection context={context} timeRef={timeRef}/><EquipmentFeedback context={context} timeRef={timeRef}/>
  </>;
}
