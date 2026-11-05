import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, Mesh, type DirectionalLight, type HemisphereLight, type PointLight } from 'three';
import { sampleActor, STORY_ACTORS, type ActorId, type StoryContext } from './OfferingStoryMotion';
import { storeLightLevel } from './offeringLighting';

export function OfferingStudioLighting({ context, timeRef }: { context: StoryContext; timeRef: RefObject<number> }) {
  const key = useRef<DirectionalLight>(null), fill = useRef<DirectionalLight>(null);
  const sky = useRef<HemisphereLight>(null), practical = useRef<PointLight>(null);
  useFrame(() => {
    const level = storeLightLevel(context, timeRef.current);
    if (key.current) key.current.intensity = 1.2 + level * 1.8;
    if (fill.current) fill.current.intensity = .22 + level * .43;
    if (sky.current) sky.current.intensity = .18 + level * .16;
    if (practical.current) practical.current.intensity = .4 + level * 8;
  });
  return <>
    <ambientLight intensity={.08} />
    <hemisphereLight ref={sky} args={['#d5e7f4', '#242b31', .34]} />
    <directionalLight ref={key} position={[-12, 22, 16]} intensity={3} color="#ffe9cf" castShadow
      shadow-mapSize={[4096, 4096]} shadow-camera-left={-23} shadow-camera-right={23}
      shadow-camera-top={21} shadow-camera-bottom={-21} shadow-camera-near={1} shadow-camera-far={80}
      shadow-normalBias={.012} shadow-bias={-.00008} />
    <directionalLight ref={fill} position={[18, 10, 14]} intensity={.65} color="#b7d7ed" />
    <directionalLight position={[-9, 12, -16]} intensity={1.15} color="#a6d5ee" />
    <pointLight ref={practical} position={[6.5, 3.9, 4.8]} color="#ffdda6" intensity={8.4} distance={10} decay={2} />
    <pointLight position={[0, 2.8, -6.5]} color="#c1e7ee" intensity={3.5} distance={6} decay={2} />
  </>;
}

function contactTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 96;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(48, 48, 4, 48, 48, 46);
  gradient.addColorStop(0, 'rgba(0,0,0,.58)');
  gradient.addColorStop(.35, 'rgba(0,0,0,.36)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = gradient; context.fillRect(0, 0, 96, 96);
  return new CanvasTexture(canvas);
}

function PersonContact({ id, context, timeRef, texture }: {
  id: ActorId; context: StoryContext; timeRef: RefObject<number>; texture: CanvasTexture;
}) {
  const mesh = useRef<Mesh>(null);
  useFrame(() => {
    if (!mesh.current) return;
    const pose = sampleActor(id, context, timeRef.current);
    mesh.current.visible = pose.visible;
    mesh.current.position.set(pose.at[0] + Math.sin(pose.heading) * .7 * pose.fall, .012, pose.at[2] + Math.cos(pose.heading) * .7 * pose.fall);
    mesh.current.rotation.set(-Math.PI / 2, 0, pose.heading - Math.PI / 2);
    mesh.current.scale.set(.4 + pose.fall * .7, .3 + pose.fall * .12 + pose.kneel * .1, 1);
  });
  return <mesh ref={mesh} renderOrder={1}><planeGeometry args={[2, 2]} /><meshBasicMaterial map={texture} transparent opacity={.52} depthWrite={false} toneMapped={false} /></mesh>;
}

/** Soft local occlusion complements the directional shadow at feet and bases. */
export function OfferingContactGrounding({ context, timeRef }: { context: StoryContext; timeRef: RefObject<number> }) {
  const texture = useMemo(() => contactTexture(), []);
  useEffect(() => () => texture.dispose(), [texture]);
  return <>
    {STORY_ACTORS.map(actor => <PersonContact key={actor.id} id={actor.id} context={context} timeRef={timeRef} texture={texture} />)}
    {[[-9, -6, 1.6, 1.4], [-1.35, -7.6, 1.25, 1.1], [1.25, -7.6, 1.25, 1.1], [10, -6, 1.3, 1.2], [14.6, 1.4, 1.2, 1.2]].map(([x, z, w, h]) =>
      <mesh key={`${x}/${z}`} position={[x, .006, z]} rotation={[-Math.PI / 2, 0, 0]} scale={[w, h, 1]} renderOrder={1}>
        <planeGeometry args={[2, 2]} /><meshBasicMaterial map={texture} transparent opacity={.5} depthWrite={false} toneMapped={false} />
      </mesh>)}
  </>;
}
