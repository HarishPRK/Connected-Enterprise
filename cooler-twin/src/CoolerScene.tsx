import { Component, Suspense, memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { ContactShadows, Environment, Html, OrbitControls, useGLTF, useProgress } from '@react-three/drei'
import { gsap } from 'gsap'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { DoorOpen, RotateCcw, ScanLine, Thermometer, Wind, ZoomIn, ZoomOut } from 'lucide-react'
import type { Telemetry } from '../shared/telemetry'

export type ComponentName = 'overview' | 'door' | 'compressor' | 'shelves' | 'thermostat'
export type ViewMode = 'studio' | 'thermal'
type Props = {
  data: Telemetry | null
  selected: ComponentName
  onSelect: (value: ComponentName) => void
  onDoor: () => void
  badges: boolean
  view: ViewMode
  canControl: boolean
  snapshotRef: React.RefObject<(() => void) | null>
}

class SceneBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError() { return { error: true } }
  render() { return this.state.error ? <div className="scene-fallback"><ScanLine size={30}/><strong>3D view could not load</strong><p>Check WebGL support and reload. Sensor data is still available.</p><button onClick={() => location.reload()}>Reload view</button></div> : this.props.children }
}

function Loader() {
  const { progress } = useProgress()
  return <Html center><div className="model-loader"><div className="loader-orbit"/><span>Preparing your digital twin</span><small>{Math.round(progress)}% · Loading model & studio lighting</small></div></Html>
}

function componentFromName(object: THREE.Object3D): ComponentName {
  let node: THREE.Object3D | null = object
  while (node) {
    if (/Door|Glass|Handle/i.test(node.name)) return 'door'
    if (/Compressor|Grill|Vent/i.test(node.name)) return 'compressor'
    if (/Thermostat|Display/i.test(node.name)) return 'thermostat'
    if (/Shelf|Stock|Divider/i.test(node.name)) return 'shelves'
    node = node.parent
  }
  return 'overview'
}

const names: Record<ComponentName, string> = { overview: 'Painted steel cabinet', door: 'Glass door · click to open / close', compressor: 'Compressor assembly', shelves: 'Shelf inventory', thermostat: 'Electronic thermostat' }
const hudProjection = new THREE.Vector3()
function hudPosition(object: THREE.Object3D, camera: THREE.Camera, size: { width: number; height: number }): [number, number] {
  hudProjection.setFromMatrixPosition(object.matrixWorld).project(camera)
  const margin = size.width < 480 ? 65 : 95
  return [THREE.MathUtils.clamp((hudProjection.x * 0.5 + 0.5) * size.width, margin, size.width - margin), THREE.MathUtils.clamp((-hudProjection.y * 0.5 + 0.5) * size.height, 25, size.height - 45)]
}

function ThermostatScreen({ temperature, onSelect }: { temperature?: number; onSelect: () => void }) {
  const invalidate = useThree(state => state.invalidate)
  const screen = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 256; canvas.height = 80
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return { canvas, texture }
  }, [])
  useEffect(() => {
    const ctx = screen.canvas.getContext('2d')!
    ctx.fillStyle = '#071f1b'; ctx.fillRect(0, 0, 256, 80)
    ctx.fillStyle = '#84eed5'; ctx.font = 'bold 65px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(temperature === undefined ? '—' : temperature.toFixed(1), 128, 45)
    screen.texture.needsUpdate = true
    invalidate()
  }, [screen, temperature, invalidate])
  useEffect(() => () => screen.texture.dispose(), [screen])
  return <mesh position={[0.208, 1.837, 0.427]} onClick={event => { event.stopPropagation(); onSelect() }}><planeGeometry args={[0.078, 0.025]}/><meshBasicMaterial map={screen.texture} toneMapped={false}/></mesh>
}

const CoolerModel = memo(function CoolerModel({ data, selected, onSelect, onDoor, badges, view, canControl }: Omit<Props, 'snapshotRef'>) {
  const { scene: original } = useGLTF('/models/cooler.glb', '/draco/')
  const { invalidate, size } = useThree()
  const compact = size.width < 480
  const [hovered, setHovered] = useState<ComponentName | null>(null)
  const originals = useRef(new Map<THREE.Material, THREE.Color>())
  const scene = useMemo(() => {
    const copy = original.clone(true)
    copy.traverse(object => {
      if (object.name === 'Thermostat_Reading') object.visible = false
      if (object instanceof THREE.Mesh) {
        object.castShadow = !/Glass|LED/i.test(object.name)
        object.receiveShadow = true
        object.material = Array.isArray(object.material) ? object.material.map(m => m.clone()) : object.material.clone()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach(material => {
          if (material instanceof THREE.MeshStandardMaterial) {
            originals.current.set(material, material.color.clone())
            material.envMapIntensity = /Glass/i.test(object.name) ? 0.65 : 0.7
            if (material instanceof THREE.MeshPhysicalMaterial && /Glass/i.test(object.name)) {
              material.roughness = 0.003
              material.thickness = 0.006
              material.transmission = 1
              material.color.set('#ffffff')
              material.envMapIntensity = 0.3
              material.side = THREE.FrontSide
            }
          }
        })
      }
    })
    return copy
  }, [original])

  useEffect(() => {
    const door = scene.getObjectByName('DoorPivot')
    if (!door) return
    const tween = gsap.to(door.rotation, { y: data?.doorOpen ? -1.92 : 0, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1.1, ease: 'power2.inOut', onUpdate: invalidate })
    return () => { tween.kill() }
  }, [scene, data?.doorOpen, invalidate])

  useEffect(() => {
    if (!data) return
    data.stock.forEach((row, r) => row.forEach((filled, c) => {
      const item = scene.getObjectByName(`Stock_${r}_${c}`)
      if (item) item.visible = filled
    }))
    invalidate()
  }, [scene, data?.stock, invalidate])

  useEffect(() => {
    scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      const group = componentFromName(object)
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach(material => {
        if (!(material instanceof THREE.MeshStandardMaterial)) return
        const base = originals.current.get(material)
        if (base) material.color.copy(base)
        if (view === 'thermal' && !/Glass|LED|Brand|Label|Text|CocaCola|Marquee|Enjoy/i.test(object.name)) {
          material.color.set(group === 'compressor' ? '#fd683f' : group === 'shelves' ? '#54becf' : '#536881')
        } else if ((hovered === group || (selected !== 'overview' && selected === group)) && !/Glass|LED/i.test(object.name)) {
          material.color.lerp(new THREE.Color('#ffffff'), 0.14)
        }
      })
    })
    invalidate()
  }, [scene, hovered, selected, view, invalidate])

  useEffect(() => { return () => { document.body.style.cursor = '' } }, [])
  const hover = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    setHovered(componentFromName(event.object))
    document.body.style.cursor = 'pointer'
  }

  return <group>
    <ThermostatScreen temperature={data?.temperature.middle} onSelect={() => onSelect('thermostat')}/>
    <primitive object={scene} onPointerOver={hover} onPointerOut={() => { setHovered(null); document.body.style.cursor = '' }} onClick={(event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation()
      const part = componentFromName(event.object)
      onSelect(part)
      if (part === 'door' && canControl) onDoor()
    }}/>
    <pointLight position={[-0.25, 1.65, 0.16]} intensity={0.24} distance={1.7} color="#e0f6ff"/>
    <pointLight position={[0.25, 0.85, 0.18]} intensity={0.18} distance={1.5} color="#e0f6ff"/>
    <spotLight position={[0, 1.75, 0.22]} target-position={[0, 0.4, 0]} intensity={0.4} angle={0.75} penumbra={0.7} distance={2}/>
    {badges && data && <>
      <Html position={[compact ? 0.58 : 0.76, 1.22, 0.38]} center calculatePosition={hudPosition} distanceFactor={compact ? 2 : 3} zIndexRange={[5, 1]}><button className="sensor-badge" onClick={() => onSelect('thermostat')}><span className="sensor-icon"><Thermometer size={15}/></span><span><small>MIDDLE ZONE</small><b>{data.temperature.middle.toFixed(1)}<em> °C</em></b></span><i className="sensor-dot"/></button></Html>
      <Html position={[compact ? -0.4 : -0.65, 0.29, 0.4]} center calculatePosition={hudPosition} distanceFactor={compact ? 2 : 3} zIndexRange={[5, 1]}><button className="sensor-badge compressor-badge" onClick={() => onSelect('compressor')}><span className="sensor-icon"><Wind size={15}/></span><span><small>COMPRESSOR</small><b>{data.compressor.vibrationHz.toFixed(0)}<em> Hz</em></b></span><i className="sensor-dot"/></button></Html>
    </>}
    {hovered && <Html position={[0, 2.15, 0]} center zIndexRange={[6, 1]}><span className="part-tooltip">{names[hovered]}</span></Html>}
  </group>
})

function SceneControls({ reset, zoom }: { reset: number; zoom: { value: number; direction: number } }) {
  const controls = useRef<OrbitControlsImpl>(null)
  const { camera, invalidate } = useThree()
  useEffect(() => {
    if (!controls.current) return
    camera.position.set(2.65, 1.8, 4.3)
    controls.current.target.set(0, 1.0, 0)
    controls.current.update()
    invalidate()
  }, [reset, camera, invalidate])
  useEffect(() => {
    if (!zoom.value || !controls.current) return
    const target = controls.current.target
    const offset = camera.position.clone().sub(target)
    const distance = THREE.MathUtils.clamp(offset.length() * (zoom.direction > 0 ? 0.85 : 1.18), 2.8, 7.5)
    camera.position.copy(target).add(offset.normalize().multiplyScalar(distance))
    controls.current.update()
    invalidate()
  }, [zoom, camera, invalidate])
  return <OrbitControls ref={controls} makeDefault target={[0, 1, 0]} minDistance={2.8} maxDistance={7.5} minPolarAngle={0.5} maxPolarAngle={Math.PI / 2.04} enablePan={false} enableDamping dampingFactor={0.1}/>
}

export default function CoolerScene(props: Props) {
  const [reset, setReset] = useState(0)
  const [zoom, setZoom] = useState({ value: 0, direction: 1 })
  return <div className="scene-wrap">
    <SceneBoundary><Canvas shadows={{ type: THREE.PCFShadowMap }} frameloop="demand" dpr={[1, 1.6]} camera={{ position: [2.65, 1.8, 4.3], fov: 31, near: 0.1, far: 40 }} gl={{ antialias: true, preserveDrawingBuffer: true, alpha: true, powerPreference: 'high-performance' }} onCreated={({ gl, scene, camera }) => {
      gl.toneMapping = THREE.ACESFilmicToneMapping
      gl.toneMappingExposure = 0.95
      gl.outputColorSpace = THREE.SRGBColorSpace
      props.snapshotRef.current = () => {
        gl.render(scene, camera)
        const a = document.createElement('a')
        a.download = 'cooler-twin-3d.png'
        a.href = gl.domElement.toDataURL('image/png')
        a.click()
      }
    }}>
      <ambientLight intensity={0.4}/>
      <directionalLight position={[3, 5, 4]} intensity={1.8} castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0003}/>
      <directionalLight position={[-3, 2, 1]} intensity={0.8} color="#c3dbec"/>
      <spotLight position={[1, 4, -3]} intensity={5} angle={0.8} penumbra={1} color="#ffb6bd"/>
      <Suspense fallback={<Loader/>}>
        <Environment files="/models/studio.hdr" environmentIntensity={0.65}/>
        <CoolerModel {...props}/>
        <ContactShadows position={[0, -0.025, 0]} opacity={0.55} scale={5} blur={2.4} far={3} resolution={512} frames={1}/>
      </Suspense>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.032, 0]} receiveShadow><circleGeometry args={[2, 96]}/><meshStandardMaterial color="#26292c" roughness={0.92} metalness={0.15}/></mesh>
      <gridHelper args={[12, 48, '#414447', '#303437']} position={[0, -0.035, 0]}/>
      <SceneControls reset={reset} zoom={zoom}/>
    </Canvas></SceneBoundary>
    <div className="viewport-tools" aria-label="3D camera controls">
      <button title="Zoom in" aria-label="Zoom in" onClick={() => setZoom(z => ({ value: z.value + 1, direction: 1 }))}><ZoomIn size={17}/></button>
      <button title="Zoom out" aria-label="Zoom out" onClick={() => setZoom(z => ({ value: z.value + 1, direction: -1 }))}><ZoomOut size={17}/></button>
      <span/>
      <button title="Reset camera" aria-label="Reset camera" onClick={() => setReset(v => v + 1)}><RotateCcw size={16}/></button>
    </div>
    <div className="scene-instruction"><span className="orbit-symbol">↔</span> Drag to orbit <i/> Scroll to zoom <i/> Click to inspect</div>
    <button className={`door-control ${props.data?.doorOpen ? 'is-open' : ''}`} disabled={!props.canControl} onClick={props.onDoor}><DoorOpen size={16}/>{props.data?.doorOpen ? 'Close door' : 'Open door'}</button>
  </div>
}
