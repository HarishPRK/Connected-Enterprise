import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { PARTS } from './OfferingEquipment';
import { sampleEagle } from './OfferingEagleStory';
import kitManifest from '../../assets/offerings/offerings-kit.manifest.json';

const RACK = PARTS.find(part => part.id === 'it')!;
const SOURCE = kitManifest.prefabs.ServerRack;
const SCALE = RACK.size / Math.max(...SOURCE.size);
const FRONT = (SOURCE.max[2] - (SOURCE.min[2] + SOURCE.max[2]) / 2) * SCALE;
const WIDTH = 1280, HEIGHT = 800;

function wrapped(ctx:CanvasRenderingContext2D,text:string,x:number,y:number,width:number,lineHeight:number,maxLines=2) {
  const words=text.split(' ');let line='',row=0;
  for(const word of words){
    const next=line?line+' '+word:word;
    if(ctx.measureText(next).width>width&&line){ctx.fillText(line,x,y+row*lineHeight);line=word;if(++row>=maxLines)return;}
    else line=next;
  }
  if(row<maxLines)ctx.fillText(line,x,y+row*lineHeight);
}

function paintConsole(ctx: CanvasRenderingContext2D, texture: CanvasTexture, variant: string, time: number) {
  const state=sampleEagle(variant,time);
  const mint='#91e3c5',amber='#f2ca91',rose='#ed95b3',ink='#eeeadd',muted='#acc3bf';
  ctx.textAlign='left';ctx.fillStyle='#112629';ctx.fillRect(0,0,WIDTH,HEIGHT);
  ctx.fillStyle=ink;ctx.font='700 48px sans-serif';ctx.fillText('EA:GLE',48,58);
  ctx.textAlign='right';ctx.fillStyle=muted;ctx.font='24px sans-serif';ctx.fillText('ILLUSTRATIVE INVESTIGATION / '+state.deviceLabel.toUpperCase(),1230,55);ctx.textAlign='left';
  ctx.fillStyle='#355258';ctx.fillRect(48,80,1184,2);
  ctx.font='25px sans-serif';ctx.fillStyle=muted;ctx.fillText('MSE / LEARNED THRESHOLD',50,119);
  ctx.fillStyle=state.thresholdCrossed?amber:mint;ctx.font='600 48px sans-serif';
  ctx.fillText(state.anomalyMse.toFixed(3)+' / '+state.anomalyThreshold.toFixed(3),50,171);
  ctx.fillStyle=state.anomalyFlag?'#ffab9d':mint;ctx.font='600 30px sans-serif';
  ctx.fillText('RECEIVED FLAG '+(state.anomalyFlag?'1':'0')+' / CODE '+state.reasonCode,750,120);
  ctx.font='28px sans-serif';ctx.fillText(state.reasonLabel,750,162);
  ctx.fillStyle=muted;ctx.font='23px sans-serif';ctx.fillText(state.diagnosticStatus,50,205);
  const x=76,y=238,width=620,height=180;
  for(const value of [0,1,2]){
    const at=y+height*(1-value/2);ctx.strokeStyle='#344e54';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,at);ctx.lineTo(x+width,at);ctx.stroke();
    ctx.fillStyle=muted;ctx.font='21px sans-serif';ctx.fillText(String(value),45,at+7);
  }
  const thresholdY=y+height*(1-state.anomalyThreshold/2);
  ctx.fillStyle='#64415630';ctx.fillRect(x,y,width,thresholdY-y);ctx.strokeStyle=rose;ctx.lineWidth=3;ctx.setLineDash([11,8]);
  ctx.beginPath();ctx.moveTo(x,thresholdY);ctx.lineTo(x+width,thresholdY);ctx.stroke();ctx.setLineDash([]);
  ctx.strokeStyle=mint;ctx.lineWidth=3;ctx.beginPath();
  state.windows.forEach((window,index)=>{
    const px=x+width*window.index/12,py=y+height*(1-window.mse/2);
    if(index===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
  });ctx.stroke();
  state.windows.forEach(window=>{
    const px=x+width*window.index/12,py=y+height*(1-window.mse/2);
    ctx.fillStyle=window.flag?'#ffab9d':mint;ctx.beginPath();ctx.arc(px,py,window.index===state.selectedWindow?6:4,0,Math.PI*2);ctx.fill();
    if(window.index===state.selectedWindow&&time>=10&&time<12.5){ctx.strokeStyle=amber;ctx.lineWidth=2;ctx.strokeRect(px-11,y-9,22,height+18);}
  });
  ctx.fillStyle=muted;ctx.font='21px sans-serif';ctx.fillText('0–2 fixed scale / '+state.windows.length+' received windows',76,450);
  ctx.fillStyle=rose;ctx.fillText('Threshold',545,450);
  ctx.fillStyle=muted;ctx.font='24px sans-serif';ctx.fillText('CONNECTED WORKLOADS / PENDING',750,212);
  state.endpointQueues.forEach((queue,index)=>{
    const row=256+index*67;ctx.fillStyle=ink;ctx.font='25px sans-serif';ctx.fillText(queue.label,750,row);
    ctx.textAlign='right';ctx.fillStyle=queue.pending?amber:mint;ctx.font='600 27px sans-serif';ctx.fillText(queue.pending?String(queue.pending)+' waiting':'Current',1225,row);ctx.textAlign='left';
    for(let block=0;block<12;block++){ctx.fillStyle=block<queue.pending?amber:'#294347';ctx.fillRect(750+block*39,row+13,33,9);}
  });
  ctx.fillStyle=state.reviewAction==='compare-connections'?'#2a4b45':'#1d373a';ctx.fillRect(48,474,1184,45);
  ctx.fillStyle=ink;ctx.font='26px sans-serif';
  ctx.fillText('CONNTRACK '+state.conntrack.total+'  / TCP '+state.conntrack.tcp+'  UDP '+state.conntrack.udp+'  ICMP '+state.conntrack.icmp+'  OTHER '+state.conntrack.other,66,505);
  // The control centre maps to the existing index-pad contact near world
  // [9.98,1.39,-5.34], keeping the physical touch and visible action aligned.
  ctx.fillStyle=state.actionAttempted?'#386650':'#365052';ctx.fillRect(400,530,400,60);
  ctx.fillStyle=ink;ctx.font='600 29px sans-serif';ctx.textAlign='center';
  const action=time>=22?'REVIEW RESULT':time>=18?'WAIT FOR NEW WINDOWS':time>=17?'EXAMPLE ACTION STARTED':time>=16.5?'RUN EXAMPLE ACTION':time>=11.2&&time<12.5?'COMPARE CONNECTIONS':'SELECT EVIDENCE WINDOW';
  ctx.fillText(action,600,568);ctx.textAlign='left';
  ctx.font='600 27px sans-serif';ctx.fillStyle=state.recoveryVerified?mint:amber;
  wrapped(ctx,time>=18?state.verificationStatus:time>=12.5?state.actionLabel:state.inspectionTask,50,625,1180,32);
  ctx.font='25px sans-serif';ctx.fillStyle=ink;
  ctx.fillText(state.endpointLabel+': '+state.endpointDelayMs+' ms  / baseline 180 ms',50,704);
  ctx.fillStyle=muted;ctx.font='23px sans-serif';
  ctx.fillText(time>=18?'Fresh windows '+state.freshWindows+'/2  / detector '+(state.anomalyFlag?'flag still set':'not flagged')+'  / investigation remains open':state.inspectionStarted?'Physical inspection recorded / next: a specific example action':'Connection counts are context, not a root-cause verdict.',50,744);
  ctx.fillStyle='#92aaa8';ctx.font='20px sans-serif';ctx.fillText('Scripted samples and actions / five-minute windows compressed / no live device command',50,782);
  texture.needsUpdate=true;
}

/** A real-size, bracket-mounted diagnostic monitor on the existing IT rack.
 * The screen is not the analytics server and never issues device commands. */
export function OfferingEagleConsole({ timeRef, variant, onSelect }: {
  timeRef: RefObject<number>;
  variant: string;
  onSelect?: (id: string) => void;
}) {
  const surface = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = WIDTH; canvas.height = HEIGHT;
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; texture.anisotropy = 8;
    return { ctx: canvas.getContext('2d')!, texture };
  }, []);
  const last = useRef('');
  useEffect(() => () => surface.texture.dispose(), [surface]);
  useFrame(() => {
    // Ten illustrative samples per story second are plenty for this small
    // physical screen. No React rerenders or texture allocation while playing.
    const time = Math.floor(timeRef.current * 10) / 10;
    const key = `${variant}/${time}`;
    if (last.current === key) return;
    last.current = key;
    paintConsole(surface.ctx, surface.texture, variant, time);
  });
  return <group name="EA:GLE diagnostic console" position={RACK.at} rotation={[0, RACK.yaw ?? 0, 0]}
    onClick={event => { event.stopPropagation(); if (event.delta < 5) onSelect?.('it'); }}>
    {[-.265, .265].map(offset => <mesh key={offset} position={[offset, 1.43, FRONT + .007]} castShadow>
      <boxGeometry args={[.04, .37, .045]} /><meshStandardMaterial color="#65746f" metalness={.65} roughness={.35} />
    </mesh>)}
    <RoundedBox args={[.70, .455, .045]} radius={.012} smoothness={3} position={[0, 1.43, FRONT + .03]} castShadow>
      <meshStandardMaterial color="#263a3c" metalness={.35} roughness={.42} />
    </RoundedBox>
    <mesh name="EA:GLE physical display" position={[0, 1.43, FRONT + .054]}>
      <planeGeometry args={[.64, .40]} /><meshBasicMaterial map={surface.texture} toneMapped={false} />
    </mesh>
    <mesh position={[.305, 1.223, FRONT + .054]}><circleGeometry args={[.003, 12]} /><meshBasicMaterial color="#91e3c5" toneMapped={false} /></mesh>
    <RoundedBox args={[.69, .025, .31]} radius={.006} position={[0, .99, FRONT + .14]} castShadow>
      <meshStandardMaterial color="#384b4d" metalness={.65} roughness={.42} />
    </RoundedBox>
    <RoundedBox args={[.49, .018, .18]} radius={.004} position={[0, 1.012, FRONT + .16]} castShadow>
      <meshStandardMaterial color="#1b292b" roughness={.72} />
    </RoundedBox>
    {[0, 1, 2, 3].map(row => <mesh key={row} position={[-.025, 1.023, FRONT + .102 + row * .034]}>
      <boxGeometry args={[row === 3 ? .25 : .40, .004, .023]} /><meshStandardMaterial color="#596763" roughness={.7} />
    </mesh>)}
  </group>;
}
