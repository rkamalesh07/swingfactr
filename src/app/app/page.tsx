'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface BoardStats {
  total:         number
  strong_overs:  number
  lean_overs:    number
  strong_unders: number
  lean_unders:   number
  players:       number
  last_computed: string | null
}

function useLiveStats(refreshMs = 60000) {
  const [stats, setStats] = useState<BoardStats | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  useEffect(() => {
    const fetch_ = () =>
      fetch(`${API}/props/board/stats`)
        .then(r => r.json())
        .then(d => { setStats(d); setLastUpdated(new Date()) })
        .catch(() => {})

    fetch_()
    const id = setInterval(fetch_, refreshMs)
    return () => clearInterval(id)
  }, [refreshMs])

  return { stats, lastUpdated }
}

function Ticker({ value, label, color = '#4ade80' }: { value: string | number; label: string; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '20px 24px', background: '#0a0a0a',
      border: '1px solid #111', borderRadius: '4px', minWidth: '100px' }}>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '28px',
        fontWeight: 700, color, lineHeight: 1 }}>{value}</span>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px',
        color: '#333', letterSpacing: '0.12em', marginTop: '6px' }}>{label}</span>
    </div>
  )
}

function PlayerSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
    const debounce = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (!query || query.length < 2) { setResults([]); return }
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      setLoading(true)
      fetch(`${API}/props/board?search=${encodeURIComponent(query)}`)
        .then(r => r.json())
        .then(d => {
          const names = (d.results || []).map((r: any) => r.player_name as string).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i)
          setResults(names.slice(0, 8))
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false))
    }, 300)
  }, [query])

  const go = (name: string) => {
    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    window.location.href = `/player/${slug}`
  }

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: '480px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px',
        background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '4px',
        padding: '10px 14px' }}>
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
          color: '#2a2a2a' }}>SEARCH</span>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && results[0]) go(results[0]) }}
          placeholder="player name..."
          style={{ flex: 1, background: 'none', border: 'none', outline: 'none',
            fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', color: '#e0e0e0' }}
        />
        {loading && <span style={{ fontFamily: 'IBM Plex Mono, monospace',
          fontSize: '9px', color: '#333' }}>...</span>}
      </div>
      {results.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: '#0d0d0d', border: '1px solid #1a1a1a', borderTop: 'none',
          borderRadius: '0 0 4px 4px' }}>
          {results.map(name => (
            <button key={name} onClick={() => go(name)} style={{
              display: 'block', width: '100%', textAlign: 'left',
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '10px 14px', fontFamily: 'IBM Plex Mono, monospace',
              fontSize: '12px', color: '#888', borderBottom: '1px solid #111',
              transition: 'color 0.1s, background 0.1s',
            }}
            onMouseEnter={e => { const el = e.currentTarget; el.style.color = '#4ade80'; el.style.background = '#4ade8008' }}
            onMouseLeave={e => { const el = e.currentTarget; el.style.color = '#888'; el.style.background = 'none' }}>
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const MODULES = [
  {
    href: '/props',
    label: 'Props Board',
    tag: 'PrizePicks · Live ETL · 3× Daily',
    desc: 'Distribution-based player prop predictions with Bayesian shrinkage, positional opponent defense, and injury-adjusted usage boosts.',
    stat: null, statLabel: 'props today', statKey: 'total',
    accent: '#4ade80',
  },
  {
    href: '/methodology',
    label: 'Model Methodology',
    tag: 'v14 · Normal CDF · Platt Scaling',
    desc: 'Full technical documentation of the prediction model — formulas, data sources, calibration logic, and known limitations.',
    stat: '6', statLabel: 'model steps',
    accent: '#60a5fa',
  },
  {
    href: '/games',
    label: 'Game Win Curves',
    tag: 'Random Walk · Per-play',
    desc: 'Per-play win probability curves for every completed game. Pre-game projections for upcoming matchups.',
    stat: '1,100+', statLabel: 'games tracked',
    accent: '#f59e0b',
  },
  {
    href: '/teams',
    label: 'Team Rankings',
    tag: 'Net Rating · 5-man Stints',
    desc: 'All 30 teams ranked by net rating. Best and worst 5-man lineups by net points per 100 possessions.',
    stat: '30', statLabel: 'teams ranked',
    accent: '#a78bfa',
  },
  {
    href: '/rapm',
    label: 'RAPM',
    tag: 'Ridge Regression · α=2000',
    desc: 'Regularized Adjusted Plus-Minus — points added per 100 possessions controlling for teammates and opponents.',
    stat: '534', statLabel: 'players rated',
    accent: '#fb923c',
  },
  {
    href: '/players',
    label: 'Player Ratings',
    tag: 'Net Rating · On/Off',
    desc: 'On-court net rating for every player with 50+ minutes. Sortable by offense, defense, and net impact.',
    stat: '410K', statLabel: 'plays analyzed',
    accent: '#34d399',
  },
  {
    href: '/clutch',
    label: 'Clutch Performance',
    tag: 'Last 5 min · ±5 pts',
    desc: 'Net ratings in clutch situations only — Q4 within 5 points. Separates closers from aggregate noise.',
    stat: 'Q4', statLabel: 'crunch time only',
    accent: '#f87171',
  },
  {
    href: '/fatigue',
    label: 'Fatigue & Travel',
    tag: 'OLS Regression · R²=0.029',
    desc: 'Quantified effect of back-to-backs, travel distance, altitude, and timezone changes on scoring margin.',
    stat: '8', statLabel: 'fatigue factors',
    accent: '#fbbf24',
  },
  {
    href: '/lineups',
    label: 'Lineup Explorer',
    tag: 'Play-by-play · 5-man units',
    desc: 'Browse every 5-man lineup with net rating, possessions, and minutes. Filter by team.',
    stat: '23K', statLabel: 'stints tracked',
    accent: '#818cf8',
  },
]

function timeAgo(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000)
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs/60)}m ago`
  return `${Math.floor(secs/3600)}h ago`
}

export default function Home() {
  const { stats, lastUpdated } = useLiveStats(60000)
  const [tick, setTick] = useState(0)

  // Force re-render every 5s to update "X ago" label
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 5000)
    return () => clearInterval(id)
  }, [])

  return (
    <div>
      <style>{`
        .module-card { background: #0a0a0a; padding: 28px 32px; transition: background 0.15s; display: block; text-decoration: none; }
        .module-card:hover { background: #0f0f0f; }
      `}</style>

      {/* Hero */}
      <div style={{ marginBottom: '40px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
          color: '#333', letterSpacing: '0.12em', marginBottom: '12px' }}>
          NBA ANALYTICS · 2025–26 SEASON · LIVE
        </div>
        <h1 style={{ fontSize: '32px', fontWeight: 300, color: '#f0f0f0',
          letterSpacing: '-0.02em', marginBottom: '12px', lineHeight: 1.1 }}>
          Game intelligence.<br />Prop edge. Live data.
        </h1>
        <p style={{ color: '#444', fontSize: '14px', maxWidth: '520px', lineHeight: 1.6,
          marginBottom: '24px' }}>
          SwingFactr models player prop edges using distribution-based prediction,
          Bayesian shrinkage, and positional opponent defense — plus lineup chemistry,
          win probability, and fatigue from every 2025–26 NBA game.
        </p>
        <PlayerSearch />
      </div>

      {/* Live stats bar */}
      <div style={{ marginBottom: '40px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px',
          marginBottom: '12px' }}>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px',
            color: '#333', letterSpacing: '0.15em' }}>PROPS BOARD · LIVE</span>
          {lastUpdated && (
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px',
              color: '#222' }}>updated {timeAgo(lastUpdated)}</span>
          )}
          <span style={{ width: '6px', height: '6px', borderRadius: '50%',
            background: stats?.total ? '#4ade80' : '#333',
            boxShadow: stats?.total ? '0 0 6px #4ade80' : 'none',
            display: 'inline-block' }} />
        </div>

        {stats?.total ? (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Ticker value={stats.total}         label="TOTAL PROPS"    color="#e0e0e0" />
            <Ticker value={stats.strong_overs}  label="STRONG OVER"   color="#4ade80" />
            <Ticker value={stats.lean_overs}    label="LEAN OVER"     color="#86efac" />
            <Ticker value={stats.strong_unders} label="STRONG UNDER"  color="#f87171" />
            <Ticker value={stats.lean_unders}   label="LEAN UNDER"    color="#fca5a5" />
            <Ticker value={stats.players}       label="PLAYERS"       color="#888"    />
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '8px' }}>
            {['TOTAL PROPS','STRONG OVER','LEAN OVER','STRONG UNDER','PLAYERS'].map(l => (
              <div key={l} style={{ padding: '20px 24px', background: '#0a0a0a',
                border: '1px solid #111', borderRadius: '4px', minWidth: '100px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '32px', height: '28px', background: '#111',
                  borderRadius: '3px', animation: 'pulse 1.5s ease-in-out infinite' }} />
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px',
                  color: '#222', letterSpacing: '0.12em' }}>{l}</span>
              </div>
            ))}
          </div>
        )}

        <style>{`@keyframes pulse { 0%,100% { opacity:.4 } 50% { opacity:.8 } }`}</style>

        {stats?.total && (
          <div style={{ marginTop: '12px' }}>
            <Link href="/props" style={{
              fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
              color: '#4ade80', textDecoration: 'none', letterSpacing: '0.05em',
            }}>View full props board →</Link>
          </div>
        )}
        {stats && !stats.total && (
          <div style={{ marginTop: '8px', fontFamily: 'IBM Plex Mono, monospace',
            fontSize: '11px', color: '#2a2a2a' }}>
            No props yet today — check back after 6:30am PST
          </div>
        )}
      </div>

      {/* Module grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px',
        background: '#111', border: '1px solid #111' }}>
        {MODULES.map((m) => (
          <Link key={`${m.href}-${m.label}`} href={m.href} className="module-card">
            <div style={{ display: 'flex', justifyContent: 'space-between',
              alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <div style={{ fontSize: '16px', fontWeight: 500, color: '#e0e0e0',
                  marginBottom: '4px' }}>{m.label}</div>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px',
                  color: '#2a2a2a', letterSpacing: '0.08em' }}>{m.tag}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '22px',
                  fontWeight: 700, color: m.accent ?? '#e8e8e8' }}>
                  {m.statKey === 'total' && stats?.total != null
                    ? stats.total
                    : m.stat ?? '—'}
                </div>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px',
                  color: '#2a2a2a' }}>{m.statLabel}</div>
              </div>
            </div>
            <p style={{ color: '#444', fontSize: '12px', lineHeight: 1.7,
              marginBottom: '16px' }}>{m.desc}</p>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
              color: '#2a2a2a' }}>View →</div>
          </Link>
        ))}
      </div>

      {/* Footer metadata */}
      <div style={{ marginTop: '40px', paddingTop: '20px', borderTop: '1px solid #111',
        display: 'flex', flexWrap: 'wrap', gap: '24px',
        fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#1e1e1e' }}>
        <span>v14 model</span>
        <span>Bayesian shrinkage</span>
        <span>Positional defense profiles</span>
        <span>RotoWire + ESPN injury engine</span>
        <span>Platt scaling calibration</span>
        <span>GitHub Actions ETL · 3× daily</span>
        <span>Railway · Vercel · PostgreSQL</span>
      </div>
    </div>
  )
}
