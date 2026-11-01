# Mofil — Autumn Grove Portfolio

A cinematic, real-time 3D portfolio: the shadow monk resting against an old
oak in an autumn forest — glowing canopy, god rays, falling leaves and warm
haze. Scrolling moves the camera between shots so the monk sits opposite each
section's content. The cursor is a torch that lights the scene; bring it to
the monk's face and he snuffs it out and bows his head.

## Stack

- Vite + React, three.js via `@react-three/fiber` + `@react-three/drei`
- `@react-three/postprocessing` (bloom + ACES tone mapping)
- Everything in the forest is procedural (seeded) — no extra assets besides
  the rigged monk GLB.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # outputs dist/ (relative base — deploys under any path)
```

## Where things live

- `src/content.js` — all portfolio text
- `src/components/Scene.jsx` — lights, camera shots (`SHOTS`), torch light, bloom
- `src/components/Forest.jsx` — oak, canopy, ground, background trees, sky
- `src/components/LightShafts.jsx` — god rays
- `src/components/FallingLeaves.jsx` — drifting leaves
- `src/components/MonkModel.jsx` — monk pose, idle, torch blow-out + head bow
- `src/components/TorchCursor.jsx` — on-screen torch flame/trail

## Tuning

- Camera per section: `SHOTS` in `Scene.jsx`
- Sun direction / haze colour: `SUN_POS`, `HAZE` in `Forest.jsx`
- Canopy density: `PER_TIP` in `Forest.jsx`; falling leaves: `count` prop
- Bloom strength: `<Bloom intensity>` in `Scene.jsx`
