import type { ActorId, ActorPose, StoryPoint, StorySignal } from './OfferingStoryMotion';
import { EAGLE_CASES, eagleVariant, sampleEagle } from './OfferingEagleStory';

const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const progress=(t:number,a:number,b:number)=>clamp((t-a)/(b-a),0,1);
const ease=(n:number)=>n*n*(3-2*n);
type Stop=[number,number,number];
const pose=(x:number,z:number,heading=0):ActorPose=>({at:[x,.04,z],heading,walk:0,distance:0,phase:0,tap:0,fall:0,collapse:0,kneel:0,tablet:0,phone:0,carry:0,receipt:0,concern:0,lookY:0,visible:true});
function travel(stops:Stop[],time:number,heading:number):ActorPose {
  let distance=0;
  for(let i=1;i<stops.length;i++){
    const a=stops[i-1],b=stops[i],length=Math.hypot(b[1]-a[1],b[2]-a[2]);
    if(time>b[0]){distance+=length;continue;}
    const u=progress(time,a[0],b[0]),k=ease(u),moving=length>.01;
    const result=pose(a[1]+(b[1]-a[1])*k,a[2]+(b[2]-a[2])*k,heading);
    if(moving){
      const direction=Math.atan2(b[1]-a[1],b[2]-a[2]);
      const turn=ease(progress(u,0,.18))*(1-ease(progress(u,.82,1)));
      result.heading=heading+Math.atan2(Math.sin(direction-heading),Math.cos(direction-heading))*turn;
    }
    result.walk=moving?Math.min(1,6*u*(1-u)*length/Math.max(.01,b[0]-a[0])/1.45):0;
    result.distance=distance+length*k;return result;
  }
  const end=stops[stops.length-1],result=pose(end[1],end[2],heading);result.distance=distance;return result;
}

export function sampleEagleActor(id:ActorId,variant:string,time:number):ActorPose {
  const state=sampleEagle(variant,time),v=state.variant,t=state.time,local=v==='gateway'||v==='it';
  let result=pose(0,0);result.visible=false;
  if(id==='technician'){
    const walk:Stop[]=[[0,8.9,-4.35],[6,8.9,-4.35],[8.5,9.82,-4.84],[12.5,9.82,-4.84]];
    if(local)walk.push([13,9.25,-4.35],[13.65,9.25,-2.18],[14.1,8.55,-2.18],[15.1,8.55,-2.18],[15.5,9.25,-2.18],[16.1,9.25,-4.35],[16.5,9.82,-4.84],[24,9.82,-4.84]);
    else walk.push([24,9.82,-4.84]);
    const inspecting=local&&t>=13.65&&t<15.5;
    const inspectionTurn=ease(progress(t,13.5,14.1))*(1-ease(progress(t,15.1,15.5)));
    result=travel(walk,t,2.825+Math.atan2(Math.sin(-2.61-2.825),Math.cos(-2.61-2.825))*inspectionTurn);
    result.tablet=t<6||local&&t>=12.5&&t<16.5?1:0;
    // Console finger IK owns the actual contact; no generic arm flailing.
    result.tap=0;result.lookY=inspecting?-.18:0;
  }
  if(id==='staff'){
    if(local){result=pose(8,3.25,0);result.concern=state.symptom?.42:0;}
    else {
      const destination:Record<string,[number,number]>={fiber:[13.6,-5.4],'5g':[13.2,.8],ot:[-6.55,-5.3]};
      const target:Record<string,[number,number]>={fiber:[14.6,-6],'5g':[14.6,1.4],ot:[-7.55,-6]};
      const end=destination[v],point=target[v],heading=Math.atan2(point[0]-end[0],point[1]-end[1]);
      const stops:Stop[]=v==='ot'?[[0,8.3,-4.35],[6,8.3,-4.35],[12.2,-6.55,-4.35],[13,...end],[24,...end]]
        :[[0,10.8,-4.35],[6,10.8,-4.35],[10,12.7,-4.35],[13,...end],[24,...end]];
      result=travel(stops,t,heading);result.tablet=1;result.lookY=t>=13?-.18:0;
    }
  }
  if(id==='shopper'&&state.checkoutAffected)result=pose(7.25,5.55,Math.PI);
  if(id==='queue1'&&state.checkoutAffected)result=pose(4.6,6.2,Math.PI);
  result.phase=id==='technician'?6.472:id==='staff'?4.854:id==='queue1'?1.618:0;
  return result;
}

interface Shot {t:number;target:StoryPoint;distance:number;yaw:number;pitch:number;cut?:boolean}
export function sampleEagleCamera(variant:string,time:number):Omit<Shot,'t'|'cut'> {
  const state=sampleEagle(variant,time),v=state.variant,t=state.time;
  const console:StoryPoint=[10,1.47,-5.391],endpoint:StoryPoint=state.checkoutAffected?[7.19,1.51,4.98]:console;
  const targets:Record<string,StoryPoint>={gateway:[7.65,1.35,-2.55],it:[8.2,1.35,-2.7],fiber:[14,1.2,-5.7],'5g':[14,1.1,1.1],ot:[-7.25,1.45,-5.7]};
  const inspection=targets[v],far=v==='fiber'||v==='5g';
  const shots:Shot[]=[
    {t:0,target:state.checkoutAffected?[7.6,1.2,4.65]:inspection,distance:5,yaw:.2,pitch:.28},
    {t:2.95,target:endpoint,distance:3.4,yaw:.15,pitch:.25},
    {t:3,target:endpoint,distance:1.55,yaw:state.checkoutAffected?.02:.15,pitch:state.checkoutAffected?.5:.2,cut:true},
    {t:5.95,target:endpoint,distance:1.5,yaw:state.checkoutAffected?.02:.15,pitch:state.checkoutAffected?.5:.2},
    {t:6,target:[9.8,1.25,-4.9],distance:3.7,yaw:.15,pitch:.24,cut:true},
    {t:8.5,target:console,distance:1.5,yaw:.15,pitch:.20},
    {t:12.45,target:console,distance:1.45,yaw:.15,pitch:.20},
    {t:12.5,target:inspection,distance:far?5.4:4.3,yaw:-.8,pitch:.3,cut:true},
    {t:14.2,target:inspection,distance:far?4.7:3.65,yaw:-.8,pitch:.3},
    {t:16.4,target:inspection,distance:far?4.5:3.55,yaw:-.8,pitch:.3},
    {t:16.5,target:console,distance:1.5,yaw:.15,pitch:.2,cut:true},
    {t:18.4,target:console,distance:1.45,yaw:.15,pitch:.2},
    {t:18.5,target:endpoint,distance:1.5,yaw:state.checkoutAffected?.02:.15,pitch:state.checkoutAffected?.5:.2,cut:true},
    {t:19.9,target:endpoint,distance:1.5,yaw:state.checkoutAffected?.02:.15,pitch:state.checkoutAffected?.5:.2},
    {t:20,target:console,distance:1.45,yaw:.15,pitch:.2,cut:true},
    {t:24,target:console,distance:1.4,yaw:.15,pitch:.2},
  ];
  for(let i=1;i<shots.length;i++){
    const a=shots[i-1],b=shots[i];if(t>=b.t)continue;
    const u=b.cut?0:ease(progress(t,a.t,b.t));
    return {target:a.target.map((n,j)=>n+(b.target[j]-n)*u) as StoryPoint,distance:a.distance+(b.distance-a.distance)*u,yaw:a.yaw+(b.yaw-a.yaw)*u,pitch:a.pitch+(b.pitch-a.pitch)*u};
  }
  const last=shots[shots.length-1];return {target:[...last.target],distance:last.distance,yaw:last.yaw,pitch:last.pitch};
}

export function sampleEagleCue(variant:string,time:number):{chapter:string;title:string;subtitle:string} {
  const s=sampleEagle(variant,time),item=EAGLE_CASES[s.variant],t=s.time;
  const cues:readonly[number,string,string][]=[
    [0,'One store. Several connected workloads.','Camera recording, checkout and telemetry are separate workloads sharing local infrastructure.'],
    [3,item.symptom,`${s.endpointLabel}: ${(s.endpointDelayMs/1000).toFixed(2)} s. Watch the pending requests grow; a slow response does not identify its cause.`],
    [6,'Let the evidence accumulate','New example windows arrive. A reconstruction-error crossing is separate from a received detector flag.'],
    [8.5,'Compare the trace with the received flag',`MSE ${s.anomalyMse.toFixed(3)} / learned threshold ${s.anomalyThreshold}. Flag ${s.anomalyFlag?1:0}; ${s.reasonLabel}.`],
    [10,'Select the window. Read its reason.',s.variant==='gateway'?'The selected example window reports Memory Pressure. This supports investigation, not a guaranteed cause.':'The selected hardware window remains Normal. The separate interface or service symptom still needs inspection.'],
    [11.2,'Compare protocol counts and pending requests',`TCP ${s.conntrack.tcp}, UDP ${s.conntrack.udp}, ICMP ${s.conntrack.icmp}, other ${s.conntrack.other}. Counts provide context; they are not proof of a fault.`],
    [12.5,'Follow the evidence to the equipment',item.check],
    [13.7,'Check the physical device and its workload',item.finding],
    [16.5,'Prepare a specific recovery attempt',item.actionDetail],
    [17,item.action,'The operator uses the physical console. This is a scripted example action, not a live command.'],
    [18,'An attempted action is not a verified repair','Watch the service response and pending queue. Wait for new detector windows rather than reusing the earlier sample.'],
    [20,s.variant==='gateway'?'The error is lower. The flag has not cleared.':'Read the next fresh verification sample',s.variant==='gateway'?'One new window is below threshold, but the received flag is still set. Keep the investigation open.':s.verificationStatus],
    [22,s.recoveryVerified?'Fresh evidence shows an observed recovery':'The repeat check still needs escalation',s.recoveryVerified?`${s.freshWindows} fresh windows, a normal detector result and improved responses. Keep monitoring; this does not establish a permanent repair.`:item.outcome],
  ];
  const selected=[...cues].reverse().find(([start])=>t>=start)??cues[0];
  return {chapter:t>=22?'06 / VERIFIED OBSERVATION':t>=18?'05 / VERIFY':t>=17?'04 / ATTEMPT':t>=12.5?'03 / INSPECT':t>=6?'02 / INVESTIGATE':'01 / CONNECTED DEVICES',title:selected[1],subtitle:selected[2]};
}
export function sampleEagleSignals(variant:string,time:number):StorySignal[] {
  const s=sampleEagle(variant,time),v=eagleVariant(variant);
  const at:StoryPoint=s.stage==='inspect'?(v==='gateway'||v==='it'?[8.05,1.93,-2.9]:v==='ot'?[-7.55,2.1,-6]:v==='fiber'?[14,2,-6]:[14,2,1.4]):[10,1.98,-5.39];
  return [{text:s.recoveryVerified?'Fresh evidence / recovery observed':s.stage==='attempt'?'Console / example action':s.stage==='inspect'?'Physical inspection':s.anomalyFlag?'EA:GLE / received flag':'EA:GLE / window '+s.windows.length,detail:s.status,at,color:s.recoveryVerified?'#9dd9bb':s.symptomOccurred?'#efba7c':'#91d6dd',visible:true}];
}
