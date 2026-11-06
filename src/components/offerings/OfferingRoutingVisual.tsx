import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { PerspectiveCamera, RenderTexture, useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, Mesh, MeshStandardMaterial, SkinnedMesh, PerspectiveCamera as ThreeCamera, SRGBColorSpace, type Object3D } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import kitUrl from '../../assets/offerings/routing-kit.studio.glb?url';
import actorsUrl from '../../assets/offerings/enterprise-actors.studio.glb?url';
import { cinematicAssets, useCinematicModel } from './OfferingCinematicCanvas';
import { clearLaptopDisplayGraphics } from './OfferingRoutingScreens';
import { sampleRouting } from './OfferingRoutingStory';
import { SERVICE_CART } from './OfferingEquipment';

type RoutingState=ReturnType<typeof sampleRouting>;
const W=1440,H=850;
const INK='#0e2528',CREAM='#f5eddc',MUTED='#a6c0ba',MINT='#9ddfbc',AMBER='#f2c58d';
const SCREEN={teams:[8,1.50,4.5115],voice:[8.025,1.238,6.953],archive:[10,1.47,-5.391]} as const;

function text(ctx:CanvasRenderingContext2D,value:string,x:number,y:number,size=30,color=CREAM,weight=500){ctx.font=`${weight} ${size}px sans-serif`;ctx.fillStyle=color;ctx.fillText(value,x,y);}
function box(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,color:string,r=14){ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
function wire(ctx:CanvasRenderingContext2D,x:number,y:number,tx:number,ty:number,color:string,dashed=false){ctx.strokeStyle=color;ctx.lineWidth=4;ctx.setLineDash(dashed?[10,8]:[]);ctx.beginPath();ctx.moveTo(x,y);ctx.bezierCurveTo(x+(tx-x)*.45,y,tx-(tx-x)*.45,ty,tx,ty);ctx.stroke();ctx.setLineDash([]);}
function screenBase(ctx:CanvasRenderingContext2D,label:string){ctx.fillStyle=INK;ctx.fillRect(0,0,W,H);text(ctx,label,40,54,30,MUTED,700);text(ctx,'ILLUSTRATIVE',1175,54,23,MUTED);ctx.fillStyle='#36514e';ctx.fillRect(40,78,W-80,2);}

function patchboard(ctx:CanvasRenderingContext2D,s:RoutingState,t:number){
  screenBase(ctx,'APPLICATION STEERING');
  text(ctx,'Choose one application. Keep the others in place.',40,121,32,CREAM,600);
  const selected=s.clients.find(c=>c.selected)!;
  const progress=s.selectionProgress;
  s.clients.forEach((client,i)=>{
    const y=210+i*106,route=s.tunnels.findIndex(tunnel=>tunnel.id===client.desiredRoute),old=s.tunnels.findIndex(tunnel=>tunnel.id===client.initialRoute);
    const destination=client.selected&&t>=9&&t<10.5?old+(route===old?s.tunnels.findIndex(tunnel=>tunnel.id===s.targetRoute)-old:route-old)*progress:route;
    box(ctx,35,y-43,400,86,client.selected?'#284d48':'#19363a');
    text(ctx,client.label,52,y-6,27,CREAM,650);text(ctx,client.app,52,y+26,24,client.color);
    if(client.locked){text(ctx,'LOCK',350,y+6,20,AMBER,700);}else if(client.selected){text(ctx,'EDIT',350,y+6,20,MINT,700);}
    wire(ctx,435,y,650,285+i*58,client.color);
    wire(ctx,785,285+i*58,1045,230+destination*141,client.color,client.selected&&!s.brokerAccepted);
    const pulse=((t*.27+i*.19)%1),px=435+pulse*215;
    ctx.fillStyle=client.color;ctx.beginPath();ctx.arc(px,y+(285+i*58-y)*pulse,5,0,Math.PI*2);ctx.fill();
  });
  box(ctx,650,205,135,395,'#b5c9c3',32);box(ctx,665,225,105,355,'#284746',25);
  text(ctx,'EDGE',674,386,24,CREAM,700);text(ctx,'GATEWAY',656,415,21,MUTED,600);
  ctx.fillStyle=MINT;ctx.beginPath();ctx.arc(717,548,7,0,Math.PI*2);ctx.fill();
  s.tunnels.forEach((tunnel,i)=>{
    const y=230+i*141;box(ctx,1045,y-50,355,103,'#19383c');
    text(ctx,tunnel.id,1065,y-8,29,tunnel.id.includes('cell')?'#c7b7ed':'#a1dbe5',700);
    text(ctx,`${tunnel.rtt} ms  /  ONLINE`,1065,y+27,23,MINT);
  });
  const status=s.brokerAccepted?'PUBLISHED TO BROKER':s.publishRequested?'PUBLISHING':s.previewBlocked?'ROUTE LOCKED':t>=10.5?'PREVIEW READY':t>=9?'DRAG TO A TUNNEL':t>=6?'REVIEW THE ROUTES':'ALL FOUR TUNNELS ONLINE';
  box(ctx,35,713,1370,100,'#294b44');text(ctx,status,55,752,30,s.previewBlocked?AMBER:MINT,700);
  text(ctx,s.brokerAccepted?'Gateway applied? Awaiting independent evidence.':`${selected.app}  /  ${selected.initialRoute}  →  ${s.targetRoute}`,55,790,26,CREAM);
  if(t>=9&&t<11){
    const end=s.tunnels.findIndex(tunnel=>tunnel.id===s.targetRoute),x=435+progress*610,y=210+s.clients.findIndex(c=>c.selected)*106+(230+end*141-(210+s.clients.findIndex(c=>c.selected)*106))*progress;
    ctx.fillStyle=CREAM;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+10,y+36);ctx.lineTo(x+19,y+23);ctx.lineTo(x+35,y+19);ctx.closePath();ctx.fill();
  }
}

function meeting(ctx:CanvasRenderingContext2D,s:RoutingState){
  ctx.clearRect(0,0,W,H);
  box(ctx,0,0,W,145,INK,0);text(ctx,'TEAMS  /  REGIONAL BRIEFING',36,52,34,CREAM,700);
  const waiting=s.teams.frozen,connecting=s.teams.state==='rejoining';
  text(ctx,waiting?'Video is paused':connecting?'Rejoining on the selected path':'Live briefing · 02 participants',36,107,30,waiting?AMBER:MINT);
  box(ctx,0,670,W,180,INK,0);
  text(ctx,waiting?'“Could you repeat the stock update?”':connecting?'Starting a new media flow…':'“The replenishment plan is on screen.”',36,727,32,CREAM,600);
  text(ctx,s.teams.route==='vti-fiber1'?'Illustrated new flow · vti-fiber1':'Front desk · vti-cell1',36,790,28,MUTED);
  if(waiting||connecting){box(ctx,1000,180,400,72,'#213d40');text(ctx,connecting?'REJOINING…':'LAST FRAME',1020,228,27,AMBER,700);}
}

function surveillance(ctx:CanvasRenderingContext2D,s:RoutingState,t:number){
  screenBase(ctx,'BACK OFFICE / SURVEILLANCE');
  text(ctx,'Export the loading-bay clip',40,135,43,CREAM,650);
  // A visibly moving recorded forklift/parcel sequence. Local recording never
  // stops while the upstream transfer is reassigned for its next segment.
  box(ctx,40,175,825,430,'#3b5152');
  ctx.fillStyle='#75847e';ctx.fillRect(40,430,825,175);ctx.fillStyle='#b3bcae';ctx.fillRect(85,215,410,210);
  for(let i=0;i<7;i++){ctx.fillStyle='#687a75';ctx.fillRect(85,215+i*30,410,3);}
  const truckX=120+((t*36)%490);box(ctx,truckX,399,130,71,'#d0ad6c',5);box(ctx,truckX+90,356,42,68,'#d0ad6c',4);
  ctx.strokeStyle='#273c3b';ctx.lineWidth=10;ctx.beginPath();ctx.moveTo(truckX+147,355);ctx.lineTo(truckX+147,460);ctx.lineTo(truckX+189,460);ctx.stroke();
  [truckX+25,truckX+105].forEach(x=>{ctx.fillStyle='#142c2d';ctx.beginPath();ctx.arc(x,474,18,0,Math.PI*2);ctx.fill();});
  text(ctx,`CAM 02   REC ●    14:32:${String(Math.floor(t)%60).padStart(2,'0')}`,62,565,29,CREAM,700);
  box(ctx,905,175,495,430,'#19383c');text(ctx,'ARCHIVE TRANSFER',930,224,27,MUTED,700);
  text(ctx,`${Math.round(s.archive.uploadProgress*100)}%`,930,315,78,CREAM,700);
  box(ctx,930,354,440,24,'#365650',6);box(ctx,930,354,Math.max(4,440*s.archive.uploadProgress),24,MINT,6);
  text(ctx,s.archive.flow==='new-flow'?'New segment: fiber2':'Current segment: fiber1',930,436,26,MINT);
  text(ctx,'Local recording stays on',930,492,25,CREAM);
  text(ctx,'Example transfer',930,555,25,MUTED);
  box(ctx,40,645,1360,160,'#294b44');text(ctx,s.archive.flow==='new-flow'?'Next segment uses the selected tunnel':'One busy application can have its own route',65,700,35,CREAM,650);
  text(ctx,'No bandwidth cap. No claim of dedicated physical capacity.',65,758,28,MUTED);
}

function phone(ctx:CanvasRenderingContext2D,s:RoutingState,t:number){
  screenBase(ctx,'MEETING ROOM / VoIP');
  text(ctx,s.voice.newCallStarted?'Supplier call':'Next supplier call',45,180,70,CREAM,650);
  text(ctx,s.voice.newCallStarted?'SPEAKER ON':'Ready to dial',45,275,63,s.voice.newCallStarted?MINT:AMBER,700);
  ctx.strokeStyle=s.voice.newCallStarted?MINT:'#627b76';ctx.lineWidth=8;ctx.beginPath();
  for(let i=0;i<110;i++){const x=45+i*12.3,y=436+(s.voice.state==='connected'?Math.sin(i*.6+t*8)*Math.sin(i*.12-t*2)*65:0);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();
  text(ctx,s.voice.newCallStarted?'Illustrated new call · vti-fiber2':'Review route before placing the call',45,610,38,MUTED);
  text(ctx,'MIC  ●     SPEAKER  ●',45,755,38,MINT);
}

function uploadTexture(texture:CanvasTexture){texture.needsUpdate=true;}
function lightRing(materials:MeshStandardMaterial[],on:boolean){for(const material of materials){material.emissive.set(on?MINT:'#102525');material.emissiveIntensity=on?.8:0;}}
function animateSpeaker(joints:{head:Object3D|undefined;arm:Object3D|undefined;forearm:Object3D|undefined},t:number){if(joints.head)joints.head.rotation.y=Math.sin(t*1.8)*.12;if(joints.arm)joints.arm.rotation.x=-.22-Math.sin(t*1.5)*.13;if(joints.forearm)joints.forearm.rotation.x=-.5-Math.sin(t*1.9)*.1;}

function useSurface(paint:(ctx:CanvasRenderingContext2D,state:RoutingState,t:number)=>void,timeRef:RefObject<number>,variant:string){
  const surface=useMemo(()=>{const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;const ctx=canvas.getContext('2d')!;const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;texture.anisotropy=8;return {ctx,texture};},[]);
  const tick=useRef(-1);
  useEffect(()=>{tick.current=-1;},[variant]);
  useEffect(()=>()=>surface.texture.dispose(),[surface]);
  useFrame(()=>{const t=timeRef.current,next=Math.floor(t*12);if(tick.current===next)return;tick.current=next;paint(surface.ctx,sampleRouting(t,variant),t);uploadTexture(surface.texture);});
  return surface.texture;
}

function MeetingSpeaker({timeRef,variant}:{timeRef:RefObject<number>;variant:string}){
  const cast=useGLTF(actorsUrl,false);
  const person=useMemo(()=>clone(cast.scene.getObjectByName('Staff')!),[cast]);
  useEffect(()=>()=>{const skeletons=new Set<SkinnedMesh['skeleton']>();person.traverse(node=>{if(node instanceof SkinnedMesh)skeletons.add(node.skeleton);});skeletons.forEach(skeleton=>skeleton.dispose());},[person]);
  const joints=useMemo(()=>({head:person.getObjectByName('Staff_Head'),arm:person.getObjectByName('Staff_RightUpperArm'),forearm:person.getObjectByName('Staff_RightForearm')}),[person]);
  const rotation=useMemo(()=>{const camera=new ThreeCamera();camera.position.set(0,1.53,1.65);camera.lookAt(0,1.43,0);return camera.quaternion.clone();},[]);
  useFrame(()=>{const t=sampleRouting(timeRef.current,variant).teams.motionTime;animateSpeaker(joints,t);});
  return <><color attach="background" args={['#536f69']}/><PerspectiveCamera makeDefault manual aspect={16/9} fov={36} position={[0,1.53,1.65]} quaternion={rotation}/><ambientLight intensity={1.4}/><directionalLight position={[-2,4,4]} intensity={2.5}/><primitive object={person} dispose={null}/><mesh position={[0,1,-.3]}><boxGeometry args={[4,3,.06]}/><meshStandardMaterial color="#627e74" roughness={.9}/></mesh></>;
}

function LaptopConsole({timeRef,variant,onSelect}:{timeRef:RefObject<number>;variant:string;onSelect:(id:string)=>void}){
  const laptop=useCinematicModel(cinematicAssets.kit,'Laptop',SERVICE_CART.laptopWidth);
  const graphics=useMemo(()=>clearLaptopDisplayGraphics(laptop),[laptop]);
  useEffect(()=>()=>graphics.forEach(g=>g.dispose()),[graphics]);
  const texture=useSurface(patchboard,timeRef,variant);
  return <group name="Application steering workstation" position={SERVICE_CART.at}>
    <mesh position={[0,1.025,0]} castShadow receiveShadow><boxGeometry args={[.65,.05,.48]}/><meshStandardMaterial color="#8d9ca8" metalness={.5} roughness={.38}/></mesh>
    {[-.265,.265].flatMap(x=>[-.18,.18].map(z=><group key={`${x}/${z}`}><mesh position={[x,.565,z]} castShadow><boxGeometry args={[.03,.87,.03]}/><meshStandardMaterial color="#31434f" metalness={.65} roughness={.4}/></mesh><mesh position={[x,.06,z]} rotation={[0,0,Math.PI/2]} castShadow><cylinderGeometry args={[.05,.05,.03,16]}/><meshStandardMaterial color="#182825" roughness={.8}/></mesh></group>))}
    <mesh position={[0,.24,0]}><boxGeometry args={[.56,.025,.39]}/><meshStandardMaterial color="#40525f" metalness={.5} roughness={.5}/></mesh>
    <group position={[0,SERVICE_CART.top,0]}><primitive object={laptop} dispose={null}/><group scale={SERVICE_CART.laptopWidth/1.23}><mesh position={[0,.490972,-.321563]} rotation={[-.13,0,0]} onClick={e=>{e.stopPropagation();if(e.delta<5)onSelect('route-console');}}><planeGeometry args={[1.10,.65]}/><meshBasicMaterial map={texture} toneMapped={false}/></mesh></group></group>
  </group>;
}

function hide(model:Object3D,name:string){const object=model.getObjectByName(name);if(object)object.visible=false;}
export function OfferingRoutingVisual({timeRef,variant,onSelect}:{timeRef:RefObject<number>;variant:string;onSelect:(id:string)=>void}){
  const model=useCinematicModel(kitUrl);
  const rings=useMemo(()=>{hide(model,'TeamsMonitorScreen');hide(model,'VoipPhoneScreen');const result:MeshStandardMaterial[]=[];model.getObjectByName('SpeakerphoneStatusRing')?.traverse(o=>{if(o instanceof Mesh)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{if(m instanceof MeshStandardMaterial)result.push(m);});});return result;},[model]);
  const teams=useSurface(meeting,timeRef,variant),archive=useSurface(surveillance,timeRef,variant),voice=useSurface(phone,timeRef,variant);
  useFrame(()=>{const on=sampleRouting(timeRef.current,variant).voice.newCallStarted;lightRing(rings,on);});
  return <group name="Application routing studio">
    <primitive object={model} dispose={null}/>
    <mesh position={SCREEN.teams} onClick={e=>{e.stopPropagation();if(e.delta<5)onSelect('route-front-desk');}}><planeGeometry args={[.60,.3375]}/><meshBasicMaterial toneMapped={false}><RenderTexture attach="map" width={960} height={540} samples={0}><MeetingSpeaker timeRef={timeRef} variant={variant}/></RenderTexture></meshBasicMaterial></mesh>
    <mesh position={[8,1.5,4.512]}><planeGeometry args={[.60,.3375]}/><meshBasicMaterial transparent map={teams} toneMapped={false} depthWrite={false}/></mesh>
    <mesh position={SCREEN.voice} onClick={e=>{e.stopPropagation();if(e.delta<5)onSelect('route-meeting-room');}}><planeGeometry args={[.145,.076]}/><meshBasicMaterial map={voice} toneMapped={false}/></mesh>
    <group position={SCREEN.archive} onClick={e=>{e.stopPropagation();if(e.delta<5)onSelect('route-back-office');}}><mesh position={[0,0,-.025]} castShadow><boxGeometry args={[.72,.45,.045]}/><meshStandardMaterial color="#203b39" metalness={.5} roughness={.35}/></mesh><mesh position={[0,0,.001]}><planeGeometry args={[.69,.407]}/><meshBasicMaterial map={archive} toneMapped={false}/></mesh></group>
    <LaptopConsole timeRef={timeRef} variant={variant} onSelect={onSelect}/>
  </group>;
}
