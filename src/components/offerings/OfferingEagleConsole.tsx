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

function paintConsole(ctx: CanvasRenderingContext2D, texture: CanvasTexture, variant: string, time: number) {
  const state = sampleEagle(variant, time);
  const mint = '#91e3c5', amber = '#f2ca91', rose = '#ed95b3', ink = '#eeeadd', muted = '#acc3bf';
  ctx.fillStyle = '#112629'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = ink; ctx.font = '700 48px sans-serif'; ctx.fillText('EA:GLE', 48, 59);
  ctx.textAlign = 'right'; ctx.font = '26px sans-serif'; ctx.fillStyle = muted;
  ctx.fillText('ILLUSTRATIVE CPE / HARDWARE + CONNECTIONS', 1230, 58); ctx.textAlign = 'left';
  ctx.fillStyle = '#355258'; ctx.fillRect(48, 82, 1184, 2);
  ctx.fillStyle = muted; ctx.font = '27px sans-serif'; ctx.fillText('RECONSTRUCTION ERROR / LEARNED THRESHOLD', 50, 126);
  ctx.fillStyle = state.thresholdCrossed ? amber : mint; ctx.font = '600 55px sans-serif';
  ctx.fillText(`${state.anomalyMse.toFixed(3)} / ${state.anomalyThreshold.toFixed(3)}`, 50, 191);
  ctx.fillStyle = state.anomalyFlag ? '#ffab9d' : mint; ctx.font = '600 36px sans-serif';
  ctx.fillText(`FLAG ${state.anomalyFlag ? '1' : '0'}  ·  CODE ${state.reasonCode}`, 795, 159);
  ctx.font = '29px sans-serif'; ctx.fillText(state.reasonLabel, 795, 202);
  ctx.fillStyle = muted; ctx.font = '25px sans-serif'; ctx.fillText(state.diagnosticStatus, 50, 231);
  const x = 78, y = 266, width = 1124, height = 215;
  for (const value of [0, 1, 2]) {
    const at = y + height * (1 - value / 2);
    ctx.strokeStyle = '#344e54'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, at); ctx.lineTo(x + width, at); ctx.stroke();
    ctx.fillStyle = muted; ctx.font = '22px sans-serif'; ctx.fillText(String(value), 43, at + 7);
  }
  const thresholdY = y + height * (1 - state.anomalyThreshold / 2);
  ctx.fillStyle = '#64415630'; ctx.fillRect(x, y, width, thresholdY - y);
  ctx.strokeStyle = rose; ctx.lineWidth = 3; ctx.setLineDash([13, 9]);
  ctx.beginPath(); ctx.moveTo(x, thresholdY); ctx.lineTo(x + width, thresholdY); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = mint; ctx.lineWidth = 4; ctx.beginPath();
  for (let index = 0; index <= 64; index++) {
    const sample = sampleEagle(variant, Math.max(0, time - 8 + index / 8));
    const px = x + width * index / 64;
    const py = y + height * (1 - sample.anomalyMse / 2);
    if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.fillStyle = state.anomalyFlag ? '#ffab9d' : mint;
  ctx.beginPath(); ctx.arc(x + width, y + height * (1 - state.anomalyMse / 2), 7, 0, Math.PI * 2); ctx.fill();
  if (state.operatorAtConsole && state.reviewAction !== 'review-chart') {
    ctx.strokeStyle = amber; ctx.lineWidth = 2; ctx.strokeRect(x - 6, y - 6, width + 12, height + 12);
  }
  ctx.fillStyle = mint; ctx.font = '24px sans-serif'; ctx.fillText('MSE', 78, 518);
  ctx.fillStyle = rose; ctx.fillText('Learned threshold', 190, 518);
  ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.fillText('0–2 fixed scale · example windows', 1200, 518); ctx.textAlign = 'left';
  ctx.fillStyle = state.reviewAction === 'compare-connections' ? '#2a4b45' : '#1d373a'; ctx.fillRect(48, 541, 1184, 111);
  ctx.fillStyle = ink; ctx.font = '600 35px sans-serif'; ctx.fillText(`CONNTRACK   ${state.conntrack.total} connections`, 68, 587);
  ctx.fillStyle = muted; ctx.font = '28px sans-serif';
  ctx.fillText(`TCP ${state.conntrack.tcp}     UDP ${state.conntrack.udp}     ICMP ${state.conntrack.icmp}     OTHER ${state.conntrack.other}`, 68, 630);
  ctx.fillStyle = state.symptom ? amber : mint; ctx.font = '600 31px sans-serif';
  ctx.fillText(`${state.endpointLabel.toUpperCase()}: ${(state.endpointDelayMs / 1000).toFixed(2)} s`, 50, 700);
  ctx.fillStyle = muted; ctx.font = '25px sans-serif';
  ctx.fillText(state.diagnosticReviewed ? state.inspectionTask : state.operatorAtConsole ? 'Operator reviewing detector and connection evidence' : 'Separate service check · baseline 0.18 s', 50, 741);
  ctx.fillStyle = '#92aaa8'; ctx.font = '22px sans-serif';
  ctx.fillText('Illustrative samples · compressed time · investigation remains open', 50, 782);
  texture.needsUpdate = true;
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
