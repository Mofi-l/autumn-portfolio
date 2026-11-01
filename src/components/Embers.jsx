import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Slow-drifting particles (embers / dust motes). Configurable so the same
 * component can render warm dust floating in the sun shafts.
 */
export default function Embers({
  count = 300,
  color = '#ff6b35',
  size = 0.035,
  opacity = 0.5,
  speed = 1,
  center = [0, 0, -1],
  area = [14, 10, 8],
}) {
  const pointsRef = useRef()
  const [cx, cy, cz] = center
  const [ax, ay, az] = area

  const { positions, speeds } = useMemo(() => {
    const positions = new Float32Array(count * 3)
    const speeds = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = cx + (Math.random() - 0.5) * ax
      positions[i * 3 + 1] = cy + (Math.random() - 0.5) * ay
      positions[i * 3 + 2] = cz + (Math.random() - 0.5) * az
      speeds[i] = 0.1 + Math.random() * 0.3
    }
    return { positions, speeds }
  }, [count, cx, cy, cz, ax, ay, az])

  const col = useMemo(() => new THREE.Color(color), [color])

  useFrame((_, delta) => {
    const geo = pointsRef.current?.geometry
    if (!geo) return
    const arr = geo.attributes.position.array
    const top = cy + ay / 2
    const bottom = cy - ay / 2
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] += speeds[i] * delta * 0.4 * speed
      arr[i * 3 + 0] += Math.sin(arr[i * 3 + 1] + i) * delta * 0.02
      if (arr[i * 3 + 1] > top) {
        arr[i * 3 + 1] = bottom
        arr[i * 3 + 0] = cx + (Math.random() - 0.5) * ax
      }
    }
    geo.attributes.position.needsUpdate = true
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial
        size={size}
        color={col}
        transparent
        opacity={opacity}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
      />
    </points>
  )
}
