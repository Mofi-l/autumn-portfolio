import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { AUTUMN, GROUND_Y, TREE_POS, makeLeafMaterial, rng } from './Forest'

/**
 * Leaves drifting down from the oak's canopy: they fall slowly, sway side to
 * side and tumble, then respawn at the top once they reach the ground.
 */
export default function FallingLeaves({ count = 120 }) {
  const { mesh, leaves } = useMemo(() => {
    const rand = rng(555)
    const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), makeLeafMaterial(0.35), count)
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    m.frustumCulled = false
    const col = new THREE.Color()
    const spawn = (l, anywhere) => {
      l.x = TREE_POS.x + (rand() - 0.5) * 8
      l.z = TREE_POS.z + (rand() - 0.5) * 6
      l.y = anywhere ? GROUND_Y + rand() * 9 : 6 + rand() * 1.5
    }
    const leaves = []
    for (let i = 0; i < count; i++) {
      const l = {
        vy: 0.35 + rand() * 0.35,
        amp: 0.25 + rand() * 0.45,
        freq: 0.8 + rand() * 0.9,
        phase: rand() * 10,
        rx: rand() * 6, ry: rand() * 6, rz: rand() * 6,
        sx: (rand() - 0.5) * 3, sy: (rand() - 0.5) * 3, sz: (rand() - 0.5) * 3,
        s: 0.16 + rand() * 0.14,
        spawn,
      }
      spawn(l, true)
      leaves.push(l)
      col.set(AUTUMN[Math.floor(rand() * AUTUMN.length)]).multiplyScalar(0.85 + rand() * 0.3)
      m.setColorAt(i, col)
    }
    return { mesh: m, leaves }
  }, [count])

  const dummy = useMemo(() => new THREE.Object3D(), [])

  useFrame((state, delta) => {
    const t = state.clock.getElapsedTime()
    const dt = Math.min(delta, 0.05)
    leaves.forEach((l, i) => {
      l.y -= l.vy * dt
      if (l.y < GROUND_Y + 0.05) l.spawn(l, false)
      l.rx += l.sx * dt
      l.ry += l.sy * dt
      l.rz += l.sz * dt
      dummy.position.set(
        l.x + Math.sin(t * l.freq + l.phase) * l.amp,
        l.y,
        l.z + Math.cos(t * l.freq * 0.8 + l.phase) * l.amp * 0.6
      )
      dummy.rotation.set(l.rx, l.ry, l.rz)
      dummy.scale.setScalar(l.s)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  })

  return <primitive object={mesh} />
}
