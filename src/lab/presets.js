import * as THREE from 'three'

const E = (x = 0, y = 0, z = 0) =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)).toArray().map((v) => +v.toFixed(5))

// Starting points — refine them in the Pose tab and save your own.
// Bone axes are world-aligned in rest pose: +X rotation tips a bone's
// tip forward (+Z), so +X on the head is a bow.
export const PRESETS = [
  { name: 'Rest', bones: {}, hips: [0, 0, 0] },
  {
    // What the torch does on the site: head bows ~45°, nothing else moves.
    name: 'Torch bow (45°)',
    bones: { head: E(0.785), neck: E(0.12) },
    hips: [0, 0, 0],
  },
  {
    name: 'Sit against tree',
    hips: [0, -0.31, -0.02],
    bones: {
      hips: E(-0.05),
      spine: E(-0.12),
      chest: E(-0.08),
      neck: E(0.12),
      head: E(0.3),
      thigh_L: E(-1.9, 0, 0.15),
      thigh_R: E(-1.9, 0, -0.15),
      shin_L: E(2.0),
      shin_R: E(2.0),
      foot_L: E(-0.1),
      foot_R: E(-0.1),
      upperarm_L: E(-0.7, 0, 0.12),
      upperarm_R: E(-0.7, 0, -0.12),
      forearm_L: E(-0.6),
      forearm_R: E(-0.6),
      // Tabard follows the raised thighs; back flap spreads on the ground.
      skirt_F1: E(-1.6),
      skirt_B1: E(1.1),
      skirt_L: E(-0.9, 0, 0.25),
      skirt_R: E(-0.9, 0, -0.25),
    },
  },
]
