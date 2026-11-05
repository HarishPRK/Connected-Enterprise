import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Canvas, useFrame, useThree, type CanvasProps } from '@react-three/fiber';
import { Environment, SoftShadows, useGLTF } from '@react-three/drei';
import { Bloom, DepthOfField, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode, type DepthOfFieldEffect } from 'postprocessing';
import {
  ACESFilmicToneMapping, Box3, ColorManagement, Group, HalfFloatType, Mesh,
  MeshPhysicalMaterial, MeshStandardMaterial, Object3D, PCFSoftShadowMap,
  SRGBColorSpace, Vector3, type DirectionalLight, type HemisphereLight, type SpotLight,
} from 'three';
import storeUrl from '../../assets/offerings/enterprise-store.studio.glb?url';
import kitUrl from '../../assets/offerings/offerings-kit.glb?url';
import actorsUrl from '../../assets/offerings/enterprise-actors.studio.glb?url';
import twinUrl from '../../assets/offerings/gemtek-gateway.glb?url';
import analyticsUrl from '../../assets/offerings/analytics-server.glb?url';
import studioHdr from '../../assets/offerings/studio-small-03-1k.hdr?url';
import { offeringPixelRatio } from './offeringRenderQuality';

// Own assets, bundled with the app; no runtime CDN or decoder dependency.
for (const url of [storeUrl, kitUrl, actorsUrl, twinUrl, analyticsUrl]) useGLTF.preload(url, false);
// One-file renderer API requested by the design brief: assets, loader and Canvas.
// eslint-disable-next-line react-refresh/only-export-components
export const cinematicAssets = { store: storeUrl, kit: kitUrl, twin: twinUrl, analytics: analyticsUrl };

/** Clone materials, never mutate useGLTF's shared cache. Source geometry and
 * textures remain shared. Physical overrides retain baked maps and markings. */
// eslint-disable-next-line react-refresh/only-export-components
export function useCinematicModel(url: string, name?: string, size?: number) {
  const gltf = useGLTF(url, false);
  const model = useMemo(() => {
    const source = name ? gltf.scene.getObjectByName(name) : gltf.scene;
    if (!source) throw new Error(`Missing cinematic model: ${name}`);
    const copy = source.clone(true), wrapper = new Group();
    const materials = new Map<MeshStandardMaterial, MeshPhysicalMaterial>();
    copy.traverse(object => {
      if (!(object instanceof Mesh)) return;
      object.castShadow = object.receiveShadow = true;
      const augment = (source: MeshStandardMaterial) => {
        if (!(source instanceof MeshStandardMaterial)) return source;
        let physical = materials.get(source);
        if (physical) return physical;
        physical = new MeshPhysicalMaterial();
        // Use the standard base's copy method: Physical.copy expects a Physical source.
        MeshStandardMaterial.prototype.copy.call(physical, source);
        const glass = /glass|glaz|lens/i.test(source.name) || source instanceof MeshPhysicalMaterial && source.transmission > 0;
        const metal = source.metalness > .45;
        physical.clearcoat = glass ? .7 : metal ? .16 : .06;
        physical.clearcoatRoughness = glass ? .12 : .38;
        physical.roughness = glass ? .16 : Math.max(.28, source.roughness);
        physical.metalness = glass ? 0 : source.metalness;
        // Preserve transparent baked glazing; transmission is reserved for an
        // existing physical lens to avoid an extra framebuffer pass per window.
        physical.transmission = source instanceof MeshPhysicalMaterial ? Math.min(.3, source.transmission) : 0;
        physical.thickness = glass ? .008 : 0;
        physical.envMapIntensity = metal ? .8 : .55;
        materials.set(source, physical);
        return physical;
      };
      object.material = Array.isArray(object.material) ? object.material.map(augment) : augment(object.material);
    });
    if (size) {
      const bounds = new Box3().setFromObject(copy);
      const center = bounds.getCenter(new Vector3()), dimensions = bounds.getSize(new Vector3());
      copy.position.sub(new Vector3(center.x, bounds.min.y, center.z));
      wrapper.scale.setScalar(size / Math.max(dimensions.x, dimensions.y, dimensions.z));
    }
    wrapper.add(copy);
    return { object: wrapper, materials: [...materials.values()] };
  }, [gltf, name, size]);
  useEffect(() => () => model.materials.forEach(material => material.dispose()), [model]);
  return model.object;
}

interface StageProps {
  focusTarget: RefObject<Vector3>;
  lightLevel: () => number;
  cinematic: boolean;
  inspection?: boolean;
}

function CinematicStage({ focusTarget, lightLevel, cinematic, inspection = false }: StageProps) {
  const { camera, size } = useThree();
  const key = useRef<DirectionalLight>(null), fill = useRef<DirectionalLight>(null);
  const bounce = useRef<HemisphereLight>(null);
  const rim = useRef<SpotLight>(null), dof = useRef<DepthOfFieldEffect>(null);
  const subject = useMemo(() => { const object = new Object3D(); object.position.set(inspection ? 0 : 7, inspection ? 1.2 : 1.8, inspection ? 0 : -3); return object; }, [inspection]);
  useFrame(({ scene }) => {
    const level = inspection ? 1 : Math.max(0, Math.min(1, lightLevel()));
    scene.environmentIntensity = inspection ? .28 : .1 + level * .42;
    if (bounce.current) bounce.current.intensity = inspection ? .28 : .18 + level * .44;
    if (key.current) key.current.intensity = inspection ? 1.05 : .32 + level * 1.8;
    if (fill.current) fill.current.intensity = inspection ? .32 : .12 + level * .36;
    if (rim.current) rim.current.intensity = inspection ? 35 : 18 + level * 47;
    if (dof.current) {
      dof.current.target?.copy(focusTarget.current);
      const distance = camera.position.distanceTo(focusTarget.current);
      // Wide network coverage stays readable; close-ups get selective focus.
      const closeUp = cinematic && distance < 5;
      dof.current.blendMode.opacity.value = closeUp ? 1 : 0;
      dof.current.cocMaterial.focusRange = closeUp ? 1.2 : 80;
      dof.current.bokehScale = closeUp ? .35 : 0;
    }
  });
  return <>
    <Environment files={studioHdr} background={false} environmentIntensity={.4} />
    <SoftShadows size={18} samples={12} focus={.3} />
    <hemisphereLight ref={bounce} args={['#fff4e5', '#758c81', .62]} />
    <primitive object={subject} />
    <directionalLight ref={key} position={inspection ? [-4, 7, 5] : [-12, 22, 16]} target={subject} color="#ffe3c7" intensity={2.12} castShadow
      shadow-mapSize={size.width < 700 ? [2048, 2048] : [4096, 4096]}
      shadow-camera-left={inspection ? -5 : -25} shadow-camera-right={inspection ? 5 : 25} shadow-camera-top={inspection ? 5 : 23} shadow-camera-bottom={inspection ? -5 : -23}
      shadow-camera-near={1} shadow-camera-far={85} shadow-bias={-.00008} shadow-normalBias={.014} shadow-radius={3} />
    <directionalLight ref={fill} position={inspection ? [5, 3, 3] : [18, 9, 12]} target={subject} color="#d4e9e4" intensity={.48} />
    <spotLight ref={rim} position={inspection ? [2, 5, -4] : [4, 11, -14]} target={subject} color="#ffddb4" intensity={65}
      angle={.38} penumbra={.55} distance={40} decay={2} />
    <pointLight position={[6.5, 3.9, 4.8]} color="#ffdda6" intensity={4} distance={10} decay={2} />
    <pointLight position={[0, 2.8, -6.5]} color="#c1e7ee" intensity={3.5} distance={6} decay={2} />
    <EffectComposer multisampling={4} frameBufferType={HalfFloatType} enableNormalPass={false}>
      <Bloom intensity={.1} luminanceThreshold={1.4} luminanceSmoothing={.35} mipmapBlur />
      {/* focalLength is the supported legacy lens parameter; focusRange is the
          current world-space control and is updated with the actual shot target. */}
      <DepthOfField ref={dof} target={[7, 1.8, -3]} focusDistance={14} focalLength={.05}
        focusRange={18} bokehScale={.22} resolutionScale={1} />
      <Vignette eskil={false} offset={.2} darkness={inspection ? .12 : .15} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  </>;
}

type CinematicCanvasProps = Omit<CanvasProps, 'gl' | 'onCreated' | 'shadows' | 'linear' | 'flat'> & StageProps;

/** Linear scene-referred shading with sRGB display output. EffectComposer
 * temporarily disables renderer tone mapping; its final ACES pass applies it
 * once. The renderer's ACES setting is restored when the composer unmounts. */
export default function OfferingCinematicCanvas({ children, focusTarget, lightLevel, cinematic, inspection = false, ...props }: CinematicCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dpr, setDpr] = useState(1.5);
  useLayoutEffect(() => {
    const canvas = canvasRef.current, container = canvas?.parentElement;
    if (!canvas || !container) return;
    const measure = () => {
      const rect = container.getBoundingClientRect();
      const next = offeringPixelRatio(container.clientWidth, container.clientHeight, rect.width, rect.height, window.devicePixelRatio || 1);
      setDpr(previous => Math.abs(previous - next) < .005 ? previous : next);
    };
    const observer = new ResizeObserver(measure); observer.observe(container);
    window.addEventListener('resize', measure); document.addEventListener('fullscreenchange', measure); measure();
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); document.removeEventListener('fullscreenchange', measure); };
  }, []);
  return <Canvas {...props} ref={canvasRef} shadows="soft" dpr={dpr}
    gl={{ antialias: false, alpha: false, powerPreference: 'high-performance', toneMapping: ACESFilmicToneMapping, toneMappingExposure: .98, outputColorSpace: SRGBColorSpace }}
    onCreated={({ gl }) => { ColorManagement.enabled = true; gl.shadowMap.type = PCFSoftShadowMap; }}>
    <Suspense fallback={null}>
      {children}
      <CinematicStage focusTarget={focusTarget} lightLevel={lightLevel} cinematic={cinematic} inspection={inspection} />
    </Suspense>
  </Canvas>;
}
