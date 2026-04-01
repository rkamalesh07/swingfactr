'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const MONO = 'IBM Plex Mono, monospace'

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoryCard {
  type:     'hot' | 'cold' | 'breakout' | 'matchup' | 'prop_edge'
  headline: string
  subline:  string
  player:   string
  team:     string
  stat:     string
  value:    string
  delta?:   string
  tag:      string
  tagColor: string
  link:     string
}

interface BoardStats {
  total: number
  strong_overs: number
  strong_unders: number
  players: number
  last_computed: string | null
}

// ─── Story generation ─────────────────────────────────────────────────────────

function generateStreakStories(data: any): StoryCard[] {
  const stories: StoryCard[] = []
  if (!data) return stories

  const STAT_LABEL: Record<string,string> = {
    pts:'PPG', reb:'RPG', ast:'APG', fg3m:'3PM', stl:'SPG', blk:'BPG'
  }

  for (const p of (data.hot || []).slice(0, 6)) {
    const label = STAT_LABEL[p.stat] || p.stat.toUpperCase()
    const pct = Math.abs(p.pct_change)
    const z = p.z_score

    let headline = ''
    if (p.stat === 'pts' && p.l5_avg >= 30) {
      headline = `${p.player_name} is going off — averaging ${p.l5_avg} PPG over his last 5`
    } else if (pct >= 40) {
      headline = `${p.player_name} has been a different player lately`
    } else if (z >= 2.5) {
      headline = `${p.player_name}'s ${label} is at an all-time season high`
    } else {
      headline = `${p.player_name} is heating up in the ${label} column`
    }

    stories.push({
      type: 'hot',
      headline,
      subline: `${p.l5_avg} ${label} over L5 vs ${p.season_avg} season avg · ${pct.toFixed(0)}% above normal`,
      player:   p.player_name,
      team:     p.team,
      stat:     p.stat,
      value:    String(p.l5_avg),
      delta:    `+${pct.toFixed(0)}%`,
      tag:      'ON FIRE',
      tagColor: '#f97316',
      link:     `/player/${p.player_name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'')}`,
    })
  }

  for (const p of (data.cold || []).slice(0, 4)) {
    const label = STAT_LABEL[p.stat] || p.stat.toUpperCase()
    const pct = Math.abs(p.pct_change)

    stories.push({
      type: 'cold',
      headline: `${p.player_name} is struggling — down ${pct.toFixed(0)}% in ${label} over L5`,
      subline: `${p.l5_avg} ${label} over L5 vs ${p.season_avg} season avg · z=${p.z_score}`,
      player:   p.player_name,
      team:     p.team,
      stat:     p.stat,
      value:    String(p.l5_avg),
      delta:    `-${pct.toFixed(0)}%`,
      tag:      'ICE COLD',
      tagColor: '#60a5fa',
      link:     `/player/${p.player_name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'')}`,
    })
  }

  return stories
}

function generateBreakoutStories(data: any): StoryCard[] {
  if (!data?.results) return []
  return data.results.slice(0, 5).map((p: any) => {
    const ptsDiff = (p.pts_l5 - p.pts_season).toFixed(1)
    const minDiff = (p.min_l10 - p.min_season).toFixed(1)
    const positive = parseFloat(ptsDiff) > 0

    return {
      type: 'breakout',
      headline: `${p.player_name} is getting more opportunities — and making the most of them`,
      subline: `${p.pts_l5} PPG over L5 (${positive ? '+' : ''}${ptsDiff} vs season) · ${parseFloat(minDiff) > 0 ? '+' : ''}${minDiff} min/game recently`,
      player:   p.player_name,
      team:     p.team,
      stat:     'pts',
      value:    String(p.pts_l5),
      delta:    `${positive ? '+' : ''}${ptsDiff} pts`,
      tag:      'BREAKOUT',
      tagColor: '#a78bfa',
      link:     `/insights`,
    }
  })
}

function generatePropStories(data: any): StoryCard[] {
  if (!data?.results) return []
  const strong = data.results
    .filter((r: any) => r.score_label === 'Strong Over' || r.score_label === 'Strong Under')
    .slice(0, 4)

  return strong.map((r: any) => {
    const isOver = r.pick_side === 'over'
    const STAT: Record<string,string> = {pts:'points',reb:'rebounds',ast:'assists',fg3m:'threes',stl:'steals',blk:'blocks'}
    const statWord = STAT[r.stat] || r.stat

    return {
      type: isOver ? 'hot' : 'cold',
      headline: isOver
        ? `Our model likes ${r.player_name} to go over ${r.line} ${statWord} tonight`
        : `Our model flags ${r.player_name} under ${r.line} ${statWord} — edge is real`,
      subline: `L10 avg: ${r.avg_last10} · Line: ${r.line} · Edge: ${r.edge > 0 ? '+' : ''}${r.edge} · ${r.score_label}`,
      player:   r.player_name,
      team:     r.team,
      stat:     r.stat,
      value:    String(r.line),
      delta:    `${r.edge > 0 ? '+' : ''}${r.edge}`,
      tag:      r.score_label.toUpperCase(),
      tagColor: isOver ? '#4ade80' : '#f87171',
      link:     `/props`,
    }
  })
}

// ─── Carousel card ────────────────────────────────────────────────────────────

function StoryCardEl({ card, active }: { card: StoryCard; active: boolean }) {
  const typeIcon: Record<string, string> = {
    hot: '🔥', cold: '🧊', breakout: '⚡', matchup: '⚔️', prop_edge: '📊'
  }

  return (
    <div style={{
      position: 'absolute', inset: 0,
      opacity: active ? 1 : 0,
      transform: active ? 'translateY(0)' : 'translateY(8px)',
      transition: 'opacity 0.5s ease, transform 0.5s ease',
      pointerEvents: active ? 'auto' : 'none',
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      padding: '32px 40px',
    }}>
      {/* Tag */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{
          fontFamily: MONO, fontSize: '9px', letterSpacing: '0.18em',
          color: card.tagColor, padding: '4px 10px',
          border: `1px solid ${card.tagColor}40`,
          borderRadius: '2px', background: `${card.tagColor}10`,
        }}>{card.tag}</div>
        <div style={{ fontFamily: MONO, fontSize: '9px', color: '#333', letterSpacing: '0.1em' }}>
          {card.team}
        </div>
      </div>

      {/* Main content */}
      <div>
        {/* Big stat */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '16px' }}>
          <span style={{
            fontFamily: MONO, fontSize: '64px', fontWeight: 700,
            color: card.tagColor, lineHeight: 1, letterSpacing: '-0.03em',
          }}>{card.value}</span>
          {card.delta && (
            <span style={{
              fontFamily: MONO, fontSize: '18px', fontWeight: 600,
              color: card.type === 'cold' ? '#60a5fa' : '#4ade80',
            }}>{card.delta}</span>
          )}
        </div>

        {/* Headline */}
        <div style={{
          fontSize: '22px', fontWeight: 700, color: '#e0e0e0',
          lineHeight: 1.3, marginBottom: '10px', maxWidth: '600px',
          fontFamily: MONO, letterSpacing: '-0.01em',
        }}>{card.headline}</div>

        {/* Subline */}
        <div style={{
          fontFamily: MONO, fontSize: '11px', color: '#444', lineHeight: 1.6,
          maxWidth: '500px',
        }}>{card.subline}</div>
      </div>

      {/* CTA */}
      <Link href={card.link} style={{
        display: 'inline-flex', alignItems: 'center', gap: '8px',
        fontFamily: MONO, fontSize: '11px', color: card.tagColor,
        textDecoration: 'none', letterSpacing: '0.08em',
        borderBottom: `1px solid ${card.tagColor}40`, paddingBottom: '2px',
        width: 'fit-content', transition: 'color 0.2s',
      }}>
        EXPLORE →
      </Link>
    </div>
  )
}

// ─── Carousel ─────────────────────────────────────────────────────────────────

function NewsCarousel({ stories }: { stories: StoryCard[] }) {
  const [idx, setIdx]       = useState(0)
  const [paused, setPaused] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval>>()

  const next = useCallback(() => setIdx(i => (i + 1) % stories.length), [stories.length])
  const prev = () => setIdx(i => (i - 1 + stories.length) % stories.length)

  useEffect(() => {
    if (paused || stories.length === 0) return
    timer.current = setInterval(next, 6000)
    return () => clearInterval(timer.current)
  }, [paused, next, stories.length])

  if (stories.length === 0) return (
    <div style={{ height: '320px', background: '#0a0a0a', border: '1px solid #111',
      borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: MONO, fontSize: '11px', color: '#2a2a2a' }}>
      Loading stories...
    </div>
  )

  const card = stories[idx]

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      style={{ position: 'relative' }}>

      {/* Main card */}
      <div style={{
        position: 'relative', height: '320px',
        background: '#0a0a0a', border: '1px solid #111',
        borderRadius: '6px', overflow: 'hidden',
      }}>
        {/* Accent gradient */}
        <div style={{
          position: 'absolute', top: 0, right: 0, width: '300px', height: '100%',
          background: `radial-gradient(ellipse at top right, ${card.tagColor}08 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />
        {/* Vertical accent bar */}
        <div style={{
          position: 'absolute', left: 0, top: '20%', bottom: '20%',
          width: '2px', background: card.tagColor, opacity: 0.6,
          borderRadius: '1px',
        }} />

        {stories.map((s, i) => <StoryCardEl key={i} card={s} active={i === idx} />)}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px',
        marginTop: '16px', padding: '0 4px' }}>

        {/* Prev / Next */}
        <button onClick={prev} style={{
          background: 'none', border: '1px solid #1a1a1a', borderRadius: '3px',
          padding: '4px 10px', cursor: 'pointer', fontFamily: MONO, fontSize: '11px',
          color: '#333', transition: 'color 0.15s, border-color 0.15s',
        }}>←</button>
        <button onClick={next} style={{
          background: 'none', border: '1px solid #1a1a1a', borderRadius: '3px',
          padding: '4px 10px', cursor: 'pointer', fontFamily: MONO, fontSize: '11px',
          color: '#333',
        }}>→</button>

        {/* Dots */}
        <div style={{ display: 'flex', gap: '6px', flex: 1 }}>
          {stories.map((s, i) => (
            <button key={i} onClick={() => setIdx(i)} style={{
              width: i === idx ? '24px' : '6px', height: '6px',
              background: i === idx ? s.tagColor : '#1a1a1a',
              border: 'none', borderRadius: '3px', cursor: 'pointer',
              transition: 'width 0.3s ease, background 0.3s ease',
              padding: 0,
            }} />
          ))}
        </div>

        {/* Story count */}
        <span style={{ fontFamily: MONO, fontSize: '9px', color: '#2a2a2a',
          letterSpacing: '0.1em' }}>
          {String(idx + 1).padStart(2,'0')} / {String(stories.length).padStart(2,'0')}
        </span>

        {/* Auto-play indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{
            width: '5px', height: '5px', borderRadius: '50%',
            background: paused ? '#2a2a2a' : '#4ade80',
            boxShadow: paused ? 'none' : '0 0 6px #4ade80',
            transition: 'all 0.3s',
          }} />
          <span style={{ fontFamily: MONO, fontSize: '8px', color: '#2a2a2a' }}>
            {paused ? 'PAUSED' : 'LIVE'}
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Quick nav modules ────────────────────────────────────────────────────────

const MODULES = [
  { label: 'Props Board',   sub: 'Today\'s picks',   href: '/props',       color: '#4ade80' },
  { label: 'Insights',      sub: 'Streaks + Breakouts', href: '/insights',  color: '#a78bfa' },
  { label: 'Playoffs',      sub: 'Simulate the race', href: '/playoffs',   color: '#fbbf24' },
  { label: 'Player Profiles', sub: '574 players',    href: '/profiles',    color: '#60a5fa' },
  { label: 'Team Rankings', sub: 'Net rating',        href: '/players',    color: '#f97316' },
  { label: 'Live Games',    sub: 'Win probability',   href: '/live',       color: '#f87171' },
]

function QuickNav() {
  const [hovered, setHovered] = useState<number | null>(null)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
      {MODULES.map((m, i) => (
        <Link key={m.href} href={m.href} style={{ textDecoration: 'none' }}>
          <div
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            style={{
              padding: '16px 18px',
              background: hovered === i ? '#0d0d0d' : '#0a0a0a',
              border: `1px solid ${hovered === i ? m.color + '30' : '#111'}`,
              borderRadius: '4px', cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}>
            <div style={{ fontFamily: MONO, fontSize: '12px', fontWeight: 700,
              color: hovered === i ? m.color : '#888', marginBottom: '4px',
              transition: 'color 0.15s' }}>
              {m.label}
            </div>
            <div style={{ fontFamily: MONO, fontSize: '9px', color: '#2a2a2a',
              letterSpacing: '0.06em' }}>{m.sub}</div>
          </div>
        </Link>
      ))}
    </div>
  )
}

// ─── Live ticker strip ────────────────────────────────────────────────────────

function LiveStrip({ stats }: { stats: BoardStats | null }) {
  if (!stats) return null
  const items = [
    `${stats.total} props today`,
    `${stats.strong_overs} strong overs`,
    `${stats.strong_unders} strong unders`,
    `${stats.players} players tracked`,
    `ETL live · 3x daily`,
    `Model v14 · Bayesian shrinkage`,
    `2025–26 NBA season`,
  ]
  const repeated = [...items, ...items, ...items]

  return (
    <div style={{
      overflow: 'hidden', borderTop: '1px solid #0f0f0f',
      borderBottom: '1px solid #0f0f0f', padding: '8px 0',
      background: '#080808',
    }}>
      <div style={{
        display: 'flex', gap: '48px', whiteSpace: 'nowrap',
        animation: 'scroll-left 30s linear infinite',
      }}>
        {repeated.map((item, i) => (
          <span key={i} style={{ fontFamily: MONO, fontSize: '9px',
            color: '#2a2a2a', letterSpacing: '0.12em', flexShrink: 0 }}>
            {i % items.length === 0 ? <span style={{ color: '#4ade80', marginRight: '48px' }}>●</span> : null}
            {item.toUpperCase()}
          </span>
        ))}
      </div>
      <style>{`
        @keyframes scroll-left {
          0%   { transform: translateX(0) }
          100% { transform: translateX(-33.33%) }
        }
      `}</style>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [stories,    setStories]    = useState<StoryCard[]>([])
  const [boardStats, setBoardStats] = useState<BoardStats | null>(null)
  const [loadingStories, setLoadingStories] = useState(true)
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  useEffect(() => {
    // Fetch board stats
    fetch(`${API}/props/board/stats`)
      .then(r => r.json())
      .then(setBoardStats)
      .catch(() => {})

    // Fetch all story data in parallel
    const fetchAll = async () => {
      setLoadingStories(true)
      try {
        const [streakPts, streakReb, streakAst, breakout, board] = await Promise.allSettled([
          fetch(`${API}/insights/streaks?stat=pts&min_gp=10&limit=16`).then(r => r.json()),
          fetch(`${API}/insights/streaks?stat=reb&min_gp=10&limit=8`).then(r => r.json()),
          fetch(`${API}/insights/streaks?stat=ast&min_gp=10&limit=8`).then(r => r.json()),
          fetch(`${API}/insights/breakout?limit=5`).then(r => r.json()),
          fetch(`${API}/props/board`).then(r => r.json()),
        ])

        const allStories: StoryCard[] = []

        if (streakPts.status === 'fulfilled')
          allStories.push(...generateStreakStories(streakPts.value))
        if (streakReb.status === 'fulfilled')
          allStories.push(...generateStreakStories(streakReb.value).slice(0, 3))
        if (streakAst.status === 'fulfilled')
          allStories.push(...generateStreakStories(streakAst.value).slice(0, 3))
        if (breakout.status === 'fulfilled')
          allStories.push(...generateBreakoutStories(breakout.value))
        if (board.status === 'fulfilled')
          allStories.push(...generatePropStories(board.value))

        // Shuffle so it's not always the same order, dedupe by player+stat
        const seen = new Set<string>()
        const deduped = allStories.filter(s => {
          const key = `${s.player}-${s.stat}-${s.type}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })

        // Sort: interleave hot, breakout, prop, cold
        const hot      = deduped.filter(s => s.type === 'hot')
        const breakouts = deduped.filter(s => s.type === 'breakout')
        const props    = deduped.filter(s => s.type === 'prop_edge' || s.tag.includes('OVER') || s.tag.includes('UNDER'))
        const cold     = deduped.filter(s => s.type === 'cold')

        const interleaved: StoryCard[] = []
        const maxLen = Math.max(hot.length, breakouts.length, cold.length)
        for (let i = 0; i < maxLen; i++) {
          if (hot[i])       interleaved.push(hot[i])
          if (breakouts[i]) interleaved.push(breakouts[i])
          if (props[i])     interleaved.push(props[i])
          if (cold[i])      interleaved.push(cold[i])
        }

        setStories(interleaved.slice(0, 20))
      } catch {}
      setLoadingStories(false)
    }

    fetchAll()
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: '#080808', color: '#888' }}>

      {/* Live ticker */}
      <LiveStrip stats={boardStats} />

      {/* Main content */}
      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '40px 28px' }}>

        {/* Header */}
        <div style={{ marginBottom: '40px' }}>
          <div style={{ fontFamily: MONO, fontSize: '9px', color: '#2a2a2a',
            letterSpacing: '0.18em', marginBottom: '12px' }}>
            {today.toUpperCase()} · NBA · 2025–26
          </div>
          <h1 style={{ fontSize: '36px', fontWeight: 700, color: '#e0e0e0',
            margin: '0 0 8px', fontFamily: MONO, letterSpacing: '-0.02em',
            lineHeight: 1.1 }}>
            What's happening<br />
            <span style={{ color: '#4ade80' }}>in the NBA right now.</span>
          </h1>
          <div style={{ fontFamily: MONO, fontSize: '11px', color: '#333',
            marginTop: '12px', lineHeight: 1.7 }}>
            Daily intelligence on player streaks, breakouts, prop edges, and playoff odds.
          </div>
        </div>

        {/* Two-column layout */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '24px',
          alignItems: 'start' }}>

          {/* Left: carousel */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: '14px' }}>
              <div style={{ fontFamily: MONO, fontSize: '9px', color: '#2a2a2a',
                letterSpacing: '0.15em' }}>TODAY'S STORIES</div>
              <Link href="/insights" style={{ fontFamily: MONO, fontSize: '9px',
                color: '#333', textDecoration: 'none', letterSpacing: '0.1em',
                borderBottom: '1px solid #1a1a1a', paddingBottom: '1px' }}>
                VIEW ALL INSIGHTS →
              </Link>
            </div>
            {loadingStories
              ? <div style={{ height: '320px', background: '#0a0a0a', border: '1px solid #111',
                  borderRadius: '6px', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontFamily: MONO, fontSize: '10px', color: '#2a2a2a' }}>
                  Generating stories...
                </div>
              : <NewsCarousel stories={stories} />
            }
          </div>

          {/* Right: quick nav + stats */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* Board stats */}
            {boardStats && (
              <div style={{ background: '#0a0a0a', border: '1px solid #111',
                borderRadius: '4px', padding: '16px 18px' }}>
                <div style={{ fontFamily: MONO, fontSize: '9px', color: '#2a2a2a',
                  letterSpacing: '0.15em', marginBottom: '12px' }}>
                  PROPS BOARD · TODAY
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  {[
                    { label: 'Total Props',    value: boardStats.total,          color: '#e0e0e0' },
                    { label: 'Strong Overs',   value: boardStats.strong_overs,   color: '#4ade80' },
                    { label: 'Strong Unders',  value: boardStats.strong_unders,  color: '#f87171' },
                    { label: 'Players',        value: boardStats.players,        color: '#888'    },
                  ].map(item => (
                    <div key={item.label}>
                      <div style={{ fontFamily: MONO, fontSize: '20px', fontWeight: 700,
                        color: item.color, lineHeight: 1 }}>{item.value}</div>
                      <div style={{ fontFamily: MONO, fontSize: '8px', color: '#2a2a2a',
                        letterSpacing: '0.1em', marginTop: '3px' }}>{item.label.toUpperCase()}</div>
                    </div>
                  ))}
                </div>
                <Link href="/props" style={{ display: 'block', marginTop: '14px',
                  fontFamily: MONO, fontSize: '9px', color: '#4ade80',
                  textDecoration: 'none', letterSpacing: '0.1em',
                  borderTop: '1px solid #111', paddingTop: '10px' }}>
                  VIEW FULL PROPS BOARD →
                </Link>
              </div>
            )}

            {/* Quick nav */}
            <div>
              <div style={{ fontFamily: MONO, fontSize: '9px', color: '#2a2a2a',
                letterSpacing: '0.15em', marginBottom: '10px' }}>EXPLORE</div>
              <QuickNav />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
