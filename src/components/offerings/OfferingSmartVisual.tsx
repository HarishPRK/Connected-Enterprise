import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { CanvasTexture, Group, InstancedMesh, Mesh, MeshStandardMaterial, Object3D, PointLight, SRGBColorSpace } from 'three';
import { sampleSmart, type SmartStoryState } from './OfferingSmartStory';
import { SMART_POINTS, smartTrolleyPoint } from './OfferingSmartMotion';

const INK = '#f4efde', MUTED = '#a9c2b5', MINT = '#a3e4c4', AMBER = '#f1c184';
const WIDTH = 1280, HEIGHT = 800;

function makeSurface(width: number, height: number) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; texture.anisotropy = 8;
  return { texture, ctx: canvas.getContext('2d')! };
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, line = 33) {
  let row = '';
  for (const word of text.split(' ')) {
    if (row && ctx.measureText(`${row} ${word}`).width > width) { ctx.fillText(row, x, y); row = word; y += line; }
    else row += `${row ? ' ' : ''}${word}`;
  }
  ctx.fillText(row, x, y);
}

function paintConsole(ctx: CanvasRenderingContext2D, texture: CanvasTexture, state: SmartStoryState) {
  const id = state.variant;
  const value = id === 'energy' ? state.energy.totalKw : id === 'cooler' ? state.cooler.airC : state.hvac.zoneC;
  const unit = id === 'energy' ? 'kW' : '°C';
  const max = id === 'energy' ? 12 : id === 'cooler' ? 10 : 30;
  const min = id === 'hvac' ? 20 : 0;
  const label = id === 'energy' ? 'STORE DEMAND' : id === 'cooler' ? 'COOLER AIR TEMPERATURE' : 'ZONE AIR TEMPERATURE';
  ctx.fillStyle = '#102a24'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = INK; ctx.font = '700 43px sans-serif'; ctx.fillText('SMART SERVICES', 48, 61);
  ctx.textAlign = 'right'; ctx.fillStyle = MUTED; ctx.font = '25px sans-serif'; ctx.fillText('ILLUSTRATIVE / COMPRESSED TREND', 1230, 58); ctx.textAlign = 'left';
  ctx.fillStyle = '#365248'; ctx.fillRect(48, 83, 1184, 2);
  ctx.fillStyle = MUTED; ctx.font = '26px sans-serif'; ctx.fillText(label, 50, 130);
  ctx.fillStyle = state.verification.trendImproving ? MINT : AMBER; ctx.font = '700 86px sans-serif'; ctx.fillText(`${value.toFixed(id === 'energy' ? 2 : 1)} ${unit}`, 48, 224);
  ctx.fillStyle = INK; ctx.font = '600 33px sans-serif';
  wrap(ctx, id === 'hvac' ? state.hvac.obstructed ? 'EXTERNAL INTAKE OBSTRUCTED' : 'INTAKE CLEAR / COOLING' : id === 'cooler' ? state.cooler.doorOpen ? 'LEFT DOOR OPEN' : 'LEFT DOOR CLOSED' : state.energy.requested ? 'AFTER-HOURS REQUESTED' : 'OCCUPIED SETTINGS STILL ON', 650, 157, 560, 40);
  ctx.fillStyle = MUTED; ctx.font = '27px sans-serif';
  ctx.fillText(id === 'hvac' ? `Fan demand ${Math.round(state.hvac.fanLoad * 100)}%` : id === 'cooler' ? 'Air sensor · stock not assessed' : 'Selected loads only', 650, 237);
  const x = 85, y = 292, w = 1115, h = 203;
  for (let i = 0; i <= 2; i++) {
    const gy = y + h * i / 2;
    ctx.strokeStyle = '#35554b'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke();
    ctx.fillStyle = MUTED; ctx.font = '20px sans-serif'; ctx.fillText(String(max - (max - min) * i / 2), 42, gy + 6);
  }
  const target = id === 'energy' ? state.energy.essentialKw : id === 'cooler' ? state.cooler.targetC : state.hvac.targetC;
  const targetY = y + h * (1 - (target - min) / (max - min));
  ctx.strokeStyle = '#d5b38b'; ctx.lineWidth = 2; ctx.setLineDash([10, 9]); ctx.beginPath(); ctx.moveTo(x, targetY); ctx.lineTo(x + w, targetY); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = MINT; ctx.lineWidth = 5; ctx.beginPath();
  for (let i = 0; i <= 64; i++) {
    const sample = sampleSmart(id, Math.max(0, state.time - 16 + i / 4));
    const reading = id === 'energy' ? sample.energy.totalKw : id === 'cooler' ? sample.cooler.airC : sample.hvac.zoneC;
    const px = x + w * i / 64, py = y + h * (1 - (reading - min) / (max - min));
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.fillStyle = MINT; ctx.font = '24px sans-serif'; ctx.fillText(id === 'energy' ? 'Metered demand (example)' : 'Air temperature (example)', 85, 536);
  ctx.textAlign = 'right'; ctx.fillStyle = '#d5b38b'; ctx.fillText(id === 'energy' ? 'Essential loads: 3.80 kW' : `Example target: ${target.toFixed(1)} °C`, 1200, 536); ctx.textAlign = 'left';
  ctx.fillStyle = '#244439'; ctx.fillRect(48, 562, 1184, 100);
  ctx.fillStyle = INK; ctx.font = '600 29px sans-serif';
  wrap(ctx, state.status, 70, 605, 1138, 35);
  ctx.fillStyle = MUTED; ctx.font = '25px sans-serif';
  wrap(ctx, id === 'energy' ? `Display ${Math.round(state.energy.displayLevel * 100)}% · task lighting ${Math.round(state.energy.lightingLevel * 100)}% · zone setpoint ${state.energy.setpointC} °C` : state.detail, 50, 710, 1180, 32);
  ctx.fillStyle = MINT; ctx.font = '22px sans-serif';
  ctx.fillText(id === 'energy' ? 'COOLERS + NETWORK + WALKWAY STAY POWERED · illustrative controls' : state.verification.started ? state.verification.message : 'Review the trend before the physical check', 50, 780);
  texture.needsUpdate = true;
}

function paintReadout(ctx: CanvasRenderingContext2D, texture: CanvasTexture, state: SmartStoryState) {
  const energy = state.variant === 'energy', cooler = state.variant === 'cooler';
  ctx.fillStyle = '#122c25'; ctx.fillRect(0, 0, 640, 240);
  ctx.fillStyle = INK; ctx.font = '700 106px sans-serif';
  ctx.fillText(energy ? `${state.energy.totalKw.toFixed(2)} kW` : `${(cooler ? state.cooler.airC : state.hvac.zoneC).toFixed(1)} °C`, 25, 120);
  ctx.fillStyle = state.verification.trendImproving ? MINT : AMBER; ctx.font = '600 33px sans-serif';
  ctx.fillText(energy ? 'ESSENTIAL LOADS RETAINED' : cooler ? state.cooler.doorOpen ? 'DOOR OPEN' : 'CLOSED / RECOVERING' : state.hvac.obstructed ? 'INTAKE OBSTRUCTED' : 'CLEAR / COOLING', 25, 185);
  ctx.fillStyle = MUTED; ctx.font = '21px sans-serif'; ctx.fillText('ILLUSTRATIVE SENSOR', 25, 222);
  texture.needsUpdate = true;
}

function Airflow({ timeRef, variant }: { timeRef: RefObject<number>; variant: string }) {
  const particles = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  useFrame(() => {
    if (!particles.current) return;
    const state = sampleSmart(variant, timeRef.current), cooler = state.variant === 'cooler';
    for (let i = 0; i < 18; i++) {
      const phase = ((state.time * (cooler ? .35 : .55) + i * .137) % 1 + 1) % 1;
      const row = Math.floor(i / 6), col = i % 6;
      const magnitude = cooler ? state.cooler.airLoss : state.hvac.airflow;
      dummy.position.set(cooler ? -1.95 + col * .12 : -9.85 + col * .17, cooler ? .7 - phase * .45 : .9 + row * .32, cooler ? -6.85 + phase * 1.2 + row * .08 : -3.75 - phase * 1.3);
      dummy.scale.set(.012, .012, (cooler ? .18 : .14) * magnitude);
      if (magnitude < .02 || !cooler && state.hvac.obstructed && col > 1) dummy.scale.setScalar(0);
      dummy.updateMatrix(); particles.current.setMatrixAt(i, dummy.matrix);
    }
    particles.current.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={particles} args={[undefined, undefined, 18]} frustumCulled={false}>
    <sphereGeometry args={[1, 8, 6]} /><meshBasicMaterial color="#b1e7e8" transparent opacity={.45} depthWrite={false} toneMapped={false} />
  </instancedMesh>;
}

function PackingTrolley({ timeRef }: { timeRef: RefObject<number> }) {
  const group = useRef<Group>(null);
  useFrame(() => { if (group.current) group.current.position.set(...smartTrolleyPoint(timeRef.current)); });
  return <group ref={group} name="External packing trolley obstruction">
    <RoundedBox args={[1.1, .08, .40]} radius={.02} position={[0, .25, 0]} castShadow><meshStandardMaterial color="#56635c" metalness={.6} roughness={.4} /></RoundedBox>
    {[-.46, .46].flatMap(x => [-.14, .14].map(z => <mesh key={`${x}/${z}`} position={[x, .11, z]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[.09, .09, .055, 16]} /><meshStandardMaterial color="#26312d" roughness={.75} /></mesh>))}
    <RoundedBox args={[1.02, 1.35, .34]} radius={.008} position={[0, .97, 0]} castShadow><meshStandardMaterial color="#a98454" roughness={.94} /></RoundedBox>
    <mesh position={[0, 1.0, .173]}><boxGeometry args={[.055, 1.30, .006]} /><meshStandardMaterial color="#d5bd87" roughness={.75} /></mesh>
    <mesh position={[0, 1.3, .178]}><boxGeometry args={[.38, .22, .007]} /><meshStandardMaterial color="#e6ddc8" roughness={.9} /></mesh>
    <RoundedBox args={[.045, .83, .045]} radius={.012} position={[.59, .64, .18]} castShadow><meshStandardMaterial color="#6d7a71" metalness={.7} roughness={.3} /></RoundedBox>
    <RoundedBox args={[.07, .055, .28]} radius={.015} position={[.59, 1.04, .08]} castShadow><meshStandardMaterial color="#203b32" roughness={.8} /></RoundedBox>
    <mesh position={[.59, 1.04, .18]} castShadow><cylinderGeometry args={[.026, .026, .22, 20]} /><meshStandardMaterial color="#243e31" roughness={.8} /></mesh>
  </group>;
}

function SelectedDisplay({ timeRef }: { timeRef: RefObject<number> }) {
  const display = useRef<Mesh>(null), light = useRef<PointLight>(null);
  useFrame(() => {
    const level = sampleSmart('energy', timeRef.current).energy.displayLevel;
    const material = display.current?.material as MeshStandardMaterial | undefined;
    if (material) { material.emissiveIntensity = .02 + level * 1.4; material.color.set(level > .1 ? '#d9c49b' : '#1c2923'); }
    if (light.current) light.current.intensity = level * 1.8;
  });
  return <group name="Selected after-hours store display" position={SMART_POINTS.energyDisplay}>
    <RoundedBox args={[1.35, .88, .09]} radius={.015} castShadow><meshStandardMaterial color="#263d32" metalness={.35} roughness={.5} /></RoundedBox>
    <mesh ref={display} position={[0, 0, .05]}><planeGeometry args={[1.23, .76]} /><meshStandardMaterial color="#d9c49b" emissive="#e4b96d" emissiveIntensity={1.4} roughness={.55} /></mesh>
    {[[-.34, .1, .42], [.3, -.08, .25]].map(([x, y, width], index) => <mesh key={index} position={[x, y, .054]}><planeGeometry args={[width, .09]} /><meshStandardMaterial color="#31533e" roughness={.8} /></mesh>)}
    <mesh position={[0, -.88, -.01]} castShadow><boxGeometry args={[.06, .95, .07]} /><meshStandardMaterial color="#5b675d" metalness={.7} roughness={.4} /></mesh>
    <RoundedBox args={[.65, .04, .4]} radius={.015} position={[0, -1.38, 0]} castShadow><meshStandardMaterial color="#32493c" metalness={.4} roughness={.5} /></RoundedBox>
    <pointLight ref={light} position={[0, .1, .25]} intensity={1.8} color="#f0c68d" distance={3.2} decay={2} />
  </group>;
}

/** Physical telemetry on the existing rack and a local sensor display.
 * Actual HVAC rotor/door/lamp groups are driven by the shared sampler in Equipment. */
export function OfferingSmartVisual({ timeRef, variant, onSelect }: { timeRef: RefObject<number>; variant: string; onSelect?: (id: string) => void }) {
  const surfaces = useMemo(() => ({ console: makeSurface(WIDTH, HEIGHT), readout: makeSurface(640, 240) }), []);
  const last = useRef('');
  useEffect(() => () => { surfaces.console.texture.dispose(); surfaces.readout.texture.dispose(); }, [surfaces]);
  useFrame(() => {
    const time = Math.floor(timeRef.current * 10) / 10, key = `${variant}/${time}`;
    if (last.current === key) return;
    last.current = key;
    const state = sampleSmart(variant, time);
    paintConsole(surfaces.console.ctx, surfaces.console.texture, state); paintReadout(surfaces.readout.ctx, surfaces.readout.texture, state);
  });
  const readout = variant === 'energy' ? SMART_POINTS.meter : variant === 'cooler' ? SMART_POINTS.coolerReadout : SMART_POINTS.hvacReadout;
  const width = variant === 'cooler' ? .7 : .48, height = width * 240 / 640;
  return <group name="Smart services physical story">
    <group position={SMART_POINTS.console} onClick={event => { event.stopPropagation(); if (event.delta < 5) onSelect?.(variant === 'energy' ? 'meter' : variant); }}>
      {[-.265, .265].map(x => <mesh key={x} position={[x, 0, -.044]} castShadow><boxGeometry args={[.04, .37, .075]} /><meshStandardMaterial color="#65746f" metalness={.65} roughness={.35} /></mesh>)}
      <RoundedBox args={[.7, .455, .045]} radius={.012} position={[0, 0, -.024]} castShadow><meshStandardMaterial color="#263a32" metalness={.35} roughness={.42} /></RoundedBox>
      <mesh name="Smart services physical console"><planeGeometry args={[.64, .40]} /><meshBasicMaterial map={surfaces.console.texture} toneMapped={false} /></mesh>
      <RoundedBox args={[.69, .025, .27]} radius={.006} position={[0, -.43, .085]} castShadow><meshStandardMaterial color="#384b42" metalness={.65} roughness={.42} /></RoundedBox>
    </group>
    <group position={readout}>
      <RoundedBox args={[width + .025, height + .025, .025]} radius={.006} position={[0, 0, -.014]} castShadow><meshStandardMaterial color="#6b7b6f" metalness={.5} roughness={.4} /></RoundedBox>
      <mesh name="Smart services local sensor display"><planeGeometry args={[width, height]} /><meshBasicMaterial map={surfaces.readout.texture} toneMapped={false} /></mesh>
    </group>
    {variant === 'hvac' && <PackingTrolley timeRef={timeRef} />}
    {variant !== 'energy' && <Airflow timeRef={timeRef} variant={variant} />}
    {variant === 'energy' && <SelectedDisplay timeRef={timeRef} />}
  </group>;
}
