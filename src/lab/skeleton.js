import * as THREE from 'three'

// Humanoid template measured on the kingslayer knight (~0.98 units tall,
// facing +Z, feet on y=0). Character's LEFT side is +X.
// Each entry: [name, parent, position, deforms?, tail]
// `tail` picks which child the bone "points at" for auto-weights
// (defaults to the first child).
const CENTER = [
  ['hips', null, [0, 0.5, 0], true, 'spine'],
  ['spine', 'hips', [0, 0.58, 0], true],
  ['chest', 'spine', [0, 0.68, 0], true, 'neck'],
  ['neck', 'chest', [0, 0.79, 0], true],
  ['head', 'neck', [0, 0.84, 0.005], true],
  ['head_end', 'head', [0, 0.975, 0.005], false],
]

// Left side; the right side is mirrored on X.
const SIDE = [
  ['clavicle', 'chest', [0.035, 0.745, 0], true],
  ['upperarm', 'clavicle', [0.12, 0.725, 0], true],
  ['forearm', 'upperarm', [0.165, 0.565, 0], true],
  ['hand', 'forearm', [0.185, 0.455, 0.01], true],
  ['hand_end', 'hand', [0.19, 0.395, 0.015], false],
  ['thigh', 'hips', [0.06, 0.47, 0], true],
  ['shin', 'thigh', [0.075, 0.25, 0], true],
  ['foot', 'shin', [0.08, 0.065, -0.005], true],
  ['toe', 'foot', [0.08, 0.02, 0.07], true],
  ['toe_end', 'toe', [0.08, 0.012, 0.115], false],
]

export const TEMPLATE_HEIGHT = 0.979

export function makeTemplate() {
  const defs = CENTER.map(([name, parent, pos, deform, tail]) => ({
    name, parent, pos, deform, tail: tail ?? null, mirror: null,
  }))
  for (const [s, sx, other] of [['L', 1, 'R'], ['R', -1, 'L']]) {
    for (const [n, p, pos, deform] of SIDE) {
      defs.push({
        name: `${n}_${s}`,
        parent: p === 'chest' || p === 'hips' ? p : `${p}_${s}`,
        pos: [pos[0] * sx, pos[1], pos[2]],
        deform,
        tail: null,
        mirror: `${n}_${other}`,
      })
    }
  }
  return defs
}

export class Rig {
  constructor(defs) {
    this.defs = defs
    this.index = new Map(defs.map((d, i) => [d.name, i]))
    this.parent = defs.map((d) => (d.parent ? this.index.get(d.parent) : -1))
    this.children = defs.map(() => [])
    this.parent.forEach((p, i) => p >= 0 && this.children[p].push(i))
    this.tail = defs.map((d, i) => (d.tail ? this.index.get(d.tail) : (this.children[i][0] ?? -1)))
    this.mirror = defs.map((d) => (d.mirror ? this.index.get(d.mirror) : -1))
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
