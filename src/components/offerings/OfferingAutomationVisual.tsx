import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { CanvasTexture, Mesh, MeshStandardMaterial, Object3D, SRGBColorSpace, Vector3, type Group, type PointLight, type SpotLight } from 'three';
import kitUrl from '../../assets/offerings/automation-kit.studio.glb?url';
import { useCinematicModel } from './OfferingCinematicCanvas';
import { AUTOMATION_TIMING, sampleAutomation, type AutomationDeviceId, type AutomationStoryState } from './OfferingAutomationStory';

type Point = [number, number, number];
const MINT = '#9dd9bb', AMBER = '#efba7c', INK = '#112a25', CREAM = '#f2ebd6';
const NODE_IDS: Record<string, string> = { WiFiPlug:'auto-wifi', PromoDisplay:'auto-wifi', ThreadPlug:'auto-thread', DeskLamp:'auto-thread', ShellyRelay:'auto-shelly', IlluminatedSign:'auto-shelly', ZigbeePresenceSensor:'auto-presence', ZigbeeBridge:'auto-bridge', ThreadBorderRouter:'auto-thread', WiFiAP:'auto-wifi', EdgeController:'auto-controller' };
const PROTOCOLS = [
  {at:[-11.25,1.55,-1.37] as Point,title:'MATTER / WI-FI',sub:'DISPLAY PLUG'},
  {at:[-10.2,1.55,-1.37] as Point,title:'MATTER / THREAD',sub:'DESK LAMP PLUG'},
  {at:[-9.1,1.55,-1.37] as Point,title:'SHELLY PLUS 1PM',sub:'MQTT OVER WI-FI'},
  {at:[-10.15,2.98,-.95] as Point,title:'ZIGBEE',sub:'PRESENCE SENSOR'},
  {at:[-9.55,1.05,-.98] as Point,title:'WI-FI',sub:'ACCESS POINT'},
  {at:[-9.15,1.05,-.98] as Point,title:'THREAD',sub:'BORDER ROUTER'},
  {at:[-8.75,1.05,-.98] as Point,title:'ZIGBEE',sub:'BRIDGE'},
];
function makeSurface(width:number,height:number){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;texture.anisotropy=8;
  return {canvas,texture,ctx:canvas.getContext('2d')!};
}
function paintController(ctx:CanvasRenderingContext2D,state:AutomationStoryState,texture:CanvasTexture){
  ctx.fillStyle=INK;ctx.fillRect(0,0,1150,650);
  ctx.fillStyle='#b7c9bb';ctx.font='24px sans-serif';ctx.fillText('OPERATIONS / CLOSE ROUTINE',42,45);
  ctx.textAlign='right';ctx.fillText('ILLUSTRATIVE',1108,45);ctx.textAlign='left';
  ctx.fillStyle=state.guardHold?AMBER:CREAM;ctx.font='600 50px sans-serif';
  ctx.fillText(!state.requestClose?'Ready to close':state.guardHold?'Hold. Someone is inside.':state.allVerified?'Every load confirmed off.':'Close routine in progress',42,110);
  ctx.fillStyle='#29483c';ctx.fillRect(42,138,1066,62);
  ctx.fillStyle=state.presence?AMBER:MINT;ctx.font='27px sans-serif';ctx.fillText(`ZIGBEE PRESENCE  /  ${state.presence?'OCCUPIED':state.vacancyVerified?'VACANCY VERIFIED':'CHECKING VACANCY'}`,60,178);
  const names=['WI-FI / DISPLAY','THREAD / DESK LAMP','SHELLY / SIGN'];
  Object.values(state.devices).forEach((device,index)=>{
    const y=239+index*89;ctx.fillStyle='#b7c9bb';ctx.font='36px sans-serif';ctx.fillText(names[index],46,y);
    const value=device.confirmed?'OFF CONFIRMED':device.observed?'OFF · CHECKING POWER':device.ack?'ACK · WAITING FOR STATE':device.requested?'OFF REQUESTED':'ON';
    ctx.textAlign='right';ctx.fillStyle=device.confirmed?MINT:device.requested?AMBER:CREAM;ctx.font='600 36px sans-serif';ctx.fillText(value,1105,y);ctx.textAlign='left';
    [device.requested,device.ack,device.observed,device.confirmed].forEach((yes,i)=>{ctx.fillStyle=yes?MINT:'#365045';ctx.fillRect(46+i*253,y+18,239,5);});
  });
  ctx.fillStyle=CREAM;ctx.font='600 40px sans-serif';ctx.fillText(`${state.confirmedCount} / 3 verified`,45,535);
  ctx.textAlign='right';ctx.fillStyle=state.devices.sign.powerVerified?MINT:AMBER;ctx.fillText(`Sign circuit  ${state.devices.sign.watts.toFixed(0)} W`,1105,535);ctx.textAlign='left';
  ctx.fillStyle='#9dc7ad';ctx.font='25px sans-serif';ctx.fillText('REFRIGERATION + NETWORK + WALKWAY  /  REMAIN POWERED',45,596);
  ctx.fillStyle='#7c9d8b';ctx.font='20px sans-serif';ctx.fillText('Configured orchestration · bridged presence rule is a proposed extension',45,630);
  texture.needsUpdate=true;
}
function paintPromotion(ctx:CanvasRenderingContext2D,on:boolean,texture:CanvasTexture){
  texture.needsUpdate=true;
  ctx.fillStyle=on?'#d8a46d':'#111b1c';ctx.fillRect(0,0,870,510);if(!on)return;
  ctx.fillStyle='#16392e';ctx.fillRect(24,24,822,462);
  ctx.fillStyle=CREAM;ctx.font='600 40px sans-serif';ctx.fillText('TODAY IN STORE',60,97);
  ctx.fillStyle='#edbc7d';ctx.font='700 94px sans-serif';ctx.fillText('Fresh finds.',60,225);ctx.fillText('Every day.',60,325);
  ctx.fillStyle='#b4d4be';ctx.font='31px sans-serif';ctx.fillText('DISCOVER SOMETHING GOOD',60,433);
}
function paintSign(surface:ReturnType<typeof makeSurface>,on:boolean){
  const c=surface.ctx;c.fillStyle=on?'#efd1a1':'#1d2926';c.fillRect(0,0,990,330);c.fillStyle=on?INK:'#45524a';c.font='700 85px sans-serif';c.textAlign='center';c.fillText('OPEN',495,148);c.font='44px sans-serif';c.fillText('WELCOME IN',495,233);surface.texture.needsUpdate=true;
}
function Surface({at,size,texture}:{at:Point;size:[number,number];texture:CanvasTexture}){
  return <mesh position={at}><planeGeometry args={size}/><meshBasicMaterial map={texture} toneMapped={false}/></mesh>;
}
function ProtocolPlaque({at,title,sub}:typeof PROTOCOLS[number]){
  const surface=useMemo(()=>{const s=makeSurface(700,190);s.ctx.fillStyle='#e8e1ca';s.ctx.fillRect(0,0,700,190);s.ctx.fillStyle=INK;s.ctx.font='600 43px sans-serif';s.ctx.fillText(title,24,72);s.ctx.font='28px sans-serif';s.ctx.fillText(sub,24,133);s.texture.needsUpdate=true;return s;},[title,sub]);
  useEffect(()=>()=>surface.texture.dispose(),[surface]);
  return <Surface at={at} size={[.35,.095]} texture={surface.texture}/>;
}
const ROUTES:{id:AutomationDeviceId;points:Point[];color:string}[]=[
  {id:'display',points:[[-10.2,1.88,-1.31],[-9.55,.98,-.98],[-10.4,1.65,-.91],[-11.25,1.42,-1.33]],color:'#83c4dd'},
  {id:'lamp',points:[[-10.2,1.88,-1.31],[-9.15,.98,-.98],[-9.65,1.68,-.91],[-10.2,1.42,-1.33]],color:MINT},
  {id:'sign',points:[[-10.2,1.88,-1.31],[-8.8,2.6,-1.12],[-8.65,1.67,-.97],[-9.1,1.42,-1.34]],color:AMBER},
];
/** Animated traces illustrate command / acknowledgement exchange, not cables. */
function CommandTrace({spec,timeRef,variant}:{spec:typeof ROUTES[number];timeRef:RefObject<number>;variant:string}){
  const root=useRef<Group>(null),packet=useRef<Mesh>(null);
  const path=useMemo(()=>spec.points.map(p=>new Vector3(...p)),[spec]);
  useFrame(()=>{
    const state=sampleAutomation(variant,timeRef.current),device=state.devices[spec.id],timing=AUTOMATION_TIMING[spec.id];
    if(root.current)root.current.visible=device.requested&&!device.confirmed;
    if(!packet.current)return;
    const t=timeRef.current,forward=t<timing.ack;
    const progress=Math.min(1,Math.max(0,forward?(t-timing.request)/(timing.ack-timing.request):1-(t-timing.ack)/(timing.observed-timing.ack)));
    const at=progress*(path.length-1),index=Math.min(path.length-2,Math.floor(at));
    packet.current.position.copy(path[index]).lerp(path[index+1],at-index);
    packet.current.visible=t<timing.observed;
  });
  return <group ref={root}><Line points={spec.points} color={spec.color} lineWidth={1.1} dashed dashSize={.04} gapSize={.04} transparent opacity={.6}/><mesh ref={packet}><sphereGeometry args={[.013,12,8]}/><meshBasicMaterial color={spec.color} toneMapped={false}/></mesh></group>;
}

function PresenceCoverage({timeRef,variant}:{timeRef:RefObject<number>;variant:string}){
  const root=useRef<Group>(null),material=useRef<MeshStandardMaterial>(null);
  useFrame(()=>{
    const state=sampleAutomation(variant,timeRef.current);
    if(root.current)root.current.visible=state.requestClose&&!state.allVerified;
    if(material.current){material.current.color.set(state.presence?'#cfb8e3':MINT);material.current.emissive.set(state.presence?'#cfb8e3':MINT);}
  });
  return <group ref={root} position={[-8.85,.045,.35]}>
    <mesh rotation={[-Math.PI/2,0,0]}><ringGeometry args={[1.2,1.23,72]}/><meshStandardMaterial ref={material} transparent opacity={.5} depthWrite={false} emissiveIntensity={.5}/></mesh>
    <Line points={[[0,0,0],[-1.3,2.72,-1.3]]} color="#cfb8e3" dashed dashSize={.06} gapSize={.08} lineWidth={1} transparent opacity={.35}/>
  </group>;
}

export function OfferingAutomationVisual({timeRef,variant,onSelect}:{timeRef:RefObject<number>;variant:string;onSelect:(id:string)=>void}){
  const model=useCinematicModel(kitUrl);
  const lampLight=useRef<SpotLight>(null),displayLight=useRef<PointLight>(null),signLight=useRef<PointLight>(null);
  const lampTarget=useMemo(()=>{const target=new Object3D();target.position.set(-10.2,.785,-1.14);return target;},[]);
  const surfaces=useMemo(()=>({controller:makeSurface(1150,650),promotion:makeSurface(870,510),sign:makeSurface(990,330)}),[]);
  const nodes=useMemo(()=>{
    const materials=(name:string)=>{const result:MeshStandardMaterial[]=[];model.getObjectByName(name)?.traverse(object=>{if(object instanceof Mesh)(Array.isArray(object.material)?object.material:[object.material]).forEach(m=>{if(m instanceof MeshStandardMaterial)result.push(m);});});return result;};
    for(const name of ['EdgeControllerScreen','PromoDisplayFace','IlluminatedSignFace']){const node=model.getObjectByName(name);if(node)node.visible=false;}
    model.getObjectByName('RelayServiceCover')?.traverse(node=>{if(node instanceof Mesh)node.castShadow=false;});
    return {door:model.getObjectByName('StaffDoorHinge'),lamp:materials('LampDiffuser'),displayLed:materials('WiFiPlugLED'),lampLed:materials('ThreadPlugLED'),shellyLed:materials('ShellyIndicator'),sensorLed:materials('ZigbeeSensorLED')};
  },[model]);
  const last=useRef('');
  useEffect(()=>()=>Object.values(surfaces).forEach(s=>s.texture.dispose()),[surfaces]);
  useFrame(()=>{
    const t=timeRef.current,state=sampleAutomation(variant,t),key=`${variant}/${Math.floor(t*10)}`;
    const smooth=(start:number,end:number)=>{const u=Math.max(0,Math.min(1,(t-start)/(end-start)));return u*u*(3-2*u);};
    nodes.door?.rotation.set(0,variant==='occupied'?0:1.42*smooth(4.3,5)*(1-smooth(8.5,9)),0);
    const light=(materials:MeshStandardMaterial[],on:boolean,color:string,intensity=1)=>materials.forEach(m=>{m.color.set(on?color:'#142520');m.emissive.set(on?color:'#000000');m.emissiveIntensity=on?intensity:0;});
    light(nodes.lamp,state.devices.lamp.on,'#ffe4a7',1.6);
    light(nodes.displayLed,state.devices.display.on,'#b1e6c1');light(nodes.lampLed,state.devices.lamp.on,'#b1e6c1');light(nodes.shellyLed,state.devices.sign.on,'#f5b975');light(nodes.sensorLed,true,state.presence?AMBER:MINT);
    if(lampLight.current)lampLight.current.intensity=state.devices.lamp.on?2.8:0;
    if(displayLight.current)displayLight.current.intensity=state.devices.display.on?1.3:0;
    if(signLight.current)signLight.current.intensity=state.devices.sign.on?1.5:0;
    if(key===last.current)return;last.current=key;
    paintController(surfaces.controller.ctx,state,surfaces.controller.texture);
    paintPromotion(surfaces.promotion.ctx,state.devices.display.on,surfaces.promotion.texture);
    paintSign(surfaces.sign,state.devices.sign.on);
  });
  return <group onClick={event=>{event.stopPropagation();if(event.delta>=5)return;let node=event.object;while(node.parent){if(NODE_IDS[node.name]){onSelect(NODE_IDS[node.name]);return;}node=node.parent;}onSelect('auto-controller');}}>
    <primitive object={model} dispose={null}/>
    <Surface at={[-10.2,1.97,-1.396]} size={[.23,.13]} texture={surfaces.controller.texture}/>
    <Surface at={[-11.25,1.98,-1.396]} size={[.58,.34]} texture={surfaces.promotion.texture}/>
    <Surface at={[-9.1,2.05,-1.396]} size={[.66,.22]} texture={surfaces.sign.texture}/>
    {PROTOCOLS.map(spec=><ProtocolPlaque key={spec.title} {...spec}/>)}
    {ROUTES.map(spec=><CommandTrace key={spec.id} spec={spec} timeRef={timeRef} variant={variant}/>)}
    <PresenceCoverage timeRef={timeRef} variant={variant}/>
    <primitive object={lampTarget}/>
    <spotLight ref={lampLight} target={lampTarget} position={[-10.2,1.116,-1.14]} color="#ffe4a7" distance={1.2} angle={1} penumbra={.85} decay={2}/>
    <pointLight ref={displayLight} position={[-11.25,1.9,-1.05]} color="#edc192" distance={2} decay={2}/>
    <pointLight ref={signLight} position={[-9.1,2.05,-1.15]} color="#ffdaa3" distance={2} decay={2}/>
  </group>;
}
