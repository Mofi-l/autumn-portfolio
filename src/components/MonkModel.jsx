import { useRef, useEffect } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { GROUND_Y } from './Forest'

// Relative to Vite's base URL so the asset resolves under any deploy path.
const MODEL_URL = `${import.meta.env.BASE_URL}models/monk-optimized.glb`

// Reusable scratch vectors for projecting the head to screen space.
const _headWorld = new THREE.Vector3()
const _headProj = new THREE.Vector3()

// The model is ~0.98 units tall with its origin at the feet; scaled up so the
// monk stands ~3.3 units tall with his feet on the forest floor.
const MODEL_SCALE = 3.4
// Resting pose by the tree: turned slightly toward the hero camera and
// leaning a touch toward the trunk (which stands behind-left of him).
const MONK_YAW = 0.18
const MONK_LEAN = 0.045

/**
 * The shadow monk, standing at rest against the old oak.
 *
 * Unlike the first portfolio, the character no longer spins with scroll — the
 * camera travels around the scene instead (see CameraRig in Scene.jsx). The
 * monk keeps a subtle idle (breathing + sway) and the torch interaction: bring
 * the torch to his face and he snuffs it out and bows his head (skinned head
 * bone added during the auto-rig step).
 */
export default function MonkModel({ groupRef, onReady, extinguishRef }) {
  const { scene } = useGLTF(MODEL_URL)
  const innerRef = useRef()
  const bobRef = useRef(0)
  const readyRef = useRef(false)
  const headRef = useRef(null) // the "head_joint" bone
  // Cursor in normalized device coords (−1..1).
  const ndcRef = useRef({ x: 0, y: -1, active: false })

  useEffect(() => {
    const onMove = (e) => {
      ndcRef.current.x = (e.clientX / window.innerWidth) * 2 - 1
      ndcRef.current.y = -((e.clientY / window.innerHeight) * 2 - 1)
      ndcRef.current.active = true
    }
    const onLeave = () => {
      ndcRef.current.active = false
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  // Locate the head joint (added during the auto-rig step).
  useEffect(() => {
    scene.traverse((o) => {
      if (o.name === 'head_joint') headRef.current = o
    })
  }, [scene])

  // Tune materials once: matte, near-black ninja cloth.
  useEffect(() => {
    scene.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true
        o.receiveShadow = true
        o.frustumCulled = false
        const m = o.material
        if (m && !m.userData.__tuned) {
          if (m.color) m.color.multiplyScalar(0.2)
          if (m.metalness !== undefined) m.metalness = 0.05
          if (m.roughness !== undefined) m.roughness = 0.92
          m.envMapIntensity = 0.3
          m.needsUpdate = true
          m.userData.__tuned = true
        }
      }
    })
  }, [scene])

  useFrame((state, delta) => {
    bobRef.current += delta

    // Signal readiness after the first rendered frame.
    if (!readyRef.current) {
      readyRef.current = true
      onReady?.()
    }

    // Idle: gentle sway + breathing on a fixed resting pose.
    if (groupRef?.current) {
      const g = groupRef.current
      g.rotation.y = MONK_YAW + Math.sin(bobRef.current * 0.4) * 0.025
      g.rotation.z = MONK_LEAN
    }
    if (innerRef.current) {
      innerRef.current.position.y = GROUND_Y + Math.sin(bobRef.current * 0.8) * 0.012
    }

    // ── Torch blow-out + head bow ──
    // Anchored on the head joint's projected screen position so it works for
    // every camera shot.
    if (headRef.current) {
      const ndc = ndcRef.current
      headRef.current.getWorldPosition(_headWorld)
      _headProj.copy(_headWorld).project(state.camera)

      const dist = Math.hypot(ndc.x - _headProj.x, ndc.y - _headProj.y)
      const RADIUS = 0.42 // how close (in NDC) the torch must get to engage
      let prox = ndc.active ? Math.max(0, 1 - dist / RADIUS) : 0
      prox = prox * prox * (3 - 2 * prox)

      // The flame snuffs early/fast; the head bows a beat behind it.
      if (extinguishRef) {
        const snuff = Math.min(1, prox * 1.6)
        extinguishRef.current = THREE.MathUtils.damp(extinguishRef.current ?? 0, snuff, 10, delta)
      }
      const ext = extinguishRef?.current ?? prox
      const bowDrive = prox * Math.max(0, (ext - 0.3) / 0.7)
      const targetBow = bowDrive * 0.785 // ~45°
      headRef.current.rotation.x = THREE.MathUtils.damp(headRef.current.rotation.x, targetBow, 5, delta)
    }
  })

  return (
    <group ref={groupRef}>
      <group ref={innerRef} position={[0, GROUND_Y, 0]} scale={MODEL_SCALE}>
        <primitive object={scene} />
      </group>
    </group>
  )
}

useGLTF.preload(MODEL_URL)
