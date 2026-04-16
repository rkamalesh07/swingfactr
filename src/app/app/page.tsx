'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const MONO = "'DM Mono', monospace"
const SANS = "'Inter', sans-serif"

// ─── Interactive Dot Grid ─────────────────────────────────────────────────────
// Renders AFTER mount so offsetWidth is always valid

function DotGrid({ height = 560 }: { height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const mouse = useRef({ x: -9999, y: -9999 })
  const raf = useRef(0)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const SPACING = 30, R = 1.3, GLOW = 130

    let W = 0, H = 0
    let dots: { x: number; y: number }[] = []

    const init = () => {
      W = canvas.width = canvas.clientWidth
      H = canvas.height = canvas.clientHeight
      dots = []
      for (let x = SPACING / 2; x < W; x += SPACING)
        for (let y = SPACING / 2; y < H; y += SPACING)
          dots.push({ x, y })
    }

    // Use ResizeObserver so it fires once the element has real dimensions
    const ro = new ResizeObserver(init)
    ro.observe(canvas)
    init()

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      mouse.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    const onLeave = () => { mouse.current = { x: -9999, y: -9999 } }
    window.addEventListener('mousemove', onMove)
    canvas.addEventListener('mouseleave', onLeave)

    const draw = () => {
      ctx.clearRect(0, 0, W, H)
      const { x: mx, y: my } = mouse.current
      for (const d of dots) {
        const dist = Math.hypot(d.x - mx, d.y - my)
        const t = Math.max(0, 1 - dist / GLOW)
        const a = 0.1 + t * 0.7
        const r = R + t * 2.2
        ctx.beginPath()
        ctx.arc(d.x, d.y, r, 0, Math.PI * 2)
        ctx.fillStyle = t > 0.05
          ? `rgba(200,241,53,${a})`
          : `rgba(100,98,94,${a})`
        ctx.fill()
      }
      raf.current = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf.current)
      window.removeEventListener('mousemove', onMove)
    }
  }, [])

  return (
    <canvas
      ref={ref}
      style={{
        position: 'absolute', inset: 0,
        width: '100%', height: '100%',
        display: 'block',
      }}
    />
  )
}

// ─── Decrypt text ─────────────────────────────────────────────────────────────

function Decrypt({ text, delay = 0, style = {} }: {
  text: string; delay?: number; style?: React.CSSProperties
}) {
  const [out, setOut] = useState('')
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

  useEffect(() => {
    let iter = 0
    let timer: ReturnType<typeof setTimeout>
    let iv: ReturnType<typeof setInterval>

    timer = setTimeout(() => {
      iv = setInterval(() => {
        setOut(text.split('').map((c, i) => {
          if (c === ' ') return ' '
          if (i < iter) return text[i]
          return CHARS[Math.floor(Math.random() * CHARS.length)]
        }).join(''))
        iter += 0.5
        if (iter > text.length) clearInterval(iv)
      }, 35)
    }, delay)

    return () => { clearTimeout(timer); clearInterval(iv) }
  }, [text, delay])

  return <span style={style}>{out || text}</span>
}

// ─── Count up ─────────────────────────────────────────────────────────────────

function CountUp({ to, suffix = '' }: { to: number; suffix?: string }) {
  const [n, setN] = useState(0)
  const el = useRef<HTMLSpanElement>(null)
  const done = useRef(false)

  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting || done.current) return
      done.current = true
      const start = performance.now()
      const dur = 1600
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / dur)
        const ease = 1 - (1 - p) ** 3
        setN(Math.round(ease * to))
        if (p < 1) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }, { threshold: 0.4 })
    if (el.current) obs.observe(el.current)
    return () => obs.disconnect()
  }, [to])

  return <span ref={el}>{n >= 1000 ? n.toLocaleString() : n}{suffix}</span>
}

// ─── Fade in on scroll ────────────────────────────────────────────────────────

function Fade({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [v, setV] = useState(false)

  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setV(true); obs.disconnect() }
    }, { threshold: 0.1 })
    if (ref.current) obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])

  return (
    <div ref={ref} style={{
      opacity: v ? 1 : 0,
      transform: v ? 'translateY(0)' : 'translateY(18px)',
      transition: `opacity 0.65s ease ${delay}ms, transform 0.65s ease ${delay}ms`,
    }}>
      {children}
    </div>
  )
}

// ─── Ticker ────────────────────────────────────────────────────────────────────

function Ticker() {
  const items = [
    'Play-in tournament: GSW vs PHX · ORL vs CHA',
    '574 players tracked', 'Model v14', '3× daily updates',
    'Bayesian shrinkage', 'Positional defense profiles',
    'PER-based breakout analysis', '1M playoff simulations',
    'Normal CDF scoring', 'Exponential decay ratings',
  ]
  const rep = [...items, ...items, ...items]
  return (
    <div style={{ overflow: 'hidden', borderTop: '1px solid #1f1f24',
      borderBottom: '1px solid #1f1f24', padding: '9px 0',
      background: 'rgba(14,14,18,0.9)' }}>
      <div style={{ display: 'flex', gap: '56px', whiteSpace: 'nowrap',
        animation: 'swf-ticker 28s linear infinite' }}>
        {rep.map((item, i) => (
          <span key={i} style={{ fontFamily: MONO, fontSize: '10px',
            color: item.includes('Play-in') ? '#c8f135' : '#55534f',
            letterSpacing: '0.1em', flexShrink: 0 }}>
            {i % items.length === 0 && (
              <span style={{ color: '#c8f135', marginRight: '12px' }}>◆</span>
            )}
            {item.toUpperCase()}
          </span>
        ))}
      </div>
      <style>{`
        @keyframes swf-ticker {
          0%   { transform: translateX(0) }
          100% { transform: translateX(-33.33%) }
        }
      `}</style>
    </div>
  )
}

// ─── Story card ───────────────────────────────────────────────────────────────

interface Story {
  tag: string; headline: string; context: string
  link: string; cta: string; accent: string
}

function buildStories(overall: any, breakout: any, standings: any): Story[] {
  const stories: Story[] = []
  const dimWord: Record<string, string> = {
    scoring: 'has been scoring at will',
    playmaking: 'is facilitating at a new level',
    rebounding: 'is dominating the glass',
    defense: 'is locking opponents down',
    efficiency: 'is playing his most efficient basketball',
    minutes: 'is getting major run',
  }

  const hot = (overall?.hot || []).find((p: any) => p.composite_z >= 1.2)
  if (hot) stories.push({
    tag: 'Hot streak', accent: '#f97316',
    headline: `${hot.player_name} ${dimWord[hot.best_stat] || 'is on a tear'}.`,
    context: 'Production has trended sharply upward over the past two weeks.',
    link: '/insights', cta: 'See all streaks',
  })

  const cold = (overall?.cold || []).find((p: any) => p.composite_z <= -1.2)
  if (cold) stories.push({
    tag: 'Cold streak', accent: '#5b8ef0',
    headline: `${cold.player_name} has gone quiet.`,
    context: 'Output has dipped from his season baseline over recent games.',
    link: '/insights', cta: 'See breakdown',
  })

  const top = breakout?.results?.[0]
  if (top) {
    const dl: Record<string, string> = {
      efficiency: 'overall efficiency', playmaking: 'playmaking',
      rebounding: 'rebounding', defense: 'defensive impact',
      scoring: 'scoring efficiency', minutes: 'role expansion',
    }
    stories.push({
      tag: 'Breakout watch', accent: '#c8f135',
      headline: `${top.player_name} is trending in the right direction.`,
      context: `Model flags a meaningful jump in ${dl[top.lead_dimension] || 'efficiency'} over the last 10 games.`,
      link: '/insights', cta: 'See breakout players',
    })
  }

  // Play-in specific story — it's April 16
  stories.push({
    tag: 'Play-in tonight', accent: '#c8f135',
    headline: 'GSW vs PHX and ORL vs CHA — play-in games still to be decided.',
    context: 'Two 8-seeds remain undecided. Our playoff simulator updates live as results come in.',
    link: '/playoffs', cta: 'See playoff picture',
  })

  stories.push({
    tag: 'Playoffs', accent: '#f97316',
    headline: "The race for the Larry O'Brien is wide open.",
    context: 'Simulate the full postseason from current standings. Up to 1 million scenarios.',
    link: '/playoffs', cta: 'Open simulator',
  })

  if (standings) {
    const all = [...(standings.east || []), ...(standings.west || [])]
    const t = all.filter((t: any) => t.seed >= 5 && t.net_rtg > 3)
      .sort((a: any, b: any) => b.net_rtg - a.net_rtg)[0]
    if (t) stories.push({
      tag: 'Playoff picture', accent: '#f97316',
      headline: `${t.team} are playing above their seed.`,
      context: 'Efficiency metrics point to a team that could be dangerous in the first round.',
      link: '/playoffs', cta: 'See full standings',
    })
  }

  return stories
}

function StoryCarousel({ stories }: { stories: Story[] }) {
  const [idx, setIdx] = useState(0)
  const paused = useRef(false)

  useEffect(() => {
    if (stories.length < 2) return
    const id = setInterval(() => {
      if (!paused.current) setIdx(i => (i + 1) % stories.length)
    }, 7000)
    return () => clearInterval(id)
  }, [stories.length])

  if (!stories.length) return (
    <div style={{ height: 240, display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#141418', borderRadius: 8,
      border: '1px solid #1f1f24' }}>
      <span style={{ fontFamily: MONO, fontSize: 11, color: '#55534f' }}>Loading...</span>
    </div>
  )

  const s = stories[idx]
  return (
    <div onMouseEnter={() => { paused.current = true }}
         onMouseLeave={() => { paused.current = false }}>
      <div style={{ position: 'relative', height: 240, background: '#141418',
        border: '1px solid #1f1f24', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, top: 24, bottom: 24,
          width: 2, background: s.accent, borderRadius: 1,
          transition: 'background 0.4s' }} />
        <div style={{ padding: '28px 36px', height: '100%',
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: s.accent }} />
            <span style={{ fontFamily: MONO, fontSize: 10, color: s.accent,
              letterSpacing: '0.14em', textTransform: 'uppercase' as const }}>
              {s.tag}
            </span>
          </div>
          <div>
            <h2 style={{ fontFamily: SANS, fontSize: 20, fontWeight: 600,
              color: '#f2f0eb', lineHeight: 1.3, marginBottom: 8,
              letterSpacing: '-0.02em', maxWidth: 480 }}>
              {s.headline}
            </h2>
            <p style={{ fontFamily: SANS, fontSize: 13, color: '#8c8a85',
              lineHeight: 1.6, maxWidth: 400 }}>
              {s.context}
            </p>
          </div>
          <Link href={s.link} style={{ fontFamily: MONO, fontSize: 10,
            color: s.accent, letterSpacing: '0.1em',
            textTransform: 'uppercase' as const }}>
            {s.cta} →
          </Link>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
        {['←', '→'].map((a, di) => (
          <button key={a}
            onClick={() => setIdx(i => di === 0
              ? (i - 1 + stories.length) % stories.length
              : (i + 1) % stories.length)}
            style={{ background: 'none', border: '1px solid #1f1f24',
              borderRadius: 4, padding: '3px 9px', color: '#787672',
              fontFamily: MONO, fontSize: 11, transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#f2f0eb'; e.currentTarget.style.borderColor = '#555' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#787672'; e.currentTarget.style.borderColor = '#1f1f24' }}>
            {a}
          </button>
        ))}
        <div style={{ display: 'flex', gap: 4, flex: 1 }}>
          {stories.map((st, i) => (
            <button key={i} onClick={() => setIdx(i)} style={{
              height: 3, width: i === idx ? 18 : 4,
              background: i === idx ? st.accent : '#2a2a32',
              border: 'none', borderRadius: 2, padding: 0,
              transition: 'width 0.3s, background 0.3s',
            }} />
          ))}
        </div>
        <span style={{ fontFamily: MONO, fontSize: 10, color: '#55534f' }}>
          {String(idx + 1).padStart(2, '0')}/{String(stories.length).padStart(2, '0')}
        </span>
      </div>
    </div>
  )
}

// ─── Features ─────────────────────────────────────────────────────────────────

const FEATURES = [
  { label: 'Props Board',   href: '/props',    accent: '#4ade80', icon: '↑',
    desc: 'Distribution-based player prop predictions with Bayesian shrinkage and positional opponent defense.' },
  { label: 'Insights',      href: '/insights', accent: '#c8f135', icon: '◎',
    desc: 'Hot/cold streaks via composite z-scores. PER-based breakout probability for players under 26.' },
  { label: 'Playoff Sim',   href: '/playoffs', accent: '#f97316', icon: '◉',
    desc: 'Monte Carlo simulation from any point in the postseason. Lock completed series. Up to 1M runs.' },
  { label: 'Player Compare',href: '/compare',  accent: '#a78bfa', icon: '↔',
    desc: 'Full head-to-head: season averages, L10 splits, consistency ratings, per-stat edges.' },
  { label: 'Matchup',       href: '/matchup',  accent: '#5b8ef0', icon: '⊕',
    desc: 'Positional defensive profiles for every team. Projected output + historical head-to-head.' },
  { label: 'Profiles',      href: '/profiles', accent: '#34d399', icon: '◈',
    desc: 'Radar chart + game log for 574 players. Sortable by PTS, REB, AST, eFG%, 3P%, and more.' },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [stories, setStories] = useState<Story[]>([])
  const [hov, setHov] = useState<string | null>(null)

  useEffect(() => {
    Promise.allSettled([
      fetch(`${API}/insights/streaks/overall?min_gp=10&limit=10`).then(r => r.json()),
      fetch(`${API}/insights/breakout?limit=5`).then(r => r.json()),
      fetch(`${API}/playoffs/standings`).then(r => r.json()),
    ]).then(([o, b, s]) => setStories(buildStories(
      o.status === 'fulfilled' ? o.value : null,
      b.status === 'fulfilled' ? b.value : null,
      s.status === 'fulfilled' ? s.value : null,
    )))
  }, [])

  return (
    <div>
      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section style={{ position: 'relative', minHeight: 580, overflow: 'hidden',
        background: '#0c0c0e' }}>
        {/* Dot grid fills the section */}
        <DotGrid height={580} />

        {/* Bottom fade */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
          height: 180, pointerEvents: 'none', zIndex: 1,
          background: 'linear-gradient(transparent, #0c0c0e)' }} />

        {/* Hero content */}
        <div style={{ position: 'relative', zIndex: 2,
          maxWidth: 1100, margin: '0 auto', padding: '72px 28px 56px',
          display: 'grid', gridTemplateColumns: '1fr 280px', gap: 40,
          alignItems: 'start' }}>

          {/* Left */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center',
              gap: 14, marginBottom: 36 }}>
              <span style={{ fontFamily: MONO, fontSize: 10, color: '#787672',
                letterSpacing: '0.12em', textTransform: 'uppercase' as const }}>
                {new Date().toLocaleDateString('en-US', {
                  weekday: 'long', month: 'long', day: 'numeric',
                })}
              </span>
              <div style={{ flex: 1, height: 1, background: '#1f1f24' }} />
              <span style={{ fontFamily: MONO, fontSize: 10, color: '#55534f',
                letterSpacing: '0.08em' }}>
                2025–26 · Play-in
              </span>
            </div>

            <h1 style={{ fontFamily: SANS, fontWeight: 300, fontSize: 52,
              lineHeight: 1.1, letterSpacing: '-0.03em', color: '#f2f0eb',
              marginBottom: 20 }}>
              <Decrypt text="NBA intelligence," delay={100} />
              <br />
              <Decrypt text="updated daily." delay={500}
                style={{ color: '#c8f135', fontWeight: 600 }} />
            </h1>

            <p style={{ fontFamily: SANS, fontSize: 15, color: '#8c8a85',
              lineHeight: 1.75, maxWidth: 420, marginBottom: 40 }}>
              Streaks, breakouts, playoff odds, matchup difficulty — built on
              play-by-play data and refreshed three times daily.
            </p>

            <div style={{ marginBottom: 12, display: 'flex',
              justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: MONO, fontSize: 10, color: '#55534f',
                letterSpacing: '0.14em', textTransform: 'uppercase' as const }}>
                Today's intelligence
              </span>
              <Link href="/insights" style={{ fontFamily: MONO, fontSize: 10,
                color: '#55534f', letterSpacing: '0.1em',
                transition: 'color 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#c8f135')}
                onMouseLeave={e => (e.currentTarget.style.color = '#55534f')}>
                All insights →
              </Link>
            </div>
            <StoryCarousel stories={stories} />
          </div>

          {/* Right — frosted stats */}
          <div style={{ paddingTop: 80 }}>
            <div style={{ background: 'rgba(14,14,18,0.75)',
              backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid #1f1f24', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '12px 18px', borderBottom: '1px solid #1f1f24' }}>
                <span style={{ fontFamily: MONO, fontSize: 10, color: '#787672',
                  letterSpacing: '0.12em', textTransform: 'uppercase' as const }}>
                  Platform
                </span>
              </div>
              {[
                { to: 574,     sfx: '',    label: 'Players tracked' },
                { to: 3,       sfx: '×',   label: 'Daily ETL updates' },
                { to: 23997,   sfx: '',    label: 'Game logs · 2025–26' },
                { to: 540,     sfx: '',    label: 'Defensive profiles' },
                { to: 1000000, sfx: '',    label: 'Max playoff sims' },
              ].map((item, i, arr) => (
                <div key={item.label} style={{ display: 'flex',
                  justifyContent: 'space-between', alignItems: 'center',
                  padding: '12px 18px',
                  borderBottom: i < arr.length - 1 ? '1px solid #1a1a20' : 'none' }}>
                  <span style={{ fontFamily: SANS, fontSize: 12, color: '#8c8a85' }}>
                    {item.label}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 14,
                    fontWeight: 500, color: '#f2f0eb' }}>
                    <CountUp to={item.to} suffix={item.sfx} />
                  </span>
                </div>
              ))}
            </div>

            {/* Play-in alert */}
            <div style={{ marginTop: 12, padding: '12px 16px',
              background: 'rgba(200,241,53,0.06)',
              border: '1px solid rgba(200,241,53,0.2)',
              borderRadius: 6 }}>
              <div style={{ fontFamily: MONO, fontSize: 9, color: '#c8f135',
                letterSpacing: '0.14em', marginBottom: 6 }}>PLAY-IN · APRIL 2026</div>
              <div style={{ fontFamily: SANS, fontSize: 12, color: '#b0aea8',
                lineHeight: 1.6 }}>
                GSW vs PHX and ORL vs CHA — two 8-seeds still to be decided.
              </div>
              <Link href="/playoffs" style={{ fontFamily: MONO, fontSize: 10,
                color: '#c8f135', letterSpacing: '0.08em',
                display: 'inline-block', marginTop: 8 }}>
                See playoff picture →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── TICKER ────────────────────────────────────────────────────────── */}
      <Ticker />

      {/* ── FEATURES ─────────────────────────────────────────────────────── */}
      <section style={{ maxWidth: 1100, margin: '0 auto', padding: '72px 28px' }}>
        <Fade>
          <div style={{ marginBottom: 48 }}>
            <span style={{ fontFamily: MONO, fontSize: 10, color: '#787672',
              letterSpacing: '0.14em', textTransform: 'uppercase' as const }}>
              What's inside
            </span>
            <h2 style={{ fontFamily: SANS, fontSize: 34, fontWeight: 300,
              color: '#f2f0eb', marginTop: 10, letterSpacing: '-0.025em',
              lineHeight: 1.15 }}>
              Six tools.<br />One picture of the NBA.
            </h2>
          </div>
        </Fade>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 1, background: '#1f1f24', border: '1px solid #1f1f24',
          borderRadius: 8, overflow: 'hidden' }}>
          {FEATURES.map((f, i) => (
            <Link key={f.href} href={f.href} style={{ display: 'block' }}>
              <Fade delay={i * 55}>
                <div style={{ padding: '28px 24px', background: '#0c0c0e',
                  height: '100%', transition: 'background 0.2s' }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = '#141418'
                    setHov(f.label)
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = '#0c0c0e'
                    setHov(null)
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center',
                    gap: 10, marginBottom: 14 }}>
                    <span style={{ fontFamily: MONO, fontSize: 20, color: f.accent,
                      display: 'inline-block', lineHeight: 1,
                      transition: 'transform 0.2s',
                      transform: hov === f.label ? 'scale(1.25)' : 'scale(1)' }}>
                      {f.icon}
                    </span>
                    <span style={{ fontFamily: SANS, fontSize: 14,
                      fontWeight: 600, color: '#f2f0eb' }}>{f.label}</span>
                  </div>
                  <p style={{ fontFamily: SANS, fontSize: 13, color: '#8c8a85',
                    lineHeight: 1.65, marginBottom: 20 }}>{f.desc}</p>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: f.accent,
                    display: 'inline-block', transition: 'transform 0.2s',
                    transform: hov === f.label ? 'translateX(4px)' : 'translateX(0)' }}>
                    Explore →
                  </span>
                </div>
              </Fade>
            </Link>
          ))}
        </div>
      </section>

      {/* ── STATS ─────────────────────────────────────────────────────────── */}
      <section style={{ background: '#0e0e12', borderTop: '1px solid #1f1f24',
        borderBottom: '1px solid #1f1f24' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '64px 28px' }}>
          <Fade>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)',
              gap: 1, background: '#1f1f24', border: '1px solid #1f1f24',
              borderRadius: 8, overflow: 'hidden' }}>
              {[
                { to: 574,     sfx: '',   label: 'Players tracked',    sub: '2025–26 season' },
                { to: 23997,   sfx: '',   label: 'Game logs',          sub: 'Through April 2026' },
                { to: 540,     sfx: '',   label: 'Defensive profiles', sub: 'By G / F / C' },
                { to: 1000000, sfx: '',   label: 'Max sims',           sub: 'Playoff simulator' },
              ].map(item => (
                <div key={item.label} style={{ padding: '36px 28px',
                  background: '#0e0e12', textAlign: 'center' }}>
                  <div style={{ fontFamily: MONO, fontSize: 34,
                    fontWeight: 500, color: '#c8f135', marginBottom: 8 }}>
                    <CountUp to={item.to} suffix={item.sfx} />
                  </div>
                  <div style={{ fontFamily: SANS, fontSize: 14,
                    fontWeight: 500, color: '#f2f0eb', marginBottom: 4 }}>
                    {item.label}
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 10,
                    color: '#787672', letterSpacing: '0.08em' }}>
                    {item.sub}
                  </div>
                </div>
              ))}
            </div>
          </Fade>
        </div>
      </section>

      {/* ── METHOD ────────────────────────────────────────────────────────── */}
      <section style={{ maxWidth: 1100, margin: '0 auto', padding: '72px 28px' }}>
        <Fade>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr',
            gap: 64, alignItems: 'start' }}>
            <div>
              <span style={{ fontFamily: MONO, fontSize: 10, color: '#787672',
                letterSpacing: '0.14em', textTransform: 'uppercase' as const }}>
                Methodology
              </span>
              <h2 style={{ fontFamily: SANS, fontSize: 28, fontWeight: 300,
                color: '#f2f0eb', marginTop: 10, letterSpacing: '-0.02em',
                lineHeight: 1.3 }}>
                Built on the math,<br />not the narrative.
              </h2>
              <p style={{ fontFamily: SANS, fontSize: 14, color: '#8c8a85',
                lineHeight: 1.75, marginTop: 16, marginBottom: 20 }}>
                No hot takes. No vibes. Exponentially-weighted ratings,
                distribution-based prediction, and position-adjusted defense.
              </p>
              <Link href="/about" style={{ fontFamily: MONO, fontSize: 11,
                color: '#c8f135', letterSpacing: '0.1em',
                textTransform: 'uppercase' as const }}>
                Read the full methodology →
              </Link>
            </div>
            <div>
              {[
                { l: 'Bayesian shrinkage',       d: 'Regresses small samples toward position averages.' },
                { l: 'Positional defense',        d: "Each team's allowed stats by G/F/C position bucket." },
                { l: 'Normal CDF scoring',        d: 'Models each line as a probability using predicted mean + variance.' },
                { l: 'Usage redistribution',      d: 'Absent teammate possessions reallocated to active players.' },
                { l: 'Exponential decay ratings', d: 'Recent games weighted more heavily than early season.' },
                { l: 'Monte Carlo playoff sim',   d: 'Win probability via logistic model, run N times from any state.' },
              ].map((p, i, arr) => (
                <Fade key={p.l} delay={i * 70}>
                  <div style={{ padding: '15px 0',
                    borderBottom: i < arr.length - 1 ? '1px solid #1a1a20' : 'none' }}>
                    <div style={{ fontFamily: SANS, fontSize: 13,
                      fontWeight: 500, color: '#f2f0eb', marginBottom: 3 }}>
                      {p.l}
                    </div>
                    <div style={{ fontFamily: SANS, fontSize: 13, color: '#8c8a85' }}>
                      {p.d}
                    </div>
                  </div>
                </Fade>
              ))}
            </div>
          </div>
        </Fade>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────────────── */}
      <div style={{ borderTop: '1px solid #1f1f24', maxWidth: 1100,
        margin: '0 auto', padding: '28px 28px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: MONO, fontSize: 12, color: '#c8f135',
          fontWeight: 500, letterSpacing: '0.12em' }}>SWINGFACTR</span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: '#55534f',
          letterSpacing: '0.08em' }}>
          2025–26 NBA · Play-in round · Updated 3× daily
        </span>
      </div>
    </div>
  )
}
