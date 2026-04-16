'use client'
import { useRef, useEffect } from 'react'

// GSAP-free version using requestAnimationFrame lerp for Next.js compatibility
export default function BlobCursor({
  fillColor = '#ffffff',
  trailCount = 3,
  sizes = [50, 100, 65],
  innerSizes = [16, 28, 18],
  innerColor = 'rgba(0,0,0,0.6)',
  opacities = [0.15, 0.08, 0.12],
  filterStdDeviation = 25,
  zIndex = 9999,
}: {
  fillColor?: string
  trailCount?: number
  sizes?: number[]
  innerSizes?: number[]
  innerColor?: string
  opacities?: number[]
  filterStdDeviation?: number
  zIndex?: number
}) {
  const blobsRef = useRef<(HTMLDivElement | null)[]>([])
  const positions = useRef(Array.from({ length: trailCount }, () => ({ x: -200, y: -200 })))
  const target = useRef({ x: -200, y: -200 })
  const raf = useRef(0)

  useEffect(() => {
    const LERP_FACTORS = [0.18, 0.10, 0.14]

    const onMove = (e: MouseEvent) => {
      target.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('mousemove', onMove)

    const tick = () => {
      for (let i = 0; i < trailCount; i++) {
        const src = i === 0 ? target.current : positions.current[i - 1]
        const pos = positions.current[i]
        const lf = LERP_FACTORS[i] ?? 0.1
        pos.x += (src.x - pos.x) * lf
        pos.y += (src.y - pos.y) * lf
        const el = blobsRef.current[i]
        if (el) {
          el.style.transform = `translate(${pos.x - sizes[i] / 2}px, ${pos.y - sizes[i] / 2}px)`
        }
      }
      raf.current = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      window.removeEventListener('mousemove', onMove)
      cancelAnimationFrame(raf.current)
    }
  }, [trailCount, sizes])

  return (
    <>
      <svg style={{ position: 'fixed', width: 0, height: 0, zIndex: -1 }}>
        <defs>
          <filter id="blob-filter">
            <feGaussianBlur in="SourceGraphic" result="blur" stdDeviation={filterStdDeviation} />
            <feColorMatrix in="blur" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 28 -8" />
          </filter>
        </defs>
      </svg>

      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none',
        zIndex, filter: 'url(#blob-filter)',
      }}>
        {Array.from({ length: trailCount }).map((_, i) => (
          <div
            key={i}
            ref={el => { blobsRef.current[i] = el }}
            style={{
              position: 'fixed', top: 0, left: 0,
              width: sizes[i], height: sizes[i],
              borderRadius: '50%',
              backgroundColor: fillColor,
              opacity: opacities[i],
              willChange: 'transform',
              pointerEvents: 'none',
            }}
          >
            <div style={{
              position: 'absolute',
              width: innerSizes[i], height: innerSizes[i],
              top: (sizes[i] - innerSizes[i]) / 2,
              left: (sizes[i] - innerSizes[i]) / 2,
              backgroundColor: innerColor,
              borderRadius: '50%',
            }} />
          </div>
        ))}
      </div>
    </>
  )
}
