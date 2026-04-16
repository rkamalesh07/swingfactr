'use client'

import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import Link from 'next/link'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const MONO = "'DM Mono', monospace"
const SANS = "'Inter', sans-serif"

// Lazy load heavy WebGL components
const LiquidChrome = lazy(() => import('@/components/LiquidChrome'))
const BlobCursor   = lazy(() => import('@/components/BlobCursor'))

// ─── Decrypt ──────────────────────────────────────────────────────────────────

function Decrypt({ text, delay = 0, style = {} }: {
  text: string; delay?: number; style?: React.CSSProperties
}) {
  const [out, setOut] = useState(text)
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  useEffect(() => {
    let iter = 0
    const t = setTimeout(() => {
      const iv = setInterval(() => {
        setOut(text.split('').map((c, i) => {
          if (c === ' ') return ' '
          if (i < iter) return text[i]
          return CHARS[Math.floor(Math.random() * CHARS.length)]
        }).join(''))
        iter += 0.5
        if (iter > text.length) clearInterval(iv)
      }, 32)
    }, delay)
    return () => clearTimeout(t)
  }, [text, delay])
  return <span style={style}>{out}</span>
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
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / 1600)
        setN(Math.round((1 - (1 - p) ** 3) * to))
        if (p < 1) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }, { threshold: 0.4 })
    if (el.current) obs.observe(el.current)
    return () => obs.disconnect()
  }, [to])
  return <span ref={el}>{n >= 1000 ? n.toLocaleString() : n}{suffix}</span>
}

// ─── Fade in ──────────────────────────────────────────────────────────────────

function Fade({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [v, setV] = useState(false)
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setV(true); obs.disconnect() }
    }, { threshold: 0.08 })
    if (ref.current) obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])
  return (
    <div ref={ref} style={{
      opacity: v ? 1 : 0,
      transform: v ? 'translateY(0)' : 'translateY(16px)',
      transition: `opacity 0.6s ease ${delay}ms, transform 0.6s ease ${delay}ms`,
    }}>{children}</div>
  )
}

// ─── Ticker ────────────────────────────────────────────────────────────────────

function Ticker() {
  const items = [
    'Play-in: GSW vs PHX · ORL vs CHA pending',
    '574 players tracked', 'Model v14 · Bayesian shrinkage',
    '3× daily updates', 'Positional defense profiles',
    'PER-based breakout analysis', '1M playoff simulations',
  ]
  const rep = [...items, ...items, ...items]
  return (
    <div style={{ overflow: 'hidden', borderTop: '1px solid #111',
      borderBottom: '1px solid #111', padding: '9px 0', background: '#000' }}>
      <div style={{ display: 'flex', gap: '48px', whiteSpace: 'nowrap',
        animation: 'swf-ticker 28s linear infinite' }}>
        {rep.map((item, i) => (
          <span key={i} style={{ fontFamily: MONO, fontSize: '10px', flexShrink: 0,
            color: item.includes('Play-in') ? '#888' : '#333',
            letterSpacing: '0.1em' }}>
            {i % items.length === 0 && <span style={{ color: '#333', marginRight: '10px' }}>◆</span>}
            {item.toUpperCase()}
          </span>
        ))}
      </div>
      <style>{`@keyframes swf-ticker{0%{transform:translateX(0)}100%{transform:translateX(-33.33%)}}`}</style>
    </div>
  )
}

// ─── Stories ──────────────────────────────────────────────────────────────────

interface Story { tag: string; headline: string; context: string; link: string; cta: string }

function buildStories(overall: any, breakout: any): Story[] {
  const stories: Story[] = []
  const dimWord: Record<string, string> = {
    scoring: 'has been scoring at will', playmaking: 'is facilitating at a new level',
    rebounding: 'is dominating the glass', defense: 'is locking opponents down',
    efficiency: 'is playing his most efficient basketball', minutes: 'is getting major run',
  }
  const hot = (overall?.hot || []).find((p: any) => p.composite_z >= 1.2)
  if (hot) stories.push({
    tag: 'Hot streak',
    headline: `${hot.player_name} ${dimWord[hot.best_stat] || 'is on a tear'}.`,
    context: 'Production has trended sharply upward over the past two weeks.',
    link: '/insights', cta: 'See all streaks',
  })
  const cold = (overall?.cold || []).find((p: any) => p.composite_z <= -1.2)
  if (cold) stories.push({
    tag: 'Cold streak',
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
      tag: 'Breakout watch',
      headline: `${top.player_name} is trending in the right direction.`,
      context: `Model flags a meaningful jump in ${dl[top.lead_dimension] || 'efficiency'} over the last 10 games.`,
      link: '/insights', cta: 'See breakout players',
    })
  }
  stories.push({
    tag: 'Play-in · April 2026',
    headline: 'GSW vs PHX and ORL vs CHA — two 8-seeds still to be decided.',
    context: 'Playoff simulator updates as results come in.',
    link: '/playoffs', cta: 'See playoff picture',
  })
  stories.push({
    tag: 'Playoffs',
    headline: "The race for the Larry O'Brien is wide open.",
    context: 'Simulate the full postseason from current standings. Up to 1M scenarios.',
    link: '/playoffs', cta: 'Open simulator',
  })
  return stories
}

function Carousel({ stories }: { stories: Story[] }) {
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
    <div style={{ height: 220, display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#0a0a0a', borderRadius: 6,
      border: '1px solid #111' }}>
      <span style={{ fontFamily: MONO, fontSize: 11, color: '#333' }}>Loading...</span>
    </div>
  )
  const s = stories[idx]
  return (
    <div onMouseEnter={() => { paused.current = true }} onMouseLeave={() => { paused.current = false }}>
      <div style={{ position: 'relative', height: 220, background: 'rgba(8,8,8,0.9)',
        border: '1px solid #1a1a1a', borderRadius: 6, overflow: 'hidden',
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}>
        <div style={{ position: 'absolute', left: 0, top: 20, bottom: 20,
          width: 1, background: '#fff', opacity: 0.06 }} />
        <div style={{ padding: '24px 32px', height: '100%',
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: MONO, fontSize: 9, color: '#444',
            letterSpacing: '0.18em', textTransform: 'uppercase' as const }}>{s.tag}</span>
          <div>
            <h2 style={{ fontFamily: SANS, fontSize: 19, fontWeight: 500,
              color: '#f0f0f0', lineHeight: 1.3, marginBottom: 8,
              letterSpacing: '-0.02em', maxWidth: 460 }}>{s.headline}</h2>
            <p style={{ fontFamily: SANS, fontSize: 13, color: '#555',
              lineHeight: 1.6, maxWidth: 400 }}>{s.context}</p>
          </div>
          <Link href={s.link} style={{ fontFamily: MONO, fontSize: 10,
            color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase' as const,
            transition: 'color 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
            onMouseLeave={e => (e.currentTarget.style.color = '#444')}>
            {s.cta} →
          </Link>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        {['←', '→'].map((a, di) => (
          <button key={a}
            onClick={() => setIdx(i => di === 0 ? (i - 1 + stories.length) % stories.length : (i + 1) % stories.length)}
            style={{ background: 'none', border: '1px solid #1a1a1a', borderRadius: 4,
              padding: '3px 9px', color: '#333', fontFamily: MONO, fontSize: 11,
              transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = '#444' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#333'; e.currentTarget.style.borderColor = '#1a1a1a' }}>
            {a}
          </button>
        ))}
        <div style={{ display: 'flex', gap: 4, flex: 1 }}>
          {stories.map((_, i) => (
            <button key={i} onClick={() => setIdx(i)} style={{
              height: 2, width: i === idx ? 16 : 4,
              background: i === idx ? '#fff' : '#222',
              border: 'none', borderRadius: 1, padding: 0,
              transition: 'width 0.3s, background 0.3s',
            }} />
          ))}
        </div>
        <span style={{ fontFamily: MONO, fontSize: 10, color: '#333' }}>
          {String(idx + 1).padStart(2, '0')}/{String(stories.length).padStart(2, '0')}
        </span>
      </div>
    </div>
  )
}

// ─── Features ─────────────────────────────────────────────────────────────────

const FEATURES = [
  { label: 'Insights',    href: '/insights', icon: '↑', desc: 'Hot/cold streaks via composite z-scores. PER-based breakout probability for players under 26.' },
  { label: 'Playoff Sim', href: '/playoffs', icon: '◎', desc: 'Monte Carlo from current standings. Lock completed series. Up to 1M runs.' },
  { label: 'Matchup',     href: '/matchup',  icon: '⊕', desc: 'Positional defensive profiles for every team. Projected output + historical head-to-head.' },
  { label: 'Compare',     href: '/compare',  icon: '↔', desc: 'Full head-to-head: season averages, L10 splits, consistency ratings, per-stat edges.' },
  { label: 'Profiles',    href: '/profiles', icon: '◈', desc: 'Radar chart + game log for 574 players. Sort by PTS, REB, AST, eFG%, 3P%, and more.' },
  { label: 'Props Board', href: '/props',    icon: '◐', desc: 'Distribution-based predictions with Bayesian shrinkage and positional opponent defense.' },
]

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [stories, setStories] = useState<Story[]>([])
  const [hov, setHov] = useState<string | null>(null)

  useEffect(() => {
    Promise.allSettled([
      fetch(`${API}/insights/streaks/overall?min_gp=10&limit=10`).then(r => r.json()),
      fetch(`${API}/insights/breakout?limit=5`).then(r => r.json()),
    ]).then(([o, b]) => setStories(buildStories(
      o.status === 'fulfilled' ? o.value : null,
      b.status === 'fulfilled' ? b.value : null,
    )))
  }, [])

  return (
    <>
      {/* Blob cursor — fixed overlay */}
      <Suspense fallback={null}>
        <BlobCursor
          fillColor="#ffffff"
          trailCount={3}
          sizes={[50, 100, 65]}
          innerSizes={[16, 28, 18]}
          innerColor="rgba(0,0,0,0.5)"
          opacities={[0.15, 0.08, 0.12]}
          filterStdDeviation={25}
          zIndex={9999}
        />
      </Suspense>

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section style={{ position: 'relative', minHeight: 620, overflow: 'hidden', background: '#000' }}>

        {/* LiquidChrome fills the entire hero */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
          <Suspense fallback={<div style={{ width: '100%', height: '100%', background: '#000' }} />}>
            <LiquidChrome
              baseColor={[0.07, 0.07, 0.07]}
              speed={0.35}
              amplitude={0.45}
              frequencyX={2.8}
              frequencyY={1.8}
              interactive={true}
            />
          </Suspense>
        </div>

        {/* Gradient overlays — darken edges so text is readable */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none',
          background: 'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.7) 100%)' }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 220,
          background: 'linear-gradient(transparent, #000)', zIndex: 1, pointerEvents: 'none' }} />

        {/* Hero content */}
        <div style={{ position: 'relative', zIndex: 2, maxWidth: 1100,
          margin: '0 auto', padding: '88px 28px 64px',
          display: 'grid', gridTemplateColumns: '1fr 280px', gap: 40, alignItems: 'start' }}>

          <div>
            {/* Date */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 40 }}>
              <span style={{ fontFamily: MONO, fontSize: 10, color: '#555',
                letterSpacing: '0.12em', textTransform: 'uppercase' as const }}>
                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </span>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.06)' }} />
              <span style={{ fontFamily: MONO, fontSize: 10, color: '#333', letterSpacing: '0.08em' }}>
                2025–26 · Play-in
              </span>
            </div>

            {/* Headline */}
            <h1 style={{ fontFamily: SANS, fontWeight: 200, fontSize: 58,
              lineHeight: 1.05, letterSpacing: '-0.04em', color: '#fff',
              marginBottom: 20, textShadow: '0 2px 40px rgba(0,0,0,0.8)' }}>
              <Decrypt text="NBA intelligence," delay={100} />
              <br />
              <Decrypt text="updated daily." delay={500} style={{ fontWeight: 600 }} />
            </h1>

            <p style={{ fontFamily: SANS, fontSize: 15, color: '#666',
              lineHeight: 1.75, maxWidth: 420, marginBottom: 44 }}>
              Streaks, breakouts, playoff odds, matchup difficulty — built on
              play-by-play data and refreshed three times daily.
            </p>

            {/* Feed header */}
            <div style={{ display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontFamily: MONO, fontSize: 9, color: '#333',
                letterSpacing: '0.18em', textTransform: 'uppercase' as const }}>
                Today's intelligence
              </span>
              <Link href="/insights" style={{ fontFamily: MONO, fontSize: 9,
                color: '#333', letterSpacing: '0.12em',
                textTransform: 'uppercase' as const, transition: 'color 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
                onMouseLeave={e => (e.currentTarget.style.color = '#333')}>
                All insights →
              </Link>
            </div>
            <Carousel stories={stories} />
          </div>

          {/* Right sidebar */}
          <div style={{ paddingTop: 96 }}>
            <div style={{ background: 'rgba(5,5,5,0.85)',
              backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
              border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '12px 18px',
                borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ fontFamily: MONO, fontSize: 9, color: '#333',
                  letterSpacing: '0.16em', textTransform: 'uppercase' as const }}>Platform</span>
              </div>
              {[
                { to: 574,     sfx: '',  label: 'Players tracked' },
                { to: 3,       sfx: '×', label: 'Daily ETL updates' },
                { to: 23997,   sfx: '',  label: 'Game logs · 2025–26' },
                { to: 540,     sfx: '',  label: 'Defensive profiles' },
                { to: 1000000, sfx: '',  label: 'Max playoff sims' },
              ].map((item, i, arr) => (
                <div key={item.label} style={{ display: 'flex',
                  justifyContent: 'space-between', alignItems: 'center',
                  padding: '12px 18px',
                  borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none' }}>
                  <span style={{ fontFamily: SANS, fontSize: 12, color: '#555' }}>{item.label}</span>
                  <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 500, color: '#e0e0e0' }}>
                    <CountUp to={item.to} suffix={item.sfx} />
                  </span>
                </div>
              ))}
            </div>

            {/* Play-in card */}
            <div style={{ marginTop: 12, padding: '14px 16px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6 }}>
              <div style={{ fontFamily: MONO, fontSize: 9, color: '#444',
                letterSpacing: '0.16em', marginBottom: 8,
                textTransform: 'uppercase' as const }}>Play-in · April 2026</div>
              <div style={{ fontFamily: SANS, fontSize: 12, color: '#666', lineHeight: 1.6 }}>
                GSW vs PHX and ORL vs CHA —<br />two 8-seeds still to be decided.
              </div>
              <Link href="/playoffs" style={{ fontFamily: MONO, fontSize: 9, color: '#555',
                letterSpacing: '0.1em', display: 'inline-block', marginTop: 8,
                textTransform: 'uppercase' as const, transition: 'color 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
                onMouseLeave={e => (e.currentTarget.style.color = '#555')}>
                See playoff picture →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── TICKER ───────────────────────────────────────────────────────── */}
      <Ticker />

      {/* ── FEATURES ─────────────────────────────────────────────────────── */}
      <section style={{ background: '#000', maxWidth: 1100, margin: '0 auto', padding: '80px 28px' }}>
        <Fade>
          <div style={{ marginBottom: 52 }}>
            <span style={{ fontFamily: MONO, fontSize: 9, color: '#333',
              letterSpacing: '0.18em', textTransform: 'uppercase' as const }}>
              What's inside
            </span>
            <h2 style={{ fontFamily: SANS, fontSize: 38, fontWeight: 200,
              color: '#fff', marginTop: 10, letterSpacing: '-0.03em', lineHeight: 1.1 }}>
              Six tools.<br />One picture of the NBA.
            </h2>
          </div>
        </Fade>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)',
          gap: 1, background: '#111', border: '1px solid #111',
          borderRadius: 8, overflow: 'hidden' }}>
          {FEATURES.map((f, i) => (
            <Link key={f.href} href={f.href} style={{ display: 'block' }}>
              <Fade delay={i * 55}>
                <div style={{ padding: '28px 24px', background: '#000', height: '100%',
                  transition: 'background 0.2s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#080808'; setHov(f.label) }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#000'; setHov(null) }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <span style={{ fontFamily: MONO, fontSize: 18, color: '#fff',
                      display: 'inline-block', lineHeight: 1, opacity: 0.5,
                      transition: 'opacity 0.2s, transform 0.2s',
                      transform: hov === f.label ? 'scale(1.2)' : 'scale(1)',
                      ...(hov === f.label ? { opacity: 1 } : {}),
                    }}>{f.icon}</span>
                    <span style={{ fontFamily: SANS, fontSize: 14, fontWeight: 500,
                      color: '#e8e8e8' }}>{f.label}</span>
                  </div>
                  <p style={{ fontFamily: SANS, fontSize: 13, color: '#444',
                    lineHeight: 1.65, marginBottom: 20 }}>{f.desc}</p>
                  <span style={{ fontFamily: MONO, fontSize: 9, color: '#333',
                    display: 'inline-block', letterSpacing: '0.1em',
                    transition: 'transform 0.2s, color 0.2s',
                    transform: hov === f.label ? 'translateX(4px)' : 'translateX(0)',
                    ...(hov === f.label ? { color: '#aaa' } : {}),
                  }}>EXPLORE →</span>
                </div>
              </Fade>
            </Link>
          ))}
        </div>
      </section>

      {/* ── STATS ────────────────────────────────────────────────────────── */}
      <section style={{ background: '#050505', borderTop: '1px solid #111', borderBottom: '1px solid #111' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '64px 28px' }}>
          <Fade>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)',
              gap: 1, background: '#111', border: '1px solid #111',
              borderRadius: 8, overflow: 'hidden' }}>
              {[
                { to: 574,     sfx: '', label: 'Players tracked',    sub: '2025–26 season' },
                { to: 23997,   sfx: '', label: 'Game logs',          sub: 'Through April 2026' },
                { to: 540,     sfx: '', label: 'Defensive profiles', sub: 'By G / F / C' },
                { to: 1000000, sfx: '', label: 'Max simulations',    sub: 'Playoff simulator' },
              ].map(item => (
                <div key={item.label} style={{ padding: '36px 24px',
                  background: '#050505', textAlign: 'center' }}>
                  <div style={{ fontFamily: MONO, fontSize: 34,
                    fontWeight: 500, color: '#fff', marginBottom: 8 }}>
                    <CountUp to={item.to} suffix={item.sfx} />
                  </div>
                  <div style={{ fontFamily: SANS, fontSize: 14,
                    fontWeight: 400, color: '#aaa', marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontFamily: MONO, fontSize: 9,
                    color: '#333', letterSpacing: '0.1em' }}>{item.sub}</div>
                </div>
              ))}
            </div>
          </Fade>
        </div>
      </section>

      {/* ── METHODOLOGY ──────────────────────────────────────────────────── */}
      <section style={{ maxWidth: 1100, margin: '0 auto', padding: '80px 28px' }}>
        <Fade>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 64, alignItems: 'start' }}>
            <div>
              <span style={{ fontFamily: MONO, fontSize: 9, color: '#333',
                letterSpacing: '0.18em', textTransform: 'uppercase' as const }}>Methodology</span>
              <h2 style={{ fontFamily: SANS, fontSize: 30, fontWeight: 200,
                color: '#fff', marginTop: 10, letterSpacing: '-0.025em', lineHeight: 1.3 }}>
                Built on the math,<br />not the narrative.
              </h2>
              <p style={{ fontFamily: SANS, fontSize: 14, color: '#444',
                lineHeight: 1.75, marginTop: 16, marginBottom: 24 }}>
                No hot takes. No vibes. Exponentially-weighted ratings,
                distribution-based prediction, and position-adjusted defense.
              </p>
              <Link href="/about" style={{ fontFamily: MONO, fontSize: 10, color: '#555',
                letterSpacing: '0.1em', textTransform: 'uppercase' as const, transition: 'color 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
                onMouseLeave={e => (e.currentTarget.style.color = '#555')}>
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
                  <div style={{ padding: '14px 0',
                    borderBottom: i < arr.length - 1 ? '1px solid #0f0f0f' : 'none' }}>
                    <div style={{ fontFamily: SANS, fontSize: 13,
                      fontWeight: 500, color: '#ccc', marginBottom: 3 }}>{p.l}</div>
                    <div style={{ fontFamily: SANS, fontSize: 13, color: '#444' }}>{p.d}</div>
                  </div>
                </Fade>
              ))}
            </div>
          </div>
        </Fade>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────────── */}
      <div style={{ borderTop: '1px solid #0f0f0f', maxWidth: 1100, margin: '0 auto',
        padding: '28px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: MONO, fontSize: 12, color: '#fff',
          fontWeight: 500, letterSpacing: '0.16em' }}>SWINGFACTR</span>
        <span style={{ fontFamily: MONO, fontSize: 9, color: '#2a2a2a',
          letterSpacing: '0.1em' }}>2025–26 NBA · Play-in round · Updated 3× daily</span>
      </div>
    </>
  )
}
