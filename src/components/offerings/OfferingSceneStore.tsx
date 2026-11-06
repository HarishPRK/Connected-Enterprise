import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { events, useFrame, useThree, type RootState, type ThreeEvent } from '@react-three/fiber';
import { Mesh, MeshStandardMaterial, PerspectiveCamera, Vector3, type Camera, type PointLight, type WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Expand, Focus, Minimize, RotateCcw, RotateCw, Scan, Store, ZoomIn, ZoomOut } from 'lucide-react';
import OfferingCinematicCanvas, { cinematicAssets, useCinematicModel } from './OfferingCinematicCanvas';
import type { OfferingId, OfferingSceneProps } from './OfferingScene';
import './OfferingScene.css';
import OfferingStoryEffects from './OfferingStoryEffects';
import { OfferingTwinWorkstation } from './OfferingTwinWorkstation';
import { OfferingRoutingVisual } from './OfferingRoutingVisual';
import { OfferingEagleConsole } from './OfferingEagleConsole';
import { OfferingAutomationVisual } from './OfferingAutomationVisual';
import { OfferingSmartVisual } from './OfferingSmartVisual';
import { sampleSmart } from './OfferingSmartStory';
import { STORY_PLAYBACK_SECONDS } from './OfferingPlayback';
import { OfferingCinemaControls } from './OfferingCinemaControls';
import { PARTS, GATEWAY_EXPLODE, type EquipmentSpec, type Vec } from './OfferingEquipment';
import { OfferingConnections } from './OfferingConnections';
import { sampleStoryCamera, storyProgress, type StoryContext } from './OfferingStoryMotion';
import { OfferingContactGrounding } from './OfferingStudioLighting';
import { storeLightLevel } from './offeringLighting';
import { OfferingStoryAnnotationLayer, OfferingStoryAnnotationSync, type StoryAnnotationNodes } from './OfferingStoryAnnotations';
import { portraitStoryCamera } from './offeringPortraitCamera';

interface Hotspot { id: string; label: string; at: Vec; color: string; number?: string; }
const SKY = '#b2d8cc', TEAL = '#9dd9bb', VIOLET = '#c9badb', AMBER = '#efba7c', CORAL = '#ef9d83';
// One permanent floor plan. Selecting a service changes its story and signals,
// while the store, equipment and all other service areas stay in place.
const SERVICE_SPOTS: (Hotspot & { id: OfferingId })[] = [
  { id: 'failover', label: 'Dynamic Failover', number: '01', at: [14.1, 5.8, -.6], color: SKY },
  { id: 'routing', label: 'Application routing', number: '02', at: [8, 2.6, 6.4], color: TEAL },
  { id: 'twin', label: 'CPE digital twin', number: '03', at: [6.45, 1.7, -2.65], color: VIOLET },
  { id: 'eagle', label: 'EA:GLE', number: '04', at: [10.1, 4.6, -7.5], color: SKY },
  { id: 'automation', label: 'Device automation', number: '05', at: [-10.5, 3.35, .25], color: VIOLET },
  { id: 'smart', label: 'Smart services', number: '06', at: [-5, 4.2, -7.9], color: AMBER },
  { id: 'video', label: 'Video analytics', number: '07', at: [.6, 2.55, 6.7], color: TEAL },
];
const FOCUS: Record<OfferingId, { target: Vec; span: number }> = {
  failover: { target: [10.8, 1.5, -2.2], span: 14 }, routing: { target: [8, 1.1, 2.6], span: 9.5 },
  twin: { target: [6.9, 1.15, -1.1], span: 3.6 }, eagle: { target: [7.8, 1, -4.8], span: 14.5 },
  automation: { target: [-9.9, .9, .15], span: 9.5 }, smart: { target: [-5.7, 1, -6.5], span: 18 },
  video: { target: [5.8, 1.3, 2.4], span: 17 },
};
const INSPECT: Record<OfferingId, string[]> = {
  failover: ['fiber', '5g', 'gateway', 'analytics', 'pos'], routing: ['pos', 'camera', 'analytics', 'gateway', 'fiber', '5g'],
  twin: ['housing', 'board', 'heatsink', 'ports', 'antennae'], eagle: ['gateway', 'fiber', '5g', 'it', 'ot'],
  automation: ['auto-wifi', 'auto-thread', 'auto-shelly', 'auto-presence', 'auto-controller'], smart: ['hvac', 'cooler', 'energy', 'meter'],
  video: ['camera', 'person', 'zone', 'crowd'],
};
const NAMES: Record<string, string> = { hvac: 'HVAC', cooler: 'Coolers', energy: 'Solar & energy', meter: 'Energy meter', it: 'IT devices', gateway: 'Gemtek OSPv2 gateway', analytics: 'Dell analytics server', fiber: 'Fiber', '5g': '5G', sensor: 'Occupancy sensor', thermostat: 'Thermostat', lock: 'Access control', light: 'Lighting', ot: 'OT sensor', pos: 'POS', voice: 'Voice', camera: 'Camera', person: 'Man-down', zone: 'Restricted zone', crowd: 'Crowd monitoring' };

// Three owns these mutable resources; imperative updates stay outside render.
function setCursor(renderer: WebGLRenderer, cursor: string) { renderer.domElement.style.cursor = cursor; }
function dimLamp(material:MeshStandardMaterial,amount:number){material.color.setRGB(.12+amount*.65,.14+amount*.62,.16+amount*.48);material.emissive.setRGB(amount*.8,amount*.62,amount*.3);material.emissiveIntensity=.65;}
function createOrbit(camera: Camera, renderer: WebGLRenderer, requestFrame: () => void) {
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enablePan = false; orbit.enableZoom = true; orbit.enableDamping = false;
  orbit.rotateSpeed = .45; orbit.zoomSpeed = .6; orbit.minDistance = 1.1; orbit.maxDistance = 110;
  orbit.minPolarAngle = .32; orbit.maxPolarAngle = 1.38;
  orbit.addEventListener('change', requestFrame); renderer.domElement.style.touchAction = 'pan-y';
  return orbit;
}
function sceneEvents(store: Parameters<typeof events>[0]) {
  return { ...events(store), compute(event: MouseEvent, state: RootState) {
    const rect = state.gl.domElement.getBoundingClientRect();
    state.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    state.raycaster.setFromCamera(state.pointer, state.camera);
  } };
}
function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => { const media = window.matchMedia('(prefers-reduced-motion: reduce)'); const update = () => setReduced(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  return reduced;
}
function Architecture({ context }: { context: StoryContext; timeRef: RefObject<number> }) {
  const model = useCinematicModel(cinematicAssets.store);
  const { gl } = useThree();
  useMemo(() => {
    const copy=model;
    // Adjacent coplanar tile pieces receive equipment shadows but should not
    // cast shadow-map silhouettes onto one another.
    copy.getObjectByName('FloorShell')?.traverse(object=>{if(object instanceof Mesh)object.castShadow=false;});
    copy.traverse(object=>{if(object instanceof Mesh)(Array.isArray(object.material)?object.material:[object.material]).forEach(material=>{if(material instanceof MeshStandardMaterial&&material.map)material.map.anisotropy=Math.min(16,gl.capabilities.getMaxAnisotropy());});});
    return copy;
  }, [model,gl]);
  useLayoutEffect(()=>{const checkout=model.getObjectByName('CheckoutFixtures');if(checkout)checkout.visible=context.offering!=='routing';},[model,context.offering]);
  const diffusers=useMemo(()=>{const materials:MeshStandardMaterial[]=[];model.getObjectByName('LightingRig')?.traverse(object=>{if(object instanceof Mesh)(Array.isArray(object.material)?object.material:[object.material]).forEach(material=>{if(material instanceof MeshStandardMaterial&&material.emissiveIntensity>0)materials.push(material);});});return materials;},[model]);
  useFrame(()=>{const level=storeLightLevel(context);diffusers.forEach(material=>{material.emissiveIntensity=.12+level*1.6;});});

  return <primitive object={model} dispose={null} />;
}
function Equipment({ spec, exploded = false, inspection = false, onSelect, context, timeRef }: { spec: EquipmentSpec; exploded?: boolean; inspection?: boolean; onSelect: (id: string) => void; context:StoryContext; timeRef:RefObject<number> }) {
  const { gl, invalidate } = useThree();
  const url=spec.model==='GatewayTwin'?cinematicAssets.twin:spec.model==='AnalyticsServer'?cinematicAssets.analytics:cinematicAssets.kit;
  // The installed CPE stays closed, even while its laptop twin explodes. Keep
  // the independently selectable assembly graph for the inspection viewer.
  const model=useCinematicModel(url,spec.model,spec.size,!inspection&&!exploded?'closed':'assemblies');
  const animated=useMemo(()=>{
    const moves=GATEWAY_EXPLODE;
    const bulbs:MeshStandardMaterial[]=[];if(spec.model==='Light')model.traverse(object=>{if(object instanceof Mesh)(Array.isArray(object.material)?object.material:[object.material]).forEach(material=>{if(material instanceof MeshStandardMaterial&&material.name==='Display and markings')bulbs.push(material);});});
    return {parts:Object.entries(moves).map(([name,move])=>{const object=model.getObjectByName(name);return object?{object,origin:object.position.clone(),move:new Vector3(...move)}:null;}).filter(item=>item!==null),fan:model.getObjectByName('HVACFan'),door:model.getObjectByName('CoolerLeftDoor'),bulbs};
  },[model,spec.model]);

  useFrame(()=>{
    const t=timeRef.current,amount=exploded?(inspection?1:storyProgress(t,3,9)):0;
    for(const part of animated.parts){part.object.position.copy(part.origin);part.object.position.addScaledVector(part.move,amount);}
    const smart=context.offering==='smart'?sampleSmart(context.variant,t):null;
    if(animated.fan)animated.fan.rotation.set(0,0,smart?(context.variant==='energy'?smart.energy.hvacFanAngle:smart.hvac.fanAngle):t*6);
    if(animated.door)animated.door.rotation.set(0,smart&&context.variant==='cooler'&&spec.id==='cooler'?smart.cooler.doorAngle:0,0);
    if(animated.bulbs.length)animated.bulbs.forEach(material=>dimLamp(material,smart&&context.variant==='energy'?smart.energy.lightingLevel:.75));
  });
  useEffect(()=>invalidate(),[context,exploded,inspection,invalidate]);
  useEffect(() => () => setCursor(gl, ''), [gl]);
  const choose = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation(); if (event.delta >= 5) return;
    if (spec.model === 'GatewayTwin' && exploded) {
      const targets: Record<string, string> = { GatewayHousingFront: 'housing', GatewayHousingBack: 'housing', GatewayFrontPanel: 'housing', GatewayBackplate: 'board', GatewayBoard: 'board', GatewayCrown: 'housing', GatewayHeatsinkLeft: 'heatsink', GatewayHeatsinkRight: 'heatsink', GatewayRadio: 'board', GatewayPorts: 'ports', GatewayAntennae: 'antennae' };
      let node = event.object; while (node.parent) { if (targets[node.name]) { onSelect(targets[node.name]); return; } node = node.parent; }
    }
    onSelect(spec.id === 'cooler-right' ? 'cooler' : spec.id === 'it-laptop' ? 'it' : spec.id === 'camera-back' ? 'camera' : spec.id);
  };
  return <group position={spec.at} rotation={[0, spec.yaw || 0, 0]}>
    <primitive object={model} dispose={null} onClick={choose} onPointerOver={(event: ThreeEvent<PointerEvent>) => { event.stopPropagation(); setCursor(gl, 'pointer'); }} onPointerOut={() => setCursor(gl, '')} />
  </group>;
}

function FloorRing({ at, radius = 1, color = AMBER }: { at: Vec; radius?: number; color?: string }) {
  return <mesh position={at} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[radius, radius+.018, 56]} /><meshBasicMaterial color={color} transparent opacity={.35} toneMapped={false} /></mesh>;
}
function PracticalDetails({ offering, variant, active, response, timeRef }: Pick<OfferingSceneProps, 'offering' | 'variant' | 'active'> & { response: boolean; timeRef: RefObject<number> }) {
  const taskLight=useRef<PointLight>(null);
  useFrame(()=>{if(taskLight.current)taskLight.current.intensity=offering==='automation'?0:4.5*(offering==='smart'&&variant==='energy'?sampleSmart(variant,timeRef.current).energy.lightingLevel:1);});
  return <>
    {[[4.8,7.9],[11.4,-2.1]].map(([x,z]) => <group key={x}>
      <mesh position={[x,1.8,z]} castShadow><cylinderGeometry args={[.045,.065,3.6,10]} /><meshStandardMaterial color="#81929e" metalness={.7} roughness={.35} /></mesh>
      <mesh position={[x,.06,z]}><cylinderGeometry args={[.25,.3,.12,20]} /><meshStandardMaterial color="#435664" metalness={.7} roughness={.4} /></mesh>
    </group>)}
    <pointLight ref={taskLight} position={[-10.5,2.25,1.6]} color="#ffe2a7" intensity={4.5} distance={7} decay={2} />
    <mesh position={[9.5,.035,-4.5]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[5.2,5]} /><meshBasicMaterial color={offering==='video' && variant==='intruder' && response ? CORAL : SKY} transparent opacity={offering==='video' && variant==='intruder' ? .065 : .018} depthWrite={false} /></mesh>
    <mesh position={[9.5,.045,-2]}><boxGeometry args={[5.2,.016,.035]} /><meshBasicMaterial color={offering==='video' && variant==='intruder' && response ? CORAL : '#6b97a5'} transparent opacity={.7} /></mesh>
    {offering==='smart' && active && <FloorRing at={variant==='hvac' ? [-9,.1,-6] : variant==='cooler' ? [0,.1,-7.6] : [-14.6,.1,-1.5]} radius={variant==='cooler' ? 2.4 : 1.8} color={response ? AMBER : SKY} />}
    {offering==='eagle' && active && <FloorRing at={variant==='fiber' ? [14.6,.1,-6] : variant==='5g' ? [14.6,.1,1.4] : variant==='it' ? [10,.1,-6] : variant==='ot' ? [-7.55,.1,-6] : [7,1.12,-3]} radius={1.5} color={response ? AMBER : CORAL} />}
  </>;
}

function equipmentSpots(offering: OfferingId, variant: string, active: boolean): Hotspot[] {
  if(offering==='automation')return [
    {id:'auto-wifi',label:'Matter · Wi-Fi',at:[-11.25,1.5,-1.35],color:SKY},
    {id:'auto-thread',label:'Matter · Thread',at:[-10.2,1.5,-1.35],color:TEAL},
    {id:'auto-shelly',label:'Shelly · MQTT / Wi-Fi',at:[-9.1,1.5,-1.35],color:AMBER},
    {id:'auto-presence',label:'Zigbee · presence',at:[-10.15,2.9,-.95],color:VIOLET},
    {id:'auto-controller',label:'Close routine',at:[-10.2,2.1,-1.35],color:TEAL},
  ];
  if (offering==='routing') return [
    {id:'route-front-desk',label:'Front desk · Teams',at:[8,1.95,4.5],color:VIOLET},
    {id:'route-meeting-room',label:'Meeting room · VoIP',at:[8,1.55,7],color:SKY},
    {id:'route-back-office',label:'Back office · surveillance',at:[10,1.9,-5.39],color:AMBER},
    {id:'route-console',label:'Application patchboard',at:[7.1,1.5,.25],color:TEAL},
  ];
  if (offering==='twin') {
    // Internal-part labels belong to the magnified twin, not empty space around
    // the installed closed appliance. Keep its real interface identifiable.
    return [{id:'ports',label:'Gateway · LAN 1',at:[6.48,1.45,-2.55],color:AMBER}];
  }
  const ids=offering==='video'?(variant==='intruder'?['camera-back','analytics','person','zone']:variant==='crowd'?['camera','analytics','crowd']:['camera','analytics','person']):INSPECT[offering];
  return ids.map(id => {
    const part = PARTS.find(item=>item.id===id);
    const fallback: Vec = id==='zone' ? [9.5,.2,-4.5] : id==='crowd' ? [-1,2.25,7] : variant==='intruder' ? active ? [9.8,2.1,-4.2] : [9.8,2.1,.7] : [.2,active && variant==='man-down' ? .7 : 2.1,6];
    const label=id==='person' && variant==='intruder'?'Person':id==='camera-back'?'Camera':NAMES[id]||id;
    return { id:id==='camera-back'?'camera':id, label, at: part ? [part.at[0],part.at[1]+part.size*.9+.25,part.at[2]] as Vec : fallback, color: id==='5g' || id==='camera' ? VIOLET : id==='energy' ? AMBER : SKY };
  });
}
function CameraRig({ focusTarget, offering, variant, focused, inspection, reset, rotation, zoom, reduced, followStory, timeRef, onCameraInteraction }: { focusTarget:RefObject<Vector3>; offering: OfferingId; variant:string; focused: boolean; inspection: boolean; reset: number; rotation: number; zoom: number; reduced: boolean;followStory:boolean;timeRef:RefObject<number>;onCameraInteraction?:()=>void }) {
  const { camera, gl, size, invalidate } = useThree();
  const controls = useRef<OrbitControls|null>(null),flight = useRef<{ eye:Vector3; target:Vector3 }|null>(null),initial = useRef(true);
  const dragTakeover=useRef(false),following=useRef(followStory);
  useEffect(()=>{following.current=followStory;},[followStory]);
  useLayoutEffect(()=>{const orbit=createOrbit(camera,gl,()=>invalidate());orbit.addEventListener('start',()=>{flight.current=null;dragTakeover.current=following.current;onCameraInteraction?.();});controls.current=orbit;return()=>{orbit.dispose();controls.current=null;};},[camera,gl,invalidate,onCameraInteraction]);
  const targetKey=inspection?'inspection':focused?offering:'whole';
  const focusVariant=focused||inspection?variant:'';
  useLayoutEffect(()=>{
    const orbit=controls.current;if(!orbit || !(camera instanceof PerspectiveCamera)||followStory)return;
    if(dragTakeover.current){dragTakeover.current=false;initial.current=false;invalidate();return;}
    let region=targetKey==='inspection'?{target:[0,focusVariant==='exploded'?1.5:1.2,0] as Vec,span:focusVariant==='exploded'?5.6:3.8}:targetKey==='whole'?{target:[0,-1.2,.4] as Vec,span:39}:FOCUS[targetKey];
    if(targetKey==='video'&&focusVariant==='intruder')region={target:[9.5,1,-3.8],span:11};
    if(targetKey==='smart')region=focusVariant==='hvac'?{target:[-8.6,1,-6.2],span:12}:focusVariant==='cooler'?{target:[0,1,-6.7],span:10}:{target:[-10.5,1,-3.5],span:15};
    const target=new Vector3(...region.target);
    const aspect=size.width/Math.max(size.height,1),scale=Math.max(1,(inspection?.65:1.45)/Math.max(aspect,.35));
    const distance=(targetKey==='whole'?42:region.span*1.5)*scale/zoom;
    const direction=new Vector3(.61,inspection?.38:.67,.92).normalize().applyAxisAngle(new Vector3(0,1,0),rotation*Math.PI/180);
    const eye=target.clone().addScaledVector(direction,distance);
    if(initial.current||reduced){camera.position.copy(eye);orbit.target.copy(target);orbit.update();initial.current=false;flight.current=null;}
    else flight.current={eye,target};
    invalidate();
  },[camera,size,targetKey,focusVariant,inspection,reset,rotation,zoom,reduced,followStory,invalidate]);
  useFrame((_,delta)=>{
    const orbit=controls.current;if(!orbit)return;
    orbit.minPolarAngle=inspection?.05:.32;orbit.maxPolarAngle=inspection?Math.PI-.05:1.38;
    if(followStory){
      orbit.minDistance=.35;
      orbit.maxPolarAngle=offering==='automation'?2.2:1.38;
      const time=timeRef.current,aspect=size.width/Math.max(size.height,1);
      const shot=portraitStoryCamera({offering,variant},time,aspect,sampleStoryCamera({offering,variant},time)),target=new Vector3(...shot.target);
      const readingLaptop=offering==='twin'&&((time>=4&&time<9)||(time>=20&&time<=22));
      const frameWidth=readingLaptop?.95:shot.distance<3?.65:1.25;
      const distance=shot.distance*Math.max(1,frameWidth/Math.max(aspect,.4));
      const azimuth=.586+shot.yaw,direction=new Vector3(Math.sin(azimuth)*Math.cos(shot.pitch),Math.sin(shot.pitch),Math.cos(azimuth)*Math.cos(shot.pitch));
      camera.position.copy(target).addScaledVector(direction,distance);orbit.target.copy(target);orbit.update();focusTarget.current.copy(target);flight.current=null;return;
    }
    focusTarget.current.copy(orbit.target);orbit.minDistance=inspection?2:3;const target=flight.current;if(!target)return;
    const ease=1-Math.exp(-9*Math.min(delta,.05));camera.position.lerp(target.eye,ease);orbit.target.lerp(target.target,ease);orbit.update();
    if(camera.position.distanceTo(target.eye)<.003){camera.position.copy(target.eye);orbit.target.copy(target.target);orbit.update();flight.current=null;}else invalidate();
  });
  if(inspection)return <>
    <color attach="background" args={['#344454']} />
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.025,0]} receiveShadow><planeGeometry args={[200,200]}/><meshStandardMaterial color="#344454" roughness={.82} metalness={.05}/></mesh>
  </>;
  return <>
    <color attach="background" args={['#192e29']} /><fog attach="fog" args={['#192e29',72,145]} />
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.36,0]}><planeGeometry args={[250,250]} /><meshBasicMaterial color="#192e29" toneMapped={false} /></mesh>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.355,0]} receiveShadow><planeGeometry args={[250,250]} /><shadowMaterial transparent opacity={.28}/></mesh>
  </>;
}
function ProjectHotspots({ spots, refs }: { spots: Hotspot[]; refs: RefObject<Map<string,HTMLButtonElement>> }) {
  const { camera,size }=useThree();const point=useMemo(()=>new Vector3(),[]);
  useFrame(()=>{
    camera.updateMatrixWorld();
    const occupied: {l:number;t:number;r:number;b:number}[]=[];
    for(const spot of spots){
      const button=refs.current.get(spot.id);if(!button)continue;point.set(...spot.at).project(camera);
      const w=button.offsetWidth || 110,h=button.offsetHeight || 30;
      let x=(point.x*.5+.5)*size.width,y=(-point.y*.5+.5)*size.height-16;
      x=Math.max(w/2+8,Math.min(size.width-w/2-8,x));y=Math.max(52+h,Math.min(size.height-70,y));
      for(let attempt=0;attempt<6;attempt++){
        const box={l:x-w/2-4,r:x+w/2+4,t:y-h-4,b:y+4};
        if(!occupied.some(b=>box.l<b.r&&box.r>b.l&&box.t<b.b&&box.b>b.t)){occupied.push(box);break;}
        y-=h+7;if(y<h+50){y+=2*(h+7);x=Math.max(w/2+8,Math.min(size.width-w/2-8,x+w*.65));}
      }
      button.style.left=`${x}px`;button.style.top=`${y}px`;button.style.opacity=point.z<1?'1':'0';
    }
  });return null;
}
function Ready({ onReady }: { onReady:()=>void }) {
  const invalidate=useThree(state=>state.invalidate);
  useEffect(()=>{onReady();const frame=requestAnimationFrame(()=>invalidate());return()=>cancelAnimationFrame(frame);},[onReady,invalidate]);return null;
}
function StoryRevision({revision}:{revision:number}){const invalidate=useThree(state=>state.invalidate);useEffect(()=>invalidate(),[revision,invalidate]);return null;}

export default function OfferingSceneStore(props: OfferingSceneProps) {
  const {offering,variant,active,paused,selected,onSelect,onOfferingSelect,phase=3,timeRef,revision=0,followStory=false,onCameraInteraction,onReady,finished=false,onTogglePlayback,onSeek,onReplay}=props;
  const [ready,setReady]=useState(false),[focused,setFocused]=useState(false),[reset,setReset]=useState(0),[rotation,setRotation]=useState(0),[zoom,setZoom]=useState(1),[expanded,setExpanded]=useState(false),[fullscreenError,setFullscreenError]=useState('');
  const [inspectTwin,setInspectTwin]=useState(false);
  const inspection=inspectTwin&&offering==='twin';
  const [visible,setVisible]=useState(!document.hidden),host=useRef<HTMLDivElement>(null),refs=useRef(new Map<string,HTMLButtonElement>());
  const fallbackClock=useRef(0),clock=timeRef??fallbackClock;
  const annotations=useRef<StoryAnnotationNodes>({labels:new Map(),caption:new Map(),route:new Map()});
  useEffect(()=>{if(!timeRef)fallbackClock.current=[0,7.5,14,22][phase];},[timeRef,phase]);
  const context=useMemo(()=>({offering,variant}),[offering,variant]);
  const focusTarget=useRef(new Vector3(7,1.8,-3));
  const lightLevel=()=>storeLightLevel(context);
  const reduced=useReducedMotion(),response=active&&phase>=2,moving=!paused&&!reduced&&visible;
  const markReady=useCallback(()=>{setReady(true);onReady?.();},[onReady]);

  const spots=useMemo(()=>focused?equipmentSpots(offering,variant,active):SERVICE_SPOTS,[focused,offering,variant,active]);
  useEffect(()=>{
    let inView=true;const update=()=>setVisible(inView&&!document.hidden),observer=new IntersectionObserver(entries=>{inView=entries[entries.length-1]?.isIntersecting??false;update();});
    if(host.current)observer.observe(host.current);document.addEventListener('visibilitychange',update);
    const fullscreen=()=>setExpanded(document.fullscreenElement===host.current);document.addEventListener('fullscreenchange',fullscreen);
    return()=>{observer.disconnect();document.removeEventListener('visibilitychange',update);document.removeEventListener('fullscreenchange',fullscreen);};
  },[]);
  const resetView=()=>{onCameraInteraction?.();setFocused(false);setZoom(1);setRotation(0);setReset(v=>v+1);};
  const toggleExpanded=async()=>{try{setFullscreenError('');if(document.fullscreenElement)await document.exitFullscreen();else await host.current?.requestFullscreen();}catch{setFullscreenError('Fullscreen is unavailable in this browser.');}};
  return <div className="offering-scene offering-store-scene" ref={host} data-offering={offering} data-scenario-active={active} data-scene-view={inspection?'inspection':followStory?'story':focused?'focus':'whole'}>
    <div className="offering-store-viewport">
    {!ready&&<div className="offering-scene-loading" role="status"><span/>Preparing the enterprise…</div>}
    <OfferingCinematicCanvas className="offering-render-surface" focusTarget={focusTarget} lightLevel={lightLevel} cinematic={followStory&&!inspection} inspection={inspection} frameloop={moving?'always':'demand'} resize={{offsetSize:true}} events={sceneEvents} camera={{position:[30,32,42],fov:40,near:.1,far:250}}
      tabIndex={0} role="group" aria-label="Connected enterprise store. All seven offerings share this building. Drag to orbit; use left and right arrow keys to rotate, plus and minus to zoom, or Home to reset."
      onKeyDown={event=>{if(event.target instanceof HTMLButtonElement)return;if(!['ArrowLeft','ArrowRight','+','=','-','Home'].includes(event.key))return;event.preventDefault();onCameraInteraction?.();if(event.key==='Home')resetView();else if(event.key==='ArrowLeft'||event.key==='ArrowRight')setRotation(v=>v+(event.key==='ArrowLeft'?-20:20));else setZoom(v=>Math.max(.65,Math.min(2.1,v+(event.key==='-'?-.15:.15))));}}>
      <CameraRig focusTarget={focusTarget} offering={offering} variant={variant} focused={focused} inspection={inspection} reset={reset} rotation={rotation} zoom={zoom} reduced={reduced} followStory={followStory&&!inspection} timeRef={clock} onCameraInteraction={onCameraInteraction}/>
      <StoryRevision revision={revision}/>
      <Suspense fallback={null}>
        {inspection ? <Equipment spec={{id:'gateway',model:'GatewayTwin',at:[0,0,0],size:2.4,yaw:-Math.PI/2+.3}} exploded={variant==='exploded'} inspection onSelect={onSelect} context={context} timeRef={clock}/> : <>
        <Architecture context={context} timeRef={clock}/>
        <OfferingContactGrounding context={context} timeRef={clock}/>
        {PARTS.filter(spec=>(offering!=='routing'||!['pos','voice'].includes(spec.id))&&(offering!=='automation'||!['sensor','thermostat','lock','light'].includes(spec.id))).map(spec=><Equipment key={spec.id} spec={spec} exploded={false} onSelect={onSelect} context={context} timeRef={clock}/>)}
        {offering==='automation'&&<OfferingAutomationVisual timeRef={clock} variant={variant} onSelect={onSelect}/>}
        {offering==='twin'&&<OfferingTwinWorkstation timeRef={clock} variant={variant} onSelect={onSelect}/>}
        {offering==='routing'&&<OfferingRoutingVisual timeRef={clock} variant={variant} onSelect={onSelect}/>}
        {offering==='eagle'&&<OfferingEagleConsole timeRef={clock} variant={variant} onSelect={onSelect}/>}
        {offering==='smart'&&<OfferingSmartVisual timeRef={clock} variant={variant} onSelect={onSelect}/>}
        <OfferingConnections context={context} active={active} response={response} timeRef={clock}/>
        <OfferingStoryEffects offering={offering} variant={variant} timeRef={clock} onSelect={onSelect}/>
        <OfferingStoryAnnotationSync context={context} timeRef={clock} nodes={annotations} visible={ready&&!inspection&&(followStory||focused)} film={followStory}/>
        <PracticalDetails offering={offering} variant={variant} active={active} response={response} timeRef={clock}/>
        <ProjectHotspots spots={spots} refs={refs}/></>}<Ready onReady={markReady}/>
      </Suspense>
    </OfferingCinematicCanvas>
    <OfferingStoryAnnotationLayer nodes={annotations} visible={ready&&!inspection&&(followStory||focused)} film={followStory}/>
    {ready&&!inspection&&!followStory&&<div className="offering-connection-key" aria-label="Connection legend"><span><i/>Cable</span><span><i className="is-radio"/>Radio link</span></div>}
    {ready&&!inspection&&!followStory&&<div className="offering-scene-hotspots" aria-label={focused?'Inspect equipment':'Seven connected offerings'}>
      {spots.map(spot=><button type="button" key={spot.id} ref={node=>{if(node)refs.current.set(spot.id,node);else refs.current.delete(spot.id);}}
        className={`offering-scene-hotspot${(focused?selected===spot.id:offering===spot.id)?' is-selected':''}${spot.number?' is-service':''}`}
        style={{'--hotspot-color':spot.color} as CSSProperties} aria-label={focused?`Inspect ${spot.label}`:`Explore ${spot.number}. ${spot.label}`} aria-pressed={focused?selected===spot.id:offering===spot.id}
        onClick={()=>focused?onSelect(spot.id):onOfferingSelect?.(spot.id as OfferingId)}>
        {spot.number?<b>{spot.number}</b>:<i aria-hidden="true"/>}<span>{spot.label}</span>
      </button>)}
    </div>}
    {ready&&offering==='twin'&&<div className="offering-twin-inspector">
      <button type="button" onClick={()=>{onCameraInteraction?.();setInspectTwin(value=>!value);setZoom(1);setRotation(0);setReset(value=>value+1);}} aria-pressed={inspection}>
        <RotateCw size={15}/>{inspection?'Back to store':'Inspect gateway · 360°'}
      </button>
      {inspection&&<div><strong>Gemtek OSPv2 gateway</strong><span>Drag to rotate 360° · Scroll to zoom</span></div>}
    </div>}
    </div>
    <div className="offering-store-controls" aria-label="Enterprise view" onClick={event=>{const title=(event.target as HTMLElement).closest('button')?.getAttribute('title');if(title!=='Expand enterprise'&&title!=='Exit fullscreen')onCameraInteraction?.();}}>
      <div className="offering-store-control-group"><button type="button" aria-pressed={!inspection&&!followStory&&!focused} onClick={()=>{setInspectTwin(false);setFocused(false);setZoom(1);setReset(value=>value+1);}} title="Whole store"><Store size={15}/><span>Whole store</span></button><button type="button" aria-pressed={!inspection&&!followStory&&focused} onClick={()=>{setInspectTwin(false);setFocused(true);setZoom(1);setReset(value=>value+1);}} title="Focus selected area"><Focus size={15}/><span>Focus</span></button></div>
      <div className="offering-store-control-group"><button type="button" aria-label="Rotate left" title="Rotate left" onClick={()=>setRotation(v=>v-25)}><RotateCcw size={15}/></button><button type="button" aria-label="Rotate right" title="Rotate right" onClick={()=>setRotation(v=>v+25)}><RotateCw size={15}/></button><button type="button" aria-label="Zoom out" title="Zoom out" disabled={zoom<=.65} onClick={()=>setZoom(v=>Math.max(.65,v-.15))}><ZoomOut size={15}/></button><button type="button" aria-label="Zoom in" title="Zoom in" disabled={zoom>=2.1} onClick={()=>setZoom(v=>Math.min(2.1,v+.15))}><ZoomIn size={15}/></button></div>
      <div className="offering-store-control-group"><button type="button" aria-label="Reset scene camera" title="Reset view" onClick={resetView}><Scan size={15}/></button><button type="button" aria-label={expanded?'Exit fullscreen':'Expand enterprise'} title={expanded?'Exit fullscreen':'Expand enterprise'} onClick={()=>void toggleExpanded()}>{expanded?<Minimize size={15}/>:<Expand size={15}/>}</button></div>
    </div>
    {expanded&&!inspection&&<>
      <div className="offering-cinema-heading"><strong>A working day at the connected store</strong><span>Illustrative story · {STORY_PLAYBACK_SECONDS} seconds</span></div>
      <OfferingCinemaControls timeRef={clock} paused={paused} finished={finished} reduced={reduced} revision={revision} onToggle={onTogglePlayback} onSeek={onSeek} onReplay={onReplay}/>
    </>}
    {fullscreenError&&<p className="offering-scene-error" role="status">{fullscreenError}</p>}
  </div>;
}
