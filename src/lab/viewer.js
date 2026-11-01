// Knight Lab viewer — shows a (rigged) GLB on a lit ground with its clips.
// ?model=name.glb picks another file from /models (letters, digits, - and _ only).
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

const $ = (id) => document.getElementById(id)
const requested = new URLSearchParams(window.location.search).get('model')
const FILE = requested && /^[\w-]+\.glb$/.test(requested) ? requested : 'knight.glb'
const LABEL = `models/${FILE}`
const URL_ = new URL(`../models/${FILE}`, window.location.href).href

// --- renderer / scene -------------------------------------------------------
const canvas = $('view')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap

const scene = new THREE.Scene()
scene.background = new THREE.Color('#2a170d')
// Soft studio reflections so the armour reads glossy, with gold highlights.
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.55

const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 60)
camera.position.set(0, 0.62, 2.9)
const controls = new OrbitControls(camera, canvas)
controls.target.set(0, 0.45, 0)
controls.enableDamping = true
controls.minDistance = 0.6
controls.maxDistance = 8
controls.maxPolarAngle = Math.PI * 0.495
controls.update()

scene.add(new THREE.HemisphereLight('#ffe3c8', '#3b2214', 0.6))
const sun = new THREE.DirectionalLight('#ffdcb8', 2.4)
sun.position.set(-1.6, 2.4, 1.9)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.left = -1.5
sun.shadow.camera.right = 1.5
sun.shadow.camera.top = 1.5
sun.shadow.camera.bottom = -1.5
sun.shadow.camera.near = 0.5
sun.shadow.camera.far = 8
sun.shadow.bias = -0.0004
sun.shadow.normalBias = 0.015
scene.add(sun)
const rim = new THREE.DirectionalLight('#ff9d5c', 1.1)
rim.position.set(1.8, 1.6, -2.2)
scene.add(rim)

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(7, 96),
  new THREE.MeshStandardMaterial({ color: '#6a412c', roughness: 1, metalness: 0, envMapIntensity: 0.35 }),
)
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

new ResizeObserver(() => {
  const w = canvas.clientWidth, h = canvas.clientHeight
  if (!w || !h) return
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}).observe(canvas)

// --- model ------------------------------------------------------------------
const mixer = { current: null, action: null }
let skeletonHelper = null
const clock = new THREE.Clock()

const loader = new GLTFLoader()
const draco = new DRACOLoader()
draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.5/')
loader.setDRACOLoader(draco)

loader.load(
  URL_,
  (gltf) => {
    const model = gltf.scene
    let bones = 0
    let tris = 0
    model.traverse((o) => {
      if (!o.isMesh) return
      o.castShadow = true
      o.receiveShadow = true
      if (o.isSkinnedMesh) {
        o.frustumCulled = false
        bones = Math.max(bones, o.skeleton.bones.length)
      }
      const g = o.geometry
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3
    })
    scene.add(model)

    skeletonHelper = new THREE.SkeletonHelper(model)
    skeletonHelper.material.depthTest = false
    skeletonHelper.material.transparent = true
    skeletonHelper.renderOrder = 10
    skeletonHelper.visible = $('skeleton').checked
    scene.add(skeletonHelper)

    mixer.current = new THREE.AnimationMixer(model)
    mixer.current.timeScale = parseFloat($('speed').value)
    const clips = gltf.animations
    if (!clips.length) {
      $('no-clips').hidden = false
    } else {
      const sel = $('clip')
      sel.replaceChildren(...clips.map((c, i) => new Option(c.name || `Clip ${i + 1}`, String(i))))
      sel.hidden = false
      sel.addEventListener('change', () => play(clips[+sel.value]))
      play(clips[0])
    }

    $('stats').textContent = `${LABEL} · ${bones} bones · ${Math.round(tris / 1000)}k tris · ${clips.length} clips`
    $('loading').hidden = true
    // Test hook: jump the current clip to a time (seconds).
    window.__knight = { seek: (t) => { if (mixer.action) { mixer.action.time = t; mixer.current.update(0) } } }
    window.__viewerReady = true
  },
  undefined,
  (err) => {
    $('loading').textContent = `Could not load ${LABEL}: ${err.message ?? err}`
    window.__viewerReady = 'error'
  },
)

function play(clip) {
  mixer.action?.stop()
  mixer.action = mixer.current.clipAction(clip)
  mixer.action.reset().play()
}

// --- UI ---------------------------------------------------------------------
$('skeleton').addEventListener('change', (e) => {
  if (skeletonHelper) skeletonHelper.visible = e.target.checked
})
$('speed').addEventListener('input', (e) => {
  if (mixer.current) mixer.current.timeScale = parseFloat(e.target.value)
})

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1)
  mixer.current?.update(dt)
  controls.update()
  renderer.render(scene, camera)
})
