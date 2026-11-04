import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, DirectionalLight, MathUtils, Mesh, PerspectiveCamera, SRGBColorSpace, TextureLoader, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import texasUrl from '../../assets/atlas/texas-satellite.jpg?url';
import dfwUrl from '../../assets/atlas/dfw-satellite.jpg?url';
import earthUrl from '../../assets/atlas/branch-earth.glb?url';

export interface GlobePin {
  id: string;
  label: string;
  ariaLabel: string;
  lon: number;
  lat: number;
  count: number;
  selected: boolean;
  tone: 'normal' | 'warn' | 'err';
  activate: () => void;
}

export type GlobeView = 'world' | 'us';
export interface GlobeRegion {
  level: 'state' | 'metro';
  lon: number;
  lat: number;
  widthDegrees: number;
  heightDegrees: number;
  outline?: number[][][];
}

interface GlobeProps {
  region?: GlobeRegion;
  view: GlobeView;
  reset: number;
  pins: GlobePin[];
  onFocusUS: () => void;
}

const d = Math.PI / 180;
function surface(lon: number, lat: number, radius = 1) {
  return new Vector3(Math.cos(lat * d) * Math.sin(lon * d), Math.sin(lat * d), Math.cos(lat * d) * Math.cos(lon * d)).multiplyScalar(radius);
}

function Earth({ regional }: { regional: boolean }) {
  const model = useLoader(GLTFLoader, earthUrl);
  const globe = model.nodes.Earth as Mesh;
  return <>
    <mesh geometry={globe.geometry} material={globe.material} dispose={null} />
    {!regional && <mesh scale={1.018}>
      <sphereGeometry args={[1, 96, 64]} />
      <shaderMaterial transparent depthWrite={false} side={BackSide} blending={AdditiveBlending}
        vertexShader={`varying float edge;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            edge = max(0.0, 1.0 + dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
            gl_Position = projectionMatrix * mv;
          }`}
        fragmentShader={`varying float edge;
          void main() { gl_FragColor = vec4(0.16, 0.43, 0.78, 0.36 * smoothstep(0.0, 0.16, 1.0 - edge)); }`} />
    </mesh>}
  </>;
}

// UV coordinates follow the geodetic bounds of the two local satellite mosaics.
// The soft outer edge blends back into the lower-resolution globe as it curves away.
const imagery = {
  state: { url: texasUrl, west: -108, south: 23, east: -88, north: 40, radius: 1.00008 },
  metro: { url: dfwUrl, west: -97.5, south: 32.35, east: -96.1, north: 33.65, radius: 1.00012 },
};

function SatellitePatch({ level }: { level: GlobeRegion['level'] }) {
  const { url, west, south, east, north, radius } = imagery[level];
  const texture = useLoader(TextureLoader, url);
  const gl = useThree(state => state.gl);
  const geometry = useMemo(() => {
    const columns = 64, rows = 52;
    const vertices = [], normals = [], uv = [], colors = [], faces = [];
    for (let y = 0; y <= rows; y++) {
      for (let x = 0; x <= columns; x++) {
        const u = x / columns, v = y / rows;
        const unit = surface(west + (east - west) * u, south + (north - south) * v);
        vertices.push(unit.x * radius, unit.y * radius, unit.z * radius);
        normals.push(unit.x, unit.y, unit.z);
        uv.push(u, v);
        colors.push(1, 1, 1, Math.min(1, Math.min(u, v, 1 - u, 1 - v) * 18));
        if (x === columns || y === rows) continue;
        const i = y * (columns + 1) + x;
        faces.push(i, i + 1, i + columns + 1, i + 1, i + columns + 2, i + columns + 1);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
    geo.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    geo.setAttribute('color', new BufferAttribute(new Float32Array(colors), 4));
    geo.setIndex(faces);
    return geo;
  }, [west, south, east, north, radius]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} renderOrder={level === 'metro' ? 2 : 1}>
    <meshStandardMaterial map={texture} map-colorSpace={SRGBColorSpace} map-anisotropy={Math.min(8, gl.capabilities.getMaxAnisotropy())} vertexColors transparent depthWrite={false} roughness={1} />
  </mesh>;
}

function RegionOutline({ rings }: { rings: number[][][] }) {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i++) {
        const [lon, lat] = ring[i - 1];
        const dx = ring[i][0] - lon, dy = ring[i][1] - lat;
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / .25));
        for (let j = 0; j < steps; j++) {
          for (const t of [j / steps, (j + 1) / steps]) {
            const point = surface(lon + t * dx, lat + t * dy, 1.00018);
            positions.push(point.x, point.y, point.z);
          }
        }
      }
    }
    return new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  }, [rings]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <lineSegments geometry={geometry} renderOrder={3}>
    <lineBasicMaterial color="#e2ebd7" transparent opacity={.67} depthWrite={false} toneMapped={false} />
  </lineSegments>;
}

type CameraPose = { lon: number; lat: number; altitude: number };
const fov = 42;
function cameraPreset(view: GlobeView, region: GlobeRegion | undefined, aspect: number): CameraPose {
  const halfTan = Math.tan(fov * d / 2);
  if (region) {
    const width = region.widthDegrees * d * Math.cos(region.lat * d);
    const height = region.heightDegrees * d;
    const fill = region.level === 'state' ? 1.54 : 1.36;
    const altitude = Math.max(width / (fill * halfTan * aspect), height / (fill * halfTan));
    return { lon: region.lon, lat: region.lat, altitude };
  }
  // Frame the Americas face-on. World shows the entire disc, US fills the width
  // with North America while the curved limb remains visible at the outer edges.
  const radiusInHalfHeights = view === 'world'
    ? .91 * Math.min(1, aspect)
    : Math.max(.94 * aspect, Math.min(1.5 * aspect, 1.56));
  const altitude = Math.sqrt(1 + (1 / (radiusInHalfHeights * halfTan)) ** 2) - 1;
  return { lon: view === 'world' ? -87 : -98, lat: view === 'world' ? 23 : 35, altitude };
}

type CaptionBounds = { left: number; right: number; top: number; bottom: number };
const captionPlacements = [
  { right: true, below: false }, { right: false, below: false },
  { right: true, below: true }, { right: false, below: true },
];

function placeCaption(el: HTMLButtonElement, x: number, y: number,
  size: { width: number; height: number }, occupied: CaptionBounds[]) {
  const caption = el.lastElementChild as HTMLElement;
  const width = caption.offsetWidth;
  const height = caption.offsetHeight;
  // Prefer close labels. A second lane keeps dense north-eastern sites
  // individually readable on a phone, including during free rotation.
  for (const gap of [6, height + 7]) {
    for (const { right, below } of captionPlacements) {
      const left = MathUtils.clamp(right ? x + 4 : x - 4 - width, 2, size.width - width - 2);
      const top = below ? y + gap : y - gap - height;
      const bounds = { left, right: left + width, top, bottom: top + height };
      if (top < 1 || bounds.bottom >= size.height) continue;
      if (occupied.some(other => left < other.right + 3 && bounds.right > other.left - 3 &&
          top < other.bottom + 3 && bounds.bottom > other.top - 3)) continue;
      caption.style.left = `${12 + left - x}px`;
      caption.style.top = `${12 + top - y}px`;
      occupied.push(bounds);
      return;
    }
  }
}

function GlobeCamera({ view, region, reset, pins, labels }: Pick<GlobeProps, 'view' | 'region' | 'reset' | 'pins'> & {
  labels: RefObject<Map<string, HTMLButtonElement>>;
}) {
  const { gl, invalidate, size } = useThree();
  const initial = useMemo(() => cameraPreset(view, region, size.width / Math.max(size.height, 1)), [view, region, size.width, size.height]);
  const desired = useRef<CameraPose>(initial);
  const pose = useRef({ ...initial });
  const sun = useRef<DirectionalLight>(null);
  const projected = useMemo(() => new Vector3(), []);
  const positions = useMemo(() => pins.map(pin => surface(pin.lon, pin.lat, 1.00015)), [pins]);
  const motion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)'), []);

  // The HTML badges and Fiber tree commit separately. Ask for a frame after
  // both layouts have settled, including when a late atlas changes the pins.
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => invalidate());
    return () => cancelAnimationFrame(frame);
  }, [positions, view, reset, invalidate]);

  useLayoutEffect(() => {
    desired.current = { ...initial };
    // Follow the short way back across the antimeridian after free rotation.
    const delta = MathUtils.euclideanModulo(pose.current.lon - desired.current.lon + 180, 360) - 180;
    pose.current.lon = desired.current.lon + delta;
    invalidate();
  }, [initial, reset, invalidate]);

  useEffect(() => {
    const el = gl.domElement;
    let previous: { x: number; y: number; id: number } | null = null;
    const start = (event: PointerEvent) => {
      if (event.button !== 0 || previous) return;
      previous = { x: event.clientX, y: event.clientY, id: event.pointerId };
      el.setPointerCapture(event.pointerId);
      el.classList.add('is-orbiting');
    };
    const move = (event: PointerEvent) => {
      if (!previous || previous.id !== event.pointerId) return;
      const speed = Math.min(210, pose.current.altitude * 75) / Math.max(200, el.clientWidth);
      desired.current.lon -= (event.clientX - previous.x) * speed;
      desired.current.lat = MathUtils.clamp(desired.current.lat + (event.clientY - previous.y) * speed, -79, 79);
      previous.x = event.clientX;
      previous.y = event.clientY;
      invalidate();
    };
    const stop = () => { previous = null; el.classList.remove('is-orbiting'); };
    el.addEventListener('pointerdown', start);
    el.addEventListener('pointermove', move);
    el.addEventListener('lostpointercapture', stop);
    el.addEventListener('pointercancel', stop);
    el.addEventListener('pointerup', stop);
    return () => {
      el.removeEventListener('pointerdown', start);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('lostpointercapture', stop);
      el.removeEventListener('pointercancel', stop);
      el.removeEventListener('pointerup', stop);
      stop();
    };
  }, [gl, view, invalidate]);

  useFrame(({ camera, size }, dt) => {
    const perspective = camera as PerspectiveCamera;
    const now = pose.current;
    let moving = false;
    const amount = motion.matches ? 1 : 1 - Math.exp(-8 * Math.min(dt, .08));
    for (const key of ['lon', 'lat', 'altitude'] as const) {
      const target = desired.current[key];
      if (Math.abs(target - now[key]) < .000005) now[key] = target;
      else {
        // Interpolate altitude proportionally so a continental-to-city flight
        // keeps moving smoothly across its two very different length scales.
        now[key] = key === 'altitude' ? Math.exp(MathUtils.lerp(Math.log(now[key]), Math.log(target), amount)) : MathUtils.lerp(now[key], target, amount);
        moving = true;
      }
    }
    perspective.position.copy(surface(now.lon, now.lat, 1 + now.altitude));
    perspective.lookAt(0, 0, 0);
    perspective.updateMatrixWorld();
    sun.current?.position.set(-3, 3.7, 4.1).applyQuaternion(perspective.quaternion);
    const occupied: CaptionBounds[] = [];
    positions.forEach((position, index) => {
      const el = labels.current.get(pins[index].id);
      if (!el) return;
      projected.copy(position).project(perspective);
      const visible = position.dot(perspective.position) > 1.0003 && Math.abs(projected.x) < .98 && Math.abs(projected.y) < .97;
      el.hidden = !visible;
      if (visible) {
        const x = (projected.x + 1) / 2 * size.width;
        const y = (1 - projected.y) / 2 * size.height;
        el.style.left = `${(x / size.width * 100).toFixed(3)}%`;
        el.style.top = `${(y / size.height * 100).toFixed(3)}%`;
        placeCaption(el, x, y, size, occupied);
      }
    });
    if (moving) invalidate();
  });
  return <>
    <ambientLight color="#c9deff" intensity={1.4} />
    <directionalLight ref={sun} color="#ffe6c4" intensity={2.25} />
  </>;
}

export default function BranchGlobe({ view, region, reset, pins, onFocusUS }: GlobeProps) {
  const labels = useRef(new Map<string, HTMLButtonElement>());
  const redraw = useRef<(() => void) | null>(null);
  const worldPin = useMemo<GlobePin>(() => ({
    id: 'us', label: 'United States', ariaLabel: 'Explore United States branches', lon: -98, lat: 38,
    count: pins.reduce((count, pin) => count + pin.count, 0), selected: true, tone: 'normal', activate: onFocusUS,
  }), [pins, onFocusUS]);
  const displayed = useMemo(() => view === 'world' && !region ? [worldPin] : pins, [view, region, worldPin, pins]);
  return <div className="branch-globe-stage" aria-label="Interactive branch globe">
    <Canvas onCreated={({ gl, invalidate }) => { gl.toneMappingExposure = 1.08; redraw.current = invalidate; }} resize={{ offsetSize: true }} frameloop="demand" dpr={[1, 1.5]} camera={{ near: .0005, far: 10, fov, position: [0, 0, 3] }}
      gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}>
      <Suspense fallback={<mesh><sphereGeometry args={[1, 48, 32]} /><meshStandardMaterial color="#17344d" /></mesh>}>
        <Earth regional={!!region} />
      </Suspense>
      {region && <Suspense fallback={null}><SatellitePatch level="state" /></Suspense>}
      {region?.level === 'metro' && <Suspense fallback={null}><SatellitePatch level="metro" /></Suspense>}
      {region?.outline && <RegionOutline rings={region.outline} />}
      <GlobeCamera region={region} view={view} reset={reset} pins={displayed} labels={labels} />
    </Canvas>
    <div className="branch-globe-labels">{displayed.map(pin => <button
      type="button" key={pin.id} className="branch-globe-pin" data-selected={pin.selected} data-tone={pin.tone}
      hidden aria-label={pin.ariaLabel} aria-pressed={pin.count === 1 ? pin.selected : undefined} onClick={pin.activate}
      ref={el => {
        if (el) { labels.current.set(pin.id, el); redraw.current?.(); }
        else labels.current.delete(pin.id);
      }}>
      <i className="branch-globe-beacon" aria-hidden="true" /><span>{pin.label}{pin.count > 1 && <b>{pin.count}</b>}</span>
    </button>)}</div>
  </div>;
}
