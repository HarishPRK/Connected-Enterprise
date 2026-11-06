import type { OfferingId } from './OfferingScene';
import { sampleTwin } from './OfferingTwinStory';
import { sampleRouting } from './OfferingRoutingStory';
import { sampleEagleActor, sampleEagleCamera, sampleEagleSignals } from './OfferingEagleMotion';
import { sampleSmartActor, sampleSmartCamera } from './OfferingSmartMotion';
import { sampleSmart } from './OfferingSmartStory';
import { sampleAutomation } from './OfferingAutomationStory';
import { CHECKOUT_SHOTS, isCheckoutStory, sampleCheckout } from './OfferingCheckoutStory';

export type StoryPoint = [number, number, number];
export type ActorRole = 'Customer' | 'Staff' | 'Technician' | 'Security';
export type ActorId = 'shopper' | 'queue1' | 'queue2' | 'staff' | 'caller' | 'technician' | 'security' | 'crowd1' | 'crowd2' | 'crowd3' | 'crowd4';
export interface ActorPose { at: StoryPoint; heading: number; walk: number; distance:number; phase:number; tap: number; fall: number; collapse:number; kneel: number; tablet: number; phone:number; carry:number; receipt:number; concern:number; lookY:number; visible: boolean; }
export interface StoryContext { offering: OfferingId; variant: string; }
export interface StorySignal { text: string; detail: string; at: StoryPoint; color: string; visible: boolean; }
export const STORY_ACTORS: { id: ActorId; role: ActorRole }[] = [
  {id:'shopper',role:'Customer'},{id:'queue1',role:'Customer'},{id:'queue2',role:'Customer'},
  {id:'staff',role:'Staff'},{id:'technician',role:'Technician'},{id:'security',role:'Security'},
  {id:'caller',role:'Staff'},
  {id:'crowd1',role:'Customer'},{id:'crowd2',role:'Customer'},{id:'crowd3',role:'Customer'},{id:'crowd4',role:'Customer'},
];
export const storyProgress=(time:number,start:number,end:number)=>Math.max(0,Math.min(1,(time-start)/Math.max(.001,end-start)));
const ease=(t:number)=>t*t*(3-2*t);
type Stop=[number,number,number];
const pose=(x:number,z:number,heading=0):ActorPose=>({at:[x,.04,z],heading,walk:0,distance:0,phase:0,tap:0,fall:0,collapse:0,kneel:0,tablet:0,phone:0,carry:0,receipt:0,concern:0,lookY:0,visible:true});
const angleBetween=(a:number,b:number)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
const turn=(a:number,b:number,weight:number)=>a+angleBetween(a,b)*weight;
const legDistance=(a:Stop,b:Stop)=>Math.hypot(b[1]-a[1],b[2]-a[2]);
function travel(stops:Stop[],time:number,heading=0):ActorPose {
  let travelled=0;
  if(time<stops[0][0])return pose(stops[0][1],stops[0][2],heading);
  for(let i=1;i<stops.length;i++){
    const a=stops[i-1],b=stops[i],distance=legDistance(a,b);
    if(time>b[0]){travelled+=distance;continue;}
    const u=storyProgress(time,a[0],b[0]),duration=b[0]-a[0],moving=distance>.01;
    const before=i>1&&legDistance(stops[i-2],a)>.01,after=i+1<stops.length&&legDistance(b,stops[i+1])>.01;
    // Hermite distance easing stops feet at a hold, while consecutive waypoints
    // carry their speed through the turn instead of stopping at every corner.
    const m0=before?1:0,m1=after?1:0;
    const k=Math.max(0,Math.min(1,(-2*u*u*u+3*u*u)+(u*u*u-2*u*u+u)*m0+(u*u*u-u*u)*m1));
    const velocity=(-6*u*u+6*u)+(3*u*u-4*u+1)*m0+(3*u*u-2*u)*m1;
    const direction=Math.atan2(b[1]-a[1],b[2]-a[2]);
    let facing=moving?direction:heading;
    const turnTime=Math.min(.45,duration*.22);
    if(moving&&time<a[0]+turnTime){
      const previous=before?Math.atan2(a[1]-stops[i-2][1],a[2]-stops[i-2][2]):heading;
      facing=turn(previous,direction,before?.5+.5*ease(storyProgress(time,a[0],a[0]+turnTime)):ease(storyProgress(time,a[0],a[0]+turnTime)));
    }
    if(moving&&time>b[0]-turnTime){
      const next=after?Math.atan2(stops[i+1][1]-b[1],stops[i+1][2]-b[2]):heading;
      facing=turn(direction,next,(after?.5:1)*ease(storyProgress(time,b[0]-turnTime,b[0])));
    }
    const result=pose(a[1]+(b[1]-a[1])*k,a[2]+(b[2]-a[2])*k,facing);
    result.distance=travelled+distance*k;
    result.walk=moving?Math.min(1,Math.max(0,velocity*distance/duration)/1.45):0;
    return result;
  }
  const end=stops[stops.length-1],result=pose(end[1],end[2],heading);result.distance=travelled;return result;
}
export function monitoredPoint(variant:string):StoryPoint {
  return variant==='fiber'?[14.6,.4,-6]:variant==='5g'?[14.6,.4,1.4]:variant==='it'?[10,.5,-6]:variant==='ot'?[-7.55,1.1,-6]:[6.7,1.2,-3];
}
export function smartPoint(variant:string):StoryPoint {return variant==='hvac'?[-9,.5,-6]:variant==='cooler'?[-1.35,.5,-7.6]:[-10.5,1,1.6];}

/** Pure absolute-clock choreography: forward play and backwards scrubbing agree. */
export function sampleActor(id:ActorId,{offering,variant}:StoryContext,time:number):ActorPose {
  const t=Math.max(0,Math.min(24,time));
  let result=pose(id==='staff'?8:id==='technician'?9.5:id==='security'?10.8:-5,id==='staff'?3.25:id==='technician'?-1.5:id==='security'?-6.8:5.7,0);
  if(id==='caller'){result=pose(8,8.15,Math.PI);result.visible=false;result.phone=ease(storyProgress(t,.6,2));}
  if(id.startsWith('crowd'))result.visible=false;
  if(id==='technician'){result.tablet=1;result.visible=['twin','eagle','smart'].includes(offering);}
  if(id==='security')result.visible=offering==='video'&&variant==='intruder';
  if(isCheckoutStory({offering,variant})){
    const release=17;
    if(id==='shopper'){
      result=travel([[0,3.6,7.8],[1.2,5.55,7.8],[2,5.55,5.55],[3.05,7.25,5.55],[release-2,7.25,5.55],[release-.6,8.43,5.55],[release,8.43,5.55],[release+2.2,5.55,5.55],[release+3.8,5.55,8.3],[release+7,1,11.5]],t,Math.PI);
      if(t>=3.05&&t<release)result.tap=sampleCheckout({offering,variant},t).cardReach;
      // Take the basket first, step to the printer, collect the receipt, leave.
      result.carry=ease(storyProgress(t,release-2.8,release-2));
      result.receipt=ease(storyProgress(t,release-.7,release-.1));
      result.tap=Math.max(result.tap,ease(storyProgress(t,release-3.3,release-2.8))*(1-ease(storyProgress(t,release-2,release-1.5)))*.65);
      if(offering==='failover'&&variant==='fiber')result.lookY=-.35*ease(storyProgress(t,4.5,5.5))*(1-ease(storyProgress(t,9.5,10.3)));
    }
    if(id==='queue1')result=travel([[0,2.6,8],[4,4.6,6.2],[release+2,4.6,6.2],[release+4,5.55,5.55],[release+7,7.25,5.55]],t,Math.PI);
    if(id==='queue2')result=travel([[0,1.2,9],[5,3.5,7.1],[release+2,3.5,7.1],[release+6,5.3,6.1]],t,Math.PI);
    if(id==='staff'){result=pose(8,3.25,0);result.tap=.12+ease(storyProgress(t,11.6,12.6))*(1-ease(storyProgress(t,14.5,15.5)))*.55;if(offering==='failover'&&variant==='fiber'){result.concern=ease(storyProgress(t,5,6))*(1-ease(storyProgress(t,9.5,10.5)))*.6;result.lookY=-.3*result.concern;}}
  }else if(offering==='routing'){
    result.visible=false;
    if(id==='staff'){result=pose(8.32,5.35,Math.PI);result.lookY=-.12;result.concern=variant==='teams'&&t>=4&&t<14?.35:0;}
    if(id==='caller'){result=pose(8.22,7.58,Math.PI);result.phone=0;result.lookY=variant==='voice'&&t<16?-.25:0;}
    if(id==='queue1'){result=pose(10.25,-4.66,Math.PI);result.lookY=-.12;}
    if(id==='technician'){
      result=travel([[0,9.1,-.45],[2,9.1,-.45],[3.5,9.1,.88],[4.75,7.27,.88],[4.95,7.27,.88],[5.5,7.27,.71],[24,7.27,.71]],t,Math.PI);
      result.visible=true;result.tablet=0;result.lookY=-.16;
    }
  }else if(offering==='video'){
    if(variant==='man-down'){
      if(id==='shopper'){result=travel([[0,-3.5,6],[4,.3,6]],t,Math.PI/2);result.collapse=ease(storyProgress(t,4.1,4.8));result.fall=ease(storyProgress(t,4.7,6.1));result.at[1]+=.13*result.fall;result.walk*=1-result.collapse;result.heading=Math.PI/2;}
      if(id==='staff'){result=travel([[0,8,3.25],[11,8,3.25],[13,5.7,3.25],[14.5,5.7,5.5],[18,1.2,5.3]],t,0);result.kneel=ease(storyProgress(t,18,20));}
      if(id==='queue1'||id==='queue2'){
        const reaction=ease(storyProgress(t,4.7,6)),first=id==='queue1';
        const x=first?-2.9:3.1,z=first?7.7:8.1,heading=first?1.6:-1.8;
        result=pose(x+(first?-.2:.2)*reaction,z+.35*reaction,turn(heading,Math.atan2(1.1-x,6-z),reaction));
        result.concern=reaction*.65;result.lookY=0;
      }
    }else if(variant==='intruder'){
      if(id==='shopper')result=travel([[0,9.8,1.2],[4,9.8,-1.5],[7,9.8,-4.2],[24,9.8,-4.2]],t,Math.PI);
      if(id==='security'){result=travel([[0,10.8,-7.8],[11,10.8,-7.8],[15,10.9,-5.2],[18,10.5,-4.2]],t,-Math.PI/2);result.tap=storyProgress(t,18,19)*.7;}
      if(id==='queue1')result=pose(-3.5,6.3,.5);if(id==='queue2')result=pose(3.1,8.2,-.8);
    }else{
      const positions:Record<string,[number,number,number,number]>={shopper:[-.4,6.7,-5,6],queue1:[1,7.1,-3.7,6.5],queue2:[2,6.4,-2.4,6],crowd1:[.3,8,-1,7],crowd2:[1.7,8.3,.5,6],crowd3:[3,7.5,2.4,5.3],crowd4:[3.5,6.3,4.4,5.5]};
      const p=positions[id];if(p){result=travel([[0,p[0]+(id.startsWith('crowd')?1.5:-1.5),11.8],[7,p[0],p[1]],[15,p[0],p[1]],[23,p[2],p[3]]],t,.3);result.visible=true;}
      if(id==='staff'){result=travel([[0,8,3.25],[10,8,3.25],[12,5.7,3.25],[14,5.7,5.6],[18,3.8,6.8]],t,-Math.PI/2);result.tap=storyProgress(t,14,15)*.85;}
    }
  }else if(offering==='automation'){
    if(id==='shopper'){
      const staying=variant==='occupied';
      result=travel(staying?[[0,-8.9,.35],[4,-8.9,.35],[7,-7.35,2.4],[24,-7.35,2.4]]:[[0,-8.9,.35],[4,-8.9,.35],[5.8,-7.5,.35],[8.5,-7.5,-2.75],[24,-7.5,-2.75]],t,staying?-.9:Math.PI);
      result.tablet=1;result.visible=staying||t<9;
    }
    if(id==='queue1'||id==='queue2')result.visible=false;
    if(id==='staff'){result=pose(8,3.25,0);result.visible=false;}
  }else if(offering==='eagle'){
    result=sampleEagleActor(id,variant,t);
  }else if(offering==='smart'){
    result=sampleSmartActor(id,variant,t);
  }else if(offering==='twin'){
    if(id==='technician'){result=travel([[0,7.27,.71],[9,7.27,.71],[9.65,8.6,.71],[10.65,8.6,-1.7],[11.4,6.82,-2.14],[17,6.82,-2.14],[17.75,8.6,-1.7],[19,8.6,.71],[20,7.27,.71],[24,7.27,.71]],t,t>=9&&t<19?Math.PI+.3:Math.PI);result.tablet=0;result.tap=sampleTwin(t).typing*.3;result.lookY=0;}
    if(id==='shopper')result=pose(3.1,8.1,-.8);if(id==='queue1')result=pose(-3.5,6.3,.5);if(id==='queue2')result.visible=false;
  }
  if(offering==='smart'&&variant==='energy'&&id!=='technician')result.visible=false;
  result.phase=STORY_ACTORS.findIndex(actor=>actor.id===id)*1.618;
  return result;
}

interface CameraStop { t:number; at:StoryPoint; distance:number; yaw?:number; pitch?:number; cut?:boolean }
export function sampleStoryCamera(context:StoryContext,time:number):{target:StoryPoint;distance:number;yaw:number;pitch:number} {
  const {offering,variant}=context;let stops:CameraStop[];
  // Cut from the observed event to the dedicated inference appliance, then
  // return to the original human-response sequence at exactly the same clock.
  if(offering==='video'&&time>=10.05&&time<13.05)return {target:[8.05,1.33,-2.9],distance:1.7-(time-10.05)*.04,yaw:-.65,pitch:.26};
  if(offering==='routing'){
    const point:StoryPoint=variant==='archive'?[10,1.47,-5.39]:variant==='voice'?[8,1.19,7.03]:[8,1.5,4.515];
    const close=variant==='voice'?1.05:variant==='archive'?1.5:1.35;
    const pitch=variant==='voice'?.65:.16,yaw=variant==='voice'?-1.1:-.95;
    stops=[
      {t:0,at:[point[0],1.18,point[2]+.4],distance:4.5,yaw:-1,pitch:.25},
      {t:2.8,at:[point[0],1.25,point[2]+.3],distance:3.7,yaw:-1,pitch:.25},
      {t:3,at:point,distance:close,yaw,pitch,cut:true},
      {t:5.5,at:point,distance:close*.97,yaw,pitch},
      {t:5.6,at:[7.25,1.25,.45],distance:2.6,yaw:-1.2,pitch:.28,cut:true},
      {t:6,at:[7.1,1.1934,.156],distance:.77,yaw:-.8,pitch:.30,cut:true},
      {t:13.9,at:[7.1,1.1934,.156],distance:.74,yaw:-.8,pitch:.30},
      {t:14,at:point,distance:close,yaw,pitch,cut:true},
      ...(variant==='voice'?[{t:15.8,at:point,distance:close,yaw,pitch},{t:16,at:[8.025,1.238,6.953] as StoryPoint,distance:.46,yaw:-.8,pitch:.22,cut:true},{t:18.2,at:[8.025,1.238,6.953] as StoryPoint,distance:.45,yaw:-.8,pitch:.22}]:[{t:18.2,at:point,distance:close*.97,yaw,pitch}]),
      {t:18.3,at:[point[0],1.2,point[2]+.35],distance:3.3,yaw:-1.2,pitch:.22,cut:true},
      {t:20.6,at:[point[0],1.2,point[2]+.35],distance:3.1,yaw:-1.2,pitch:.22},
      {t:20.7,at:[7.1,1.1934,.156],distance:.77,yaw:-.8,pitch:.30,cut:true},
      {t:24,at:[7.1,1.1934,.156],distance:.77,yaw:-.8,pitch:.30},
    ];
  }
  else if(isCheckoutStory(context))stops=CHECKOUT_SHOTS;
  else if(offering==='twin')stops=[
    {t:0,at:[7.18,1.17,.28],distance:3.2,yaw:-1.1,pitch:.3},
    {t:2.8,at:[7.1,1.19,.156],distance:2.5,yaw:-1.1,pitch:.3},
    {t:4,at:[7.1,1.1934,.156],distance:.74,yaw:-1.42,pitch:.30},
    {t:8.95,at:[7.1,1.1934,.156],distance:.72,yaw:-1.42,pitch:.30},
    {t:9,at:[7.2,1.13,-.7],distance:4.6,yaw:-.4,pitch:.3,cut:true},
    {t:10.9,at:[6.66,1.22,-2.34],distance:2.4,yaw:-1.2,pitch:.25},
    {t:12.2,at:[6.49,1.18,-2.53],distance:.76,yaw:-1.1,pitch:.34},
    {t:15.35,at:[6.49,1.18,-2.53],distance:.72,yaw:-1.1,pitch:.34},
    {t:16.1,at:[6.65,1.3,-2.37],distance:2.3,yaw:-1,pitch:.28},
    {t:18.8,at:[7.15,1.2,.2],distance:3.3,yaw:-1.1,pitch:.3},
    {t:20,at:[7.1,1.1934,.156],distance:.74,yaw:-1.42,pitch:.30},
    {t:22,at:[7.1,1.1934,.156],distance:.72,yaw:-1.42,pitch:.30},
    {t:22.05,at:[6.9,1.18,-1.15],distance:5.6,yaw:-.5,pitch:.33,cut:true},
    {t:24,at:[6.9,1.18,-1.15],distance:5.8,yaw:-.5,pitch:.33},
  ];
  else if(offering==='eagle')return sampleEagleCamera(variant,time);
  else if(offering==='automation')stops=variant==='occupied'?[
    {t:0,at:[-9.6,1.3,-.1],distance:7,yaw:-.1,pitch:.3},
    {t:2.9,at:[-8.9,1.25,.35],distance:2.5,yaw:-1.1,pitch:.3},
    {t:3,at:[-10.2,1.97,-1.39],distance:.72,yaw:-.45,pitch:.18,cut:true},
    {t:4.5,at:[-10.2,1.97,-1.39],distance:.70,yaw:-.45,pitch:.18},
    {t:4.6,at:[-8.1,1.3,.9],distance:5.5,yaw:-.2,pitch:.3,cut:true},
    {t:8.9,at:[-7.35,1.15,2.4],distance:3.7,yaw:-.2,pitch:.3},
    {t:9,at:[-10.15,2.76,-.95],distance:.8,yaw:-.3,pitch:-.25,cut:true},
    {t:11.9,at:[-10.15,2.76,-.95],distance:.75,yaw:-.3,pitch:-.25},
    {t:12,at:[-10.2,1.97,-1.39],distance:.72,yaw:-.45,pitch:.18,cut:true},
    {t:16.9,at:[-10.2,1.97,-1.39],distance:.70,yaw:-.45,pitch:.18},
    {t:17,at:[-8.9,1.35,.6],distance:7.5,yaw:-.25,pitch:.3,cut:true},
    {t:24,at:[-8.9,1.35,.6],distance:7.8,yaw:-.25,pitch:.3},
  ]:[
    {t:0,at:[-9.6,1.3,-.1],distance:7,yaw:-.1,pitch:.3},
    {t:2.9,at:[-8.9,1.25,.35],distance:2.5,yaw:-1.1,pitch:.3},
    {t:3,at:[-10.2,1.97,-1.39],distance:.72,yaw:-.45,pitch:.18,cut:true},
    {t:4.2,at:[-10.2,1.97,-1.39],distance:.70,yaw:-.45,pitch:.18},
    {t:4.3,at:[-8.5,1.2,-.5],distance:5.8,yaw:-.2,pitch:.3,cut:true},
    {t:8.8,at:[-8.5,1.2,-.5],distance:5.4,yaw:-.2,pitch:.3},
    {t:8.9,at:[-10.15,2.76,-.95],distance:.8,yaw:-.3,pitch:-.25,cut:true},
    {t:10.7,at:[-10.15,2.76,-.95],distance:.75,yaw:-.3,pitch:-.25},
    {t:10.8,at:[-11.25,1.70,-1.37],distance:1.75,yaw:-.45,pitch:.17,cut:true},
    {t:12.4,at:[-11.25,1.70,-1.37],distance:1.68,yaw:-.45,pitch:.17},
    {t:12.5,at:[-10.2,1.12,-1.10],distance:1.3,yaw:-.55,pitch:-.1,cut:true},
    {t:13.9,at:[-10.2,1.12,-1.10],distance:1.25,yaw:-.55,pitch:-.1},
    {t:14,at:[-9.1,1.40,-1.35],distance:.47,yaw:-.2,pitch:.16,cut:true},
    {t:14.7,at:[-9.1,1.40,-1.35],distance:.47,yaw:-.2,pitch:.16},
    {t:15,at:[-9.1,1.76,-1.35],distance:1.6,yaw:-.2,pitch:.16},
    {t:16.3,at:[-9.1,1.76,-1.35],distance:1.6,yaw:-.2,pitch:.16},
    {t:16.4,at:[-10.2,1.97,-1.39],distance:.72,yaw:-.45,pitch:.18,cut:true},
    {t:18.2,at:[-10.2,1.97,-1.39],distance:.70,yaw:-.45,pitch:.18},
    {t:18.3,at:[-4.7,1.15,-4.5],distance:17,yaw:-.4,pitch:.4,cut:true},
    {t:24,at:[-4.7,1.15,-4.5],distance:17.5,yaw:-.4,pitch:.4},
  ];
  else if(offering==='smart')return sampleSmartCamera(variant,time);
  else if(variant==='intruder')stops=[{t:0,at:[9.7,1,.2],distance:11.5,yaw:-.6,pitch:.34},{t:5,at:[9.7,1,-2.4],distance:11,yaw:-.6,pitch:.34},{t:5.05,at:[9.8,1,-4.2],distance:8.5,yaw:-.6,pitch:.35,cut:true},{t:12,at:[9.8,1,-4.2],distance:8.2,yaw:-.6,pitch:.35},{t:12.05,at:[10,1,-5.2],distance:10.5,yaw:-.6,pitch:.4,cut:true},{t:19,at:[10,1,-4.1],distance:10,yaw:-.6,pitch:.4},{t:19.05,at:[10.1,1,-4.1],distance:7.8,yaw:-.6,pitch:.32,cut:true},{t:24,at:[10.1,1,-4.1],distance:7.6,yaw:-.6,pitch:.32}];
  else if(variant==='crowd')stops=[{t:0,at:[1.3,1,8.2],distance:15,pitch:.44},{t:6,at:[1.3,1,7.3],distance:14.5,pitch:.44},{t:6.05,at:[1.3,1,7],distance:11.5,pitch:.45,cut:true},{t:13,at:[1.3,1,7],distance:11.2,pitch:.45},{t:13.05,at:[3.5,1,5.9],distance:12,pitch:.4,cut:true},{t:20,at:[1.5,1,6],distance:13,pitch:.4},{t:20.05,at:[0,1,6.5],distance:17,pitch:.46,cut:true},{t:24,at:[0,1,6.5],distance:17.3,pitch:.46}];
  else stops=[{t:0,at:[-1,.9,6],distance:10.4,yaw:1.25,pitch:.37},{t:4,at:[.2,.8,5.8],distance:9.8,yaw:1.25,pitch:.37},{t:8.6,at:[.4,.6,5.4],distance:9.4,yaw:1.25,pitch:.38},{t:8.65,at:[5.8,1,4.3],distance:11,yaw:1.25,pitch:.4,cut:true},{t:15,at:[3.8,.8,5.3],distance:10.7,yaw:1.25,pitch:.4},{t:15.05,at:[.8,.5,5.3],distance:8.2,yaw:1.25,pitch:.37,cut:true},{t:20,at:[.8,.5,5.3],distance:7.8,yaw:1.25,pitch:.37},{t:24,at:[.8,.5,5.3],distance:8,yaw:1.25,pitch:.37}];
  const t=Math.max(0,Math.min(24,time));let a=stops[0],b=stops[stops.length-1];
  for(let i=1;i<stops.length;i++)if(t<=stops[i].t){a=stops[i-1];b=stops[i];break;}
  const k=b.cut?(t>=b.t?1:0):ease(storyProgress(t,a.t,b.t));return {target:a.at.map((value,i)=>value+(b.at[i]-value)*k) as StoryPoint,distance:a.distance+(b.distance-a.distance)*k,yaw:turn(a.yaw||0,b.yaw||0,k),pitch:(a.pitch??.44)+((b.pitch??.44)-(a.pitch??.44))*k};
}

export function sampleSignals({offering,variant}:StoryContext,time:number):StorySignal[] {
  const t=Math.max(0,Math.min(24,time)),event=t>=4,response=t>=10;
  const signal=(text:string,detail:string,at:StoryPoint,color='#68d6ff',visible=true):StorySignal=>({text,detail,at,color,visible});
  if(offering==='failover')return [
    signal(!event?'Tap to pay':t<13&&variant==='fiber'?'Payment on hold':t<17?'Payment approved':'Receipt issued',!event?'Checkout 01':t<13&&variant==='fiber'?'Waiting for an available path':t<17?'Transaction completed':'Next customer, please',[8,3.5,4.5],t>=4&&t<13&&variant==='fiber'?'#ffbd79':'#8ce3c6'),
    signal(!event?'Fiber primary · 5G ready':variant==='fiber'?response?'5G carries the transaction':'Fiber link interrupted':response?'Fiber remains active':'5G backup unavailable',response?'Traffic follows gateway policy':'Local demonstration',variant==='fiber'?(response?[14.6,5.5,1.4]:[14.6,2.8,-6]):(response?[14.6,2.8,-6]:[14.6,5.5,1.4]),event?'#b4a5ff':'#68d6ff',t>6&&t<16),
  ];
  if(offering==='routing'){
    const state=sampleRouting(t,variant);
    return [signal(state.brokerAccepted?'Published · gateway evidence pending':'Five applications · four online tunnels',state.status,[7.1,1.6,.25],'#9dd9bb',t>=5.6&&t<6)];
  }
  if(offering==='twin'){const twin=sampleTwin(t);return [signal(twin.resolved?'LAN 1 / link stable':'LAN 1 / inspect connector',twin.action,[6.48,1.37,-2.55],twin.color,t>=9&&t<20)];}
  if(offering==='eagle')return sampleEagleSignals(variant,t);
  if(offering==='automation'){
    const routine=sampleAutomation(variant,t);
    if(t>=8.9&&t<10.8||variant==='occupied'&&t>=9&&t<12)return [signal(routine.presence?'Zigbee / presence detected':'Zigbee / vacancy check',routine.detail,[-10.15,2.9,-.9],routine.presence?'#efba7c':'#9dd9bb')];
    const id=t<12.5?'display':t<14?'lamp':'sign',device=routine.devices[id],x=id==='display'?-11.25:id==='lamp'?-10.2:-9.1;
    const readback=id==='sign'&&t>=15?`${routine.devices.sign.watts.toFixed(0)} W · ${device.confirmed?'verified':'checking'}`:device.confirmed?'Off confirmed':device.ack?'acknowledged':device.requested?'command sent':'On';
    return [signal(`${id==='sign'?'Shelly · MQTT':device.transport} / ${readback}`,device.status,[x,id==='lamp'?1.8:2.4,-1.15],device.confirmed?'#9dd9bb':'#efba7c',variant!=='occupied'&&t>=10.8&&t<16.4)];
  }
  if(offering==='smart'){
    const p=smartPoint(variant),state=sampleSmart(variant,t);return [signal(state.status,state.detail,[p[0],3.5,p[2]],state.verification.trendImproving?'#9dd9bb':'#efba7c')];
  }
  if(offering==='video'&&t>=10.05&&t<13.05)return [signal('Dell analytics server','Camera A + Camera B / local inference',[8.05,1.7,-2.9],'#b4a5ff')];
  const actor=sampleActor('shopper',{offering,variant},t);
  if(variant==='man-down')return [signal(t<4?'Customer aisle':t<10?'A person has fallen':t<17?'Possible fall · verify & assist':'Colleague assisting',t<4?'Camera observes the shared aisle':t<10?'Scene event before the edge response':t<17?'Local analytics prompts operator review':'Human response follows the alert',[actor.at[0]-.7,2.7,actor.at[2]-1.1],t<4?'#68d6ff':'#ffc885')];
  if(variant==='intruder')return [signal(t<4?'Staff-only access':t<10?'Boundary crossed':t<17?'Entry alert · review required':'Security checks the entry',t<4?'Defined restricted area':t<10?'Track movement through the boundary':t<17?'Operator reviews the event':'An alert supports a human decision',[actor.at[0],3,actor.at[2]],t<4?'#68d6ff':'#ff897a')];
  return [signal(t<4?'Customers arriving':t<10?'Aisle becoming congested':t<17?'Crowd alert · staff notified':'Staff redirects the flow',t<4?'Observe the entrance and checkout':t<10?'People gather near the checkout':t<17?'The team sees where help is needed':'The open aisle provides more space',[1.2,3.4,6.8],t<4?'#68d6ff':'#ffc885')];
}
