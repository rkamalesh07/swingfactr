'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const STATS = ['pts','reb','ast','fg3m','stl','blk']
const STAT_LABEL: Record<string,string> = {
  pts:'PTS', reb:'REB', ast:'AST', fg3m:'3PM', stl:'STL', blk:'BLK'
}
const STAT_COLOR: Record<string,string> = {
  pts:'#60a5fa', reb:'#34d399', ast:'#f59e0b',
  fg3m:'#a78bfa', stl:'#f87171', blk:'#fb923c'
}

interface PlayerCard {
  player_name:  string
  team:         string
  stat:         string
  line:         number
  edge:         number
  pick_side:    string
  score_label:  string
  avg_last10:   number | null
  p_over:       number | null
}

function toSlug(name: string) {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

export default function ProfilesPage() {
  const [players, setPlayers] = useState<PlayerCard[]>([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [statFilter, setStatFilter] = useState('all')
  const [sortBy, setSortBy] = useState<'edge'|'name'>('edge')

  useEffect(() => {
    fetch(`${API}/props/board`)
      .then(r => r.json())
      .then(d => {
        // Dedupe — one card per player (strongest edge prop)
        const map = new Map<string, PlayerCard>()
        for (const r of (d.results || [])) {
          const key = r.player_name
          const existing = map.get(key)
          if (!existing || Math.abs(r.edge) > Math.abs(existing.edge)) {
            map.set(key, {
              player_name: r.player_name,
              team:        r.team,
              stat:        r.stat,
              line:        r.line,
              edge:        r.edge,
              pick_side:   r.pick_side,
              score_label: r.score_label,
              avg_last10:  r.avg_last10,
              p_over:      r.p_over,
            })
          }
        }
        setPlayers(Array.from(map.values()))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    let list = [...players]
    if (search) list = list.filter(p =>
      p.player_name.toLowerCase().includes(search.toLowerCase()) ||
      p.team.toLowerCase().includes(search.toLowerCase())
    )
    if (statFilter !== 'all') list = list.filter(p => p.stat === statFilter)
    if (sortBy === 'edge') list.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))
    if (sortBy === 'name') list.sort((a, b) => a.player_name.localeCompare(b.player_name))
    return list
  }, [players, search, statFilter, sortBy])

  return (
    <div style={{ minHeight: '100vh', background: '#080808', color: '#888',
      fontFamily: 'IBM Plex Mono, monospace' }}>

      {/* Header */}
      <div style={{ borderBottom: '1px solid #0f0f0f', padding: '12px 24px',
        display: 'flex', alignItems: 'center', gap: '16px' }}>
        <Link href="/" style={{ color: '#333', textDecoration: 'none',
          fontSize: '11px', letterSpacing: '0.05em' }}>← HOME</Link>
        <span style={{ color: '#1a1a1a' }}>·</span>
        <span style={{ color: '#333', fontSize: '11px', letterSpacing: '0.1em' }}>
          PLAYER PROFILES
        </span>
        {!loading && (
          <span style={{ color: '#222', fontSize: '11px' }}>
            {filtered.length} players
          </span>
        )}
      </div>

      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '32px 24px' }}>

        {/* Title + controls */}
        <div style={{ marginBottom: '32px' }}>
          <h1 style={{ fontSize: '28px', fontWeight: 700, color: '#e0e0e0',
            letterSpacing: '-0.02em', margin: '0 0 20px',
            fontFamily: 'IBM Plex Mono, monospace' }}>
            Player Profiles
          </h1>
          <p style={{ fontSize: '12px', color: '#333', lineHeight: 1.7,
            margin: '0 0 24px', maxWidth: '500px' }}>
            Season stats, game logs, and model projections for every player
            with PrizePicks props today. Click any card to view their full profile.
          </p>

          {/* Search + filters */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search player or team..."
              style={{ padding: '8px 12px', background: '#0a0a0a',
                border: '1px solid #1a1a1a', borderRadius: '4px', outline: 'none',
                fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px',
                color: '#e0e0e0', width: '220px' }}
            />

            <div style={{ display: 'flex', gap: '2px' }}>
              {['all', ...STATS].map(s => (
                <button key={s} onClick={() => setStatFilter(s)} style={{
                  padding: '6px 10px', background: statFilter === s ? '#111' : 'none',
                  border: `1px solid ${statFilter === s ? '#222' : '#111'}`,
                  borderRadius: '3px', cursor: 'pointer',
                  fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px',
                  color: statFilter === s
                    ? (s === 'all' ? '#e0e0e0' : STAT_COLOR[s])
                    : '#333',
                  letterSpacing: '0.08em',
                }}>{s === 'all' ? 'ALL' : STAT_LABEL[s]}</button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '2px', marginLeft: 'auto' }}>
              {(['edge','name'] as const).map(s => (
                <button key={s} onClick={() => setSortBy(s)} style={{
                  padding: '6px 10px', background: sortBy === s ? '#111' : 'none',
                  border: `1px solid ${sortBy === s ? '#222' : '#111'}`,
                  borderRadius: '3px', cursor: 'pointer',
                  fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px',
                  color: sortBy === s ? '#e0e0e0' : '#333',
                  letterSpacing: '0.08em',
                }}>{s === 'edge' ? 'BY EDGE' : 'A–Z'}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Loading state */}
        {loading && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: '8px' }}>
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} style={{ height: '120px', background: '#0a0a0a',
                border: '1px solid #111', borderRadius: '4px',
                animation: 'pulse 1.5s ease-in-out infinite',
                animationDelay: `${i * 0.05}s` }} />
            ))}
            <style>{`@keyframes pulse { 0%,100%{opacity:.3} 50%{opacity:.6} }`}</style>
          </div>
        )}

        {/* Empty state */}
        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px 0',
            fontSize: '12px', color: '#222' }}>
            {players.length === 0
              ? 'No props today — check back after 6:30am PST'
              : `No players match "${search}"`}
          </div>
        )}

        {/* Player grid */}
        {!loading && filtered.length > 0 && (
          <div style={{ display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px' }}>
            {filtered.map(p => {
              const edgeColor = p.edge > 0 ? '#4ade80' : '#f87171'
              const statColor = STAT_COLOR[p.stat] || '#888'
              return (
                <Link key={p.player_name} href={`/player/${toSlug(p.player_name)}`}
                  style={{ textDecoration: 'none' }}>
                  <div style={{
                    padding: '16px', background: '#0a0a0a',
                    border: '1px solid #111', borderRadius: '4px',
                    transition: 'border-color 0.15s, background 0.15s',
                    cursor: 'pointer', height: '100%',
                  }}
                  onMouseEnter={e => {
                    const el = e.currentTarget
                    el.style.borderColor = edgeColor + '40'
                    el.style.background = '#0d0d0d'
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget
                    el.style.borderColor = '#111'
                    el.style.background = '#0a0a0a'
                  }}>
                    {/* Player name + team */}
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 700,
                        color: '#e0e0e0', marginBottom: '3px',
                        whiteSpace: 'nowrap', overflow: 'hidden',
                        textOverflow: 'ellipsis' }}>
                        {p.player_name}
                      </div>
                      <div style={{ fontSize: '9px', color: '#333',
                        letterSpacing: '0.08em' }}>{p.team}</div>
                    </div>

                    {/* Stat + line */}
                    <div style={{ display: 'flex', justifyContent: 'space-between',
                      alignItems: 'center', marginBottom: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '9px', color: statColor,
                          letterSpacing: '0.08em' }}>{STAT_LABEL[p.stat]}</span>
                        <span style={{ fontSize: '14px', fontWeight: 700,
                          color: '#e0e0e0' }}>{p.line}</span>
                      </div>
                      <span style={{ fontSize: '9px', color: edgeColor,
                        letterSpacing: '0.05em' }}>
                        {p.pick_side.toUpperCase()} {p.edge > 0 ? '+' : ''}{p.edge}
                      </span>
                    </div>

                    {/* L10 avg vs line bar */}
                    {p.avg_last10 != null && (
                      <div style={{ marginBottom: '10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between',
                          marginBottom: '4px' }}>
                          <span style={{ fontSize: '8px', color: '#222' }}>L10 AVG</span>
                          <span style={{ fontSize: '8px',
                            color: p.avg_last10 > p.line ? '#4ade80' : '#f87171' }}>
                            {p.avg_last10}
                          </span>
                        </div>
                        <div style={{ height: '2px', background: '#111',
                          borderRadius: '1px', overflow: 'hidden' }}>
                          <div style={{
                            width: `${Math.min(100, (p.avg_last10 / (p.line * 1.5)) * 100)}%`,
                            height: '100%', borderRadius: '1px',
                            background: p.avg_last10 > p.line ? '#4ade80' : '#f87171',
                          }} />
                        </div>
                      </div>
                    )}

                    {/* Score label */}
                    <div style={{ fontSize: '9px', color: edgeColor,
                      letterSpacing: '0.06em' }}>
                      {p.score_label}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
