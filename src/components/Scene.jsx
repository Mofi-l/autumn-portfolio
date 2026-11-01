import { Suspense, useRef, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment } from '@react-three/drei'
import { EffectComposer, Bloom, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import MonkModel from './MonkModel'
import Embers from './Embers'
import Forest, { SUN_POS, HAZE } from './Forest'
import LightShafts from './LightShafts'
import FallingLeaves from './FallingLeaves'

// Shared cursor position in NDC (−1..1), read by the torch light and camera.
const pointer = { x: 0, y: 0 }
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointermove',
    (e) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1
      pointer.y = -((e.clientY / window.innerHeight) * 2 - 1)
    },
    { passive: true }
  )
}

/**
 * Torch light: a warm, flickering point light that follows the cursor. The
 * cursor is unprojected through the (moving) camera and the light placed part
 * way toward the monk, so it lights whatever the torch is over in every shot.
 * Dims to nothing when the monk blows the torch out.
 */
const _ray = new THREE.Vector3()
const FOCUS = new THREE.Vector3(0, -0.4, 0)
function CursorLight({ extinguishRef }) {
  const lightRef = useRef()
  const target = useRef(new THREE.Vector3())
  const tRef = useRef(0)
  const { camera } = useThree()

  useFrame((_, delta) => {
    const light = lightRef.current
    if (!light) return
    tRef.current += delta
    _ray.set(pointer.x, pointer.y, 0.5).unproject(camera).sub(camera.position).normalize()
    const dist = camera.position.distanceTo(FOCUS) * 0.72
    target.current.copy(camera.position).addScaledVector(_ray, dist)
    light.position.lerp(target.current, 1 - Math.pow(0.0015, delta))

    const t = tRef.current
    const flicker = 1 + Math.sin(t * 18) * 0.08 + Math.sin(t * 33 + 1.1) * 0.05 + Math.sin(t * 7) * 0.06
    const lit = Math.max(0, 1 - (extinguishRef?.current ?? 0))
    light.intensity = THREE.MathUtils.damp(light.intensity, 34 * flicker * lit, 8, delta)
  })

  return <pointLight ref={lightRef} intensity={34} distance={9} decay={2} color="#ff8a3c" />
}

/**
 * Camera shots, one per section. The monk stays put by the oak; the camera
 * travels so he sits opposite each section's content panel:
 *   hero (wide) → about (monk left) → path (monk right) → disciplines (monk
 *   left) → contracts (pulled back, high) → summon (front).
 */
const SHOTS = [
  { pos: [1.2, 0.5, 9.6], look: [-0.5, 0.9, -0.6] },
  { pos: [3.4, 0.4, 5.6], look: [1.7, 0.0, 0.0] },
  { pos: [-3.6, 0.5, 5.2], look: [-1.8, 0.1, -0.2] },
  { pos: [2.8, 1.5, 4.6], look: [1.6, 0.2, 0.0] },
  { pos: [0.2, 3.2, 11.5], look: [-0.4, 1.8, -2.0] },
  { pos: [3.0, 0.6, 7.8], look: [2.5, 0.1, 0.0] },
]
const smooth = (t) => {
  const x = Math.min(Math.max(t, 0), 1)
  return x * x * x * (x * (x * 6 - 15) + 10)
}
const _p0 = new THREE.Vector3()
const _p1 = new THREE.Vector3()
const _l0 = new THREE.Vector3()
const _l1 = new THREE.Vector3()

function CameraRig({ scrollRef }) {
  const { camera } = useThree()
  const look = useRef(new THREE.Vector3(...SHOTS[0].look))

  useFrame((_, delta) => {
    const sf = (scrollRef.current ?? 0) * (SHOTS.length - 1)
    const i = Math.min(Math.floor(sf), SHOTS.length - 2)
    const f = smooth(sf - i)
    _p0.fromArray(SHOTS[i].pos)
    _p1.fromArray(SHOTS[i + 1].pos)
    _l0.fromArray(SHOTS[i].look)
    _l1.fromArray(SHOTS[i + 1].look)
    const pos = _p0.lerp(_p1, f)
    const lk = _l0.lerp(_l1, f)
    // subtle mouse parallax
    pos.x += pointer.x * 0.25
    pos.y += pointer.y * 0.15

    camera.position.x = THREE.MathUtils.damp(camera.position.x, pos.x, 2.5, delta)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, pos.y, 2.5, delta)
    camera.position.z = THREE.MathUtils.damp(camera.position.z, pos.z, 2.5, delta)
    look.current.x = THREE.MathUtils.damp(look.current.x, lk.x, 2.5, delta)
    look.current.y = THREE.MathUtils.damp(look.current.y, lk.y, 2.5, delta)
    look.current.z = THREE.MathUtils.damp(look.current.z, lk.z, 2.5, delta)
    camera.lookAt(look.current)
  })

  return null
}

export default function Scene({ scrollRef, onReady, extinguishRef }) {
  const groupRef = useRef()

  return (
    <Canvas
      shadows
      dpr={[1, 1.8]}
      camera={{ position: SHOTS[0].pos, fov: 38, near: 0.1, far: 150 }}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', zIndex: 0 }}
    >
      <color attach="background" args={[HAZE]} />
      <fog attach="fog" args={[HAZE, 8, 30]} />

      {/* Warm late-afternoon light */}
      <hemisphereLight args={['#8a5a34', '#1a120a', 0.55]} />
      <ambientLight intensity={0.12} color="#5a4030" />
      <directionalLight
        position={SUN_POS}
        intensity={3.2}
        color="#ffb36b"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      >
        <orthographicCamera attach="shadow-camera" args={[-12, 12, 12, -12, 0.5, 50]} />
      </directionalLight>
      {/* Soft front key so the monk's form reads against the backlight */}
      <directionalLight position={[5, 4, 8]} intensity={1.1} color="#ffd8b0" />
      <pointLight position={[0, -1.6, 2.5]} intensity={1.0} distance={8} color="#c2410c" />

      <Suspense fallback={null}>
        <MonkModel groupRef={groupRef} onReady={onReady} extinguishRef={extinguishRef} />
        <Environment preset="sunset" environmentIntensity={0.35} />
      </Suspense>

      <Forest />
      <LightShafts />
      <FallingLeaves count={120} />
      <Embers count={260} color="#ffdcae" size={0.028} opacity={0.55} speed={0.15} center={[-0.5, 0.8, -0.8]} area={[9, 7, 6]} />
      <CursorLight extinguishRef={extinguishRef} />
      <CameraRig scrollRef={scrollRef} />

      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur luminanceThreshold={0.6} luminanceSmoothing={0.25} intensity={0.75} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    </Canvas>
  )
}
