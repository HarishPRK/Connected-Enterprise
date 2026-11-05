import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, EdgesGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, SkinnedMesh, type Object3D } from 'three';
import { useGLTF } from '@react-three/drei';
import actorsUrl from '../../assets/offerings/enterprise-actors.studio.glb?url';
import { monitoredPoint, sampleActor, STORY_ACTORS, storyProgress, type ActorId, type ActorRole, type StoryContext } from './OfferingStoryMotion';
import { prepareActor, setRig, reachReader } from './OfferingSkinnedActor';
import { isCheckoutStory, sampleCheckout } from './OfferingCheckoutStory';
import { poseTwinContact } from './OfferingTwinContact';
import { poseCardGrip } from './OfferingFingerGrip';
import { poseConsoleContact } from './OfferingConsoleContact';
import { OfferingPaymentTerminal } from './OfferingPaymentTerminal';

export interface StoryEffectsProps extends StoryContext { timeRef: RefObject<number>; onSelect: (id:string)=>void; }
function Actor({id,role,context,timeRef,onSelect}:{id:ActorId;role:ActorRole;context:StoryContext;timeRef:RefObject<number>;onSelect:(id:string)=>void}){
  const gltf=useGLTF(actorsUrl,false),root=useRef<Group>(null),lean=useRef<Group>(null);
  const actor=useMemo(()=>{const source=gltf.scene.getObjectByName(role);if(!source)throw new Error(`Missing actor ${role}`);return prepareActor(source,role,id,gltf.scene);},[gltf,role,id]);
  useEffect(()=>()=>{for(const prop of [actor.handset,actor.receipt]){prop.geometry.dispose();(prop.material as MeshStandardMaterial).dispose();}actor.card.traverse(object=>{if(object instanceof Mesh){object.geometry.dispose();(object.material as MeshStandardMaterial).dispose();}});actor.ownedMaterials.forEach(material=>material.dispose());const skeletons=new Set<SkinnedMesh['skeleton']>();actor.object.traverse(node=>{if(node instanceof SkinnedMesh)skeletons.add(node.skeleton);});skeletons.forEach(skeleton=>skeleton.dispose());},[actor]);
  useFrame(()=>{
    if(!root.current||!lean.current)return;const time=timeRef.current,pose=sampleActor(id,context,time);
    root.current.visible=pose.visible;root.current.position.set(...pose.at);root.current.rotation.y=pose.heading;lean.current.rotation.x=pose.fall*Math.PI/2;
    setRig(actor.joints,pose,time);
    const checkout=sampleCheckout(context,time);
    setVisibility(actor.card,id==='shopper'&&checkout.cardVisible);
    if(actor.joints.BagMount)setVisibility(actor.joints.BagMount.object,!(id==='technician'&&(context.offering==='twin'||context.offering==='eagle'&&time>=8.5&&time<13.5)));
    if(id==='shopper'&&checkout.cardVisible)poseCardGrip(actor.joints);
    if(id==='technician'&&context.offering==='twin'){
      poseTwinContact(actor.joints,time);
    }
    if(id==='technician'&&context.offering==='eagle'&&time>=8.5&&time<13.5)poseConsoleContact(actor.joints,time);
    if(id==='shopper'&&isCheckoutStory(context)){
      reachReader(actor.joints,checkout.cardReach);
      const lift=storyProgress(time,15.9,16.3),lower=storyProgress(time,16.55,17.25);
      reachReader(actor.joints,lift*lift*(3-2*lift)*(1-lower*lower*(3-2*lower)),'Left',[8.7,1.6,4.85]);
    }
  });
  return <group ref={root} onClick={event=>{event.stopPropagation();if(event.delta<5)onSelect(context.offering==='video'&&context.variant==='crowd'?'crowd':'person');}}><group ref={lean}><primitive object={actor.object} dispose={null}/></group></group>;
}

function cloneProp(source:Object3D){const copy=source.clone(true);copy.traverse(node=>{if(node instanceof Mesh){node.castShadow=true;node.receiveShadow=true;node.material=Array.isArray(node.material)?node.material.map(m=>m.clone()):node.material.clone();}});return copy;}
function setVisibility(object:Object3D,visible:boolean){object.visible=visible;}
function CheckoutProps({context,timeRef}:{context:StoryContext;timeRef:RefObject<number>}){
  const gltf=useGLTF(actorsUrl,false);
  const props=useMemo(()=>{
    const terminal=cloneProp(gltf.scene.getObjectByName('PaymentTerminal')!),printer=cloneProp(gltf.scene.getObjectByName('ReceiptPrinter')!),basket=cloneProp(gltf.scene.getObjectByName('ShoppingBasket')!);
    const display=terminal.getObjectByName('PaymentTerminal_Display');if(display)display.visible=false;
    return {terminal,printer,basket,paper:printer.getObjectByName('ReceiptPrinter_Receipt')};
  },[gltf]);
  useEffect(()=>()=>{for(const object of [props.terminal,props.printer,props.basket])object.traverse(child=>{if(child instanceof Mesh)(Array.isArray(child.material)?child.material:[child.material]).forEach(m=>m.dispose());});},[props]);
  useFrame(()=>{
    const t=timeRef.current,isPayment=isCheckoutStory(context);
    const checkout=sampleCheckout(context,t);
    const shopper=sampleActor('shopper',context,t),carry=isPayment?shopper.carry:0;
    if(props.paper){props.paper.scale.setY(isPayment?checkout.paper:.08);setVisibility(props.paper,shopper.receipt<.55);}
    const handX=shopper.at[0]+Math.cos(shopper.heading)*.30+Math.sin(shopper.heading)*.04;
    const handZ=shopper.at[2]-Math.sin(shopper.heading)*.30+Math.cos(shopper.heading)*.04;
    const handY=.34+Math.sin(shopper.distance*9.8+shopper.phase)*.012*shopper.walk;
    props.basket.position.set(6.65+(handX-6.65)*carry,1.15+(handY-1.15)*carry+Math.sin(carry*Math.PI)*.12,4.45+(handZ-4.45)*carry);
    props.basket.rotation.set(0,shopper.heading*carry,0);
  });
  return <>
    <OfferingPaymentTerminal context={context} timeRef={timeRef}/>
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
    const t=timeRef.current,event=t>=4;
    if(fault.current){const p=context.offering==='eagle'?monitoredPoint(context.variant):context.offering==='smart'?context.variant==='hvac'?[-9,1.9,-4.8]:context.variant==='cooler'?[-1.35,3.15,-7.6]:[-9.6,2,-1.1]:[14.6,2.3,-6];fault.current.visible=event&&['eagle','smart','failover'].includes(context.offering);fault.current.position.set(p[0],p[1]+.25,p[2]);fault.current.scale.setScalar(.8+.2*Math.sin(t*4));}
    if(scan.current){scan.current.visible=t>8&&['eagle','smart'].includes(context.offering);const k=(t*.5)%1;scan.current.scale.setScalar(.3+k*1.7);if(scanMaterial.current)scanMaterial.current.opacity=.45*(1-k);}
    if(lock.current)lock.current.visible=false;
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
