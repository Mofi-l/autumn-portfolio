import { useEffect, useRef, useState } from 'react'
import Scene from './components/Scene'
import Overlay from './components/Overlay'
import TorchCursor from './components/TorchCursor'
import { sections } from './content'
import './App.css'

export default function App() {
  // Shared scroll progress (0..1) read by the 3D scene every frame.
  // A ref (not state) avoids re-rendering React on every scroll tick.
  const scrollRef = useRef(0)
  // Shared "blow out" signal (0 = flame burning, 1 = fully extinguished).
  // MonkModel sets it from torch-to-face proximity; TorchCursor reads it to
  // snuff the flame + puff smoke, so the blow-out syncs with the head bow.
  const extinguishRef = useRef(0)
  const [active, setActive] = useState(0)
  const [loaded, setLoaded] = useState(false)

  // Track scroll progress + active section.
  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement
      const max = doc.scrollHeight - doc.clientHeight
      const p = max > 0 ? doc.scrollTop / max : 0
      scrollRef.current = Math.min(Math.max(p, 0), 1)

      // Active section = whichever is nearest the viewport center.
      const mid = doc.scrollTop + doc.clientHeight / 2
      let idx = 0
      for (let i = 0; i < sections.length; i++) {
        const el = document.getElementById(sections[i].id)
        if (el && el.offsetTop <= mid) idx = i
      }
      setActive(idx)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Hide the loader only once the character has actually rendered its first
  // frame (geometry + textures on the GPU), so there's no gap between the
  // loader disappearing and the character appearing. MonkModel fires onReady.
  const handleReady = () => setLoaded(true)

  // Safety net: never let the loader stick if an asset stalls.
  useEffect(() => {
    const safety = setTimeout(() => setLoaded(true), 12000)
    return () => clearTimeout(safety)
  }, [])

  const navigate = (i) => {
    const el = document.getElementById(sections[i].id)
    if (el) el.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <>
      <Scene scrollRef={scrollRef} onReady={handleReady} extinguishRef={extinguishRef} />
      <div className="vignette" />
      <Overlay active={active} onNavigate={navigate} />
      <TorchCursor extinguishRef={extinguishRef} />

      <div className={`loader ${loaded ? 'is-hidden' : ''}`}>
        <div className="loader__ring" />
        <div className="loader__text">Entering the grove…</div>
      </div>
    </>
  )
}
