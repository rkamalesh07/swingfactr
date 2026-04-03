'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Story {
  tag: string; headline: string; context: string
  link: string; cta: string; accent: string
}

// ─── Story builder ────────────────────────────────────────────────────────────

function buildStories(overall: any, breakout: any, standings: any): Story[] {
  const stories: Story[] = []

  const hot = (overall?.hot || []).filter((p: any) => p.composite_z >= 1.2)[0]
  if (hot) {
    const dimWord: Record<string,string> = {
      scoring:'has been scoring at will', playmaking:'is facilitating at a new level',
      rebounding:'is dominating the glass', defense:'is locking opponents down',
      efficiency:'is playing his most efficient basketball', minutes:'is getting major run and delivering',
    }
    stories.push({
      tag: 'Hot streak', accent: '#f97316',
      headline: `${hot.player_name} ${dimWord[hot.best_stat] || 'is on a tear'}.`,
      context: 'Production has trended sharply upward over the past two weeks.',
      link: '/insights', cta: 'See all streaks',
    })
  }

  const cold = (overall?.cold || []).filter((p: any) => p.composite_z <= -1.2)[0]
  if (cold) {
    stories.push({
      tag: 'Cold streak', accent: '#5b8ef0',
      headline: `${cold.player_name} has gone quiet.`,
      context: 'Output has dipped from his season baseline over recent games.',
      link: '/insights', cta: 'See breakdown',
    })
  }

  const top = breakout?.results?.[0]
  if (top) {
    const dimLabel: Record<string,string> = {
      efficiency:'efficiency', playmaking:'playmaking', rebounding:'rebounding',
      defense:'defensive impact', scoring:'scoring efficiency', minutes:'role expansion',
    }
    stories.push({
      tag: 'Breakout watch', accent: '#c8f135',
      headline: `${top.player_name} is trending in the right direction.`,
      context: `Our model flags a meaningful jump in ${dimLabel[top.lead_dimension] || 'efficiency'} over the last 10 games.`,
      link: '/insights', cta: 'See breakout players',
    })
  }

  stories.push({
    tag: 'Playoffs', accent: '#c8f135',
    headline: "The race for the Larry O'Brien is wide open.",
    context: 'Simulate the full postseason from current standings. Up to 1 million scenarios.',
    link: '/playoffs', cta: 'Open simulator',
  })

  if (standings) {
    const all = [...(standings.east||[]), ...(standings.west||[])]
    const t = all.filter((t:any) => t.seed >= 5 && t.net_rtg > 3).sort((a:any,b:any) => b.net_rtg - a.net_rtg)[0]
    if (t) stories.push({
      tag: 'Playoff picture', accent: '#f97316',
      headline: `${t.team} are playing above their seed.`,
      context: 'Efficiency metrics point to a team that could be dangerous come April.',
      link: '/playoffs', cta: 'See full standings',
    })
  }

  return stories
}

// ─── Carousel ─────────────────────────────────────────────────────────────────

function Carousel({ stories }: { stories: Story[] }) {
  const [idx, setIdx] = useState(0)
  const pausedRef = useRef(false)

  useEffect(() => {
    if (stories.length < 2) return
    const id = setInterval(() => {
      if (!pausedRef.current) setIdx(i => (i + 1) % stories.length)
    }, 7000)
    return () => clearInterval(id)
  }, [stories.length])

  if (!stories.length) return (
    <div style={{ height: '260px', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#141418', borderRadius: '8px',
      border: '1px solid #222228' }}>
      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '11px', color: '#b0aea8' }}>
        Loading...
      </span>
    </div>
  )

  const s = stories[idx]

  return (
    <div onMouseEnter={() => { pausedRef.current = true }}
         onMouseLeave={() => { pausedRef.current = false }}>
      <div style={{ position: 'relative', height: '260px', background: '#141418',
        border: '1px solid #222228', borderRadius: '8px', overflow: 'hidden' }}>
        {/* Left accent */}
        <div style={{ position: 'absolute', left: 0, top: '24px', bottom: '24px',
          width: '2px', background: s.accent, transition: 'background 0.5s', borderRadius: '1px' }} />

        {/* Content */}
        <div style={{ padding: '32px 40px', height: '100%',
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: s.accent }} />
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '10px',
              color: s.accent, letterSpacing: '0.14em', textTransform: 'uppercase' as const }}>
              {s.tag}
            </span>
          </div>

          <div>
            <h2 style={{ fontFamily: 'Inter, sans-serif', fontSize: '22px', fontWeight: 600,
              color: '#f2f0eb', lineHeight: 1.3, marginBottom: '10px', letterSpacing: '-0.02em',
              maxWidth: '500px' }}>
              {s.headline}
            </h2>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '13px', color: '#8c8a85',
              lineHeight: 1.6, maxWidth: '420px' }}>
              {s.context}
            </p>
          </div>

          <Link href={s.link} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px',
            fontFamily: 'DM Mono, monospace', fontSize: '11px', color: s.accent,
            letterSpacing: '0.1em', textTransform: 'uppercase' as const }}>
            {s.cta} →
          </Link>
        </div>
      </div>

      {/* Dots + counter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px' }}>
        {['←','→'].map((a, di) => (
          <button key={a} onClick={() => setIdx(i => di===0?(i-1+stories.length)%stories.length:(i+1)%stories.length)}
            style={{ background:'none', border:'1px solid #2e2e36', borderRadius:'4px',
              padding:'4px 10px', cursor:'pointer', color:'#b0aea8', fontSize:'12px',
              fontFamily:'DM Mono, monospace', transition:'all 0.15s' }}
            onMouseEnter={e=>{e.currentTarget.style.color='#f2f0eb';e.currentTarget.style.borderColor='#555'}}
            onMouseLeave={e=>{e.currentTarget.style.color='#555';e.currentTarget.style.borderColor='#2e2e36'}}>
            {a}
          </button>
        ))}
        <div style={{ display:'flex', gap:'5px', flex:1 }}>
          {stories.map((st, i) => (
            <button key={i} onClick={()=>setIdx(i)} style={{
              height:'3px', width:i===idx?'20px':'4px',
              background:i===idx?st.accent:'#2e2e36', border:'none',
              borderRadius:'2px', cursor:'pointer', padding:0,
              transition:'width 0.3s, background 0.3s' }} />
          ))}
        </div>
        <span style={{ fontFamily:'DM Mono, monospace', fontSize:'10px', color:'#909090' }}>
          {String(idx+1).padStart(2,'0')}/{String(stories.length).padStart(2,'0')}
        </span>
      </div>
    </div>
  )
}

// ─── Feature modules ──────────────────────────────────────────────────────────

const MODULES = [
  {
    label: 'Insights',
    desc: 'Hot and cold streaks detected using composite z-scores across points, rebounds, assists, and defense. Breakout probability powered by PER-based multi-dimensional efficiency analysis.',
    stat: '574 players tracked',
    href: '/insights',
    accent: '#c8f135',
    icon: '↑',
  },
  {
    label: 'Playoff Simulator',
    desc: "Monte Carlo simulation from current standings. Locks completed series, simulates forward from any point in the season. Conference finals, semis, or Game 7 of the first round.",
    stat: 'Up to 1M simulations',
    href: '/playoffs',
    accent: '#f97316',
    icon: '◎',
  },
  {
    label: 'Matchup Difficulty',
    desc: 'Positional defensive profiles for every team. See projected output per stat for any player against any opponent, plus their actual game log history vs that team.',
    stat: '540 defensive profiles',
    href: '/matchup',
    accent: '#5b8ef0',
    icon: '⊕',
  },
  {
    label: 'Head-to-Head',
    desc: 'Full side-by-side comparison of any two players. Season averages, last 10 splits, consistency ratings, and per-stat edge summary. Type any two names.',
    stat: 'Any two players',
    href: '/compare',
    accent: '#a78bfa',
    icon: '↔',
  },
  {
    label: 'Player Profiles',
    desc: 'Radar chart, game log, and season averages for every player with 5+ games this season. Sortable by any stat. Click any player to open their full profile.',
    stat: '574 players · 2025–26',
    href: '/profiles',
    accent: '#34d399',
    icon: '◉',
  },
  {
    label: 'Clutch Rankings',
    desc: 'Net ratings in Q4 within 5 points only — separates closers from aggregate noise. Which teams and players show up when it actually matters.',
    stat: 'Q4 ±5 pts only',
    href: '/clutch',
    accent: '#fbbf24',
    icon: '★',
  },
]

// ─── Scrolling sections ───────────────────────────────────────────────────────

function HeroSection({ stories }: { stories: Story[] }) {
  return (
    <section style={{ padding: '52px 0 60px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '32px', alignItems: 'start' }}>
        <div>
          {/* Date */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '32px' }}>
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '11px',
              color: '#8c8a85', letterSpacing: '0.1em', textTransform: 'uppercase' as const }}>
              {new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' })}
            </span>
            <div style={{ flex: 1, height: '1px', background: '#1a1a20' }} />
          </div>

          {/* Headline */}
          <h1 style={{ fontFamily: 'Inter, sans-serif', fontSize: '42px', fontWeight: 300,
            color: '#f2f0eb', lineHeight: 1.15, letterSpacing: '-0.03em', marginBottom: '20px' }}>
            NBA intelligence,<br />
            <span style={{ color: '#c8f135', fontWeight: 500 }}>updated daily.</span>
          </h1>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '15px', color: '#8c8a85',
            lineHeight: 1.7, maxWidth: '440px', marginBottom: '32px' }}>
            Streaks, breakouts, playoff odds, matchup difficulty — built on
            play-by-play data and refreshed three times a day before tip-off.
          </p>

          {/* Feed */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: '12px' }}>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '10px',
                color: '#b0aea8', letterSpacing: '0.14em', textTransform: 'uppercase' as const }}>
                Today's intelligence
              </span>
              <Link href="/insights" style={{ fontFamily: 'DM Mono, monospace', fontSize: '10px',
                color: '#b0aea8', letterSpacing: '0.1em', transition: 'color 0.15s',
                textTransform: 'uppercase' as const }}
                onMouseEnter={e=>(e.currentTarget.style.color='#c8f135')}
                onMouseLeave={e=>(e.currentTarget.style.color='#555')}>
                All insights →
              </Link>
            </div>
            <Carousel stories={stories} />
          </div>
        </div>

        {/* Right — platform stats */}
        <div style={{ paddingTop: '72px' }}>
          <div style={{ border: '1px solid #222228', borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #222228',
              background: '#141418' }}>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '10px',
                color: '#8c8a85', letterSpacing: '0.12em', textTransform: 'uppercase' as const }}>
                Platform
              </span>
            </div>
            {[
              { v: '574', l: 'Players tracked' },
              { v: '3×',  l: 'Daily ETL updates' },
              { v: '23K', l: 'Game logs this season' },
              { v: 'v14', l: 'Model version' },
              { v: '1M',  l: 'Max playoff simulations' },
              { v: '540', l: 'Defensive profiles' },
            ].map((item, i, arr) => (
              <div key={item.l} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '12px 18px', background: '#141418',
                borderBottom: i < arr.length-1 ? '1px solid #1a1a20' : 'none',
              }}>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '13px', color: '#8c8a85' }}>
                  {item.l}
                </span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '14px',
                  fontWeight: 500, color: '#f2f0eb' }}>{item.v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function FeaturesSection() {
  return (
    <section style={{ padding: '60px 0', borderTop: '1px solid #222228' }}>
      <div style={{ marginBottom: '40px' }}>
        <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '10px',
          color: '#b0aea8', letterSpacing: '0.14em', textTransform: 'uppercase' as const }}>
          What's inside
        </span>
        <h2 style={{ fontFamily: 'Inter, sans-serif', fontSize: '30px', fontWeight: 400,
          color: '#f2f0eb', marginTop: '10px', letterSpacing: '-0.02em' }}>
          Six ways to read the NBA differently.
        </h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px',
        background: '#1a1a20', border: '1px solid #1a1a20', borderRadius: '8px',
        overflow: 'hidden' }}>
        {MODULES.map(m => (
          <Link key={m.href} href={m.href} style={{ display: 'block', textDecoration: 'none' }}>
            <div style={{ padding: '28px 24px', background: '#0c0c0e', height: '100%',
              transition: 'background 0.15s', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#141418')}
              onMouseLeave={e => (e.currentTarget.style.background = '#0c0c0e')}>
              {/* Icon + label */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '16px',
                  color: m.accent, lineHeight: 1 }}>{m.icon}</span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '14px',
                  fontWeight: 600, color: '#f2f0eb' }}>{m.label}</span>
              </div>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '13px', color: '#8c8a85',
                lineHeight: 1.65, marginBottom: '20px' }}>{m.desc}</p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '10px',
                  color: '#909090', letterSpacing: '0.06em' }}>{m.stat}</span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '11px',
                  color: m.accent }}>→</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}

function ModelSection() {
  const points = [
    { label: 'Bayesian shrinkage', desc: 'Regresses small-sample performances toward position averages.' },
    { label: 'Positional defense profiles', desc: 'Compares each team\'s allowed stats by G/F/C position bucket.' },
    { label: 'Normal CDF scoring', desc: 'Models each prop line as a probability using predicted mean and variance.' },
    { label: 'Usage redistribution', desc: 'When a teammate is out, missing possessions get reallocated.' },
    { label: 'Exponential decay ratings', desc: 'Recent games weighted more heavily than October results.' },
    { label: 'Monte Carlo playoff sim', desc: 'Win probability per game via logistic model, run N times.' },
  ]

  return (
    <section style={{ padding: '60px 0', borderTop: '1px solid #222228' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '60px', alignItems: 'start' }}>
        <div>
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '10px',
            color: '#b0aea8', letterSpacing: '0.14em', textTransform: 'uppercase' as const }}>
            How it works
          </span>
          <h2 style={{ fontFamily: 'Inter, sans-serif', fontSize: '28px', fontWeight: 400,
            color: '#f2f0eb', marginTop: '10px', letterSpacing: '-0.02em', lineHeight: 1.3 }}>
            Built on the math,<br />not the narrative.
          </h2>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '14px', color: '#8c8a85',
            lineHeight: 1.7, marginTop: '16px' }}>
            Every prediction runs through a pipeline of statistical models.
            No hot takes. No vibes. Just exponentially-weighted ratings,
            distribution-based prediction, and position-adjusted defense.
          </p>
          <Link href="/about" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px',
            marginTop: '20px', fontFamily: 'DM Mono, monospace', fontSize: '11px',
            color: '#c8f135', letterSpacing: '0.1em', textTransform: 'uppercase' as const }}>
            Read the methodology →
          </Link>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
          {points.map((p, i) => (
            <div key={p.label} style={{ padding: '16px 0',
              borderBottom: i < points.length-1 ? '1px solid #1a1a20' : 'none' }}>
              <div style={{ fontFamily: 'Inter, sans-serif', fontSize: '13px',
                fontWeight: 500, color: '#f2f0eb', marginBottom: '4px' }}>
                {p.label}
              </div>
              <div style={{ fontFamily: 'Inter, sans-serif', fontSize: '13px', color: '#6b6a6f' }}>
                {p.desc}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function FooterSection() {
  return (
    <section style={{ padding: '40px 0', borderTop: '1px solid #222228' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '12px',
          color: '#c8f135', fontWeight: 500, letterSpacing: '0.12em' }}>SWINGFACTR</span>
        <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '11px', color: '#909090',
          letterSpacing: '0.08em' }}>2025–26 NBA · Updated 3× daily</span>
      </div>
    </section>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [stories, setStories] = useState<Story[]>([])

  useEffect(() => {
    const load = async () => {
      const [overallRes, breakoutRes, standingsRes] = await Promise.allSettled([
        fetch(`${API}/insights/streaks/overall?min_gp=10&limit=10`).then(r => r.json()),
        fetch(`${API}/insights/breakout?limit=5`).then(r => r.json()),
        fetch(`${API}/playoffs/standings`).then(r => r.json()),
      ])
      setStories(buildStories(
        overallRes.status   === 'fulfilled' ? overallRes.value   : null,
        breakoutRes.status  === 'fulfilled' ? breakoutRes.value  : null,
        standingsRes.status === 'fulfilled' ? standingsRes.value : null,
      ))
    }
    load()
  }, [])

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '0 28px' }}>
      <HeroSection stories={stories} />
      <FeaturesSection />
      <ModelSection />
      <FooterSection />
    </div>
  )
}
