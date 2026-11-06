import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Canvas, useFrame, useThree, type CanvasProps } from '@react-three/fiber';
import { Environment, useGLTF } from '@react-three/drei';
import {
  ACESFilmicToneMapping, Box3, ColorManagement, Group, Mesh,
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
import { batchClosedGateway, batchGatewayAssemblies } from './OfferingModelBatch';

// Own assets, bundled with the app; no runtime CDN or decoder dependency.
for (const url of [storeUrl, kitUrl, actorsUrl, twinUrl, analyticsUrl]) useGLTF.preload(url, false);
// One-file renderer API requested by the design brief: assets, loader and Canvas.
// eslint-disable-next-line react-refresh/only-export-components
export const cinematicAssets = { store: storeUrl, kit: kitUrl, twin: twinUrl, analytics: analyticsUrl };

/** Clone materials, never mutate useGLTF's shared cache. Source geometry and
 * textures remain shared. Physical overrides retain baked maps and markings. */
// eslint-disable-next-line react-refresh/only-export-components
export function useCinematicModel(url: string, name?: string, size?: number, gatewayRepresentation: 'assemblies' | 'closed' = 'assemblies') {
  const gltf = useGLTF(url, false);
  const model = useMemo(() => {
    const source = name ? gltf.scene.getObjectByName(name) : gltf.scene;
    if (!source) throw new Error(`Missing cinematic model: ${name}`);
    const copy = source.clone(true), wrapper = new Group();
    const materials = new Map<MeshStandardMaterial, MeshStandardMaterial>();
    copy.traverse(object => {
      if (!(object instanceof Mesh)) return;
      object.castShadow = object.receiveShadow = true;
      const augment = (source: MeshStandardMaterial) => {
        if (!(source instanceof MeshStandardMaterial)) return source;
        let physical = materials.get(source);
        if (physical) return physical;
        const glass = /glass|glaz|lens/i.test(source.name) || source instanceof MeshPhysicalMaterial && source.transmission > 0;
        const metal = source.metalness > .45;
        // Painted walls/plastic/fabric do not need the extra clearcoat BRDF.
        // Keep the physical finish on the reflective glass and metal details.
        physical = glass || metal ? new MeshPhysicalMaterial() : new MeshStandardMaterial();
        MeshStandardMaterial.prototype.copy.call(physical, source);
        if (physical instanceof MeshPhysicalMaterial) {
          physical.clearcoat = glass ? .7 : .16;
          physical.clearcoatRoughness = glass ? .12 : .38;
          physical.transmission = source instanceof MeshPhysicalMaterial ? Math.min(.3, source.transmission) : 0;
          physical.thickness = glass ? .008 : 0;
        }
        physical.roughness = glass ? .16 : Math.max(.28, source.roughness);
        physical.metalness = glass ? 0 : source.metalness;
        // Preserve transparent baked glazing; transmission is reserved for an
        // existing physical lens to avoid an extra framebuffer pass per window.
        physical.envMapIntensity = metal ? .8 : .55;
        materials.set(source, physical);
        return physical;
      };
      object.material = Array.isArray(object.material) ? object.material.map(augment) : augment(object.material);
    });
    const geometries = name === 'GatewayTwin'
      ? gatewayRepresentation === 'closed' ? batchClosedGateway(copy) : batchGatewayAssemblies(copy)
      : [];
    if (size) {
      const bounds = new Box3().setFromObject(copy);
      const center = bounds.getCenter(new Vector3()), dimensions = bounds.getSize(new Vector3());
      copy.position.sub(new Vector3(center.x, bounds.min.y, center.z));
      wrapper.scale.setScalar(size / Math.max(dimensions.x, dimensions.y, dimensions.z));
    }
    wrapper.add(copy);
    return { object: wrapper, materials: [...materials.values()], geometries };
  }, [gltf, name, size, gatewayRepresentation]);
  useEffect(() => () => { model.materials.forEach(material => material.dispose()); model.geometries.forEach(geometry => geometry.dispose()); }, [model]);
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
  const rim = useRef<SpotLight>(null);
  const subject = useMemo(() => { const object = new Object3D(); object.position.set(inspection ? 0 : 7, inspection ? 1.2 : 1.8, inspection ? 0 : -3); return object; }, [inspection]);
  const shadowSubject = useMemo(() => { const object = new Object3D(); object.position.copy(subject.position); return object; }, [subject]);
  const lightOffset = useMemo(() => new Vector3(...(inspection ? [-4, 5.8, 5] : [-19, 20.2, 19]) as [number, number, number]), [inspection]);
  useFrame(({ scene }) => {
    const level = inspection ? 1 : Math.max(0, Math.min(1, lightLevel()));
    scene.environmentIntensity = inspection ? .28 : .1 + level * .42;
    if (bounce.current) bounce.current.intensity = inspection ? .28 : .18 + level * .44;
    if (key.current) key.current.intensity = inspection ? 1.05 : .32 + level * 1.8;
    if (fill.current) fill.current.intensity = inspection ? .32 : .12 + level * .36;
    if (rim.current) rim.current.intensity = inspection ? 35 : 18 + level * 47;
    if (key.current) {
      // A close-up no longer redraws the shadow casters across the entire store.
      // Move light and target together: the lighting direction stays identical.
      // The guard band retains nearby casters, floor contact and self shadows.
      shadowSubject.position.copy(cinematic ? focusTarget.current : subject.position);
      key.current.position.copy(shadowSubject.position).add(lightOffset);
      shadowSubject.updateMatrixWorld();
      const radius = inspection ? 5 : cinematic
        ? Math.min(25, Math.max(6, camera.position.distanceTo(focusTarget.current) * .6 * Math.max(1, size.width / Math.max(1, size.height)) + 3)) : 25;
      const shadowCamera = key.current.shadow.camera;
      if (Math.abs(shadowCamera.right - radius) > .02) {
        shadowCamera.left = shadowCamera.bottom = -radius;
        shadowCamera.right = shadowCamera.top = radius;
        shadowCamera.updateProjectionMatrix();
      }
    }
  });
  return <>
    <Environment files={studioHdr} background={false} environmentIntensity={.4} />
    <hemisphereLight ref={bounce} args={['#fff4e5', '#758c81', .62]} />
    <primitive object={subject} />
    <primitive object={shadowSubject} />
    <directionalLight ref={key} position={inspection ? [-4, 7, 5] : [-12, 22, 16]} target={shadowSubject} color="#ffe3c7" intensity={2.12} castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-camera-left={inspection ? -5 : -25} shadow-camera-right={inspection ? 5 : 25} shadow-camera-top={inspection ? 5 : 23} shadow-camera-bottom={inspection ? -5 : -23}
      shadow-camera-near={1} shadow-camera-far={85} shadow-bias={-.00008} shadow-normalBias={.014} shadow-radius={3} />
    <directionalLight ref={fill} position={inspection ? [5, 3, 3] : [18, 9, 12]} target={subject} color="#d4e9e4" intensity={.48} />
    <spotLight ref={rim} position={inspection ? [2, 5, -4] : [4, 11, -14]} target={subject} color="#ffddb4" intensity={65}
      angle={.38} penumbra={.55} distance={40} decay={2} />
    <pointLight position={[6.5, 3.9, 4.8]} color="#ffdda6" intensity={4} distance={10} decay={2} />
    <pointLight position={[0, 2.8, -6.5]} color="#c1e7ee" intensity={3.5} distance={6} decay={2} />
  </>;
}

type CinematicCanvasProps = Omit<CanvasProps, 'gl' | 'onCreated' | 'shadows' | 'linear' | 'flat'> & StageProps;

/** Native MSAA and a single ACES output keep the HDR-lit materials and real
 * shadows, without re-rendering the full scene for an always-on depth-blur pass. */
export default function OfferingCinematicCanvas({ children, focusTarget, lightLevel, cinematic, inspection = false, ...props }: CinematicCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dpr, setDpr] = useState(1);
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
    gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', toneMapping: ACESFilmicToneMapping, toneMappingExposure: .98, outputColorSpace: SRGBColorSpace }}
    onCreated={({ gl }) => { ColorManagement.enabled = true; gl.shadowMap.type = PCFSoftShadowMap; }}>
    <Suspense fallback={null}>
      {children}
      <CinematicStage focusTarget={focusTarget} lightLevel={lightLevel} cinematic={cinematic} inspection={inspection} />
    </Suspense>
  </Canvas>;
}
