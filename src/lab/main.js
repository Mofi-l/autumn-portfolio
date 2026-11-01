// Rig Lab — place a skeleton in an unrigged character, generate and fix
// skin weights, test poses (incl. the site's torch head-bow), and export a
// rigged GLB with saved poses as animation clips.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh'
import { makeTemplate, Rig, TEMPLATE_HEIGHT } from './skeleton.js'
import { Weights } from './weights.js'
import { PRESETS } from './presets.js'
import { idbGet, idbPut, idbDelete } from './store.js'

const $ = (id) => document.getElementById(id)
const MODEL_URL = new URL('../models/knight-lab.glb', window.location.href).href
const DRACO_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.5/'
const BOW_MAX = 0.785 // same 45° the site uses
const MODES = ['skeleton', 'weights', 'pose', 'export']
const PAINT_TOOLS = ['add', 'subtract', 'smooth']
const X_AXIS = new THREE.Vector3(1, 0, 0)

// ---------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------
const canvas = $('view')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping

const scene = new THREE.Scene()
scene.background = new THREE.Color('#17171c')
const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 50)
camera.position.set(0.9, 0.75, 2.2)
const orbit = new OrbitControls(camera, canvas)
orbit.target.set(0, 0.5, 0)
orbit.enableDamping = true
orbit.update()

scene.add(new THREE.HemisphereLight('#ffffff', '#3b3b46', 1.6))
const keyLight = new THREE.DirectionalLight('#fff3e0', 2.4)
keyLight.position.set(1.5, 2.5, 2.5)
scene.add(keyLight)
const rimLight = new THREE.DirectionalLight('#ffb37a', 1.4)
rimLight.position.set(-2, 1.5, -2)
scene.add(rimLight)
scene.add(new THREE.GridHelper(2, 20, '#4b4b57', '#26262e'))

const modelRoot = new THREE.Group()
modelRoot.name = 'Knight'
scene.add(modelRoot)

new ResizeObserver(() => {
  const w = canvas.clientWidth, h = canvas.clientHeight
  if (!w || !h) return
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}).observe(canvas)

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const S = {
  mode: 'skeleton',
  sel: 0,
  tool: 'orbit',
  wview: 'bone',
  boxMode: 'translate',
  radius: 0.03,
  strength: 0.3,
  falloff: 4,
  autoSmooth: 4,
  mirrorJoints: true,
  mirrorPaint: true,
  xray: true,
  gizmo: true,
  poses: [],
  storedPose: null,
  bow: 0,
  bowBase: null,
}
let rig = null
let weights = null
let mesh = null
let pickMesh = null
let geometry = null
let texMaterial = null
let signature = ''
const weightMaterial = new THREE.MeshLambertMaterial({ vertexColors: true })

// ---------------------------------------------------------------------------
// Helpers: joints, lines, gizmo, brush, box
// ---------------------------------------------------------------------------
const jointGeo = new THREE.SphereGeometry(1, 14, 10)
const jointGroup = new THREE.Group()
scene.add(jointGroup)
let jointMeshes = []
const lineGeo = new THREE.BufferGeometry()
const boneLines = new THREE.LineSegments(
  lineGeo,
  new THREE.LineBasicMaterial({ color: '#7dd3fc', depthTest: false, transparent: true, opacity: 0.75 }),
)
boneLines.renderOrder = 998
boneLines.frustumCulled = false
scene.add(boneLines)
const C_SEL = new THREE.Color('#fbbf24')
const C_DEF = new THREE.Color('#38bdf8')
const C_END = new THREE.Color('#64748b')

const tc = new TransformControls(camera, canvas)
tc.setSize(0.75)
scene.add(tc.getHelper())
tc.addEventListener('dragging-changed', (e) => {
  orbit.enabled = !e.value
  if (e.value && S.mode === 'pose') endBow()
  if (!e.value && S.mode === 'skeleton') scheduleSave()
})
tc.addEventListener('objectChange', onGizmoChange)
const jointProxy = new THREE.Object3D()
scene.add(jointProxy)

// Region box — starts around the sword in the knight's right hand.
const box = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshBasicMaterial({ color: '#f97316', wireframe: true, depthTest: false, transparent: true, opacity: 0.9 }),
)
box.renderOrder = 997
box.position.set(-0.2, 0.29, 0.02)
box.scale.set(0.1, 0.34, 0.08)
box.visible = false
scene.add(box)

const brushCursor = new THREE.Mesh(
  new THREE.SphereGeometry(1, 18, 12),
  new THREE.MeshBasicMaterial({ color: '#fbbf24', wireframe: true, transparent: true, opacity: 0.35, depthTest: false }),
)
brushCursor.renderOrder = 996
brushCursor.visible = false
scene.add(brushCursor)

function buildJointVisuals() {
  jointGroup.clear()
  jointMeshes = rig.defs.map((d, i) => {
    const m = new THREE.Mesh(jointGeo, new THREE.MeshBasicMaterial({ depthTest: false, transparent: true }))
    m.renderOrder = 999
    m.userData.index = i
    m.scale.setScalar(d.deform ? 0.0075 : 0.005)
    jointGroup.add(m)
    return m
  })
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(rig.defs.length * 6), 3))
}

const _v = new THREE.Vector3()
function updateJointVisuals() {
  // During setup the new rig exists before its markers are built.
  if (!rig || jointMeshes.length !== rig.bones.length) return
  modelRoot.updateMatrixWorld(true)
  const lp = lineGeo.attributes.position
  rig.bones.forEach((b, i) => {
    b.getWorldPosition(_v)
    jointMeshes[i].position.copy(_v)
    jointMeshes[i].material.color.copy(i === S.sel ? C_SEL : rig.defs[i].deform ? C_DEF : C_END)
    const p = rig.parent[i]
    const a = p >= 0 ? jointMeshes[p].position : _v
    lp.setXYZ(i * 2, a.x, a.y, a.z)
    lp.setXYZ(i * 2 + 1, _v.x, _v.y, _v.z)
  })
  lp.needsUpdate = true
  jointGroup.visible = boneLines.visible = S.mode !== 'export'
}

function attachGizmo() {
  tc.detach()
  if (!rig) return
  if (S.mode === 'skeleton') {
    jointProxy.position.copy(rig.joints[S.sel])
    tc.attach(jointProxy)
    tc.setMode('translate')
    tc.setSpace('world')
  } else if (S.mode === 'pose' && S.gizmo) {
    tc.attach(rig.bones[S.sel])
    tc.setMode('rotate')
    tc.setSpace('local')
  } else if (S.mode === 'weights' && S.tool === 'box') {
    tc.attach(box)
    tc.setMode(S.boxMode)
    tc.setSpace('local')
  }
}

function onGizmoChange() {
  if (S.mode === 'skeleton') {
    setJoint(S.sel, jointProxy.position)
  } else if (S.mode === 'pose') {
    showPoseControls()
  }
}

// ---------------------------------------------------------------------------
// Skeleton editing
// ---------------------------------------------------------------------------
function setJoint(i, p) {
  rig.joints[i].copy(p)
  const m = rig.mirror[i]
  if (S.mirrorJoints && m >= 0) rig.joints[m].set(-p.x, p.y, p.z)
  rebindRest()
  $('joints-dirty').hidden = false
  showJoint()
}

/** Bones back to rest and bind matrices recomputed from the joints. */
function rebindRest() {
  rig.applyRest()
  mesh.skeleton.calculateInverses()
}

function fitTemplate() {
  geometry.computeBoundingBox()
  const bb = geometry.boundingBox
  const s = (bb.max.y - bb.min.y) / TEMPLATE_HEIGHT
  const cx = (bb.min.x + bb.max.x) / 2
  const cz = (bb.min.z + bb.max.z) / 2
  rig.defs.forEach((d, i) => rig.joints[i].set(d.pos[0] * s + cx, d.pos[1] * s + bb.min.y, d.pos[2] * s + cz))
}

function showJoint() {
  if (!rig) return
  const j = rig.joints[S.sel]
  $('joint-name').textContent = rig.defs[S.sel].name
  $('jx').value = j.x.toFixed(3)
  $('jy').value = j.y.toFixed(3)
  $('jz').value = j.z.toFixed(3)
  if (S.mode === 'skeleton') jointProxy.position.copy(j)
}

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------
const kSel = () => weights.kOf.get(S.sel) ?? 0

function refreshWeights(groups = null) {
  weights.writeSkin(geometry, groups)
  if (mesh.material === weightMaterial) weights.writeColors(geometry, S.wview, kSel(), groups)
}

function runAuto() {
  weights.snapshot()
  rig.applyRest()
  weights.auto(S.falloff, S.autoSmooth)
  refreshWeights()
  $('joints-dirty').hidden = true
  scheduleSave()
  flash('Auto weights done. Check elbows, knees, the skirt and the sword.')
}

function fillPiece(hit) {
  const comp = weights.component(weights.vg[hit.face.a])
  if (comp.length > weights.G * 0.45) {
    flash('That piece is joined to most of the body — use the Box tool or paint instead.')
    return
  }
  weights.snapshot()
  weights.assign(comp, kSel())
  refreshWeights()
  scheduleSave()
  flash(`Gave ${comp.length.toLocaleString()} points to ${rig.defs[S.sel].name}.`)
}

function boxAssign() {
  box.updateMatrixWorld()
  const inv = box.matrixWorld.clone().invert()
  const q = new THREE.Vector3()
  const list = weights.groupsWhere((p) => {
    q.copy(p).applyMatrix4(inv)
    return Math.abs(q.x) <= 0.5 && Math.abs(q.y) <= 0.5 && Math.abs(q.z) <= 0.5
  })
  if (!list.length) return flash('The box contains no vertices.')
  weights.snapshot()
  weights.assign(list, kSel())
  refreshWeights()
  scheduleSave()
  flash(`Gave ${list.length.toLocaleString()} points inside the box to ${rig.defs[S.sel].name}.`)
}

function undo() {
  if (!weights?.undo()) return flash('Nothing to undo.')
  refreshWeights()
  scheduleSave()
  flash('Undone.')
}

// Painting -------------------------------------------------------------------
const raycaster = new THREE.Raycaster()
raycaster.firstHitOnly = true
const ndc = new THREE.Vector2()
let painting = false
let paintPoint = null
let lastDab = null

function rayFrom(e) {
  const r = canvas.getBoundingClientRect()
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  raycaster.setFromCamera(ndc, camera)
}

function hitMesh(e) {
  if (!pickMesh) return null
  rayFrom(e)
  return raycaster.intersectObject(pickMesh, false)[0] ?? null
}

function pickJoint(e) {
  const r = canvas.getBoundingClientRect()
  const mx = e.clientX - r.left, my = e.clientY - r.top
  let best = -1, bestD = 14
  jointMeshes.forEach((m, i) => {
    if (S.mode !== 'skeleton' && !rig.defs[i].deform) return
    _v.copy(m.position).project(camera)
    if (_v.z > 1) return
    const d = Math.hypot(((_v.x + 1) / 2) * r.width - mx, ((1 - _v.y) / 2) * r.height - my)
    if (d < bestD) { bestD = d; best = i }
  })
  return best
}

function processPaint() {
  if (!painting || !paintPoint) return
  if (lastDab && lastDab.distanceTo(paintPoint) < S.radius * 0.25) return
  lastDab = paintPoint.clone()
  const k = kSel()
  let touched = weights.brush(paintPoint, S.radius, k, S.strength, S.tool)
  if (S.mirrorPaint && Math.abs(paintPoint.x) > S.radius * 0.5) {
    const mp = paintPoint.clone()
    mp.x = -mp.x
    touched = touched.concat(weights.brush(mp, S.radius, weights.mirrorK[k], S.strength, S.tool))
  }
  if (touched.length) refreshWeights(touched)
}

canvas.addEventListener(
  'pointerdown',
  (e) => {
    if (!rig || e.button !== 0 || tc.axis !== null) return
    if (S.mode === 'weights' && (PAINT_TOOLS.includes(S.tool) || S.tool === 'fill')) {
      const hit = hitMesh(e)
      if (!hit) return // off the body: let OrbitControls orbit
      e.stopImmediatePropagation()
      e.preventDefault()
      if (S.tool === 'fill') return fillPiece(hit)
      weights.snapshot()
      painting = true
      paintPoint = hit.point.clone()
      lastDab = null
      canvas.setPointerCapture(e.pointerId)
      return
    }
    const j = pickJoint(e)
    if (j >= 0) {
      e.stopImmediatePropagation()
      select(j)
    }
  },
  { capture: true },
)

canvas.addEventListener('pointermove', (e) => {
  if (!rig || S.mode !== 'weights') return
  const hit = hitMesh(e)
  brushCursor.visible = !!hit && PAINT_TOOLS.includes(S.tool)
  if (hit) {
    brushCursor.position.copy(hit.point)
    brushCursor.scale.setScalar(S.radius)
    const v = weights.weightAtVertex(hit.face.a, kSel())
    hover = `${rig.defs[S.sel].name} here: ${Math.round(v * 100)}%`
    if (painting) paintPoint = hit.point.clone()
  } else hover = ''
  renderStatus()
})

window.addEventListener('pointerup', () => {
  if (!painting) return
  painting = false
  paintPoint = null
  lastDab = null
  scheduleSave()
})
canvas.addEventListener('pointerleave', () => { brushCursor.visible = false })

// ---------------------------------------------------------------------------
// Pose
// ---------------------------------------------------------------------------
const headIndex = () => rig.index.get('head')

function setBow(v) {
  const head = rig.bones[headIndex()]
  if (v > 0 && !S.bowBase) S.bowBase = head.quaternion.clone()
  if (S.bowBase) {
    head.quaternion.copy(S.bowBase).multiply(new THREE.Quaternion().setFromAxisAngle(X_AXIS, v * BOW_MAX))
  }
  if (v === 0) S.bowBase = null
  S.bow = v
  setOut('bow', v, `${Math.round(v * 100)}%`)
}

function endBow() {
  if (!S.bowBase) return
  rig.bones[headIndex()].quaternion.copy(S.bowBase)
  S.bowBase = null
  S.bow = 0
  setOut('bow', 0, '0%')
}

function applyPose(p) {
  endBow()
  rig.setPose(p)
  showPoseControls()
}

function showPoseControls() {
  if (!rig) return
  const e = new THREE.Euler().setFromQuaternion(rig.bones[S.sel].quaternion, 'XYZ')
  setOut('rx', Math.round(THREE.MathUtils.radToDeg(e.x)))
  setOut('ry', Math.round(THREE.MathUtils.radToDeg(e.y)))
  setOut('rz', Math.round(THREE.MathUtils.radToDeg(e.z)))
  const off = rig.root.position.clone().sub(rig.joints[0])
  setOut('hx', off.x, off.x.toFixed(3))
  setOut('hy', off.y, off.y.toFixed(3))
  setOut('hz', off.z, off.z.toFixed(3))
  $('hips-offset').hidden = S.sel !== 0
  $('mirror-bone').disabled = rig.mirror[S.sel] < 0
}

function savePose() {
  endBow()
  const raw = $('pose-name').value.trim().replace(/[^\w\- ]/g, '').slice(0, 40)
  const name = raw || `pose-${S.poses.length + 1}`
  const pose = { name, ...rig.getPose() }
  const i = S.poses.findIndex((p) => p.name === name)
  if (i >= 0) S.poses[i] = pose
  else S.poses.push(pose)
  $('pose-name').value = ''
  renderPoseList()
  scheduleSave()
  flash(`Saved pose “${name}”.`)
}

function renderPoseList() {
  const ul = $('pose-list')
  ul.replaceChildren()
  if (!S.poses.length) {
    const li = document.createElement('li')
    li.className = 'hint'
    li.textContent = 'No saved poses yet.'
    ul.append(li)
    return
  }
  S.poses.forEach((p, i) => {
    const li = document.createElement('li')
    const span = document.createElement('span')
    span.textContent = p.name
    const apply = document.createElement('button')
    apply.textContent = 'Apply'
    apply.setAttribute('aria-label', `Apply pose ${p.name}`)
    apply.onclick = () => { setMode('pose'); applyPose(p) }
    const del = document.createElement('button')
    del.textContent = 'Delete'
    del.className = 'secondary'
    del.setAttribute('aria-label', `Delete pose ${p.name}`)
    del.onclick = () => { S.poses.splice(i, 1); renderPoseList(); scheduleSave() }
    li.append(span, apply, del)
    ul.append(li)
  })
}

// ---------------------------------------------------------------------------
// Modes / selection / materials
// ---------------------------------------------------------------------------
function setMode(m) {
  if (!rig || m === S.mode) return
  if (S.mode === 'pose') {
    endBow()
    S.storedPose = rig.getPose()
  }
  painting = false
  S.mode = m
  if (m === 'pose') rig.setPose(S.storedPose ?? { bones: {} })
  else rig.applyRest()
  if (m !== 'skeleton' && !rig.defs[S.sel].deform) S.sel = rig.parent[S.sel]

  for (const b of document.querySelectorAll('[role=tab]')) {
    const on = b.dataset.mode === m
    b.setAttribute('aria-selected', String(on))
    b.tabIndex = on ? 0 : -1
  }
  for (const id of MODES) $(`p-${id}`).hidden = id !== m
  $('bone-field').hidden = !(m === 'weights' || m === 'pose')
  $('bone').value = String(S.sel)
  brushCursor.visible = false
  box.visible = m === 'weights' && S.tool === 'box'
  applyMaterials()
  attachGizmo()
  showJoint()
  showPoseControls()
  renderStatus()
}

function select(i) {
  if (S.mode !== 'skeleton' && !rig.defs[i].deform) i = rig.parent[i]
  S.sel = i
  $('bone').value = String(i)
  showJoint()
  showPoseControls()
  attachGizmo()
  if (mesh.material === weightMaterial) weights.writeColors(geometry, S.wview, kSel())
  renderStatus()
}

function applyMaterials() {
  if (!mesh) return
  const xray = S.mode === 'skeleton' && S.xray
  texMaterial.transparent = xray
  texMaterial.opacity = xray ? 0.35 : 1
  texMaterial.depthWrite = !xray
  texMaterial.needsUpdate = true
  if (S.mode === 'weights' && S.wview !== 'texture') {
    mesh.material = weightMaterial
    weights.writeColors(geometry, S.wview, kSel())
  } else {
    mesh.material = texMaterial
  }
}

function fillBoneSelect() {
  const sel = $('bone')
  sel.replaceChildren(
    ...rig.deform.map((i) => {
      const o = document.createElement('option')
      o.value = String(i)
      o.textContent = rig.defs[i].name
      return o
    }),
  )
  sel.value = String(S.sel)
}

function renderPresets() {
  $('presets').replaceChildren(
    ...PRESETS.map((p) => {
      const b = document.createElement('button')
      b.textContent = p.name
      b.className = 'secondary'
      b.onclick = () => applyPose(p)
      return b
    }),
  )
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------
function frame(dir = null) {
  if (!geometry) return
  geometry.computeBoundingBox()
  const bb = geometry.boundingBox
  const h = bb.max.y - bb.min.y
  const target = new THREE.Vector3(0, bb.min.y + h * 0.5, 0)
  const d = dir ?? camera.position.clone().sub(orbit.target).normalize()
  const dist = (h * 0.62) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
  orbit.target.copy(target)
  camera.position.copy(target).addScaledVector(d, dist)
  orbit.update()
}

const VIEWS = {
  front: new THREE.Vector3(0, 0, 1),
  side: new THREE.Vector3(1, 0, 0),
  back: new THREE.Vector3(0, 0, -1),
  top: new THREE.Vector3(0, 1, 0.0001).normalize(),
}

// ---------------------------------------------------------------------------
// Status / autosave
// ---------------------------------------------------------------------------
let hover = ''
let message = ''
let messageTimer = 0
function flash(msg) {
  message = msg
  clearTimeout(messageTimer)
  messageTimer = setTimeout(() => { message = ''; renderStatus() }, 4000)
  renderStatus()
}
function renderStatus() {
  if (!rig) return
  const parts = [`${S.mode} · ${rig.defs[S.sel].name}`]
  if (hover) parts.push(hover)
  if (message) parts.push(message)
  $('status').textContent = parts.join('   ·   ')
}

let saveTimer = 0
function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      await idbPut(signature, {
        joints: rig.joints.map((v) => v.toArray()),
        weights: weights.w,
        poses: S.poses,
        savedAt: Date.now(),
      })
    } catch (err) {
      flash(`Autosave failed: ${err.message}`)
    }
  }, 1200)
}

// ---------------------------------------------------------------------------
// Load / setup
// ---------------------------------------------------------------------------
const loader = new GLTFLoader()
const draco = new DRACOLoader()
draco.setDecoderPath(DRACO_PATH)
loader.setDRACOLoader(draco)

const firstMaterial = (m) => (Array.isArray(m.material) ? m.material[0] : m.material)

function clipToPose(clip, hipsRest) {
  const bones = {}
  let hips = [0, 0, 0]
  for (const t of clip.tracks) {
    const dot = t.name.lastIndexOf('.')
    const node = t.name.slice(0, dot)
    const prop = t.name.slice(dot + 1)
    if (prop === 'quaternion') {
      const q = Array.from(t.values.slice(0, 4))
      if (Math.abs(q[3]) < 0.99999) bones[node] = q
    } else if (prop === 'position' && node === 'hips') {
      hips = [t.values[0] - hipsRest.x, t.values[1] - hipsRest.y, t.values[2] - hipsRest.z]
    }
  }
  return { name: clip.name, bones, hips }
}

async function applyGLTF(gltf) {
  gltf.scene.updateMatrixWorld(true)
  const meshes = []
  gltf.scene.traverse((o) => o.isMesh && meshes.push(o))
  if (!meshes.length) throw new Error('No mesh found in that file.')

  // A GLB exported by this lab (same bone names): continue where we left off.
  const template = makeTemplate()
  const sk = meshes.find((m) => m.isSkinnedMesh)
  if (sk && template.every((d) => sk.skeleton.bones.some((b) => b.name === d.name))) {
    const geo = sk.geometry.clone()
    const boneNames = sk.skeleton.bones.map((b) => b.name)
    const joints = template.map((d) =>
      new THREE.Vector3().setFromMatrixPosition(sk.skeleton.boneInverses[boneNames.indexOf(d.name)].clone().invert()),
    )
    const skin = { skinIndex: geo.getAttribute('skinIndex'), skinWeight: geo.getAttribute('skinWeight'), boneNames }
    geo.deleteAttribute('skinIndex')
    geo.deleteAttribute('skinWeight')
    const poses = gltf.animations.map((c) => clipToPose(c, joints[0]))
    return setupModel({ geometry: geo, material: firstMaterial(sk), joints, skin, poses })
  }

  // Raw mesh(es): bake transforms, merge, put the feet on y = 0.
  let geos = meshes.map((m) => {
    const g = m.geometry.clone()
    g.applyMatrix4(m.matrixWorld)
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k)
    g.morphAttributes = {}
    return g
  })
  if (geos.length > 1 && !geos.every((g) => g.index)) geos = geos.map((g) => (g.index ? g.toNonIndexed() : g))
  const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, false)
  if (!geo) throw new Error('Could not merge the meshes in that file.')
  geo.computeBoundingBox()
  const bb = geo.boundingBox
  geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2)
  return setupModel({ geometry: geo, material: firstMaterial(meshes[0]) })
}

async function setupModel({ geometry: geo, material, joints = null, skin = null, poses = null }) {
  tc.detach()
  if (mesh) {
    modelRoot.clear()
    mesh.skeleton?.dispose()
    geometry.disposeBoundsTree?.()
    geometry.dispose()
  }
  geometry = geo
  if (!geometry.attributes.normal) geometry.computeVertexNormals()
  computeBoundsTree.call(geometry, { indirect: true })
  texMaterial = material

  rig = new Rig(makeTemplate())
  if (joints) joints.forEach((v, i) => rig.joints[i].copy(v))
  else fitTemplate()
  weights = new Weights(geometry, rig)
  signature = `v1:${geometry.attributes.position.count}:${weights.G}`
  S.poses = poses ?? []

  let note = 'Template skeleton placed and auto weights computed.'
  if (skin) {
    weights.fromVertexSkin(skin.skinIndex, skin.skinWeight, skin.boneNames)
    note = 'Loaded rigged model — continue editing.'
  } else {
    const saved = await idbGet(signature).catch(() => null)
    if (saved?.joints?.length === rig.joints.length && saved?.weights?.length === weights.w.length) {
      saved.joints.forEach((a, i) => rig.joints[i].fromArray(a))
      weights.w.set(saved.weights)
      S.poses = saved.poses ?? []
      note = 'Restored your autosaved session.'
    } else {
      rig.applyRest()
      weights.auto(S.falloff, S.autoSmooth)
    }
  }
  rig.applyRest()
  weights.writeSkin(geometry)

  mesh = new THREE.SkinnedMesh(geometry, texMaterial)
  mesh.name = 'KnightMesh'
  mesh.frustumCulled = false
  modelRoot.add(mesh, rig.root)
  modelRoot.updateMatrixWorld(true)
  mesh.bind(new THREE.Skeleton(rig.bones))

  pickMesh = new THREE.Mesh(geometry)
  pickMesh.raycast = acceleratedRaycast
  pickMesh.updateMatrixWorld()

  S.storedPose = null
  S.sel = rig.index.get('head')
  if (S.mode === 'pose') rig.setPose({ bones: {} })
  $('joints-dirty').hidden = true
  buildJointVisuals()
  fillBoneSelect()
  renderPoseList()
  applyMaterials()
  attachGizmo()
  showJoint()
  showPoseControls()
  frame(VIEWS.front.clone().add(new THREE.Vector3(0.45, 0.15, 0)).normalize())
  flash(note)
}

async function loadFile(file) {
  if (!file) return
  $('loading').hidden = false
  $('loading').textContent = `Loading ${file.name}…`
  try {
    const gltf = await loader.parseAsync(await file.arrayBuffer(), '')
    await applyGLTF(gltf)
  } catch (err) {
    flash(`Could not load ${file.name}: ${err.message}`)
  } finally {
    $('loading').hidden = true
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
function poseClip(p) {
  const tracks = rig.bones.map((b) => {
    const q = p.bones?.[b.name] ?? [0, 0, 0, 1]
    return new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, [0, 1], [...q, ...q])
  })
  const h = rig.joints[0].clone().add(new THREE.Vector3(...(p.hips ?? [0, 0, 0]))).toArray()
  tracks.push(new THREE.VectorKeyframeTrack('hips.position', [0, 1], [...h, ...h]))
  return new THREE.AnimationClip(p.name, 1, tracks)
}

function download(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

async function exportGLB() {
  const btn = $('export-glb')
  btn.disabled = true
  flash('Exporting… (this can take a few seconds)')
  const pose = S.mode === 'pose' ? (endBow(), rig.getPose()) : null
  rig.applyRest()
  const prevMat = mesh.material
  mesh.material = texMaterial
  const xray = texMaterial.transparent
  texMaterial.transparent = false
  texMaterial.opacity = 1
  texMaterial.depthWrite = true
  const color = geometry.getAttribute('color')
  if (color) geometry.deleteAttribute('color')
  // Core-glTF-safe images (the exporter would otherwise write PNG — much larger).
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
    const t = texMaterial[key]
    if (t) t.userData.mimeType = 'image/jpeg'
  }
  try {
    const out = await new GLTFExporter().parseAsync(modelRoot, {
      binary: true,
      onlyVisible: true,
      animations: S.poses.map(poseClip),
    })
    download(new Blob([out], { type: 'model/gltf-binary' }), 'knight-rigged.glb')
    flash(`Exported knight-rigged.glb (${(out.byteLength / 1048576).toFixed(1)} MB, ${S.poses.length} pose clip(s)).`)
  } catch (err) {
    flash(`Export failed: ${err.message}`)
  } finally {
    if (color) geometry.setAttribute('color', color)
    mesh.material = prevMat
    texMaterial.transparent = xray
    applyMaterials()
    if (pose) rig.setPose(pose)
    btn.disabled = false
  }
}

function exportPoses() {
  const data = { bones: rig.defs.map((d) => d.name), poses: S.poses }
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'knight-poses.json')
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
function setOut(id, value, text = null) {
  const el = $(id)
  el.value = value
  const out = el.nextElementSibling
  if (out?.tagName === 'OUTPUT') out.textContent = text ?? String(value)
}
function bindRange(id, fmt, fn) {
  $(id).addEventListener('input', (e) => {
    const v = parseFloat(e.target.value)
    e.target.nextElementSibling.textContent = fmt(v)
    fn(v)
  })
}

const TOOL_HINTS = {
  orbit: 'Drag to orbit, right-drag to pan, scroll to zoom. Click a joint to pick its bone.',
  add: 'Left-drag on the body to add the selected bone’s influence. Off the body, drag orbits. [ and ] resize the brush.',
  subtract: 'Left-drag to remove the bone’s influence — it flows to the remaining bones.',
  smooth: 'Left-drag to soften hard weight edges (knees, elbows, skirt).',
  fill: 'Click a separate piece to give it 100% to the selected bone. Not mirrored.',
  box: 'Move/scale the orange box around a region (it starts on the sword), pick hand_R, then Assign. Not mirrored.',
}

document.querySelectorAll('[role=tab]').forEach((b) => {
  b.addEventListener('click', () => setMode(b.dataset.mode))
  b.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const i = MODES.indexOf(S.mode) + (e.key === 'ArrowRight' ? 1 : -1)
    const m = MODES[(i + MODES.length) % MODES.length]
    setMode(m)
    $(`tab-${m}`).focus()
  })
})

document.querySelectorAll('[data-view]').forEach((b) =>
  b.addEventListener('click', () => frame(b.dataset.view === 'frame' ? null : VIEWS[b.dataset.view].clone())),
)

$('bone').addEventListener('change', (e) => select(parseInt(e.target.value, 10)))

// Skeleton
$('mirror-joints').addEventListener('change', (e) => { S.mirrorJoints = e.target.checked })
$('xray').addEventListener('change', (e) => { S.xray = e.target.checked; applyMaterials() })
for (const [id, axis] of [['jx', 'x'], ['jy', 'y'], ['jz', 'z']]) {
  $(id).addEventListener('change', (e) => {
    const v = parseFloat(e.target.value)
    if (!Number.isFinite(v)) return showJoint()
    const p = rig.joints[S.sel].clone()
    p[axis] = v
    setJoint(S.sel, p)
    scheduleSave()
  })
}
$('reset-joints').addEventListener('click', () => {
  fitTemplate()
  rebindRest()
  showJoint()
  $('joints-dirty').hidden = false
  scheduleSave()
})

// Weights
document.querySelectorAll('input[name=wview]').forEach((r) =>
  r.addEventListener('change', (e) => { S.wview = e.target.value; applyMaterials() }),
)
document.querySelectorAll('input[name=tool]').forEach((r) =>
  r.addEventListener('change', (e) => {
    S.tool = e.target.value
    $('box-tools').hidden = S.tool !== 'box'
    box.visible = S.mode === 'weights' && S.tool === 'box'
    brushCursor.visible = false
    $('tool-hint').textContent = TOOL_HINTS[S.tool]
    attachGizmo()
  }),
)
document.querySelectorAll('[data-box]').forEach((b) =>
  b.addEventListener('click', () => {
    S.boxMode = b.dataset.box
    document.querySelectorAll('[data-box]').forEach((x) => x.classList.toggle('active', x === b))
    attachGizmo()
  }),
)
bindRange('falloff', (v) => String(v), (v) => { S.falloff = v })
bindRange('auto-smooth', (v) => String(v), (v) => { S.autoSmooth = v })
bindRange('radius', (v) => v.toFixed(3), (v) => { S.radius = v })
bindRange('strength', (v) => v.toFixed(2), (v) => { S.strength = v })
$('mirror-paint').addEventListener('change', (e) => { S.mirrorPaint = e.target.checked })
$('auto').addEventListener('click', runAuto)
$('box-assign').addEventListener('click', boxAssign)
$('smooth-all').addEventListener('click', () => {
  weights.snapshot()
  weights.smoothAll(2, 0.5)
  refreshWeights()
  scheduleSave()
  flash('Smoothed all weights (2 passes).')
})
$('undo').addEventListener('click', undo)

// Pose
for (const [id, axis] of [['rx', 'x'], ['ry', 'y'], ['rz', 'z']]) {
  bindRange(id, (v) => String(v), (v) => {
    endBow()
    rig.bones[S.sel].rotation[axis] = THREE.MathUtils.degToRad(v)
  })
}
for (const [id, axis] of [['hx', 'x'], ['hy', 'y'], ['hz', 'z']]) {
  bindRange(id, (v) => v.toFixed(3), (v) => { rig.root.position[axis] = rig.joints[0][axis] + v })
}
$('reset-bone').addEventListener('click', () => {
  endBow()
  rig.bones[S.sel].quaternion.identity()
  if (S.sel === 0) rig.root.position.copy(rig.joints[0])
  showPoseControls()
})
$('mirror-bone').addEventListener('click', () => {
  const m = rig.mirror[S.sel]
  if (m < 0) return
  endBow()
  const q = rig.bones[S.sel].quaternion
  rig.bones[m].quaternion.set(q.x, -q.y, -q.z, q.w)
  flash(`Copied ${rig.defs[S.sel].name} → ${rig.defs[m].name}.`)
})
$('gizmo').addEventListener('change', (e) => { S.gizmo = e.target.checked; attachGizmo() })
bindRange('bow', (v) => `${Math.round(v * 100)}%`, setBow)
$('save-pose').addEventListener('click', savePose)
$('pose-name').addEventListener('keydown', (e) => e.key === 'Enter' && savePose())

// Export / import
$('export-glb').addEventListener('click', exportGLB)
$('export-poses').addEventListener('click', exportPoses)
$('file').addEventListener('change', (e) => loadFile(e.target.files[0]))
$('clear-session').addEventListener('click', async () => {
  await idbDelete(signature).catch(() => {})
  flash('Saved session cleared. Reload the page to start fresh.')
})
window.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragging') })
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dragging') })
window.addEventListener('drop', (e) => {
  e.preventDefault()
  document.body.classList.remove('dragging')
  loadFile(e.dataTransfer.files[0])
})

// Keyboard
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    return undo()
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (e.key === 'f' || e.key === 'F') frame()
  else if (e.key === '[' || e.key === ']') {
    S.radius = THREE.MathUtils.clamp(S.radius * (e.key === ']' ? 1.2 : 1 / 1.2), 0.005, 0.15)
    setOut('radius', S.radius, S.radius.toFixed(3))
    brushCursor.scale.setScalar(S.radius)
  } else if (/^[1-4]$/.test(e.key) && e.target.getAttribute('role') !== 'tab') setMode(MODES[+e.key - 1])
})

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
renderPresets()
$('tool-hint').textContent = TOOL_HINTS.orbit
renderer.setAnimationLoop(() => {
  orbit.update()
  processPaint()
  updateJointVisuals()
  renderer.render(scene, camera)
})

loader
  .loadAsync(MODEL_URL)
  .then(applyGLTF)
  .catch((err) => flash(`Could not load the knight: ${err.message}`))
  .finally(() => { $('loading').hidden = true; window.__labReady = true })
