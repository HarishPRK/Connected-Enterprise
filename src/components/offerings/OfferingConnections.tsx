import { sampleTwin } from './OfferingTwinStory';
import { sampleRouting } from './OfferingRoutingStory';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferGeometry, Color, Group, Line, LineDashedMaterial, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, TubeGeometry, Vector3 } from 'three';
import { connectionCurve, makeConnections, type Connection, type Socket } from './OfferingConnectionPaths';
import { type StoryContext } from './OfferingStoryMotion';

function Connector({socket,color}:{socket:Socket;color:string}){
  const rotation=useMemo(()=>new Quaternion().setFromUnitVectors(new Vector3(0,0,1),new Vector3(...socket.normal)),[socket]);
  return <group quaternion={rotation}>
    {socket.addSocket&&<mesh position={[0,0,-.006]}><boxGeometry args={[.12,.085,.028]}/><meshStandardMaterial color="#202e39" metalness={.55} roughness={.38}/></mesh>}
    <mesh position={[0,0,.016]} castShadow><boxGeometry args={[.084,.055,.065]}/><meshStandardMaterial color="#9aaab4" metalness={.75} roughness={.3}/></mesh>
    <mesh position={[0,0,.065]} castShadow><boxGeometry args={[.072,.048,.055]}/><meshStandardMaterial color="#263943" roughness={.58}/></mesh>
    <mesh position={[0,.028,.052]}><boxGeometry args={[.048,.009,.024]}/><meshBasicMaterial color={color} toneMapped={false}/></mesh>
  </group>;
}
function makeResources(spec:Connection){
  const curve=connectionCurve(spec);
  const tube=spec.wireless?null:new TubeGeometry(curve,150,.022,6,false);
  const line=spec.wireless?new Line(new BufferGeometry().setFromPoints(curve.getPoints(100)),new LineDashedMaterial({color:spec.color,dashSize:.14,gapSize:.12,transparent:true,opacity:spec.failed?.34:spec.lit?.8:.16,depthWrite:false})):null;
  line?.computeLineDistances();
  return {curve,tube,line,amount:0,unplug:0};
}
function followExplodedPorts(resources:ReturnType<typeof makeResources>,spec:Connection,amount:number,unplug=0){
  if(resources.amount===amount&&resources.unplug===unplug)return;
  resources.amount=amount;resources.unplug=unplug;resources.curve=connectionCurve(spec,amount,unplug);
  if(resources.tube){const next=new TubeGeometry(resources.curve,150,.022,6,false);resources.tube.copy(next);next.dispose();}
  if(resources.line){resources.line.geometry.setFromPoints(resources.curve.getPoints(100));resources.line.computeLineDistances();}
}
function ConnectionLink({spec,context,timeRef}:{spec:Connection;context:StoryContext;timeRef:RefObject<number>}){
  const packets=useRef<Group>(null),startPlug=useRef<Group>(null);
  const cable=useRef<MeshStandardMaterial>(null);
  const camera=useThree(state=>state.camera);
  const resources=useMemo(()=>makeResources(spec),[spec]);
  const point=useMemo(()=>new Vector3(),[]);
  const packetColor=useMemo(()=>new Color(spec.failed?"#ff897a":spec.color).multiplyScalar(spec.wireless?1.7:1.5),[spec.color,spec.failed,spec.wireless]);
  const packetCount=spec.wireless?5:3;
  useEffect(()=>()=>{resources.tube?.dispose();resources.line?.geometry.dispose();resources.line?.material.dispose();},[resources]);
  useFrame(()=>{
    const t=timeRef.current;
    const twin=context.offering==='twin'&&spec.id==='pos'?sampleTwin(t):null;
    const failed=spec.failed||!!twin&&t>=4&&!twin.resolved;
    followExplodedPorts(resources,spec,0,twin?.unplug??0);
    if(twin&&cable.current)cable.current.color.set(twin.resolved?'#6c9688':failed?'#8e5c52':'#647f90');
    if(startPlug.current){resources.curve.getPoint(0,point);startPlug.current.position.copy(point);}
    const routing=context.offering==='routing',allocation=sampleRouting(t);
    const queued=routing&&allocation.queued&&spec.id==='it';
    const speed = routing && t >= 4 && !allocation.policy ? .065 : .16;
    packets.current?.children.forEach((packet,index)=>{
      const progress=failed||queued ? .12+index*.055 : (t*speed+index/packetCount)%1;
      resources.curve.getPointAt(progress,point);packet.position.copy(point);
      if(twin)((packet as Mesh).material as MeshBasicMaterial).color.set(twin.color);
      packet.scale.setScalar(Math.min(1,Math.max(.05,point.distanceTo(camera.position)/7)));
    });
  });
  return <group name={`Connection:${spec.id}`}>
    {resources.tube&&<>
      <mesh geometry={resources.tube} dispose={null}><meshStandardMaterial ref={cable} color={spec.failed?'#8e5c52':spec.lit?'#647f90':'#344753'} metalness={.2} roughness={.55} transparent opacity={spec.failed||spec.lit ? .95 : .36}/></mesh>
      <group ref={startPlug} position={spec.from.point}><Connector socket={spec.from} color={spec.failed?'#ff897a':spec.color}/></group>
      <group position={spec.to.point}><Connector socket={spec.to} color={spec.failed?'#ff897a':spec.color}/></group>
    </>}
    {resources.line&&<primitive object={resources.line} dispose={null}/>}
    {(spec.lit||spec.failed)&&<group ref={packets}>{Array.from({length:packetCount},(_,index)=><mesh key={index}><sphereGeometry args={[spec.wireless?.072:.045,12,8]}/><meshBasicMaterial color={packetColor} toneMapped={false}/></mesh>)}</group>}
  </group>;
}
export function OfferingConnections({context,active,response,timeRef}:{context:StoryContext;active:boolean;response:boolean;timeRef:RefObject<number>}){
  const connections=useMemo(()=>makeConnections(context,active,response),[context,active,response]);
  return <>{connections.map(spec=><ConnectionLink key={spec.id} spec={spec} context={context} timeRef={timeRef}/>)}</>;
}
