import { useEffect, useRef } from 'react'

/**
 * Screen-space "torch" cursor.
 *
 *  - The flame eases toward the pointer (it lags slightly), leaving a smooth
 *    tapered light trail along its recent path — bright/wide at the head,
 *    thin/faint at the tail. Faster movement stretches the trail longer.
 *  - A layered flame head (soft outer glow + warm mid + bright inner core)
 *    with organic, wave-driven flicker reads as a small living flame rather
 *    than a plain dot.
 *  - A few embers peel off as it moves. When the pointer goes idle, smoke
 *    wisps rise from the resting flame.
 *  - After ~30s fully idle the flame burns down and dies out over a few
 *    seconds; moving the pointer relights it instantly.
 *
 * Full-screen <canvas> above the 3D scene; additive blending for fire/trail,
 * normal blending for smoke.
 */
export default function TorchCursor({ extinguishRef }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    let w = (canvas.width = window.innerWidth)
    let h = (canvas.height = window.innerHeight)

    const onResize = () => {
      w = canvas.width = window.innerWidth
      h = canvas.height = window.innerHeight
    }
    window.addEventListener('resize', onResize)

    // Raw pointer + eased flame position (the flame chases the pointer).
    const pointer = { x: w / 2, y: h / 2 }
    const flame = { x: w / 2, y: h / 2, vx: 0, vy: 0 }
    let hasPointer = false
    let lastMoveAt = performance.now()

    const onMove = (e) => {
      pointer.x = e.clientX
      pointer.y = e.clientY
      lastMoveAt = performance.now()
      hasPointer = true
    }
    window.addEventListener('pointermove', onMove, { passive: true })

    // Trail: ring of recent flame positions, newest first. Rendered as a
    // smooth tapered streak so motion feels fluid.
    const TRAIL_MAX = 26
    const trail = []

    const fire = [] // embers
    const smoke = [] // idle smoke wisps

    const IDLE_MS = 320
    const BURN_START_MS = 30000
    const BURN_FADE_MS = 6000

    const spawnFire = (x, y, speed, burn) => {
      const n = Math.max(0, Math.round((0.4 + Math.min(2.0, speed * 0.1)) * burn))
      for (let i = 0; i < n; i++) {
        fire.push({
          x: x + (Math.random() - 0.5) * 4,
          y: y + (Math.random() - 0.5) * 4,
          vx: (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.4 - 0.25,
          life: 0,
          maxLife: 320 + Math.random() * 260,
          size: 1.2 + Math.random() * 1.8,
          hue: 18 + Math.random() * 22,
        })
      }
    }

    const spawnSmoke = (x, y) => {
      smoke.push({
        x: x + (Math.random() - 0.5) * 8,
        y: y - 2,
        vx: (Math.random() - 0.5) * 0.14,
        vy: -0.25 - Math.random() * 0.25,
        life: 0,
        maxLife: 1400 + Math.random() * 1200,
        size: 10 + Math.random() * 14,
      })
    }

    let smokeAccumulator = 0
    let prevExt = 0
    let last = performance.now()
    let raf

    const frame = (now) => {
      const dt = Math.min(48, now - last)
      last = now
      const t = now / 1000

      // Ease the flame toward the pointer (frame-rate independent). A softer
      // factor gives a longer, smoother lag/trail.
      const ease = 1 - Math.pow(0.0022, dt / 16.67)
      const fx = flame.x + (pointer.x - flame.x) * ease
      const fy = flame.y + (pointer.y - flame.y) * ease
      flame.vx = fx - flame.x
      flame.vy = fy - flame.y
      flame.x = fx
      flame.y = fy
      const flameSpeed = Math.hypot(flame.vx, flame.vy)

      const idleFor = now - lastMoveAt
      const idle = idleFor > IDLE_MS
      let burn = 1
      if (idleFor > BURN_START_MS) {
        burn = Math.max(0, 1 - (idleFor - BURN_START_MS) / BURN_FADE_MS)
      }
      // Blow-out: the character snuffing the torch drives this toward 1,
      // which crushes the flame.
      const ext = extinguishRef?.current ?? 0
      burn *= Math.max(0, 1 - ext)
      // Once the torch is going out, stop any smoke and clear what's lingering
      // so no smoke remains after it's extinguished.
      if (ext > 0.4) smoke.length = 0
      prevExt = ext

      // Record the trail head.
      if (hasPointer) {
        trail.unshift({ x: flame.x, y: flame.y })
        if (trail.length > TRAIL_MAX) trail.pop()
      }

      // Embers while moving + faint idle flicker.
      if (hasPointer && burn > 0.02) {
        if (flameSpeed > 0.4) spawnFire(flame.x, flame.y, flameSpeed, burn)
        else if (Math.random() < 0.14 * burn) spawnFire(flame.x, flame.y, 1, burn)
      }

      // Idle smoke from the resting flame — only while the flame is actually
      // lit (not during/after blow-out) and much sparser than before.
      if (hasPointer && idle && ext < 0.2) {
        smokeAccumulator += dt
        if (smokeAccumulator > 220 && Math.random() < 0.25 * burn) {
          smokeAccumulator = 0
          spawnSmoke(flame.x, flame.y)
        }
      }

      ctx.clearRect(0, 0, w, h)

      // ── Smoke, normal blending ──
      ctx.globalCompositeOperation = 'source-over'
      for (let i = smoke.length - 1; i >= 0; i--) {
        const p = smoke[i]
        p.life += dt
        const tt = p.life / p.maxLife
        if (tt >= 1) { smoke.splice(i, 1); continue }
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.vx += (Math.random() - 0.5) * 0.004 * dt
        const grow = p.size * (1 + tt * 1.8)
        const alpha = Math.sin(Math.min(tt, 1) * Math.PI) * 0.12
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, grow)
        g.addColorStop(0, `rgba(120,124,132,${alpha})`)
        g.addColorStop(1, 'rgba(120,124,132,0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(p.x, p.y, grow, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.globalCompositeOperation = 'lighter'
      if (hasPointer && burn > 0.02 && trail.length > 1) {
        // Longer, thinner streak when moving fast; tight glow when slow.
        const stretch = Math.min(1, flameSpeed / 22)
        const used = Math.max(2, Math.round(trail.length * (0.35 + stretch * 0.65)))
        for (let i = used - 1; i >= 0; i--) {
          const p = trail[i]
          const u = i / used // 0 head → 1 tail
          const fade = (1 - u) * (1 - u) // ease-out taper
          const r = (3 + (1 - u) * 7) * (0.5 + burn * 0.5)
          const a = 0.26 * fade * burn
          const hue = 30 - u * 12 // amber head → deep orange tail
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r)
          g.addColorStop(0, `hsla(${hue}, 100%, 60%, ${a})`)
          g.addColorStop(1, 'hsla(20,100%,40%,0)')
          ctx.fillStyle = g
          ctx.beginPath()
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // ── Embers, additive ──
      for (let i = fire.length - 1; i >= 0; i--) {
        const p = fire[i]
        p.life += dt
        const tt = p.life / p.maxLife
        if (tt >= 1) { fire.splice(i, 1); continue }
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.vy -= 0.0008 * dt
        const alpha = (1 - tt) * 0.5
        const size = p.size * (1 - tt * 0.5)
        const hue = p.hue - tt * 14
        const light = 55 - tt * 25
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 2.4)
        g.addColorStop(0, `hsla(${hue}, 100%, ${light}%, ${alpha})`)
        g.addColorStop(0.4, `hsla(${hue - 6}, 100%, ${light - 15}%, ${alpha * 0.5})`)
        g.addColorStop(1, 'hsla(0,0%,0%,0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(p.x, p.y, size * 2.4, 0, Math.PI * 2)
        ctx.fill()
      }

      // ── Flame head: layered glow with organic, wave-driven flicker. The
      // body stretches slightly into a teardrop pointing up + opposite motion.
      if (hasPointer && burn > 0.02) {
        // Smooth multi-wave flicker (no harsh jitter).
        const flick =
          0.86 +
          Math.sin(t * 17) * 0.06 +
          Math.sin(t * 31 + 1.3) * 0.04 +
          Math.sin(t * 7) * 0.04
        const base = (0.45 + burn * 0.55) * flick

        // Outer soft halo
        drawGlow(ctx, flame.x, flame.y, 16 * base, [
          [0, `rgba(255,150,60,${0.14 * burn})`],
          [1, 'rgba(255,90,0,0)'],
        ])
        // Warm mid flame
        drawGlow(ctx, flame.x, flame.y - 1 * base, 8 * base, [
          [0, `rgba(255,180,90,${0.34 * burn})`],
          [0.6, `rgba(255,120,30,${0.22 * burn})`],
          [1, 'rgba(255,80,0,0)'],
        ])
        // Bright inner core (hot white-gold), nudged up for a flame tip
        drawGlow(ctx, flame.x, flame.y - 2 * base, 3.6 * base, [
          [0, `rgba(255,244,210,${0.6 * burn})`],
          [1, 'rgba(255,180,80,0)'],
        ])
      }

      ctx.globalCompositeOperation = 'source-over'
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onMove)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 3,
        pointerEvents: 'none',
      }}
    />
  )
}

// Small helper: radial-gradient filled circle.
function drawGlow(ctx, x, y, r, stops) {
  if (r <= 0) return
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  for (const [offset, color] of stops) g.addColorStop(offset, color)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}
