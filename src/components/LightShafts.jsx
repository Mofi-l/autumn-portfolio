import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { SUN_POS, rng } from './Forest'

/**
 * Fake volumetric "god rays": soft, additive light shafts streaming down
 * through gaps in the canopy along the sun direction. Each shaft is two
 * crossed planes so it reads from every camera angle; opacity breathes slowly
 * as if leaves drift across the sun.
 */
function makeShaftTexture() {
  const w = 64
  const h = 256
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  const hg = ctx.createLinearGradient(0, 0, w, 0)
  hg.addColorStop(0, 'rgba(255,255,255,0)')
  hg.addColorStop(0.5, 'rgba(255,255,255,1)')
  hg.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = hg
  ctx.fillRect(0, 0, w, h)
  // Fade along the length: quick fade-in at the canopy, long tail to ground.
  ctx.globalCompositeOperation = 'destination-in'
  const vg = ctx.createLinearGradient(0, 0, 0, h)
  vg.addColorStop(0, 'rgba(255,255,255,0)')
  vg.addColorStop(0.12, 'rgba(255,255,255,1)')
  vg.addColorStop(0.6, 'rgba(255,255,255,0.55)')
  vg.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// Shaft origins (world space) placed at gaps in the canopy.
const ORIGINS = [
  [-3.2, 6.2, -2.6], [-1.2, 6.6, -3.0], [0.4, 6.3, -2.4], [-2.4, 6.8, -0.6],
  [1.4, 6.0, -1.2], [-4.4, 5.8, -1.0], [2.4, 6.4, -3.2],
]

export default function LightShafts() {
  const groupRef = useRef()
  const shafts = useMemo(() => {
    const rand = rng(77)
    const tex = makeShaftTexture()
    const down = SUN_POS.clone().normalize().negate() // travel direction
    const up = down.clone().negate()
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up)
    const q2 = new THREE.Quaternion().setFromAxisAngle(up, Math.PI / 2).multiply(q)
    return ORIGINS.map(([x, y, z]) => {
      const len = 10 + rand() * 2
      const width = 0.5 + rand() * 0.8
      const center = new THREE.Vector3(x, y, z).addScaledVector(down, len / 2)
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        color: '#ffc27a',
        transparent: true,
        opacity: 0.06 + rand() * 0.05,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      return { center, len, width, mat, base: mat.opacity, phase: rand() * 10, q, q2 }
    })
  }, [])

  useFrame((state) => {
    const t = state.clock.getElapsedTime()
    for (const s of shafts) {
      s.mat.opacity = s.base * (0.7 + 0.3 * Math.sin(t * 0.35 + s.phase))
    }
  })

  return (
    <group ref={groupRef}>
      {shafts.map((s, i) => (
        <group key={i} position={s.center}>
          <mesh quaternion={s.q} material={s.mat}>
            <planeGeometry args={[s.width, s.len]} />
          </mesh>
          <mesh quaternion={s.q2} material={s.mat}>
            <planeGeometry args={[s.width, s.len]} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
