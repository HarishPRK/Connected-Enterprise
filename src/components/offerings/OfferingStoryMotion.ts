import type { OfferingId } from './OfferingScene';
import { sampleTwin } from './OfferingTwinStory';
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
  if(id==='caller'){result=pose(8,8.15,Math.PI);result.visible=offering==='routing';result.phone=ease(storyProgress(t,.6,2));}
  if(id.startsWith('crowd'))result.visible=false;
  if(id==='technician'){result.tablet=1;result.visible=['twin','eagle','smart'].includes(offering);}
  if(id==='security')result.visible=offering==='video'&&variant==='intruder';
  if(offering==='failover'){
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
    // Business demand, not a broken link: the supplier call is the human lead.
    if(id==='caller'){result=pose(8,8.18,Math.PI);result.phone=ease(storyProgress(t,.6,2))*(1-ease(storyProgress(t,21,23)));result.concern=.35*ease(storyProgress(t,4,5))*(1-ease(storyProgress(t,10,12)));result.lookY=.12*Math.sin(t*.9);}
    if(id==='shopper')result=travel([[0,-3.5,6],[24,3.5,6]],t,Math.PI/2);
    if(id==='queue1')result=pose(1.5,9.2,-.3);
    if(id==='queue2')result.visible=false;
    if(id==='staff'){result=pose(10.9,-4.4,Math.PI);result.tablet=1;result.tap=.3;}
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
    const leaving=variant==='after-hours';
    if(id==='shopper')result=travel(leaving?[[0,-8.5,.8],[4,-5,5.6],[8,1,9.7],[10,1,12.5]]:[[0,1,12.5],[4,1,9.7],[8,-5,5.6],[11,-8.5,.8]],t);
    if(id==='queue1'||id==='queue2')result.visible=false;
    if(id==='staff'){result=pose(8,3.25,0);result.visible=false;}
  }else if(offering==='eagle'||offering==='smart'){
    const target=offering==='eagle'?monitoredPoint(variant):smartPoint(variant);
    if(id==='technician'){
      const nearX=target[0]>12?12.7:target[0]+1.2,nearZ=target[2]<-4?target[2]+1.3:target[2]+.4;
      const arrive=11+Math.min(8.5,Math.max(2.5,Math.abs(nearX-8.9)/1.5));
      result=travel([[0,8.9,-4.35],[10,8.9,-4.35],[arrive,nearX,-4.35],[arrive+1.8,nearX,nearZ]],t,Math.atan2(target[0]-nearX,target[2]-nearZ));
      result.tablet=1;result.tap=ease(storyProgress(t,arrive+1.8,arrive+2.6))*.5;
    }
    if(id==='shopper')result=offering==='smart'&&variant==='cooler'?travel([[0,-1.2,-5.5],[4,-1.2,-6.1],[8,-1.2,-6.1],[12,2,-4.3],[18,5.7,4.5]],t,Math.PI):pose(3.1,8.1,-.8);
    if(id==='queue1')result=pose(-3.5,6.3,.5);if(id==='queue2')result.visible=false;
  }else if(offering==='twin'){
    if(id==='technician'){result=travel([[0,7.1,1.14],[9,7.1,1.14],[9.65,8.45,1.14],[10.65,8.45,-1.7],[11.4,6.8,-1.9],[17,6.8,-1.9],[17.75,8.45,-1.7],[19,8.45,1.14],[20,7.1,1.14],[24,7.1,1.14]],t,Math.PI);result.tablet=0;result.tap=sampleTwin(t).typing*.3;result.lookY=0;}
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
  if(offering==='video'&&time>=10.05&&time<13.05)return {target:[7.4,2,-3],distance:6.7-(time-10.05)*.08,yaw:-.75,pitch:.28};
  // A short-film grammar: establish the place, stay with the human reaction,
  // cut to the responsible equipment, then return for the business payoff.
  // Cuts are authored in absolute time; pauses and backwards seeks reproduce
  // the same shot, rather than replaying a camera tween from an arbitrary pose.
  if(isCheckoutStory(context))stops=CHECKOUT_SHOTS;
  else if(offering==='routing')stops=[
    {t:0,at:[7.6,1.25,7.6],distance:8.8,yaw:1.7,pitch:.28},
    {t:3.95,at:[8,1.35,8.05],distance:5.6,yaw:1.65,pitch:.23},
    {t:4,at:variant==='stock'?[10,1.7,-6]:[8.05,2,-3],distance:6.8,yaw:-.55,pitch:.28,cut:true},
    {t:8.95,at:[8,2,-3],distance:6.5,yaw:-.5,pitch:.28},
    {t:9,at:[10.2,2,-1.6],distance:16,yaw:-.17,pitch:.33,cut:true},
    {t:17,at:[10.2,2,-1.6],distance:15.5,yaw:-.12,pitch:.33},
    {t:17.05,at:variant==='voice'?[8,1.3,8.15]:variant==='stock'?[10,1.7,-6]:[8.05,2,-3],distance:variant==='voice'?6.5:7,yaw:variant==='voice'?1.65:-.55,pitch:.28,cut:true},
    {t:21,at:variant==='voice'?[8,1.3,8.15]:variant==='stock'?[10,1.7,-6]:[8.05,2,-3],distance:variant==='voice'?6.2:6.6,yaw:variant==='voice'?1.65:-.55,pitch:.28},
    {t:21.05,at:[7,1.3,4.5],distance:20,yaw:.1,pitch:.4,cut:true},
    {t:24,at:[7,1.3,4.5],distance:20.5,yaw:.1,pitch:.4},
  ];
  else if(offering==='twin')stops=[
    {t:0,at:[7.1,1.3,-.8],distance:8,yaw:.15,pitch:.31},
    {t:3.95,at:[7.1,1.25,-.5],distance:7.5,yaw:.15,pitch:.31},
    {t:4,at:[7.1,1.56,-.04],distance:1.85,yaw:-1,pitch:.23,cut:true},
    {t:8.95,at:[7.1,1.56,-.04],distance:1.85,yaw:-1,pitch:.23},
    {t:9,at:[7.1,1.4,-.8],distance:7.2,yaw:.15,pitch:.27,cut:true},
    {t:11.35,at:[6.6,1.45,-2.4],distance:5.4,yaw:-.1,pitch:.25},
    {t:11.4,at:[6.62,1.45,-2.39],distance:2.3,yaw:-1.4,pitch:.19,cut:true},
    {t:15.35,at:[6.62,1.45,-2.39],distance:2.2,yaw:-1.4,pitch:.19},
    {t:15.4,at:[6.6,1.7,-2.6],distance:4.8,yaw:-.9,pitch:.24,cut:true},
    {t:19.95,at:[5.8,1.4,-2.2],distance:7.8,yaw:-.2,pitch:.3},
    {t:20,at:[7.1,1.56,-.04],distance:1.85,yaw:-1,pitch:.23,cut:true},
    {t:22,at:[7.1,1.56,-.04],distance:1.85,yaw:-1,pitch:.23},
    {t:22.05,at:[6,1.5,-2.7],distance:9.8,yaw:-.2,pitch:.32,cut:true},
    {t:24,at:[6,1.5,-2.7],distance:10,yaw:-.2,pitch:.32},
  ];
  else if(offering==='eagle'){const p=monitoredPoint(variant),span=variant==='5g'?11.7:8.8;stops=[{t:0,at:[7.5,1.3,-3],distance:13,pitch:.4},{t:4.8,at:[7.5,1.3,-3],distance:12.7,pitch:.4},{t:4.85,at:[p[0],p[1]+.7,p[2]],distance:span,pitch:.4,cut:true},{t:14.5,at:[p[0],p[1]+.7,p[2]],distance:span-.3,pitch:.4},{t:14.55,at:[p[0]+.5,1.1,p[2]+.7],distance:span+2,pitch:.38,cut:true},{t:24,at:[p[0]+.5,1.1,p[2]+.7],distance:span+1.5,pitch:.38}];}
  else if(offering==='automation')stops=[{t:0,at:[-5,1,4.4],distance:18,pitch:.4},{t:7.8,at:[-3.5,1,5.4],distance:18.5,pitch:.4},{t:7.85,at:[-9.9,1.3,.2],distance:9.4,pitch:.3,cut:true},{t:18,at:[-9.9,1.3,.2],distance:9,pitch:.3},{t:18.05,at:[-8.5,1,.8],distance:14,pitch:.42,cut:true},{t:24,at:[-8.5,1,.8],distance:14.4,pitch:.42}];
  else if(offering==='smart'){const p=smartPoint(variant);stops=[{t:0,at:[p[0],1.2,p[2]],distance:12,pitch:.43},{t:4.8,at:[p[0],1.2,p[2]],distance:11.6,pitch:.43},{t:4.85,at:[p[0],1.2,p[2]],distance:variant==='energy'?9.5:8.5,pitch:.38,cut:true},{t:14.5,at:[p[0],1.2,p[2]],distance:variant==='energy'?9.2:8.2,pitch:.38},{t:14.55,at:[p[0]+.7,1.1,p[2]+.6],distance:11,pitch:.4,cut:true},{t:24,at:[p[0]+.7,1.1,p[2]+.6],distance:10.5,pitch:.4}];}
  else if(variant==='intruder')stops=[{t:0,at:[9.7,1,.2],distance:11.5,yaw:-.6,pitch:.34},{t:5,at:[9.7,1,-2.4],distance:11,yaw:-.6,pitch:.34},{t:5.05,at:[9.8,1,-4.2],distance:8.5,yaw:-.6,pitch:.35,cut:true},{t:12,at:[9.8,1,-4.2],distance:8.2,yaw:-.6,pitch:.35},{t:12.05,at:[10,1,-5.2],distance:10.5,yaw:-.6,pitch:.4,cut:true},{t:19,at:[10,1,-4.1],distance:10,yaw:-.6,pitch:.4},{t:19.05,at:[10.1,1,-4.1],distance:7.8,yaw:-.6,pitch:.32,cut:true},{t:24,at:[10.1,1,-4.1],distance:7.6,yaw:-.6,pitch:.32}];
  else if(variant==='crowd')stops=[{t:0,at:[1.3,1,8.2],distance:15,pitch:.44},{t:6,at:[1.3,1,7.3],distance:14.5,pitch:.44},{t:6.05,at:[1.3,1,7],distance:11.5,pitch:.45,cut:true},{t:13,at:[1.3,1,7],distance:11.2,pitch:.45},{t:13.05,at:[3.5,1,5.9],distance:12,pitch:.4,cut:true},{t:20,at:[1.5,1,6],distance:13,pitch:.4},{t:20.05,at:[0,1,6.5],distance:17,pitch:.46,cut:true},{t:24,at:[0,1,6.5],distance:17.3,pitch:.46}];
  else stops=[{t:0,at:[-1,.9,6],distance:10.4,yaw:1.25,pitch:.37},{t:4,at:[.2,.8,5.8],distance:9.8,yaw:1.25,pitch:.37},{t:8.6,at:[.4,.6,5.4],distance:9.4,yaw:1.25,pitch:.38},{t:8.65,at:[5.8,1,4.3],distance:11,yaw:1.25,pitch:.4,cut:true},{t:15,at:[3.8,.8,5.3],distance:10.7,yaw:1.25,pitch:.4},{t:15.05,at:[.8,.5,5.3],distance:8.2,yaw:1.25,pitch:.37,cut:true},{t:20,at:[.8,.5,5.3],distance:7.8,yaw:1.25,pitch:.37},{t:24,at:[.8,.5,5.3],distance:8,yaw:1.25,pitch:.37}];
  const t=Math.max(0,Math.min(24,time));let a=stops[0],b=stops[stops.length-1];
  for(let i=1;i<stops.length;i++)if(t<=stops[i].t){a=stops[i-1];b=stops[i];break;}
  const k=b.cut?(t>=b.t?1:0):ease(storyProgress(t,a.t,b.t));return {target:a.at.map((value,i)=>value+(b.at[i]-value)*k) as StoryPoint,distance:a.distance+(b.distance-a.distance)*k,yaw:turn(a.yaw||0,b.yaw||0,k),pitch:(a.pitch??.44)+((b.pitch??.44)-(a.pitch??.44))*k};
}

export function sampleSignals({offering,variant}:StoryContext,time:number):StorySignal[] {
  const t=Math.max(0,Math.min(24,time)),event=t>=4,response=t>=10,outcome=t>=17;
  const signal=(text:string,detail:string,at:StoryPoint,color='#68d6ff',visible=true):StorySignal=>({text,detail,at,color,visible});
  if(offering==='failover')return [
    signal(!event?'Tap to pay':t<13&&variant==='fiber'?'Payment on hold':t<17?'Payment approved':'Receipt issued',!event?'Checkout 01':t<13&&variant==='fiber'?'Waiting for an available path':t<17?'Transaction completed':'Next customer, please',[8,3.5,4.5],t>=4&&t<13&&variant==='fiber'?'#ffbd79':'#8ce3c6'),
    signal(!event?'Fiber primary · 5G ready':variant==='fiber'?response?'5G carries the transaction':'Fiber link interrupted':response?'Fiber remains active':'5G backup unavailable',response?'Traffic follows gateway policy':'Local demonstration',variant==='fiber'?(response?[14.6,5.5,1.4]:[14.6,2.8,-6]):(response?[14.6,2.8,-6]:[14.6,5.5,1.4]),event?'#b4a5ff':'#68d6ff',t>6&&t<16),
  ];
  if(offering==='routing')return [
    signal(response?'Supplier call / 5G':'Supplier call / fiber','Latency-sensitive conversation',[8,2.6,8.18],'#8ce3c6',t<4||t>=17&&variant==='voice'),
    signal('Camera archive / fiber','Footage continues to upload',[8.05,2.9,-3],'#b4a5ff',t>=4&&t<9||t>=17&&variant==='video'),
    signal(response&&!outcome?'Stock sync / queued':outcome?'Stock sync / scheduled':'Stock sync / bulk upload','Background transfer budget',[10,3.6,-6],'#ffc885',t>=4&&t<9||t>=17&&variant==='stock'),
  ];
  if(offering==='twin'){const twin=sampleTwin(t);return [signal(twin.resolved?'LAN 1 / link stable':'LAN 1 / inspect connector',twin.action,[6.62,1.7,-2.39],twin.color,t>=9&&t<20)];}
  if(offering==='eagle'){const p=monitoredPoint(variant);return [signal(event?'Connection needs attention':'Monitoring the selected layer',outcome?'Technician inspecting · fault remains':response?'Gateway correlates the affected connection':event?'Health signal changed':'Hardware and connectivity visible',[p[0],p[1]+2.6,p[2]],event?'#ff897a':'#68d6ff')];}
  if(offering==='automation')return [signal(!event?'Store in use':!response?variant==='after-hours'?'Last colleague leaves':'Arrival detected':variant==='after-hours'?'Closing routine applied':'Opening routine applied',response?variant==='after-hours'?'Lighting dimmed · access secured · climate setback':'Lighting on · access open · climate comfort':'Occupancy event at the edge',[-10,3.8,-1.1],'#b4a5ff')];
  if(offering==='smart'){
    const p=smartPoint(variant);return [signal(variant==='hvac'?event?'Fan condition changed':'HVAC running':variant==='cooler'?event?'Cooler temperature drifting':'Cold stock protected':event?'Unused loads still running':'Store energy overview',outcome?variant==='energy'?'Efficiency adjustment prepared · review schedule':'Technician inspection requested':response?'Gateway flags the pattern for review':event&&variant==='cooler'?'Check door activity and compressor condition':event?'Observe the physical change':'Illustrative equipment activity',[p[0],3.5,p[2]],event?'#ffc885':'#68d6ff')];
  }
  if(offering==='video'&&t>=10.05&&t<13.05)return [signal('Dell analytics server','Camera A + Camera B / local inference',[8.05,2.9,-3],'#b4a5ff')];
  const actor=sampleActor('shopper',{offering,variant},t);
  if(variant==='man-down')return [signal(t<4?'Customer aisle':t<10?'A person has fallen':t<17?'Possible fall · verify & assist':'Colleague assisting',t<4?'Camera observes the shared aisle':t<10?'Scene event before the edge response':t<17?'Local analytics prompts operator review':'Human response follows the alert',[actor.at[0]-.7,2.7,actor.at[2]-1.1],t<4?'#68d6ff':'#ffc885')];
  if(variant==='intruder')return [signal(t<4?'Staff-only access':t<10?'Boundary crossed':t<17?'Entry alert · review required':'Security checks the entry',t<4?'Defined restricted area':t<10?'Track movement through the boundary':t<17?'Operator reviews the event':'An alert supports a human decision',[actor.at[0],3,actor.at[2]],t<4?'#68d6ff':'#ff897a')];
  return [signal(t<4?'Customers arriving':t<10?'Aisle becoming congested':t<17?'Crowd alert · staff notified':'Staff redirects the flow',t<4?'Observe the entrance and checkout':t<10?'People gather near the checkout':t<17?'The team sees where help is needed':'The open aisle provides more space',[1.2,3.4,6.8],t<4?'#68d6ff':'#ffc885')];
}
