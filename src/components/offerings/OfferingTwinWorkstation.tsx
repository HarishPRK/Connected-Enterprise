import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { PerspectiveCamera, RenderTexture, RoundedBox } from '@react-three/drei';
import { CanvasTexture, Group, MeshBasicMaterial, PerspectiveCamera as ThreePerspectiveCamera, Quaternion, SRGBColorSpace, Vector3 } from 'three';
import { cinematicAssets, useCinematicModel } from './OfferingCinematicCanvas';
import { GATEWAY_EXPLODE, PARTS, SERVICE_CART } from './OfferingEquipment';
import { gatewayPort } from './OfferingConnectionPaths';
import { sampleTwin } from './OfferingTwinStory';
import { clearLaptopDisplayGraphics } from './OfferingRoutingScreens';
import { useAnimatedScreenFrames } from './OfferingScreenFrames';

const LAPTOP_SCALE = SERVICE_CART.laptopWidth / 1.23;

function PortMarker({ timeRef, miniature = false, onSelect }: { timeRef: RefObject<number>; miniature?: boolean; onSelect?: () => void }) {
  const marker = useRef<Group>(null), material = useRef<MeshBasicMaterial>(null);
  const socket = useMemo(() => gatewayPort('pos'), []);
  const at = useMemo(() => {
    const p = new Vector3(...socket.point).addScaledVector(new Vector3(...socket.normal), .003);
    const gateway = PARTS.find(part => part.id === 'gateway')!;
    if (miniature) p.sub(new Vector3(...gateway.at)).multiplyScalar(2.4/gateway.size);
    return p;
  }, [socket,miniature]);
  const orientation = useMemo(() => new Quaternion().setFromUnitVectors(new Vector3(0,0,1),new Vector3(...socket.normal)),[socket]);
  useFrame(() => {
    const state=sampleTwin(timeRef.current);
    if(marker.current)marker.current.visible=state.highlight;
    material.current?.color.set(state.color);
  });
  return <group ref={marker} position={at} quaternion={orientation} onClick={event=>{event.stopPropagation();if(event.delta<5)onSelect?.();}}>
    <mesh><ringGeometry args={[miniature?.11:.014,miniature?.127:.016,48]}/><meshBasicMaterial ref={material} color="#ff897a" toneMapped={false} depthWrite={false}/></mesh>
  </group>;
}

function LaptopTwin({ timeRef, exploded }: { timeRef: RefObject<number>; exploded: boolean }) {
  const model = useCinematicModel(cinematicAssets.twin,'GatewayTwin',2.4);
  const cameraOrientation = useMemo(() => {
    const camera = new ThreePerspectiveCamera();
    camera.position.set(2.8,2.25,5);
    camera.lookAt(0,1.2,0);
    return camera.quaternion.clone();
  }, []);
  const parts = useMemo(()=>Object.entries(GATEWAY_EXPLODE).flatMap(([name,offset])=>{
    const object=model.getObjectByName(name);
    return object?[{object,origin:object.position.clone(),offset:new Vector3(...offset)}]:[];
  }),[model]);
  useFrame(()=>{
    const amount=exploded?sampleTwin(timeRef.current).virtualExplode:0;
    for(const part of parts)part.object.position.copy(part.origin).addScaledVector(part.offset,amount);
  });
  return <>
    <color attach="background" args={['#162b3a']}/>
    <PerspectiveCamera makeDefault manual aspect={.43/.46} position={[2.8,2.25,5]} quaternion={cameraOrientation} fov={38}/>
    <hemisphereLight args={['#ecf4ff','#81929d',1.1]}/>
    <directionalLight position={[-3,6,5]} intensity={2.4}/>
    <directionalLight position={[4,2,3]} intensity={.8} color="#dcecff"/>
    <group rotation={[0,-Math.PI/2+.3,0]}><primitive object={model} dispose={null}/></group>
    <PortMarker timeRef={timeRef} miniature/>
  </>;
}

function paintDiagnostics(ctx: CanvasRenderingContext2D, texture: CanvasTexture, state: ReturnType<typeof sampleTwin>) {
  ctx.fillStyle='#102535';ctx.fillRect(0,0,1440,900);
  ctx.fillStyle='#dcecf4';ctx.font='600 40px sans-serif';ctx.fillText('GATEWAY TWIN',52,66);
  ctx.fillStyle='#91afc3';ctx.font='26px sans-serif';ctx.fillText('Gemtek OSPv2  /  Simulated diagnostics',52,111);
  ctx.fillStyle='#385061';ctx.fillRect(52,140,1336,2);
  ctx.fillStyle='#91afc3';ctx.font='600 28px sans-serif';ctx.fillText('INTERFACE LOG',670,206);
  ctx.fillStyle=state.color;ctx.font='600 52px sans-serif';ctx.fillText('LAN 1',670,278);
  ctx.fillStyle='#e6eff5';ctx.font='32px sans-serif';
  const lines=state.resolved?['LINK UP  /  1 Gbps','Stability check passed','Checkout 01 reachable']
    :state.stage==='verify'?['Connector reseated','Checking link stability…','Testing Checkout 01…']
    :['Repeated link disconnects','Checkout 01 affected','Fiber + 5G remain online'];
  lines.forEach((line,i)=>ctx.fillText(line,670,346+i*64));
  ctx.fillStyle='#304b5d';ctx.fillRect(670,538,708,2);
  ctx.fillStyle='#91afc3';ctx.font='25px sans-serif';ctx.fillText(state.resolved?'VERIFICATION':'RECOMMENDED CHECK',670,592);
  ctx.fillStyle=state.color;ctx.font='600 34px sans-serif';ctx.fillText(state.resolved?'Connection restored':'Inspect LAN 1 connector',670,646);
  ctx.fillStyle='#b3cddd';ctx.font='28px sans-serif';ctx.fillText(state.resolved?'Return to service':'Locate port → check cable → retest',670,700);
  ctx.fillStyle=state.color;ctx.font='600 30px sans-serif';ctx.fillText(state.highlight?'LAN 1 highlighted':'Select log to locate port',65,820);
  ctx.fillStyle='#91afc3';ctx.font='25px sans-serif';ctx.fillText('Illustrative service session · No device commands',52,872);
  texture.needsUpdate=true;
}

/** The operator's physical laptop displays the same Gemtek mesh as the CPE.
 * Log text is a high-resolution screen texture, not floating scene decoration. */
export function OfferingTwinWorkstation({ timeRef, variant, onSelect }: { timeRef: RefObject<number>; variant: string; onSelect: (id:string)=>void }) {
  const twinFrames=useAnimatedScreenFrames(()=>{
    const state=sampleTwin(timeRef.current);
    return `${variant==='exploded'?state.virtualExplode:0}/${state.highlight}/${state.color}`;
  });
  const laptop=useCinematicModel(cinematicAssets.kit,'Laptop',SERVICE_CART.laptopWidth);
  const graphics=useMemo(()=>clearLaptopDisplayGraphics(laptop),[laptop]);
  useEffect(()=>()=>graphics.forEach(geometry=>geometry.dispose()),[graphics]);
  const surface=useMemo(()=>{
    const canvas=document.createElement('canvas');canvas.width=1440;canvas.height=900;
    const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;texture.anisotropy=16;
    return {texture,paint:canvas.getContext('2d')!};
  },[]);
  const last=useRef('');
  useEffect(()=>()=>surface.texture.dispose(),[surface]);
  useFrame(()=>{
    const state=sampleTwin(timeRef.current);
    if(last.current===state.stage)return;last.current=state.stage;
    paintDiagnostics(surface.paint,surface.texture,state);
  });
  return <group name="Gateway diagnosis workstation">
    <group position={SERVICE_CART.at}>
      <RoundedBox args={[SERVICE_CART.width,.05,SERVICE_CART.depth]} radius={.012} position={[0,SERVICE_CART.top-.025,0]} castShadow receiveShadow><meshStandardMaterial color="#8d9ca8" metalness={.5} roughness={.38}/></RoundedBox>
      {[-.265,.265].flatMap(x=>[-.18,.18].map(z=><group key={`${x}/${z}`}>
        <mesh position={[x,.565,z]} castShadow><boxGeometry args={[.03,.87,.03]}/><meshStandardMaterial color="#31434f" metalness={.7} roughness={.42}/></mesh>
        <mesh position={[x,.06,z]} rotation={[0,0,Math.PI/2]} castShadow><cylinderGeometry args={[.05,.05,.03,20]}/><meshStandardMaterial color="#17252d" roughness={.8}/></mesh>
      </group>))}
      <mesh position={[0,.24,0]} receiveShadow><boxGeometry args={[.56,.025,.39]}/><meshStandardMaterial color="#40525f" metalness={.5} roughness={.5}/></mesh>
      <group position={[0,SERVICE_CART.top,0]}>
        <primitive object={laptop} dispose={null}/>
        <group scale={LAPTOP_SCALE}>
          <group position={[0,.490972,-.321563]} rotation={[-.13,0,0]}>
            <mesh onClick={event=>{event.stopPropagation();if(event.delta<5)onSelect('ports');}}><planeGeometry args={[1.10,.65]}/><meshBasicMaterial map={surface.texture} toneMapped={false}/></mesh>
            <mesh position={[-.29,-.025,.003]}><planeGeometry args={[.43,.46]}/><meshBasicMaterial toneMapped={false}>
              <RenderTexture attach="map" width={600} height={640} samples={4} generateMipmaps frames={twinFrames}>
                <LaptopTwin timeRef={timeRef} exploded={variant==='exploded'}/>
              </RenderTexture>
            </meshBasicMaterial></mesh>
          </group>
        </group>
      </group>
    </group>
    <PortMarker timeRef={timeRef} onSelect={()=>onSelect('ports')}/>
  </group>;
}
