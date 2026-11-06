import { sampleTwin } from './OfferingTwinStory';
import { eaglePacketClock, sampleEagle } from './OfferingEagleStory';
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferGeometry, Color, DynamicDrawUsage, InstancedMesh, Line, LineDashedMaterial, Matrix4, MeshStandardMaterial, TubeGeometry, Vector3 } from 'three';
import { connectionCurve, makeConnections, type Connection } from './OfferingConnectionPaths';
import { type StoryContext } from './OfferingStoryMotion';
import { ETHERNET_CABLE_RADIUS } from './OfferingEquipment';
import { connectorFrame, connectorPartMatrix, packetRadius } from './OfferingConnectionInstances';

function makeResources(spec:Connection){
  const curve=connectionCurve(spec);
  const tube=spec.wireless?null:new TubeGeometry(curve,150,ETHERNET_CABLE_RADIUS,6,false);
  const line=spec.wireless?new Line(new BufferGeometry().setFromPoints(curve.getPoints(100)),new LineDashedMaterial({color:spec.color,dashSize:.14,gapSize:.12,transparent:true,opacity:spec.failed?.34:spec.lit?.8:.16,depthWrite:false})):null;
  line?.computeLineDistances();
  const material=tube?new MeshStandardMaterial({color:spec.failed?'#8e5c52':spec.lit?'#647f90':'#344753',metalness:.2,roughness:.55,transparent:true,opacity:spec.failed||spec.lit?.95:.36}):null;
  return {spec,curve,tube,line,material,amount:0,unplug:0,from:connectorFrame(spec.from),to:connectorFrame(spec.to),packetColor:new Color(spec.failed?'#ff897a':spec.color).multiplyScalar(spec.wireless?1.7:1.5)};
}
function followExplodedPorts(resources:ReturnType<typeof makeResources>,spec:Connection,amount:number,unplug=0){
  if(resources.amount===amount&&resources.unplug===unplug)return;
  resources.amount=amount;resources.unplug=unplug;resources.curve=connectionCurve(spec,amount,unplug);
  if(resources.tube){const next=new TubeGeometry(resources.curve,150,ETHERNET_CABLE_RADIUS,6,false);resources.tube.copy(next);next.dispose();}
  if(resources.line){resources.line.geometry.setFromPoints(resources.curve.getPoints(100));resources.line.computeLineDistances();}
}
type LinkResources=ReturnType<typeof makeResources>;

/** Identical solid plug parts and packets share five submissions rather than
 * one draw per tiny piece. Cable geometry and transparent sorting stay separate. */
function ConnectionInstances({links,context,timeRef}:{links:LinkResources[];context:StoryContext;timeRef:RefObject<number>}){
  const metal=useRef<InstancedMesh>(null),boot=useRef<InstancedMesh>(null),marker=useRef<InstancedMesh>(null),socket=useRef<InstancedMesh>(null),packets=useRef<InstancedMesh>(null);
  const camera=useThree(state=>state.camera);
  const scratch=useMemo(()=>({point:new Vector3(),matrix:new Matrix4(),color:new Color()}),[]);
  const counts=useMemo(()=>links.reduce((count,{spec,tube})=>({
    connectors:count.connectors+(tube?2:0),sockets:count.sockets+(tube?Number(!!spec.from.addSocket)+Number(!!spec.to.addSocket):0),
    packets:count.packets+(spec.lit||spec.failed?(spec.wireless?5:3):0),
  }),{connectors:0,sockets:0,packets:0}),[links]);
  useLayoutEffect(()=>{for(const ref of [metal,boot,marker,socket,packets])ref.current?.instanceMatrix.setUsage(DynamicDrawUsage);},[links]);
  useFrame(()=>{
    const t=timeRef.current,{point,matrix,color}=scratch;
    const eagle=context.offering==='eagle'?sampleEagle(context.variant,t):null;
    let connectorIndex=0,socketIndex=0,packetIndex=0;
    for(const resources of links){
      const {spec}=resources,twin=context.offering==='twin'&&spec.id==='pos'?sampleTwin(t):null;
      const failed=spec.failed||!!twin&&t>=4&&!twin.resolved;
      followExplodedPorts(resources,spec,0,twin?.unplug??0);
      if(twin&&resources.material)resources.material.color.set(twin.resolved?'#6c9688':failed?'#8e5c52':'#647f90');
      if(resources.tube){
        resources.curve.getPoint(0,point);resources.from.setPosition(point);
        color.set(spec.failed?'#ff897a':spec.color);
        for(const [frame,hasSocket] of [[resources.from,spec.from.addSocket],[resources.to,spec.to.addSocket]] as const){
          metal.current?.setMatrixAt(connectorIndex,connectorPartMatrix(frame,'metal',matrix));
          boot.current?.setMatrixAt(connectorIndex,connectorPartMatrix(frame,'boot',matrix));
          marker.current?.setMatrixAt(connectorIndex,connectorPartMatrix(frame,'marker',matrix));
          marker.current?.setColorAt(connectorIndex,color);
          if(hasSocket)socket.current?.setMatrixAt(socketIndex++,connectorPartMatrix(frame,'socket',matrix));
          connectorIndex++;
        }
      }
      if(!spec.lit&&!spec.failed)continue;
      const slow=eagle&&(spec.id===context.variant||context.variant==='gateway'&&spec.from.device==='gateway'||spec.id==='pos'&&eagle.checkoutAffected);
      const elapsed=slow?eaglePacketClock(context.variant,t):t,packetCount=spec.wireless?5:3;
      for(let index=0;index<packetCount;index++){
        const progress=failed?.12+index*.055:(elapsed*.16+index/packetCount)%1;
        resources.curve.getPointAt(progress,point);
        const radius=packetRadius(spec.wireless,point,camera.position);
        matrix.makeScale(radius,radius,radius).setPosition(point);
        packets.current?.setMatrixAt(packetIndex,matrix);
        packets.current?.setColorAt(packetIndex,twin?color.set(twin.color):resources.packetColor);
        packetIndex++;
      }
    }
    for(const ref of [metal,boot,marker,socket,packets])if(ref.current){ref.current.instanceMatrix.needsUpdate=true;if(ref.current.instanceColor)ref.current.instanceColor.needsUpdate=true;}
  });
  return <group name="Connection hardware and packet instances">
    <instancedMesh ref={metal} args={[undefined,undefined,counts.connectors]} castShadow frustumCulled={false}><boxGeometry/><meshStandardMaterial color="#9aaab4" metalness={.75} roughness={.3}/></instancedMesh>
    <instancedMesh ref={boot} args={[undefined,undefined,counts.connectors]} castShadow frustumCulled={false}><boxGeometry/><meshStandardMaterial color="#263943" roughness={.58}/></instancedMesh>
    <instancedMesh ref={marker} args={[undefined,undefined,counts.connectors]} frustumCulled={false}><boxGeometry/><meshBasicMaterial toneMapped={false}/></instancedMesh>
    <instancedMesh ref={socket} args={[undefined,undefined,counts.sockets]} frustumCulled={false}><boxGeometry/><meshStandardMaterial color="#202e39" metalness={.55} roughness={.38}/></instancedMesh>
    {counts.packets>0&&<instancedMesh ref={packets} args={[undefined,undefined,counts.packets]} frustumCulled={false}><sphereGeometry args={[1,12,8]}/><meshBasicMaterial toneMapped={false}/></instancedMesh>}
  </group>;
}
export function OfferingConnections({context,active,response,timeRef}:{context:StoryContext;active:boolean;response:boolean;timeRef:RefObject<number>}){
  const links=useMemo(()=>makeConnections(context,active,response).filter(spec=>(context.offering!=='automation'||!spec.wireless)&&(context.offering!=='routing'||!['pos','voice'].includes(spec.id))).map(makeResources),[context,active,response]);
  useEffect(()=>()=>{for(const link of links){link.tube?.dispose();link.material?.dispose();link.line?.geometry.dispose();link.line?.material.dispose();}},[links]);
  return <>
    {links.map(link=><group key={link.spec.id} name={`Connection:${link.spec.id}`}>
      {link.tube&&link.material&&<mesh geometry={link.tube} material={link.material} dispose={null}/>}
      {link.line&&<primitive object={link.line} dispose={null}/>}
    </group>)}
    <ConnectionInstances links={links} context={context} timeRef={timeRef}/>
  </>;
}
