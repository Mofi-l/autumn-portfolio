import * as THREE from 'three'

// Skin weights are stored per *position group*: vertices that share a
// position (UV seams duplicate vertices) always get identical weights, so
// the mesh never tears along seams when it bends.
export class Weights {
  constructor(geometry, rig) {
    this.rig = rig
    const pos = geometry.attributes.position
    const n = pos.count
    this.n = n

    // --- group coincident vertices -------------------------------------
    const map = new Map()
    const vg = new Int32Array(n)
    const gp = []
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
      const key = `${Math.round(x * 2e4)}|${Math.round(y * 2e4)}|${Math.round(z * 2e4)}`
      let g = map.get(key)
      if (g === undefined) {
        g = gp.length / 3
        map.set(key, g)
        gp.push(x, y, z)
      }
      vg[i] = g
    }
    const G = gp.length / 3
    this.G = G
    this.vg = vg
    this.gpos = new Float32Array(gp)

    // group -> vertices (CSR)
    this.gvStart = new Uint32Array(G + 1)
    for (let i = 0; i < n; i++) this.gvStart[vg[i] + 1]++
    for (let g = 0; g < G; g++) this.gvStart[g + 1] += this.gvStart[g]
    this.gv = new Uint32Array(n)
    const fill = this.gvStart.slice(0, G)
    for (let i = 0; i < n; i++) this.gv[fill[vg[i]]++] = i

    // group adjacency from triangle edges (CSR, duplicates are harmless)
    const idx = geometry.index ? geometry.index.array : null
    const triCount = idx ? idx.length / 3 : n / 3
    const vAt = idx ? (k) => idx[k] : (k) => k
    const deg = new Uint32Array(G + 1)
    const forEdges = (cb) => {
      for (let t = 0; t < triCount; t++) {
        const a = vg[vAt(t * 3)], b = vg[vAt(t * 3 + 1)], c = vg[vAt(t * 3 + 2)]
        if (a !== b) { cb(a, b); cb(b, a) }
        if (b !== c) { cb(b, c); cb(c, b) }
        if (c !== a) { cb(c, a); cb(a, c) }
      }
    }
    forEdges((a) => deg[a + 1]++)
    for (let g = 0; g < G; g++) deg[g + 1] += deg[g]
    this.adjStart = deg
    this.adj = new Uint32Array(deg[G])
    const af = deg.slice(0, G)
    forEdges((a, b) => { this.adj[af[a]++] = b })

    // --- bone bookkeeping (deform-bone space k = 0..nb-1) ---------------
    this.nb = rig.deform.length
    this.kOf = new Map(rig.deform.map((bi, k) => [bi, k]))
    this.parentK = rig.deform.map((bi) => {
      let p = rig.parent[bi]
      while (p >= 0 && !this.kOf.has(p)) p = rig.parent[p]
      if (p >= 0) return this.kOf.get(p)
      // root: fall back to its first deforming child
      const c = rig.children[bi].find((ci) => this.kOf.has(ci))
      return c !== undefined ? this.kOf.get(c) : 0
    })
    this.mirrorK = rig.deform.map((bi, k) => {
      const m = rig.mirror[bi]
      return m >= 0 && this.kOf.has(m) ? this.kOf.get(m) : k
    })

    this.w = new Float32Array(G * this.nb)
    this.history = []
  }

  // ---------------------------------------------------------------------
  snapshot() {
    this.history.push(this.w.slice())
    if (this.history.length > 8) this.history.shift()
  }

  undo() {
    const prev = this.history.pop()
    if (!prev) return false
    this.w.set(prev)
    return true
  }

  // ---------------------------------------------------------------------
  /** Distance-based automatic weights, then a few smoothing passes. */
  auto(falloff = 4, smoothIters = 4) {
    const { rig, G, nb, w, gpos } = this
    const seg = new Float64Array(nb * 6)
    rig.deform.forEach((bi, k) => {
      const a = rig.joints[bi]
      const t = rig.tail[bi]
      const b = t >= 0 ? rig.joints[t] : a
      seg.set([a.x, a.y, a.z, b.x, b.y, b.z], k * 6)
    })
    const tmp = new Float64Array(nb)
    const top = [0, 0, 0, 0]
    for (let g = 0; g < G; g++) {
      const px = gpos[g * 3], py = gpos[g * 3 + 1], pz = gpos[g * 3 + 2]
      for (let k = 0; k < nb; k++) {
        const o = k * 6
        const ax = seg[o], ay = seg[o + 1], az = seg[o + 2]
        const dx = seg[o + 3] - ax, dy = seg[o + 4] - ay, dz = seg[o + 5] - az
        const len2 = dx * dx + dy * dy + dz * dz
        let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / len2 : 0
        t = t < 0 ? 0 : t > 1 ? 1 : t
        const qx = ax + dx * t - px, qy = ay + dy * t - py, qz = az + dz * t - pz
        const d = Math.max(Math.sqrt(qx * qx + qy * qy + qz * qz), 1e-3)
        tmp[k] = 1 / Math.pow(d, falloff)
      }
      // keep the 4 strongest influences
      top.fill(-1)
      for (let k = 0; k < nb; k++) {
        for (let s = 0; s < 4; s++) {
          if (top[s] < 0 || tmp[k] > tmp[top[s]]) {
            for (let u = 3; u > s; u--) top[u] = top[u - 1]
            top[s] = k
            break
          }
        }
      }
      let sum = 0
      for (let s = 0; s < 4; s++) sum += tmp[top[s]]
      const o = g * nb
      w.fill(0, o, o + nb)
      for (let s = 0; s < 4; s++) w[o + top[s]] = tmp[top[s]] / sum
    }
    if (smoothIters > 0) this.smoothAll(smoothIters, 0.5)
  }

  /** Laplacian smoothing of all weights across mesh connectivity. */
  smoothAll(iters = 2, alpha = 0.5) {
    const { G, nb, adjStart, adj } = this
    let src = this.w
    let dst = new Float32Array(src.length)
    for (let it = 0; it < iters; it++) {
      for (let g = 0; g < G; g++) {
        const s = adjStart[g], e = adjStart[g + 1]
        const o = g * nb
        if (e === s) {
          for (let k = 0; k < nb; k++) dst[o + k] = src[o + k]
          continue
        }
        const inv = 1 / (e - s)
        for (let k = 0; k < nb; k++) {
          let acc = 0
          for (let j = s; j < e; j++) acc += src[adj[j] * nb + k]
          dst[o + k] = (1 - alpha) * src[o + k] + alpha * acc * inv
        }
      }
      ;[src, dst] = [dst, src]
    }
    if (src !== this.w) this.w.set(src)
  }

  /** Set bone k's weight on group g, rescaling the others to keep sum = 1. */
  setW(g, k, v) {
    const { nb, w } = this
    const o = g * nb
    v = v < 0 ? 0 : v > 1 ? 1 : v
    const cur = w[o + k]
    const rest = 1 - cur
    const newRest = 1 - v
    if (rest > 1e-6) {
      const s = newRest / rest
      for (let j = 0; j < nb; j++) if (j !== k) w[o + j] *= s
    } else if (newRest > 0) {
      w[o + this.parentK[k]] += newRest
    }
    w[o + k] = v
  }

  /** Brush stroke. mode: 'add' | 'subtract' | 'smooth'. Returns touched groups. */
  brush(center, radius, k, strength, mode) {
    const { G, nb, w, gpos, adjStart, adj } = this
    const r2 = radius * radius
    const touched = []
    const row = new Float32Array(nb)
    for (let g = 0; g < G; g++) {
      const dx = gpos[g * 3] - center.x, dy = gpos[g * 3 + 1] - center.y, dz = gpos[g * 3 + 2] - center.z
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 > r2) continue
      const t = 1 - d2 / r2
      const f = strength * t * t
      touched.push(g)
      const o = g * nb
      if (mode === 'add') this.setW(g, k, w[o + k] + f * (1 - w[o + k]))
      else if (mode === 'subtract') this.setW(g, k, w[o + k] * (1 - f))
      else {
        const s = adjStart[g], e = adjStart[g + 1]
        if (e === s) continue
        row.fill(0)
        for (let j = s; j < e; j++) {
          const on = adj[j] * nb
          for (let b = 0; b < nb; b++) row[b] += w[on + b]
        }
        const inv = 1 / (e - s)
        for (let b = 0; b < nb; b++) w[o + b] += f * (row[b] * inv - w[o + b])
      }
    }
    return touched
  }

  /** Give the listed groups 100% to bone k. */
  assign(groups, k) {
    const { nb, w } = this
    for (const g of groups) {
      w.fill(0, g * nb, g * nb + nb)
      w[g * nb + k] = 1
    }
  }

  /** All groups connected to `start` through mesh edges. */
  component(start) {
    const { G, adjStart, adj } = this
    const seen = new Uint8Array(G)
    const out = [start]
    seen[start] = 1
    for (let h = 0; h < out.length; h++) {
      const g = out[h]
      for (let j = adjStart[g]; j < adjStart[g + 1]; j++) {
        const n = adj[j]
        if (!seen[n]) { seen[n] = 1; out.push(n) }
      }
    }
    return out
  }

  groupsWhere(test) {
    const out = []
    const p = new THREE.Vector3()
    for (let g = 0; g < this.G; g++) {
      p.fromArray(this.gpos, g * 3)
      if (test(p)) out.push(g)
    }
    return out
  }

  weightAtVertex(vi, k) {
    return this.w[this.vg[vi] * this.nb + k]
  }

  /** Load weights from existing per-vertex skin attributes. */
  fromVertexSkin(skinIndex, skinWeight, boneNames) {
    const { G, nb, w, gv, gvStart, rig } = this
    const kByName = new Map(rig.deform.map((bi, k) => [rig.defs[bi].name, k]))
    w.fill(0)
    for (let g = 0; g < G; g++) {
      const vi = gv[gvStart[g]]
      const o = g * nb
      let sum = 0
      for (let j = 0; j < 4; j++) {
        const k = kByName.get(boneNames[skinIndex.getComponent(vi, j)])
        const v = skinWeight.getComponent(vi, j)
        if (k !== undefined && v > 0) { w[o + k] += v; sum += v }
      }
      if (sum > 0) for (let k = 0; k < nb; k++) w[o + k] /= sum
      else w[o] = 1
    }
  }

  // --- attribute writers ------------------------------------------------
  /** Write top-4 skinIndex/skinWeight attributes (optionally only for some groups). */
  writeSkin(geometry, groups = null) {
    const { n, nb, w, gv, gvStart, rig } = this
    let si = geometry.getAttribute('skinIndex')
    let sw = geometry.getAttribute('skinWeight')
    if (!si || si.count !== n) {
      si = new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4)
      sw = new THREE.Float32BufferAttribute(new Float32Array(n * 4), 4)
      geometry.setAttribute('skinIndex', si)
      geometry.setAttribute('skinWeight', sw)
    }
    const top = [0, 0, 0, 0]
    const count = groups ? groups.length : this.G
    for (let gi = 0; gi < count; gi++) {
      const g = groups ? groups[gi] : gi
      const o = g * nb
      top.fill(-1)
      for (let k = 0; k < nb; k++) {
        const v = w[o + k]
        for (let s = 0; s < 4; s++) {
          if (top[s] < 0 || v > w[o + top[s]]) {
            for (let u = 3; u > s; u--) top[u] = top[u - 1]
            top[s] = k
            break
          }
        }
      }
      let sum = 0
      for (let s = 0; s < 4; s++) sum += w[o + top[s]]
      if (sum <= 0) sum = 1
      for (let j = gvStart[g]; j < gvStart[g + 1]; j++) {
        const vi = gv[j] * 4
        for (let s = 0; s < 4; s++) {
          si.array[vi + s] = rig.deform[top[s]]
          sw.array[vi + s] = w[o + top[s]] / sum
        }
      }
    }
    si.needsUpdate = true
    sw.needsUpdate = true
  }

  /** Heat-map colours: one bone (blue→red) or every bone in its own colour. */
  writeColors(geometry, mode, k, groups = null) {
    const { n, nb, w, gv, gvStart } = this
    let col = geometry.getAttribute('color')
    if (!col || col.count !== n) {
      col = new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3)
      geometry.setAttribute('color', col)
    }
    const c = new THREE.Color()
    const count = groups ? groups.length : this.G
    for (let gi = 0; gi < count; gi++) {
      const g = groups ? groups[gi] : gi
      const o = g * nb
      let r = 0, gg = 0, b = 0
      if (mode === 'all') {
        for (let j = 0; j < nb; j++) {
          const v = w[o + j]
          if (v <= 0) continue
          const p = PALETTE[j % PALETTE.length]
          r += p.r * v; gg += p.g * v; b += p.b * v
        }
      } else {
        const v = w[o + k]
        if (v < 0.002) { r = 0.02; gg = 0.025; b = 0.04 }
        else { c.setHSL((1 - v) * 0.66, 1, 0.5); r = c.r; gg = c.g; b = c.b }
      }
      for (let j = gvStart[g]; j < gvStart[g + 1]; j++) {
        const vi = gv[j] * 3
        col.array[vi] = r; col.array[vi + 1] = gg; col.array[vi + 2] = b
      }
    }
    col.needsUpdate = true
  }
}

export const PALETTE = Array.from({ length: 24 }, (_, i) =>
  new THREE.Color().setHSL((i * 0.61803) % 1, 0.75, 0.5),
)
