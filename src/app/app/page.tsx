'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Story {
  tag:      string
  headline: string
  context:  string
  player?:  string
  link:     string
  cta:      string
  accent:   string
}

// ─── Story builders ────────────────────────────────────────────────────────────

function buildStories(streakData: any, breakoutData: any, standingsData: any): Story[] {
  const stories: Story[] = []

  // Hot streak — pick the most surprising one, natural language only
  const hotCandidates = (streakData?.hot || [])
    .filter((p: any) => p.composite_z >= 1.2)
    .slice(0, 3)

  if (hotCandidates.length > 0) {
    const p = hotCandidates[0]
    const dimWord: Record<string,string> = {
      scoring: 'has been scoring at will',
      playmaking: 'is facilitating at a new level',
      rebounding: 'is dominating the glass',
      defense: 'is locking down on defense',
      efficiency: 'is playing his most efficient basketball',
      minutes: 'is getting major run and delivering',
    }
    stories.push({
      tag:      'Hot streak',
      headline: `${p.player_name} ${dimWord[p.best_stat] || 'is on a tear'}.`,
      context:  'Production has trended sharply upward over the past two weeks.',
      player:   p.player_name,
      link:     '/insights',
      cta:      'See all streaks',
      accent:   '#f97316',
    })
  }

  // Cold streak
  const coldCandidates = (streakData?.cold || [])
    .filter((p: any) => p.composite_z <= -1.2)
    .slice(0, 3)

  if (coldCandidates.length > 0) {
    const p = coldCandidates[0]
    stories.push({
      tag:      'Cold streak',
      headline: `${p.player_name} has gone quiet.`,
      context:  'Output has dipped noticeably from his season baseline over recent games.',
      player:   p.player_name,
      link:     '/insights',
      cta:      'See full breakdown',
      accent:   '#5b8ef0',
    })
  }

  // Breakout
  const topBreakout = breakoutData?.results?.[0]
  if (topBreakout) {
    const dimLabel: Record<string,string> = {
      efficiency: 'overall efficiency',
      playmaking: 'playmaking',
      rebounding: 'rebounding',
      defense: 'defensive impact',
      scoring: 'scoring efficiency',
      minutes: 'role expansion',
    }
    const dim = dimLabel[topBreakout.lead_dimension] || 'efficiency'
    stories.push({
      tag:      'Breakout watch',
      headline: `${topBreakout.player_name} is trending in the right direction.`,
      context:  `Our model flags a meaningful jump in ${dim} over the past 10 games. Age ${topBreakout.age || '—'}.`,
      player:   topBreakout.player_name,
      link:     '/insights',
      cta:      'See breakout players',
      accent:   '#c8f135',
    })
  }

  // Playoffs promo
  stories.push({
    tag:      'Playoffs',
    headline: 'The race for the Larry O\'Brien is wide open.',
    context:  'Simulate the full postseason from current standings. Lock completed series. Run up to 1 million scenarios.',
    link:     '/playoffs',
    cta:      'Open simulator',
    accent:   '#c8f135',
  })

  // Trending team
  if (standingsData) {
    const all = [...(standingsData.east || []), ...(standingsData.west || [])]
    const surprising = all
      .filter((t: any) => t.seed >= 5 && t.net_rtg > 3)
      .sort((a: any, b: any) => b.net_rtg - a.net_rtg)
    if (surprising.length > 0) {
      const t = surprising[0]
      stories.push({
        tag:      'Playoff picture',
        headline: `${t.team} are playing better than their seed suggests.`,
        context:  'Efficiency metrics point to a team that could be dangerous in the postseason.',
        link:     '/playoffs',
        cta:      'See standings',
        accent:   '#f97316',
      })
    }
  }

  return stories
}

// ─── Editorial feed card ───────────────────────────────────────────────────────

function StoryCard({ story, active }: { story: Story; active: boolean }) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      opacity: active ? 1 : 0,
      transform: active ? 'translateY(0)' : 'translateY(12px)',
      transition: 'opacity 0.55s ease, transform 0.55s ease',
      pointerEvents: active ? 'auto' : 'none',
      padding: '36px 40px',
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    }}>
      {/* Tag */}
      <div style={{
        display: 'inline-flex', alignItems: 'center',
        fontFamily: 'DM Mono, monospace', fontSize: '10px',
        letterSpacing: '0.15em', color: story.accent,
        textTransform: 'uppercase' as const,
      }}>
        <span style={{
          display: 'inline-block', width: '6px', height: '6px',
          borderRadius: '50%', background: story.accent, marginRight: '8px',
        }} />
        {story.tag}
      </div>

      {/* Content */}
      <div>
        <h2 style={{
          fontFamily: 'Inter, sans-serif',
          fontSize: '26px', fontWeight: 600,
          color: '#f2f0eb', lineHeight: 1.25,
          marginBottom: '12px', letterSpacing: '-0.02em',
          maxWidth: '520px',
        }}>
          {story.headline}
        </h2>
        <p style={{
          fontFamily: 'Inter, sans-serif',
          fontSize: '14px', color: '#6b6a6f',
          lineHeight: 1.65, maxWidth: '440px',
        }}>
          {story.context}
        </p>
      </div>

      {/* CTA */}
      <Link href={story.link} style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        fontFamily: 'DM Mono, monospace', fontSize: '11px',
        color: story.accent, letterSpacing: '0.1em',
        textTransform: 'uppercase' as const,
        transition: 'opacity 0.15s',
      }}>
        {story.cta}
        <span style={{ fontSize: '14px' }}>→</span>
      </Link>
    </div>
  )
}

// ─── Carousel ─────────────────────────────────────────────────────────────────

function FeedCarousel({ stories }: { stories: Story[] }) {
  const [idx, setIdx]       = useState(0)
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  useEffect(() => { pausedRef.current = paused }, [paused])

  useEffect(() => {
    if (stories.length < 2) return
    const id = setInterval(() => {
      if (!pausedRef.current) setIdx(i => (i + 1) % stories.length)
    }, 7000)
    return () => clearInterval(id)
  }, [stories.length])

  if (!stories.length) return (
    <div style={{ height: '280px', display: 'flex', alignItems: 'center',
      justifyContent: 'center', color: '#333' }}>
      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '11px' }}>Loading...</span>
    </div>
  )

  return (
    <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {/* Card area */}
      <div style={{
        position: 'relative', height: '280px',
        background: '#141418',
        border: '1px solid #222228',
        borderRadius: '8px', overflow: 'hidden',
      }}>
        {/* Accent line */}
        <div style={{
          position: 'absolute', left: 0, top: '28px', bottom: '28px',
          width: '2px', background: stories[idx]?.accent || '#c8f135',
          opacity: 0.7, transition: 'background 0.5s',
        }} />
        {stories.map((s, i) => (
          <StoryCard key={i} story={s} active={i === idx} />
        ))}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px',
        marginTop: '14px', padding: '0 2px' }}>
        {['←','→'].map((arrow, di) => (
          <button key={arrow} onClick={() => setIdx(i =>
            di === 0 ? (i - 1 + stories.length) % stories.length : (i + 1) % stories.length
          )} style={{
            background: 'none', border: '1px solid #222228', borderRadius: '4px',
            padding: '4px 10px', cursor: 'pointer',
            fontFamily: 'DM Mono, monospace', fontSize: '12px', color: '#444',
            transition: 'color 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#f2f0eb'; e.currentTarget.style.borderColor = '#444' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#444'; e.currentTarget.style.borderColor = '#222228' }}>
            {arrow}
          </button>
        ))}

        {/* Dots */}
        <div style={{ display: 'flex', gap: '5px', flex: 1 }}>
          {stories.map((s, i) => (
            <button key={i} onClick={() => setIdx(i)} style={{
              height: '4px', width: i === idx ? '18px' : '4px',
              background: i === idx ? s.accent : '#2e2e36',
              border: 'none', borderRadius: '2px', cursor: 'pointer', padding: 0,
              transition: 'width 0.3s ease, background 0.3s ease',
            }} />
          ))}
        </div>

        <span style={{
          fontFamily: 'DM Mono, monospace', fontSize: '10px', color: '#333',
          letterSpacing: '0.08em',
        }}>
          {String(idx+1).padStart(2,'0')}/{String(stories.length).padStart(2,'0')}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <div style={{
            width: '5px', height: '5px', borderRadius: '50%',
            background: paused ? '#2e2e36' : '#c8f135',
            transition: 'background 0.3s',
          }} />
        </div>
      </div>
    </div>
  )
}

// ─── Quick nav grid ────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { label: 'Props Board',   sub: 'Model predictions · Daily',    href: '/props',    },
  { label: 'Insights',      sub: 'Streaks · Breakouts · Trends', href: '/insights', },
  { label: 'Playoffs',      sub: 'Simulate the postseason',      href: '/playoffs', },
  { label: 'Head-to-Head',  sub: 'Any two players',              href: '/compare',  },
  { label: 'Matchups',      sub: 'Difficulty ratings',           href: '/matchup',  },
  { label: 'Profiles',      sub: '500+ players',                 href: '/profiles', },
]

function QuickNav() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px',
      background: '#222228', border: '1px solid #222228', borderRadius: '8px',
      overflow: 'hidden' }}>
      {NAV_ITEMS.map(item => (
        <Link key={item.href} href={item.href} style={{
          display: 'block', padding: '16px 18px',
          background: '#141418',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = '#1a1a20')}
        onMouseLeave={e => (e.currentTarget.style.background = '#141418')}>
          <div style={{
            fontFamily: 'Inter, sans-serif', fontSize: '13px',
            fontWeight: 500, color: '#f2f0eb', marginBottom: '3px',
          }}>{item.label}</div>
          <div style={{
            fontFamily: 'DM Mono, monospace', fontSize: '10px',
            color: '#444', letterSpacing: '0.04em',
          }}>{item.sub}</div>
        </Link>
      ))}
    </div>
  )
}

// ─── Date strip ───────────────────────────────────────────────────────────────

function DateStrip() {
  const now = new Date()
  const day = now.toLocaleDateString('en-US', { weekday: 'long' })
  const date = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px',
      marginBottom: '36px' }}>
      <span style={{
        fontFamily: 'DM Mono, monospace', fontSize: '11px',
        color: '#444', letterSpacing: '0.12em',
        textTransform: 'uppercase' as const,
      }}>
        {day}, {date}
      </span>
      <span style={{ flex: 1, height: '1px', background: '#1a1a20' }} />
      <span style={{
        fontFamily: 'DM Mono, monospace', fontSize: '10px',
        color: '#2e2e36', letterSpacing: '0.08em',
      }}>2025–26 NBA</span>
    </div>
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
      const overall   = overallRes.status   === 'fulfilled' ? overallRes.value   : null
      const breakout  = breakoutRes.status  === 'fulfilled' ? breakoutRes.value  : null
      const standings = standingsRes.status === 'fulfilled' ? standingsRes.value : null
      setStories(buildStories(overall, breakout, standings))
    }
    load()
  }, [])

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '48px 28px' }}>
      <DateStrip />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '32px',
        alignItems: 'start' }}>

        {/* Left — feed */}
        <div>
          {/* Eyebrow */}
          <div style={{ display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', marginBottom: '14px' }}>
            <span style={{
              fontFamily: 'DM Mono, monospace', fontSize: '10px',
              color: '#444', letterSpacing: '0.15em',
              textTransform: 'uppercase' as const,
            }}>
              Today's intelligence
            </span>
            <Link href="/insights" style={{
              fontFamily: 'DM Mono, monospace', fontSize: '10px',
              color: '#444', letterSpacing: '0.1em',
              textTransform: 'uppercase' as const,
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#c8f135')}
            onMouseLeave={e => (e.currentTarget.style.color = '#444')}>
              All insights →
            </Link>
          </div>

          <FeedCarousel stories={stories} />

          {/* Tagline below */}
          <div style={{ marginTop: '32px', paddingTop: '28px',
            borderTop: '1px solid #1a1a20' }}>
            <h1 style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: '28px', fontWeight: 300,
              color: '#f2f0eb', lineHeight: 1.3,
              letterSpacing: '-0.02em',
            }}>
              NBA intelligence,<br />
              <span style={{ color: '#c8f135' }}>updated daily.</span>
            </h1>
            <p style={{
              marginTop: '12px', fontFamily: 'Inter, sans-serif',
              fontSize: '14px', color: '#6b6a6f', lineHeight: 1.7,
              maxWidth: '420px',
            }}>
              Streaks, breakouts, playoff odds, player matchups — built on
              play-by-play data and updated three times a day.
            </p>
          </div>
        </div>

        {/* Right — quick nav */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <div style={{
              fontFamily: 'DM Mono, monospace', fontSize: '10px',
              color: '#444', letterSpacing: '0.15em',
              textTransform: 'uppercase' as const,
              marginBottom: '10px',
            }}>
              Explore
            </div>
            <QuickNav />
          </div>

          {/* Small stat strip */}
          <div style={{
            border: '1px solid #222228', borderRadius: '8px',
            padding: '16px 18px', background: '#141418',
          }}>
            <div style={{
              fontFamily: 'DM Mono, monospace', fontSize: '10px',
              color: '#444', letterSpacing: '0.12em',
              textTransform: 'uppercase' as const,
              marginBottom: '12px',
            }}>Platform</div>
            {[
              { v: '3×',  l: 'Daily ETL updates' },
              { v: '574', l: 'Players tracked' },
              { v: 'v14', l: 'Model version' },
              { v: '1M',  l: 'Playoff simulations' },
            ].map(item => (
              <div key={item.l} style={{ display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', padding: '6px 0',
                borderBottom: '1px solid #1a1a20' }}>
                <span style={{
                  fontFamily: 'Inter, sans-serif', fontSize: '12px', color: '#6b6a6f',
                }}>{item.l}</span>
                <span style={{
                  fontFamily: 'DM Mono, monospace', fontSize: '12px',
                  fontWeight: 500, color: '#f2f0eb',
                }}>{item.v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
