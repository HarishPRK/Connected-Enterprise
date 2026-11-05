import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Canvas, events, useFrame, useLoader, useThree, type RootState, type ThreeEvent } from '@react-three/fiber';
import { AgXToneMapping, Box3, CatmullRomCurve3, Group, Mesh, MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera, PMREMGenerator, Vector3, type Camera, type Object3D, type Scene, type WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Expand, Focus, Minimize, RotateCcw, RotateCw, Scan, Store, ZoomIn, ZoomOut } from 'lucide-react';
import kitUrl from '../../assets/offerings/offerings-kit.glb?url';
import storeUrl from '../../assets/offerings/enterprise-store.glb?url';
import type { OfferingId, OfferingSceneProps } from './OfferingScene';
import './OfferingScene.css';
import OfferingStoryEffects from './OfferingStoryEffects';
import { sampleStoryCamera, storyProgress, type StoryContext } from './OfferingStoryMotion';
import { OfferingStudioLighting, OfferingContactGrounding } from './OfferingStudioLighting';
import { storeLightLevel } from './offeringLighting';
import { OfferingStoryAnnotationLayer, OfferingStoryAnnotationSync, type StoryAnnotationNodes } from './OfferingStoryAnnotations';

type Vec = [number, number, number];
interface EquipmentSpec { id: string; model: string; at: Vec; size: number; yaw?: number; }
interface Hotspot { id: string; label: string; at: Vec; color: string; number?: string; }
interface CircuitSpec { id: string; points: Vec[]; color: string; lit: boolean; failed?: boolean; }
const SKY = '#68d6ff', TEAL = '#8ce3c6', VIOLET = '#b4a5ff', AMBER = '#ffc885', CORAL = '#ff897a';
// One permanent floor plan. Selecting a service changes its story and signals,
// while the store, equipment and all other service areas stay in place.
const PARTS: EquipmentSpec[] = [
  { id: 'hvac', model: 'HVAC', at: [-9, .05, -6], size: 2.65 },
  { id: 'cooler', model: 'Cooler', at: [-1.35, .03, -7.6], size: 3.05 },
  { id: 'cooler-right', model: 'Cooler', at: [1.25, .03, -7.6], size: 3.05 },
  { id: 'energy', model: 'SolarPanel', at: [-14.6, .03, -1.5], size: 3.45, yaw: .15 },
  { id: 'meter', model: 'Meter', at: [-9.1, 1.35, -9.35], size: .82 },
  { id: 'it', model: 'ServerRack', at: [10, .04, -6], size: 3.1 },
  { id: 'gateway', model: 'Gateway', at: [6.7, 1.1, -3], size: 2 },
  { id: 'it-laptop', model: 'Laptop', at: [8.2, 1.1, -3], size: .6 },
  { id: 'fiber', model: 'FiberTerminal', at: [14.6, .04, -6], size: 2.05 },
  { id: '5g', model: 'CellularTower', at: [14.6, .04, 1.4], size: 5.15 },
  { id: 'sensor', model: 'Sensor', at: [-11.2, 1.55, -1.13], size: .67 },
  { id: 'thermostat', model: 'Thermostat', at: [-9.6, 1.5, -1.13], size: .74 },
  { id: 'lock', model: 'Lock', at: [-8.55, .9, -1.13], size: 1.05 },
  { id: 'light', model: 'Light', at: [-10.5, .03, 1.6], size: 2.5 },
  { id: 'ot', model: 'Sensor', at: [-7.55, 1.05, -6], size: .48, yaw: .6 },
  { id: 'pos', model: 'Laptop', at: [8, 1.15, 4.5], size: .75 },
  { id: 'voice', model: 'DeskPhone', at: [8, 1.15, 7], size: .5 },
  { id: 'camera', model: 'Camera', at: [4.8, 3.65, 7.9], size: .92, yaw: -.6 },
  { id: 'camera-back', model: 'Camera', at: [11.4, 3.6, -2.1], size: .85, yaw: -.85 },
];
const SERVICE_SPOTS: (Hotspot & { id: OfferingId })[] = [
  { id: 'failover', label: 'Dynamic Failover', number: '01', at: [14.1, 5.8, -.6], color: SKY },
  { id: 'routing', label: 'Application routing', number: '02', at: [8, 2.6, 6.4], color: TEAL },
  { id: 'twin', label: 'CPE digital twin', number: '03', at: [6.2, 3.65, -2.2], color: VIOLET },
  { id: 'eagle', label: 'EA:GLE', number: '04', at: [10.1, 4.6, -7.5], color: SKY },
  { id: 'automation', label: 'Device automation', number: '05', at: [-10.5, 3.35, .25], color: VIOLET },
  { id: 'smart', label: 'Smart services', number: '06', at: [-5, 4.2, -7.9], color: AMBER },
  { id: 'video', label: 'Video analytics', number: '07', at: [.6, 2.55, 6.7], color: TEAL },
];
const FOCUS: Record<OfferingId, { target: Vec; span: number }> = {
  failover: { target: [10.8, 1.5, -2.2], span: 14 }, routing: { target: [7.1, .8, 4.7], span: 11.5 },
  twin: { target: [6.7, 2.1, -3], span: 7.8 }, eagle: { target: [7.8, 1, -4.8], span: 14.5 },
  automation: { target: [-9.9, .9, .15], span: 9.5 }, smart: { target: [-5.7, 1, -6.5], span: 18 },
  video: { target: [2.2, .6, 6.1], span: 15 },
};
const INSPECT: Record<OfferingId, string[]> = {
  failover: ['fiber', '5g', 'gateway', 'pos'], routing: ['pos', 'voice', 'camera', 'gateway', 'fiber', '5g'],
  twin: ['housing', 'board', 'heatsink', 'ports', 'antennae'], eagle: ['gateway', 'fiber', '5g', 'it', 'ot'],
  automation: ['sensor', 'thermostat', 'lock', 'light', 'gateway'], smart: ['hvac', 'cooler', 'energy', 'meter'],
  video: ['camera', 'person', 'zone', 'crowd'],
};
const NAMES: Record<string, string> = { hvac: 'HVAC', cooler: 'Coolers', energy: 'Solar & energy', meter: 'Energy meter', it: 'IT devices', gateway: 'Shared edge CPE', fiber: 'Fiber', '5g': '5G', sensor: 'Occupancy sensor', thermostat: 'Thermostat', lock: 'Access control', light: 'Lighting', ot: 'OT sensor', pos: 'POS', voice: 'Voice', camera: 'Camera', person: 'Man-down', zone: 'Restricted zone', crowd: 'Crowd monitoring' };

// Three owns these mutable resources; imperative updates stay outside render.
function setCursor(renderer: WebGLRenderer, cursor: string) { renderer.domElement.style.cursor = cursor; }
function dimLamp(material:MeshStandardMaterial,amount:number){material.color.setRGB(.12+amount*.65,.14+amount*.62,.16+amount*.48);material.emissive.setRGB(amount*.8,amount*.62,amount*.3);material.emissiveIntensity=.65;}
function environmentStudio(renderer: WebGLRenderer, scene: Scene) {
  const environment = new RoomEnvironment();
  const pmrem = new PMREMGenerator(renderer), texture = pmrem.fromScene(environment, .04);
  scene.environment = texture.texture; scene.environmentIntensity = .3;
  pmrem.dispose(); environment.dispose();
  return () => { scene.environment = null; texture.dispose(); };
}
function createOrbit(camera: Camera, renderer: WebGLRenderer, requestFrame: () => void) {
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enablePan = false; orbit.enableZoom = true; orbit.enableDamping = false;
  orbit.rotateSpeed = .45; orbit.zoomSpeed = .6; orbit.minDistance = 6; orbit.maxDistance = 110;
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
function cloneModel(source: Object3D, size?: number) {
  const copy = source.clone(true), wrapper = new Group();
  if (size) {
    const bounds = new Box3().setFromObject(copy), dims = bounds.getSize(new Vector3()), center = bounds.getCenter(new Vector3());
    copy.position.x -= center.x; copy.position.z -= center.z; copy.position.y -= bounds.min.y;
    wrapper.scale.setScalar(size / Math.max(dims.x, dims.y, dims.z));
  }
  copy.traverse(obj => { if (obj instanceof Mesh) { obj.castShadow = true; obj.receiveShadow = true; } });
  wrapper.add(copy); return wrapper;
}
function Architecture({ context, timeRef }: { context: StoryContext; timeRef: RefObject<number> }) {
  const gltf = useLoader(GLTFLoader, storeUrl);
  const { gl } = useThree();
  const model = useMemo(() => {
    const copy=cloneModel(gltf.scene);
    // Adjacent coplanar tile pieces receive equipment shadows but should not
    // cast shadow-map silhouettes onto one another.
    copy.getObjectByName('FloorShell')?.traverse(object=>{if(object instanceof Mesh)object.castShadow=false;});
    copy.traverse(object=>{if(object instanceof Mesh)(Array.isArray(object.material)?object.material:[object.material]).forEach(material=>{if(material instanceof MeshStandardMaterial&&material.map)material.map.anisotropy=Math.min(8,gl.capabilities.getMaxAnisotropy());});});
    copy.getObjectByName('LightingRig')?.traverse(object=>{if(object instanceof Mesh)object.material=Array.isArray(object.material)?object.material.map(material=>material.clone()):object.material.clone();});
    return copy;
  }, [gltf,gl]);
  const diffusers=useMemo(()=>{const materials:MeshStandardMaterial[]=[];model.getObjectByName('LightingRig')?.traverse(object=>{if(object instanceof Mesh)(Array.isArray(object.material)?object.material:[object.material]).forEach(material=>{if(material instanceof MeshStandardMaterial&&material.emissiveIntensity>0)materials.push(material);});});return materials;},[model]);
  useFrame(()=>{const level=storeLightLevel(context,timeRef.current);diffusers.forEach(material=>{material.emissiveIntensity=.12+level*1.6;});});
  useEffect(()=>()=>{model.getObjectByName('LightingRig')?.traverse(object=>{if(object instanceof Mesh)(Array.isArray(object.material)?object.material:[object.material]).forEach(material=>material.dispose());});},[model]);
  return <primitive object={model} dispose={null} />;
}
function Equipment({ spec, exploded = false, onSelect, context, timeRef }: { spec: EquipmentSpec; exploded?: boolean; onSelect: (id: string) => void; context:StoryContext; timeRef:RefObject<number> }) {
  const gltf = useLoader(GLTFLoader, kitUrl), { gl, invalidate } = useThree();
  const model = useMemo(() => {
    const source = gltf.scene.getObjectByName(spec.model);
    if (!source) throw new Error(`Missing offering model ${spec.model}`);
    const copy=cloneModel(source,spec.size);
    if(spec.model==='Light')copy.traverse(object=>{if(object instanceof Mesh)object.material=Array.isArray(object.material)?object.material.map(material=>material.clone()):object.material.clone();});
    return copy;
  }, [gltf, spec.model, spec.size]);
  const animated=useMemo(()=>{
    const moves:Record<string,Vec>={GatewayHousing:[0,.62,0],GatewayBoard:[0,.12,0],GatewayHeatsink:[0,1.28,0],GatewayPorts:[0,0,.48],GatewayAntennae:[0,.78,-.12]};
    const bulbs:MeshStandardMaterial[]=[];if(spec.model==='Light')model.traverse(object=>{if(object instanceof Mesh)(Array.isArray(object.material)?object.material:[object.material]).forEach(material=>{if(material instanceof MeshStandardMaterial&&material.name==='Display and markings')bulbs.push(material);});});
    return {parts:Object.entries(moves).map(([name,move])=>{const object=model.getObjectByName(name);return object?{object,origin:object.position.clone(),move}:null;}).filter(item=>item!==null),fan:model.getObjectByName('HVACFan'),door:model.getObjectByName('CoolerLeftDoor'),bulbs};
  },[model,spec.model]);
  useEffect(()=>()=>{if(spec.model==='Light')model.traverse(object=>{if(object instanceof Mesh)(Array.isArray(object.material)?object.material:[object.material]).forEach(material=>material.dispose());});},[model,spec.model]);
  useFrame(()=>{
    const t=timeRef.current,amount=exploded?storyProgress(t,3,9):0;
    for(const part of animated.parts){part.object.position.copy(part.origin);part.object.position.addScaledVector(new Vector3(...part.move),amount);}
    if(animated.fan){const irregular=context.offering==='smart'&&context.variant==='hvac'&&t>=4;animated.fan.rotation.set(0,0,t*(irregular?2.1:6)+ (irregular?Math.sin(t*19)*.12:0));}
    if(animated.door)animated.door.rotation.set(0,context.offering==='smart'&&context.variant==='cooler'?-.55*storyProgress(t,2,5)*(1-storyProgress(t,21,24)):0,0);
    if(animated.bulbs.length){const amount=context.offering==='automation'?(context.variant==='after-hours'?1-storyProgress(t,11,15):storyProgress(t,11,15)):.75;animated.bulbs.forEach(material=>dimLamp(material,amount));}
  });
  useEffect(()=>invalidate(),[context,exploded,invalidate]);
  useEffect(() => () => setCursor(gl, ''), [gl]);
  const choose = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation(); if (event.delta >= 5) return;
    if (spec.model === 'Gateway' && exploded) {
      const targets: Record<string, string> = { GatewayHousing: 'housing', GatewayBoard: 'board', GatewayHeatsink: 'heatsink', GatewayPorts: 'ports', GatewayAntennae: 'antennae' };
      let node = event.object; while (node.parent) { if (targets[node.name]) { onSelect(targets[node.name]); return; } node = node.parent; }
    }
    onSelect(spec.id === 'cooler-right' ? 'cooler' : spec.id === 'it-laptop' ? 'it' : spec.id === 'camera-back' ? 'camera' : spec.id);
  };
  return <group position={spec.at} rotation={[0, spec.yaw || 0, 0]}>
    <primitive object={model} dispose={null} onClick={choose} onPointerOver={(event: ThreeEvent<PointerEvent>) => { event.stopPropagation(); setCursor(gl, 'pointer'); }} onPointerOut={() => setCursor(gl, '')} />
  </group>;
}

function makeCircuits(offering: OfferingId, variant: string, active: boolean, response: boolean): CircuitSpec[] {
  const start: Vec = [7, 1.35, -2.45], floor: Vec = [7, .12, -1.9];
  const fiberDown = offering === 'failover' && active && variant === 'fiber';
  const cellDown = offering === 'failover' && active && variant === '5g';
  const cellPolicy = offering === 'routing' && response && variant !== 'video';
  const pathColor = fiberDown && response || cellPolicy ? VIOLET : SKY;
  const routes: CircuitSpec[] = [
    { id: 'fiber', points: [start, floor, [11.8,.12,-1.9], [11.8,.12,-6], [14.6,.12,-6]], color: fiberDown ? CORAL : SKY, lit: offering === 'failover' ? !fiberDown : offering === 'routing' ? !cellPolicy : offering === 'eagle' && variant === 'fiber', failed: fiberDown },
    { id: '5g', points: [start, floor, [12,.12,-1.5], [12,.12,1.4], [14.6,.12,1.4]], color: cellDown ? CORAL : VIOLET, lit: offering === 'failover' && fiberDown && response || cellPolicy || offering === 'eagle' && variant === '5g', failed: cellDown },
    { id: 'pos', points: [start, floor, [11.3,.12,-1.9], [11.3,.12,4.5], [8,.12,4.5], [8,1.25,4.5]], color: pathColor, lit: offering === 'routing' || offering === 'failover' && (!fiberDown || response) },
    { id: 'voice', points: [start, floor, [11.1,.12,-1.7], [11.1,.12,7], [8,.12,7], [8,1.25,7]], color: TEAL, lit: offering === 'routing' },
    { id: 'camera', points: [start, floor, [11.5,.12,-1.7], [11.5,.12,8.1], [4.8,.12,8.1], [4.8,3.6,7.9]], color: VIOLET, lit: offering === 'video' || offering === 'routing' },
    { id: 'it', points: [start, [7,.12,-4.55], [10,.12,-4.55], [10,.12,-6]], color: SKY, lit: offering === 'eagle' && ['gateway','it'].includes(variant) },
    { id: 'sensor', points: [start, [7,.12,-4.35], [-7.7,.12,-4.35], [-7.7,.12,-.5], [-11.2,.12,-.5], [-11.2,1.65,-1.1]], color: response && offering === 'automation' ? TEAL : VIOLET, lit: offering === 'automation' && response || offering === 'eagle' && ['gateway','ot'].includes(variant) },
    { id: 'hvac', points: [start, [7,.12,-4.75], [-9,.12,-4.75], [-9,.12,-6]], color: SKY, lit: offering === 'smart' && variant === 'hvac' },
    { id: 'cooler', points: [start, [7,.12,-4.95], [0,.12,-4.95], [0,.12,-7.6]], color: TEAL, lit: offering === 'smart' && variant === 'cooler' },
    { id: 'energy', points: [start, [7,.12,-5.1], [-12.3,.12,-5.1], [-14.6,.12,-1.5]], color: AMBER, lit: offering === 'smart' && variant === 'energy' },
    { id: 'thermostat', points: [[-11.2,1.65,-1.1], [-9.6,1.65,-1.1]], color: variant==='after-hours'?VIOLET:TEAL, lit: offering==='automation'&&response },
    { id: 'lock', points: [[-9.6,1.65,-1.1], [-8.55,1.65,-1.1]], color: variant==='after-hours'?VIOLET:TEAL, lit: offering==='automation'&&response },
    { id: 'light', points: [[-11.2,1.65,-1.1], [-11.2,.12,-.65], [-10.5,.12,1.6]], color: variant==='after-hours'?VIOLET:TEAL, lit: offering==='automation'&&response },
  ];
  if (offering === 'eagle' && active) for (const route of routes) if (route.id === (variant==='ot'?'sensor':variant) || variant === 'gateway') { route.failed = true; route.color = CORAL; }
  return routes;
}
function Circuit({ spec, timeRef, context }: { spec: CircuitSpec; timeRef:RefObject<number>;context:StoryContext }) {
  const packets=useRef<Group>(null);
  const curve = useMemo(() => new CatmullRomCurve3(spec.points.map(p => new Vector3(...p)), false, 'centripetal', .1), [spec]);
  const point = useMemo(() => new Vector3(), []);
  const broken=useMemo(()=>{const points=curve.getPoints(70);return [new CatmullRomCurve3(points.slice(0,31)),new CatmullRomCurve3(points.slice(40))];},[curve]);
  useFrame(()=>{
    if(!packets.current)return;const t=timeRef.current,blocked=context.offering==='routing'&&t>=4&&t<10&&spec.id===(context.variant==='video'?'camera':context.variant);
    packets.current.children.forEach((packet,index)=>{let progress=(t*.2+index*.24)%1;if(spec.failed||blocked)progress=Math.min(.43-index*.055,.13+storyProgress(t,4,8)*.3);curve.getPointAt(progress,point);packet.position.copy(point);});
  });
  return <>
    {(spec.failed?broken:[curve]).map((path,index)=><mesh key={index}><tubeGeometry args={[path, 70, spec.lit ? .023 : .012, 5, false]} /><meshBasicMaterial color={spec.color} transparent opacity={spec.failed ? .65 : spec.lit ? .78 : .08} toneMapped={false} /></mesh>)}
    {(spec.lit||spec.failed)&&<group ref={packets}>{[0,1,2].map(i=><mesh key={i}><sphereGeometry args={[.06,10,8]}/><meshBasicMaterial color={spec.failed?'#ffbd79':spec.color} toneMapped={false}/></mesh>)}</group>}
  </>;
}
function FloorRing({ at, radius = 1, color = AMBER }: { at: Vec; radius?: number; color?: string }) {
  return <mesh position={at} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[radius, radius+.018, 56]} /><meshBasicMaterial color={color} transparent opacity={.35} toneMapped={false} /></mesh>;
}
function PracticalDetails({ offering, variant, active, response }: Pick<OfferingSceneProps, 'offering' | 'variant' | 'active'> & { response: boolean }) {
  const afterHours = offering === 'automation' && response && variant === 'after-hours';
  return <>
    {[[4.8,7.9],[11.4,-2.1]].map(([x,z]) => <group key={x}>
      <mesh position={[x,1.8,z]} castShadow><cylinderGeometry args={[.045,.065,3.6,10]} /><meshStandardMaterial color="#81929e" metalness={.7} roughness={.35} /></mesh>
      <mesh position={[x,.06,z]}><cylinderGeometry args={[.25,.3,.12,20]} /><meshStandardMaterial color="#435664" metalness={.7} roughness={.4} /></mesh>
    </group>)}
    <pointLight position={[-10.5,2.25,1.6]} color={afterHours ? '#b5bbff' : '#ffe2a7'} intensity={afterHours ? .25 : 4.5} distance={7} decay={2} />
    <mesh position={[9.5,.035,-4.5]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[5.2,5]} /><meshBasicMaterial color={offering==='video' && variant==='intruder' && response ? CORAL : SKY} transparent opacity={offering==='video' && variant==='intruder' ? .065 : .018} depthWrite={false} /></mesh>
    <mesh position={[9.5,.045,-2]}><boxGeometry args={[5.2,.016,.035]} /><meshBasicMaterial color={offering==='video' && variant==='intruder' && response ? CORAL : '#6b97a5'} transparent opacity={.7} /></mesh>
    {offering==='smart' && active && <FloorRing at={variant==='hvac' ? [-9,.1,-6] : variant==='cooler' ? [0,.1,-7.6] : [-14.6,.1,-1.5]} radius={variant==='cooler' ? 2.4 : 1.8} color={response ? AMBER : SKY} />}
    {offering==='eagle' && active && <FloorRing at={variant==='fiber' ? [14.6,.1,-6] : variant==='5g' ? [14.6,.1,1.4] : variant==='it' ? [10,.1,-6] : variant==='ot' ? [-7.55,.1,-6] : [7,1.12,-3]} radius={1.5} color={response ? AMBER : CORAL} />}
  </>;
}

function equipmentSpots(offering: OfferingId, variant: string, active: boolean, response: boolean): Hotspot[] {
  if (offering==='twin') {
    const extra=variant==='exploded' ? 1.6 : 0;
    return [
      {id:'housing',label:'Chassis',at:[5,1.65+extra*.35,-2.5],color:SKY},
      {id:'board',label:'Compute board',at:[8.35,1.65+extra*.12,-3.5],color:TEAL},
      {id:'heatsink',label:'Thermal design',at:[6.1,2.35+extra*.8,-3],color:SKY},
      {id:'ports',label:'Network I/O',at:[7.9,1.35,-1.8],color:AMBER},
      {id:'antennae',label:'Radio interfaces',at:[7.8,3+extra*.5,-3.6],color:VIOLET},
    ];
  }
  const ids=offering==='video'?(variant==='intruder'?['camera-back','person','zone']:variant==='crowd'?['camera','crowd']:['camera','person']):INSPECT[offering];
  return ids.map(id => {
    const part = PARTS.find(item=>item.id===id);
    const fallback: Vec = id==='zone' ? [9.5,.2,-4.5] : id==='crowd' ? [-1,2.25,7] : variant==='intruder' ? active ? [9.8,2.1,-4.2] : [9.8,2.1,.7] : [.2,active && variant==='man-down' ? .7 : 2.1,6];
    let label=id==='person' && variant==='intruder'?'Person':id==='camera-back'?'Camera':NAMES[id]||id;
    if(offering==='automation'&&response){const states=variant==='after-hours'?{light:'Lighting · dimmed',lock:'Access · locked',thermostat:'Climate · setback'}:{light:'Lighting · on',lock:'Access · unlocked',thermostat:'Climate · comfort'};label=states[id as keyof typeof states]||label;}
    return { id:id==='camera-back'?'camera':id, label, at: part ? [part.at[0],part.at[1]+part.size*.9+.25,part.at[2]] as Vec : fallback, color: id==='5g' || id==='camera' ? VIOLET : id==='energy' ? AMBER : SKY };
  });
}
function CameraRig({ offering, variant, focused, reset, rotation, zoom, reduced, followStory, timeRef, onCameraInteraction }: { offering: OfferingId; variant:string; focused: boolean; reset: number; rotation: number; zoom: number; reduced: boolean;followStory:boolean;timeRef:RefObject<number>;onCameraInteraction?:()=>void }) {
  const { camera, gl, scene, size, invalidate } = useThree();
  const controls = useRef<OrbitControls|null>(null),flight = useRef<{ eye:Vector3; target:Vector3 }|null>(null),initial = useRef(true);
  const dragTakeover=useRef(false),following=useRef(followStory);
  useEffect(()=>{following.current=followStory;},[followStory]);
  useEffect(() => { const dispose=environmentStudio(gl,scene);invalidate();return dispose; },[gl,scene,invalidate]);
  useLayoutEffect(()=>{const orbit=createOrbit(camera,gl,()=>invalidate());orbit.addEventListener('start',()=>{flight.current=null;dragTakeover.current=following.current;onCameraInteraction?.();});controls.current=orbit;return()=>{orbit.dispose();controls.current=null;};},[camera,gl,invalidate,onCameraInteraction]);
  const targetKey=focused?offering:'whole';
  const focusVariant=focused?variant:'';
  useLayoutEffect(()=>{
    const orbit=controls.current;if(!orbit || !(camera instanceof PerspectiveCamera)||followStory)return;
    if(dragTakeover.current){dragTakeover.current=false;initial.current=false;invalidate();return;}
    let region=targetKey==='whole'?{target:[0,-1.2,.4] as Vec,span:39}:FOCUS[targetKey];
    if(targetKey==='video'&&focusVariant==='intruder')region={target:[9.5,1,-3.8],span:11};
    if(targetKey==='smart')region=focusVariant==='hvac'?{target:[-8.6,1,-6.2],span:12}:focusVariant==='cooler'?{target:[0,1,-6.7],span:10}:{target:[-10.5,1,-3.5],span:15};
    const target=new Vector3(...region.target);
    const aspect=size.width/Math.max(size.height,1),scale=Math.max(1,1.45/Math.max(aspect,.35));
    const distance=(targetKey==='whole'?42:region.span*1.5)*scale/zoom;
    const direction=new Vector3(.61,.67,.92).normalize().applyAxisAngle(new Vector3(0,1,0),rotation*Math.PI/180);
    const eye=target.clone().addScaledVector(direction,distance);
    if(initial.current||reduced){camera.position.copy(eye);orbit.target.copy(target);orbit.update();initial.current=false;flight.current=null;}
    else flight.current={eye,target};
    invalidate();
  },[camera,size,targetKey,focusVariant,reset,rotation,zoom,reduced,followStory,invalidate]);
  useFrame((_,delta)=>{
    const orbit=controls.current;if(!orbit)return;
    if(followStory){const shot=sampleStoryCamera({offering,variant},timeRef.current),target=new Vector3(...shot.target),aspect=size.width/Math.max(size.height,1),distance=shot.distance*Math.max(1,1.25/Math.max(aspect,.4));const azimuth=.586+shot.yaw,direction=new Vector3(Math.sin(azimuth)*Math.cos(shot.pitch),Math.sin(shot.pitch),Math.cos(azimuth)*Math.cos(shot.pitch));camera.position.copy(target).addScaledVector(direction,distance);orbit.target.copy(target);orbit.update();flight.current=null;return;}
    const target=flight.current;if(!target)return;
    const ease=1-Math.exp(-9*Math.min(delta,.05));camera.position.lerp(target.eye,ease);orbit.target.lerp(target.target,ease);orbit.update();
    if(camera.position.distanceTo(target.eye)<.003){camera.position.copy(target.eye);orbit.target.copy(target.target);orbit.update();flight.current=null;}else invalidate();
  });
  return <>
    <color attach="background" args={['#0b1724']} /><fog attach="fog" args={['#0b1724',72,145]} />
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.36,0]}><planeGeometry args={[250,250]} /><meshBasicMaterial color="#0b1724" toneMapped={false} /></mesh>
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
  const {offering,variant,active,paused,selected,onSelect,onOfferingSelect,phase=3,timeRef,revision=0,followStory=false,onCameraInteraction,onReady}=props;
  const [ready,setReady]=useState(false),[focused,setFocused]=useState(false),[reset,setReset]=useState(0),[rotation,setRotation]=useState(0),[zoom,setZoom]=useState(1),[expanded,setExpanded]=useState(false),[fullscreenError,setFullscreenError]=useState('');
  const [visible,setVisible]=useState(!document.hidden),host=useRef<HTMLDivElement>(null),refs=useRef(new Map<string,HTMLButtonElement>());
  const fallbackClock=useRef(0),clock=timeRef??fallbackClock;
  const annotations=useRef<StoryAnnotationNodes>({labels:new Map(),caption:new Map()});
  useEffect(()=>{if(!timeRef)fallbackClock.current=[0,7.5,14,22][phase];},[timeRef,phase]);
  const context=useMemo(()=>({offering,variant}),[offering,variant]);
  const reduced=useReducedMotion(),response=active&&phase>=2,moving=!paused&&!reduced&&visible;
  const markReady=useCallback(()=>{setReady(true);onReady?.();},[onReady]);
  const circuits=useMemo(()=>makeCircuits(offering,variant,active,response),[offering,variant,active,response]);
  const spots=useMemo(()=>focused?equipmentSpots(offering,variant,active,response):SERVICE_SPOTS,[focused,offering,variant,active,response]);
  useEffect(()=>{
    let inView=true;const update=()=>setVisible(inView&&!document.hidden),observer=new IntersectionObserver(entries=>{inView=entries.some(e=>e.isIntersecting);update();});
    if(host.current)observer.observe(host.current);document.addEventListener('visibilitychange',update);
    const fullscreen=()=>setExpanded(document.fullscreenElement===host.current);document.addEventListener('fullscreenchange',fullscreen);
    return()=>{observer.disconnect();document.removeEventListener('visibilitychange',update);document.removeEventListener('fullscreenchange',fullscreen);};
  },[]);
  const resetView=()=>{onCameraInteraction?.();setFocused(false);setZoom(1);setRotation(0);setReset(v=>v+1);};
  const toggleExpanded=async()=>{try{setFullscreenError('');if(document.fullscreenElement)await document.exitFullscreen();else await host.current?.requestFullscreen();}catch{setFullscreenError('Fullscreen is unavailable in this browser.');}};
  return <div className="offering-scene offering-store-scene" ref={host} data-offering={offering} data-scenario-active={active} data-scene-view={followStory?'story':focused?'focus':'whole'}>
    {!ready&&<div className="offering-scene-loading" role="status"><span/>Preparing the enterprise…</div>}
    <Canvas shadows frameloop={moving?'always':'demand'} resize={{offsetSize:true}} events={sceneEvents} dpr={[1,1.65]} camera={{position:[30,32,42],fov:40,near:.1,far:250}} gl={{antialias:true,alpha:false,powerPreference:'low-power'}}
      onCreated={({gl})=>{gl.toneMapping=AgXToneMapping;gl.toneMappingExposure=1;gl.shadowMap.type=PCFSoftShadowMap;}}
      tabIndex={0} role="group" aria-label="Connected enterprise store. All seven offerings share this building. Drag to orbit; use left and right arrow keys to rotate, plus and minus to zoom, or Home to reset."
      onKeyDown={event=>{if(event.target instanceof HTMLButtonElement)return;if(!['ArrowLeft','ArrowRight','+','=','-','Home'].includes(event.key))return;event.preventDefault();onCameraInteraction?.();if(event.key==='Home')resetView();else if(event.key==='ArrowLeft'||event.key==='ArrowRight')setRotation(v=>v+(event.key==='ArrowLeft'?-20:20));else setZoom(v=>Math.max(.65,Math.min(2.1,v+(event.key==='-'?-.15:.15))));}}>
      <CameraRig offering={offering} variant={variant} focused={focused} reset={reset} rotation={rotation} zoom={zoom} reduced={reduced} followStory={followStory} timeRef={clock} onCameraInteraction={onCameraInteraction}/>
      <StoryRevision revision={revision}/>
      <Suspense fallback={null}>
        <Architecture context={context} timeRef={clock}/>
        <OfferingStudioLighting context={context} timeRef={clock}/>
        <OfferingContactGrounding context={context} timeRef={clock}/>
        {PARTS.map(spec=><Equipment key={spec.id} spec={spec} exploded={spec.id==='gateway'&&offering==='twin'&&variant==='exploded'} onSelect={onSelect} context={context} timeRef={clock}/>)}
        {circuits.map(spec=><Circuit key={spec.id} spec={spec} timeRef={clock} context={context}/>)}
        <OfferingStoryEffects offering={offering} variant={variant} timeRef={clock} onSelect={onSelect}/>
        <OfferingStoryAnnotationSync context={context} timeRef={clock} nodes={annotations} visible={ready&&(followStory||focused)} film={followStory}/>
        <PracticalDetails offering={offering} variant={variant} active={active} response={response}/>
        <ProjectHotspots spots={spots} refs={refs}/><Ready onReady={markReady}/>
      </Suspense>
    </Canvas>
    <OfferingStoryAnnotationLayer nodes={annotations} visible={ready&&(followStory||focused)} film={followStory}/>
    {ready&&!followStory&&<div className="offering-scene-hotspots" aria-label={focused?'Inspect equipment':'Seven connected offerings'}>
      {spots.map(spot=><button type="button" key={spot.id} ref={node=>{if(node)refs.current.set(spot.id,node);else refs.current.delete(spot.id);}}
        className={`offering-scene-hotspot${(focused?selected===spot.id:offering===spot.id)?' is-selected':''}${spot.number?' is-service':''}`}
        style={{'--hotspot-color':spot.color} as CSSProperties} aria-label={focused?`Inspect ${spot.label}`:`Explore ${spot.number}. ${spot.label}`} aria-pressed={focused?selected===spot.id:offering===spot.id}
        onClick={()=>focused?onSelect(spot.id):onOfferingSelect?.(spot.id as OfferingId)}>
        {spot.number?<b>{spot.number}</b>:<i aria-hidden="true"/>}<span>{spot.label}</span>
      </button>)}
    </div>}
    <div className="offering-store-controls" aria-label="Enterprise view" onClick={event=>{const title=(event.target as HTMLElement).closest('button')?.getAttribute('title');if(title!=='Expand enterprise'&&title!=='Exit fullscreen')onCameraInteraction?.();}}>
      <div className="offering-store-control-group"><button type="button" aria-pressed={!followStory&&!focused} onClick={()=>{setFocused(false);setZoom(1);setReset(value=>value+1);}} title="Whole store"><Store size={15}/><span>Whole store</span></button><button type="button" aria-pressed={!followStory&&focused} onClick={()=>{setFocused(true);setZoom(1);setReset(value=>value+1);}} title="Focus selected area"><Focus size={15}/><span>Focus</span></button></div>
      <div className="offering-store-control-group"><button type="button" aria-label="Rotate left" title="Rotate left" onClick={()=>setRotation(v=>v-25)}><RotateCcw size={15}/></button><button type="button" aria-label="Rotate right" title="Rotate right" onClick={()=>setRotation(v=>v+25)}><RotateCw size={15}/></button><button type="button" aria-label="Zoom out" title="Zoom out" disabled={zoom<=.65} onClick={()=>setZoom(v=>Math.max(.65,v-.15))}><ZoomOut size={15}/></button><button type="button" aria-label="Zoom in" title="Zoom in" disabled={zoom>=2.1} onClick={()=>setZoom(v=>Math.min(2.1,v+.15))}><ZoomIn size={15}/></button></div>
      <div className="offering-store-control-group"><button type="button" aria-label="Reset scene camera" title="Reset view" onClick={resetView}><Scan size={15}/></button><button type="button" aria-label={expanded?'Exit fullscreen':'Expand enterprise'} title={expanded?'Exit fullscreen':'Expand enterprise'} onClick={()=>void toggleExpanded()}>{expanded?<Minimize size={15}/>:<Expand size={15}/>}</button></div>
    </div>
    {fullscreenError&&<p className="offering-scene-error" role="status">{fullscreenError}</p>}
  </div>;
}
