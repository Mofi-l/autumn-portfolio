import { useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// ─────────────────────────────────────────────────────────────
//  Procedural autumn grove: an old oak with a glowing canopy, the forest
//  floor (fallen leaves + grass), background trees fading into warm haze,
//  and a sky dome. Everything is generated with a seeded RNG so the scene is
//  identical on every load.
// ─────────────────────────────────────────────────────────────

export const GROUND_Y = -2.55
// The oak stands just behind-left of the monk so he appears to rest by it.
export const TREE_POS = new THREE.Vector3(-1.55, GROUND_Y, -1.15)
// Late-afternoon sun, high and behind-left: backlights the canopy and casts
// the light shafts / dappled shadows toward the camera.
export const SUN_POS = new THREE.Vector3(-6, 14, -6)
export const HAZE = '#3b2414'

export const AUTUMN = [
  '#9a2f0c', '#c2410c', '#e2571c', '#b91c1c',
  '#d97706', '#f59e0b', '#7c2d12', '#ea7a1f',
]

// Deterministic RNG (mulberry32).
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Leaf silhouette (white, alpha-cut) tinted per instance.
let leafTex
export function getLeafTexture() {
  if (leafTex) return leafTex
  const s = 64
  const c = document.createElement('canvas')
  c.width = c.height = s
  const ctx = c.getContext('2d')
  ctx.translate(s / 2, s / 2)
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.moveTo(0, -28)
  ctx.bezierCurveTo(20, -18, 22, 10, 0, 28)
  ctx.bezierCurveTo(-22, 10, -20, -18, 0, -28)
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.28)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, -25)
  ctx.lineTo(0, 27)
  ctx.stroke()
  leafTex = new THREE.CanvasTexture(c)
  leafTex.colorSpace = THREE.SRGBColorSpace
  return leafTex
}

// Leaf material with fake translucency: leaves glow with their own colour so
// a backlit canopy reads as lit-through rather than silhouetted.
export function makeLeafMaterial(translucency = 0.38) {
  const mat = new THREE.MeshStandardMaterial({
    map: getLeafTexture(),
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    roughness: 0.8,
    metalness: 0,
  })
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
       totalEmissiveRadiance += diffuseColor.rgb * ${translucency.toFixed(3)};`
    )
  }
  mat.customProgramCacheKey = () => `leaf-${translucency}`
  return mat
}

function makeBarkTexture() {
  const w = 128
  const h = 512
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#8a8a8a'
  ctx.fillRect(0, 0, w, h)
  const r = rng(7)
  for (let i = 0; i < 280; i++) {
    const x = r() * w
    const y = r() * h
    const len = 40 + r() * 170
    const v = Math.floor(35 + r() * 130)
    ctx.strokeStyle = `rgb(${v},${v},${v})`
    ctx.lineWidth = 1 + r() * 4
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.bezierCurveTo(x + (r() - 0.5) * 8, y + len * 0.33, x + (r() - 0.5) * 8, y + len * 0.66, x + (r() - 0.5) * 6, y + len)
    ctx.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(3, 2)
  return t
}

function makeDirtTexture() {
  const s = 256
  const c = document.createElement('canvas')
  c.width = c.height = s
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#7a7a7a'
  ctx.fillRect(0, 0, s, s)
  const r = rng(21)
  for (let i = 0; i < 1400; i++) {
    const v = Math.floor(70 + r() * 120)
    ctx.fillStyle = `rgba(${v},${v},${v},0.5)`
    const sz = 2 + r() * 10
    ctx.fillRect(r() * s, r() * s, sz, sz * (0.4 + r()))
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(14, 14)
  return t
}

// ── Oak geometry ──
const UP = new THREE.Vector3(0, 1, 0)
const TRUNK_H = 6.6

function trunkAxisX(y) {
  return 0.28 * Math.sin(y * 0.42)
}

function makeTrunkGeometry() {
  const g = new THREE.CylinderGeometry(0.42, 0.78, TRUNK_H, 32, 60)
  g.translate(0, TRUNK_H / 2, 0)
  const p = g.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const a = Math.atan2(v.z, v.x)
    const r = Math.hypot(v.x, v.z)
    const y = v.y
    const bump = 1 + 0.07 * Math.sin(a * 7 + y * 1.3) + 0.045 * Math.sin(a * 13 - y * 2.3) + 0.03 * Math.sin(a * 23 + y * 4.1)
    const flare = y < 1.3 ? 1 + Math.pow((1.3 - y) / 1.3, 2) * 0.75 : 1
    const nr = r * bump * flare
    p.setXYZ(i, Math.cos(a) * nr + trunkAxisX(y), y, Math.sin(a) * nr)
  }
  g.computeVertexNormals()
  return g
}

function segment(start, dir, len, r0, r1, geos) {
  const d = dir.clone().normalize()
  const g = new THREE.CylinderGeometry(r1, r0, len, 10, 3)
  g.translate(0, len / 2, 0)
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d)
  g.applyMatrix4(new THREE.Matrix4().compose(start, q, new THREE.Vector3(1, 1, 1)))
  geos.push(g)
  return start.clone().addScaledVector(d, len)
}

function grow(start, dir, len, r, depth, rand, geos, tips) {
  const end = segment(start, dir, len, r, r * 0.62, geos)
  if (depth === 0) {
    tips.push(end)
    return
  }
  if (depth === 1) tips.push(end.clone())
  const kids = 2 + (rand() < 0.35 ? 1 : 0)
  for (let i = 0; i < kids; i++) {
    const nd = dir.clone().normalize()
    nd.x += (rand() - 0.5) * 1.1
    nd.z += (rand() - 0.5) * 1.1
    nd.y += 0.25 + rand() * 0.35
    nd.normalize()
    grow(end, nd, len * (0.62 + rand() * 0.15), r * 0.62, depth - 1, rand, geos, tips)
  }
}

function buildOak() {
  const rand = rng(1337)
  const geos = [makeTrunkGeometry()]
  const tips = []

  // Roots: half-buried flares spreading from the base.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + rand() * 0.4
    const start = new THREE.Vector3(Math.cos(a) * 0.35, 0.55, Math.sin(a) * 0.35)
    const dir = new THREE.Vector3(Math.cos(a), -0.35, Math.sin(a))
    segment(start, dir, 1.2 + rand() * 0.7, 0.26 + rand() * 0.06, 0.06, geos)
  }

  // Main limbs fanning out from the upper trunk.
  const LIMBS = 7
  for (let k = 0; k < LIMBS; k++) {
    const y = 3.8 + (k / (LIMBS - 1)) * 2.4 + (rand() - 0.5) * 0.3
    const a = (k / LIMBS) * Math.PI * 2 + rand() * 0.6
    const start = new THREE.Vector3(trunkAxisX(y), y, 0)
    const dir = new THREE.Vector3(Math.cos(a) * 0.85, 0.55 + rand() * 0.35, Math.sin(a) * 0.85)
    grow(start, dir, 1.6 + rand() * 0.8, 0.22 + rand() * 0.05, 2, rand, geos, tips)
  }
  // Crown leader continuing the trunk upward.
  grow(new THREE.Vector3(trunkAxisX(TRUNK_H), TRUNK_H - 0.1, 0), new THREE.Vector3(0.1, 1, 0.05), 1.4, 0.3, 2, rand, geos, tips)

  const wood = mergeGeometries(geos)
  geos.forEach((g) => g.dispose())

  // Canopy: instanced leaves clustered around each branch tip.
  const PER_TIP = 120
  const leafGeo = new THREE.PlaneGeometry(1, 1)
  const canopy = new THREE.InstancedMesh(leafGeo, makeLeafMaterial(0.38), tips.length * PER_TIP)
  const dummy = new THREE.Object3D()
  const col = new THREE.Color()
  let i = 0
  for (const tip of tips) {
    for (let j = 0; j < PER_TIP; j++) {
      const rr = Math.cbrt(rand())
      const th = rand() * Math.PI * 2
      const ph = Math.acos(2 * rand() - 1)
      dummy.position.set(
        tip.x + rr * Math.sin(ph) * Math.cos(th) * 1.15,
        tip.y + rr * Math.cos(ph) * 0.75 + 0.1,
        tip.z + rr * Math.sin(ph) * Math.sin(th) * 1.15
      )
      dummy.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI)
      const s = 0.2 + rand() * 0.18
      dummy.scale.set(s, s, s)
      dummy.updateMatrix()
      canopy.setMatrixAt(i, dummy.matrix)
      col.set(AUTUMN[Math.floor(rand() * AUTUMN.length)]).multiplyScalar(0.8 + rand() * 0.4)
      canopy.setColorAt(i, col)
      i++
    }
  }
  canopy.castShadow = true
  canopy.receiveShadow = true
  canopy.instanceMatrix.needsUpdate = true
  canopy.instanceColor.needsUpdate = true
  return { wood, canopy }
}

// ── Forest floor ──
function buildFloor() {
  const rand = rng(99)
  const dummy = new THREE.Object3D()
  const col = new THREE.Color()

  // Fallen leaves, densest around the oak.
  const FALLEN = 2400
  const fallen = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), makeLeafMaterial(0.12), FALLEN)
  for (let i = 0; i < FALLEN; i++) {
    const r = 9 * Math.pow(rand(), 1.4)
    const a = rand() * Math.PI * 2
    dummy.position.set(TREE_POS.x + Math.cos(a) * r, GROUND_Y + 0.012 + rand() * 0.02, TREE_POS.z + Math.sin(a) * r)
    dummy.rotation.set(-Math.PI / 2 + (rand() - 0.5) * 0.4, (rand() - 0.5) * 0.4, rand() * Math.PI * 2)
    const s = 0.18 + rand() * 0.16
    dummy.scale.set(s, s, s)
    dummy.updateMatrix()
    fallen.setMatrixAt(i, dummy.matrix)
    col.set(AUTUMN[Math.floor(rand() * AUTUMN.length)]).multiplyScalar(0.55 + rand() * 0.35)
    fallen.setColorAt(i, col)
  }
  fallen.receiveShadow = true

  // Sparse dry grass blades.
  const GRASS = 2600
  const bladeGeo = new THREE.ConeGeometry(0.025, 0.38, 3, 1)
  bladeGeo.translate(0, 0.19, 0)
  const grass = new THREE.InstancedMesh(bladeGeo, new THREE.MeshStandardMaterial({ roughness: 1 }), GRASS)
  const grassCols = ['#5a5a22', '#6b5a26', '#3f4a1c', '#7a6430']
  for (let i = 0; i < GRASS; i++) {
    const r = 1.8 + Math.pow(rand(), 0.8) * 15
    const a = rand() * Math.PI * 2
    dummy.position.set(Math.cos(a) * r, GROUND_Y, Math.sin(a) * r - 1)
    dummy.rotation.set((rand() - 0.5) * 0.5, rand() * Math.PI, (rand() - 0.5) * 0.5)
    const s = 0.4 + rand() * 0.5
    dummy.scale.set(s, s * (0.5 + rand() * 0.6), s)
    dummy.updateMatrix()
    grass.setMatrixAt(i, dummy.matrix)
    col.set(grassCols[Math.floor(rand() * grassCols.length)]).multiplyScalar(0.7 + rand() * 0.4)
    grass.setColorAt(i, col)
  }
  grass.receiveShadow = true
  return { fallen, grass }
}

// ── Background trees fading into the haze ──
function buildBackground() {
  const rand = rng(4242)
  const trunks = []
  const blobs = []
  let placed = 0
  let guard = 0
  while (placed < 20 && guard++ < 400) {
    const x = (rand() - 0.5) * 48
    const z = -8 - rand() * 24
    // keep the area around the hero composition clear
    if (Math.abs(x - TREE_POS.x) < 5 && z > -11) continue
    const h = 10 + rand() * 5
    const g = new THREE.CylinderGeometry(0.22 + rand() * 0.15, 0.45 + rand() * 0.25, h, 10)
    g.translate(x, GROUND_Y + h / 2, z)
    trunks.push(g)
    const n = 7 + Math.floor(rand() * 4)
    for (let k = 0; k < n; k++) {
      blobs.push({
        p: new THREE.Vector3(x + (rand() - 0.5) * 4, GROUND_Y + h * (0.62 + rand() * 0.35), z + (rand() - 0.5) * 3.5),
        s: 0.8 + rand() * 0.8,
        c: AUTUMN[Math.floor(rand() * AUTUMN.length)],
      })
    }
    placed++
  }
  const trunkGeo = mergeGeometries(trunks)
  trunks.forEach((g) => g.dispose())

  const blobMat = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true })
  blobMat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
       totalEmissiveRadiance += diffuseColor.rgb * 0.1;`
    )
  }
  blobMat.customProgramCacheKey = () => 'bg-blob'
  const foliage = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), blobMat, blobs.length)
  const dummy = new THREE.Object3D()
  const col = new THREE.Color()
  blobs.forEach((b, i) => {
    dummy.position.copy(b.p)
    dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3)
    dummy.scale.set(b.s, b.s * 0.8, b.s)
    dummy.updateMatrix()
    foliage.setMatrixAt(i, dummy.matrix)
    col.set(b.c).multiplyScalar(0.3)
    foliage.setColorAt(i, col)
  })
  return { trunkGeo, foliage }
}

function makeSkyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color('#0a0705') },
      horizon: { value: new THREE.Color(HAZE) },
      glow: { value: new THREE.Color('#ff9d4d') },
      sunDir: { value: SUN_POS.clone().normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      uniform vec3 glow;
      uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 c = mix(horizon, top, smoothstep(0.5, 0.95, h));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        c += glow * (pow(s, 8.0) * 0.5 + pow(s, 64.0) * 1.2);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
}

export default function Forest() {
  const { wood, canopy, fallen, grass, trunkGeo, foliage, barkTex, dirtTex, sky } = useMemo(() => {
    const oak = buildOak()
    const floor = buildFloor()
    const bg = buildBackground()
    return { ...oak, ...floor, ...bg, barkTex: makeBarkTexture(), dirtTex: makeDirtTexture(), sky: makeSkyMaterial() }
  }, [])

  return (
    <group>
      {/* Sky dome */}
      <mesh material={sky} renderOrder={-1}>
        <sphereGeometry args={[70, 32, 16]} />
      </mesh>

      {/* Ground */}
      <mesh rotation-x={-Math.PI / 2} position={[0, GROUND_Y, 0]} receiveShadow>
        <circleGeometry args={[48, 64]} />
        <meshStandardMaterial color="#2a1c10" map={dirtTex} roughness={1} />
      </mesh>
      <primitive object={fallen} />
      <primitive object={grass} />

      {/* The old oak */}
      <group position={TREE_POS}>
        <mesh geometry={wood} castShadow receiveShadow>
          <meshStandardMaterial color="#5a3f2c" map={barkTex} bumpMap={barkTex} bumpScale={3} roughness={1} />
        </mesh>
        <primitive object={canopy} />
      </group>

      {/* Distant trees */}
      <mesh geometry={trunkGeo}>
        <meshStandardMaterial color="#2a1d14" roughness={1} />
      </mesh>
      <primitive object={foliage} />
    </group>
  )
}
