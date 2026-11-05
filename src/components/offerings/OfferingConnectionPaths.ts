import { CurvePath, LineCurve3, QuadraticBezierCurve3, Vector3 } from 'three';
import manifest from '../../assets/offerings/offerings-kit.manifest.json';
import twinManifest from '../../assets/offerings/gemtek-gateway.manifest.json';
import analyticsManifest from '../../assets/offerings/analytics-server.manifest.json';
import { CONNECTOR_WITHDRAWAL, GATEWAY_EXPLODE, PARTS, type Vec } from './OfferingEquipment';
import type { StoryContext } from './OfferingStoryMotion';

export interface Socket { point: Vec; normal: Vec; device: string; radio?: boolean; addSocket?: boolean; }
export interface Connection { id: string; from: Socket; to: Socket; via: Vec[]; color: string; lit: boolean; failed: boolean; wireless?: boolean; }
const SKY='#68d6ff',TEAL='#8ce3c6',VIOLET='#b4a5ff',AMBER='#ffc885',CORAL='#ff897a';
const bounds={...manifest.prefabs,...twinManifest.prefabs,...analyticsManifest.prefabs} as Record<string,{min:number[];max:number[];size:number[]}>;

/** The same center, scale and yaw as cloneModel. Coordinates are glTF +Y up.
 * Socket locations come from the original Blender port geometry, not its floor footprint. */
export function equipmentSocket(device:string,local:Vec,normal:Vec=[0,0,1],addSocket=false):Socket {
  const part=PARTS.find(item=>item.id===device);
  if(!part)throw new Error(`Unknown connection device: ${device}`);
  const box=bounds[part.model],scale=part.size/Math.max(...box.size),yaw=part.yaw??0;
  const point=new Vector3(local[0]-(box.min[0]+box.max[0])/2,local[1]-box.min[1],local[2]-(box.min[2]+box.max[2])/2);
  point.multiplyScalar(scale).applyAxisAngle(new Vector3(0,1,0),yaw).add(new Vector3(...part.at));
  const direction=new Vector3(...normal).applyAxisAngle(new Vector3(0,1,0),yaw).normalize();
  return {device,point:point.toArray() as Vec,normal:direction.toArray() as Vec,addSocket};
}
// Gemtek studio's actual rear sockets, including the source root's X scale.
export const gatewayPort=(id:'fiber'|'pos'|'voice'|'it'|'analytics')=>{
  const ports:Record<typeof id,Vec>={fiber:[.974,1.5,.018],pos:[.984,.49,.018],voice:[.984,.675,.018],it:[.984,1.06,.018],analytics:[.984,.86,.018]};
  const local=ports[id];local[0]*=1.64/1.83;
  return equipmentSocket('gateway',local,[1,0,0]);
};
const analyticsPort=(id:'Camera A'|'Camera B'|'LAN')=>equipmentSocket('analytics',analyticsManifest.ports[id] as Vec);
const rackPort=(index:number)=>equipmentSocket('it',[-.31+index*.122,1.51,.55]);
const outward=(socket:Socket,distance:number):Vec=>socket.point.map((value,index)=>value+socket.normal[index]*distance) as Vec;
const floor=(point:Vec):Vec=>[point[0],.055,point[2]];

export function makeConnections(context:StoryContext,active:boolean,response:boolean):Connection[] {
  const {offering,variant}=context;
  const fiberDown=offering==='failover'&&active&&variant==='fiber';
  const cellDown=offering==='failover'&&active&&variant==='5g';
  const cellPolicy=offering==='routing'&&response;
  const switched=fiberDown&&response||cellPolicy;
  const cpe=gatewayPort('fiber'),pos=gatewayPort('pos'),voice=gatewayPort('voice'),lan=gatewayPort('it');
  const fiber=equipmentSocket('fiber',[-.19,.57,.332]);
  const checkout=equipmentSocket('pos',[-.615,.045,.1],[-1,0,0],true);
  const phone=equipmentSocket('voice',[.3,.1,-.41],[0,0,-1],true);
  const camera=equipmentSocket('camera',[0,.38,-.18],[0,-1,0],true);
  const cameraBack=equipmentSocket('camera-back',[0,.38,-.18],[0,-1,0],true);
  const radioFrom=equipmentSocket('gateway',[0,2.05,0]);
  const radioTo=equipmentSocket('5g',[-.199,1.66,.115]);
  const sensor=equipmentSocket('sensor',[0,.42,.25]);
  const hvac=equipmentSocket('hvac',[.685,.32,0],[1,0,0],true);
  const cooler=equipmentSocket('cooler',[.645,.3,0],[1,0,0],true);
  const meter=equipmentSocket('meter',[0,.03,.03],[0,-1,0],true);
  const ot=equipmentSocket('ot',[0,.03,0],[0,-1,0],true);
  const wire=(id:string,from:Socket,to:Socket,via:Vec[],color:string,lit:boolean,failed=false):Connection=>({id,from,to,via,color,lit,failed});
  const radio=(id:string,from:Socket,to:Socket,color:string,lit:boolean,failed=false):Connection=>({id,from,to,via:[],color,lit,failed,wireless:true});
  // Leads leave each jack straight, pass the counter edge, then descend. A
  // separate physical cable serves each of the four CPE Ethernet interfaces.
  const drop=(socket:Socket):Vec[]=>{
    if(socket.device==='it'){
      const lead=outward(socket,.12),side:Vec=[socket.point[0]<10?9.38:10.62,lead[1],lead[2]];
      // Patch leads use the rack's side channels, leaving the diagnostic
      // display and keyboard unobstructed for the operator.
      return [lead,side,floor(side)];
    }
    const lead=outward(socket,.38);return [lead,floor(lead)];
  };
  const up=(socket:Socket):Vec[]=>{if(socket.device==='it')return drop(socket).reverse();const lead=outward(socket,socket.device==='analytics'?.42:.30);return [floor(lead),lead];};
  const routes:Connection[]=[
    wire('fiber',cpe,fiber,[...drop(cpe),[11.8,.055,-2.03],[11.8,.055,-5.05],...up(fiber)],fiberDown?CORAL:offering==='routing'?VIOLET:SKY,offering==='failover'?!fiberDown:offering==='routing'?true:offering==='eagle'&&variant==='fiber',fiberDown),
    radio('5g',radioFrom,radioTo,cellDown?CORAL:offering==='routing'?TEAL:VIOLET,offering==='failover'&&fiberDown&&response||cellPolicy||offering==='eagle'&&variant==='5g',cellDown),
    wire('pos',pos,checkout,[...drop(pos),[10.9,.055,-2.04],[10.9,.055,3.6],[6.2,.055,3.6],[6.2,1.19,3.6],[6.2,1.19,3.92],[7.65,1.19,3.92],[7.65,1.19,4.51]],offering==='routing'?TEAL:switched?VIOLET:SKY,offering==='routing'||offering==='twin'||offering==='failover'&&(!fiberDown||response)),
    wire('voice',voice,phone,[...drop(voice),[11.1,.055,-2.02],[11.1,.055,6.35],[8.15,.055,6.35],[8.15,1.2,6.35]],TEAL,false),
    wire('it',lan,rackPort(0),[...drop(lan),[11.35,.055,-2],[11.35,.055,-4.65],...up(rackPort(0))],AMBER,offering==='routing'||offering==='eagle'&&['gateway','it'].includes(variant)),
    wire('camera',camera,analyticsPort('Camera A'),[[4.8,3.4,8.1],[4.8,.055,8.1],[11.3,.055,8.1],[11.3,.055,-2.1],...up(analyticsPort('Camera A'))],VIOLET,offering==='video'||offering==='routing'),
    wire('camera-back',cameraBack,analyticsPort('Camera B'),[[11.4,3.3,-2.1],[11.4,.055,-2.1],[9.2,.055,-2.1],...up(analyticsPort('Camera B'))],VIOLET,offering==='video'||offering==='routing'),
    wire('analytics',gatewayPort('analytics'),analyticsPort('LAN'),[outward(gatewayPort('analytics'),.32),[7.1,1.14,-2.3],[8.25,1.14,-2.3],outward(analyticsPort('LAN'),.42)],VIOLET,offering==='video'||offering==='routing'),
    wire('hvac',rackPort(2),hvac,[...drop(rackPort(2)),[7,.055,-4.75],[-7.25,.055,-4.75],...up(hvac)],SKY,offering==='smart'&&variant==='hvac'),
    wire('cooler',rackPort(3),cooler,[...drop(rackPort(3)),[7,.055,-4.95],[0,.055,-4.95],[0,.055,-6.5],...up(cooler)],TEAL,offering==='smart'&&variant==='cooler'),
    wire('energy',rackPort(4),meter,[...drop(rackPort(4)),[11.5,.055,-4.8],[11.5,.055,-8.9],[-9.1,.055,-8.9],...up(meter)],AMBER,offering==='smart'&&variant==='energy'),
    wire('ot',rackPort(5),ot,[...drop(rackPort(5)),[7,.055,-4.85],[-7.7,.055,-4.85],...up(ot)],SKY,offering==='eagle'&&['gateway','ot'].includes(variant)),
    radio('sensor',radioFrom,sensor,VIOLET,offering==='automation'&&response),
    ...(['thermostat','lock','light'] as const).map(id=>radio(id,sensor,equipmentSocket(id,id==='light'?[0,.95,0]:id==='lock'?[0,.87,.135]:[0,.36,.13]),variant==='after-hours'?VIOLET:TEAL,offering==='automation'&&response)),
  ];
  if(offering==='eagle'&&active)for(const route of routes)if(route.id===variant||variant==='gateway'&&route.from.device==='gateway'||route.id==='pos'&&['gateway','fiber','it'].includes(variant)){route.lit=true;route.color=AMBER;}
  return routes;
}

/** Bounded corner fillets cannot overshoot into the floor like Catmull-Rom.
 * The first and last segment remain aligned with the connector's normal. */
export function connectionCurve(connection:Connection,explode=0,unplug=0) {
  const from={...connection.from,point:[...connection.from.point] as Vec};
  if(from.device==='gateway'){
    const part=PARTS.find(item=>item.id==='gateway')!;
    const offset=new Vector3(...GATEWAY_EXPLODE[connection.wireless?'GatewayAntennae':'GatewayPorts']);
    offset.multiplyScalar(part.size/Math.max(...bounds.GatewayTwin.size)*explode).applyAxisAngle(new Vector3(0,1,0),part.yaw??0);
    from.point=new Vector3(...from.point).add(offset).toArray() as Vec;
  }
  if(unplug)from.point=outward(from,unplug*CONNECTOR_WITHDRAWAL);
  if(connection.wireless){
    const start=new Vector3(...from.point),end=new Vector3(...connection.to.point),middle=start.clone().lerp(end,.5);
    middle.y+=Math.min(1.7,start.distanceTo(end)*.16);
    const path=new CurvePath<Vector3>();path.add(new QuadraticBezierCurve3(start,middle,end));return path;
  }
  const points=[from.point,outward(from,.15),...connection.via,outward(connection.to,.15),connection.to.point].map(point=>new Vector3(...point));
  const path=new CurvePath<Vector3>();let last=points[0];
  for(let i=1;i<points.length-1;i++){
    const previous=points[i-1],corner=points[i],next=points[i+1];
    const distance=Math.min(.16,previous.distanceTo(corner)*.35,next.distanceTo(corner)*.35);
    const entry=corner.clone().add(previous.clone().sub(corner).normalize().multiplyScalar(distance));
    const exit=corner.clone().add(next.clone().sub(corner).normalize().multiplyScalar(distance));
    if(last.distanceTo(entry)>.00001)path.add(new LineCurve3(last,entry));
    path.add(new QuadraticBezierCurve3(entry,corner.clone(),exit));last=exit;
  }
  path.add(new LineCurve3(last,points[points.length-1]));return path;
}
