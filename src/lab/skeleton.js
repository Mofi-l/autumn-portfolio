import * as THREE from 'three'

// Dense humanoid template measured on the kingslayer knight (~0.98 units
// tall, facing +Z, feet on y=0, character's LEFT = +X).
//
// Each def: { name, parent, pos, deform, tail, mirror, r, bias }
//   tail  – child the bone points at for auto-weights (default: first child)
//   r     – joint marker radius in the lab
//   bias  – distance multiplier in auto-weights (>1 = only wins when clearly
//           closer; used for cloth and armour plates layered over limbs)

export const TEMPLATE_HEIGHT = 0.979

// Measured fist centres (the knight's hands are not symmetric).
const FIST = { L: [0.195, 0.443, 0.025], R: [-0.183, 0.453, 0.007] }
const ELBOW = { L: [0.172, 0.57, -0.003], R: [-0.163, 0.57, -0.006] }

const mid = (a, b) => a.map((v, i) => +((v + b[i]) / 2).toFixed(4))
const add = (a, b) => a.map((v, i) => +(v + b[i]).toFixed(4))

function center() {
  return [
    ['hips', null, [0, 0.5, 0], { tail: 'spine' }],
    ['spine', 'hips', [0, 0.555, 0]],
    ['spine1', 'spine', [0, 0.61, 0]],
    ['chest', 'spine1', [0, 0.665, 0]],
    ['upper_chest', 'chest', [0, 0.72, 0], { tail: 'neck' }],
    ['neck', 'upper_chest', [0, 0.785, 0]],
    ['neck1', 'neck', [0, 0.812, 0.002]],
    ['head', 'neck1', [0, 0.84, 0.005]],
    ['head_end', 'head', [0, 0.975, 0.005], { deform: false }],
    // Tabard / skirt chains (front, back) — cloth, so biased.
    ['skirt_F1', 'hips', [0, 0.47, 0.095], { bias: 1.4 }],
    ['skirt_F2', 'skirt_F1', [0, 0.4, 0.105], { bias: 1.4 }],
    ['skirt_F3', 'skirt_F2', [0, 0.335, 0.105], { bias: 1.4 }],
    ['skirt_F_end', 'skirt_F3', [0, 0.285, 0.105], { deform: false }],
    ['skirt_B1', 'hips', [0, 0.47, -0.09], { bias: 1.4 }],
    ['skirt_B2', 'skirt_B1', [0, 0.38, -0.1], { bias: 1.4 }],
    ['skirt_B3', 'skirt_B2', [0, 0.285, -0.1], { bias: 1.4 }],
    ['skirt_B_end', 'skirt_B3', [0, 0.195, -0.1], { deform: false }],
  ]
}

/** One side's bones. sx = +1 for L, -1 for R. */
function side(s) {
  const sx = s === 'L' ? 1 : -1
  const X = (p) => [p[0] * sx, p[1], p[2]]
  const C = FIST[s]
  const W = [C[0], C[1] + 0.035, C[2]] // wrist
  const E = ELBOW[s]
  const SH = X([0.12, 0.725, 0]) // shoulder ball
  // Finger offsets from the fist centre, written for the LEFT hand
  // (fingers hang down from the knuckles and curl in toward the palm).
  const o = (dx, dy, dz) => add(C, [dx * sx, dy, dz])
  const fingers = [
    ['thumb', [[-0.008, 0.015, 0.022], [-0.012, 0.0, 0.03], [-0.01, -0.012, 0.026], [-0.006, -0.02, 0.018]]],
    ['index', [[0.012, -0.008, 0.018], [0.008, -0.021, 0.018], [-0.006, -0.022, 0.018], [-0.014, -0.011, 0.018]]],
    ['middle', [[0.013, -0.01, 0.006], [0.009, -0.024, 0.006], [-0.006, -0.025, 0.006], [-0.015, -0.013, 0.006]]],
    ['ring', [[0.012, -0.009, -0.006], [0.008, -0.022, -0.006], [-0.006, -0.023, -0.006], [-0.014, -0.012, -0.006]]],
    ['pinky', [[0.01, -0.006, -0.017], [0.007, -0.017, -0.017], [-0.004, -0.018, -0.017], [-0.011, -0.009, -0.017]]],
  ]
  const out = [
    ['clavicle', 'upper_chest', X([0.035, 0.745, 0])],
    ['upperarm', 'clavicle', SH],
    ['upperarm_twist', 'upperarm', mid(SH, E)],
    ['forearm', 'upperarm_twist', E],
    ['forearm_twist', 'forearm', mid(E, W)],
    ['hand', 'forearm_twist', W, { tail: `middle1_${s}` }],
  ]
  for (const [f, pts] of fingers) {
    out.push([`${f}1`, 'hand', o(...pts[0]), { r: 0.003 }])
    out.push([`${f}2`, `${f}1`, o(...pts[1]), { r: 0.003 }])
    out.push([`${f}3`, `${f}2`, o(...pts[2]), { r: 0.003 }])
    out.push([`${f}_end`, `${f}3`, o(...pts[3]), { deform: false, r: 0.0025 }])
  }
  out.push(
    // Pauldron (shoulder plate) — armour layered over the arm, so biased.
    ['pauldron', 'clavicle', X([0.115, 0.77, 0]), { bias: 1.3 }],
    ['pauldron_end', 'pauldron', X([0.165, 0.715, 0]), { deform: false }],
    // Leg
    ['thigh', 'hips', X([0.06, 0.47, 0])],
    ['thigh_twist', 'thigh', X([0.068, 0.36, 0])],
    ['shin', 'thigh_twist', X([0.075, 0.25, 0])],
    ['shin_twist', 'shin', X([0.078, 0.157, -0.002])],
    ['foot', 'shin_twist', X([0.08, 0.065, -0.005])],
    ['toe', 'foot', X([0.08, 0.02, 0.07])],
    ['toe_end', 'toe', X([0.08, 0.012, 0.115]), { deform: false }],
    // Side skirt chain — cloth, biased.
    ['skirt', 'hips', X([0.12, 0.47, 0]), { bias: 1.4 }],
    ['skirt2', 'skirt', X([0.13, 0.38, 0]), { bias: 1.4 }],
    ['skirt3', 'skirt2', X([0.13, 0.295, 0]), { bias: 1.4 }],
    ['skirt_end', 'skirt3', X([0.13, 0.225, 0]), { deform: false }],
  )
  const LOCAL_PARENTS = new Set(['upper_chest', 'hips'])
  const other = s === 'L' ? 'R' : 'L'
  return out.map(([n, p, pos, opt = {}]) => ({
    name: `${n}_${s}`,
    parent: LOCAL_PARENTS.has(p) ? p : `${p}_${s}`,
    pos,
    mirror: `${n}_${other}`,
    ...opt,
  }))
}

export function makeTemplate() {
  const defs = [
    ...center().map(([name, parent, pos, opt = {}]) => ({ name, parent, pos, mirror: null, ...opt })),
    ...side('L'),
    ...side('R'),
  ]
  return defs.map((d) => ({ deform: true, r: 0.0075, bias: 1, ...d, tail: d.tail ?? null }))
}

export class Rig {
  constructor(defs) {
    this.defs = defs
    this.index = new Map(defs.map((d, i) => [d.name, i]))
    this.parent = defs.map((d) => (d.parent ? this.index.get(d.parent) : -1))
    this.children = defs.map(() => [])
    this.parent.forEach((p, i) => p >= 0 && this.children[p].push(i))
    this.tail = defs.map((d, i) => (d.tail ? this.index.get(d.tail) : (this.children[i][0] ?? -1)))
    this.mirror = defs.map((d) => (d.mirror ? (this.index.get(d.mirror) ?? -1) : -1))
    this.deform = defs.map((_, i) => i).filter((i) => defs[i].deform)

    // Rest (bind) joint positions in model space.
    this.joints = defs.map((d) => new THREE.Vector3(...d.pos))

    this.bones = defs.map((d) => {
      const b = new THREE.Bone()
      b.name = d.name
      return b
    })
    this.parent.forEach((p, i) => p >= 0 && this.bones[p].add(this.bones[i]))
    this.root = this.bones[0]
    this.applyRest()
  }

  /** Put every bone back in bind pose: positions from joints, no rotation. */
  applyRest() {
    this.bones.forEach((b, i) => {
      b.position.copy(this.joints[i])
      if (this.parent[i] >= 0) b.position.sub(this.joints[this.parent[i]])
      b.quaternion.identity()
      b.scale.set(1, 1, 1)
    })
    this.root.updateMatrixWorld(true)
  }

  /** Snapshot of the current pose (rotations + hips offset from rest). */
  getPose() {
    const bones = {}
    for (const b of this.bones) {
      if (Math.abs(b.quaternion.w) < 0.99999) {
        bones[b.name] = b.quaternion.toArray().map((v) => +v.toFixed(5))
      }
    }
    const hips = this.root.position.clone().sub(this.joints[0]).toArray().map((v) => +v.toFixed(5))
    return { bones, hips }
  }

  setPose(pose) {
    this.applyRest()
    for (const [name, q] of Object.entries(pose?.bones ?? {})) {
      const i = this.index.get(name)
      if (i !== undefined) this.bones[i].quaternion.fromArray(q)
    }
    if (pose?.hips) this.root.position.add(new THREE.Vector3(...pose.hips))
    this.root.updateMatrixWorld(true)
  }
}
