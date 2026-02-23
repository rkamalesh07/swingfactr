'use client'

import { useEffect, useState } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Player {
  rank: number
  player_id: number
  player: string
  team: string
  games: number
  minutes: number
  net_rtg: number
}

export default function PlayersPage() {
  const [players, setPlayers] = useState<Player[]>([])
  const [teams, setTeams] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [season, setSeason] = useState('2024-25')
  const [team, setTeam] = useState('')
  const [minMinutes, setMinMinutes] = useState(300)
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')

  useEffect(() => {
    fetch(`${API}/players/teams?season=${season}`)
      .then(r => r.json())
      .then(d => setTeams(d.teams || []))
      .catch(() => {})
  }, [season])

  useEffect(() => {
    setLoading(true)
    const teamParam = team ? `&team=${team}` : ''
    fetch(`${API}/players/?season=${season}&min_minutes=${minMinutes}${teamParam}`)
      .then(r => r.json())
      .then(d => { setPlayers(d.results || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [season, team, minMinutes])

  const sorted = [...players]
    .sort((a, b) => sortDir === 'desc' ? b.net_rtg - a.net_rtg : a.net_rtg - b.net_rtg)
    .map((p, i) => ({ ...p, displayRank: i + 1 }))

  const maxAbs = Math.max(...players.map(p => Math.abs(p.net_rtg)), 1)

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.12em', marginBottom: '6px' }}>
          STINT-BASED · NET RATING PER 100 POSSESSIONS
        </div>
        <h1 style={{ fontSize: '22px', fontWeight: 400, color: '#f0f0f0', marginBottom: '8px' }}>Player Ratings</h1>
        <p style={{ color: '#555', fontSize: '13px', maxWidth: '560px', lineHeight: 1.6 }}>
          Net rating when each player is on the court, computed from 5-man lineup stints. Minimum minutes filter removes small samples.
        </p>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <select value={season} onChange={e => setSeason(e.target.value)} style={{
          background: '#111', border: '1px solid #222', color: '#888',
          padding: '6px 12px', fontSize: '12px', fontFamily: 'IBM Plex Mono, monospace', outline: 'none', cursor: 'pointer',
        }}>
          <option value="2024-25">2024-25</option>
          <option value="2025-26">2025-26</option>
        </select>

        <select value={team} onChange={e => setTeam(e.target.value)} style={{
          background: '#111', border: '1px solid #222', color: '#888',
          padding: '6px 12px', fontSize: '12px', fontFamily: 'IBM Plex Mono, monospace', outline: 'none', cursor: 'pointer',
        }}>
          <option value="">All Teams</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <select value={minMinutes} onChange={e => setMinMinutes(Number(e.target.value))} style={{
          background: '#111', border: '1px solid #222', color: '#888',
          padding: '6px 12px', fontSize: '12px', fontFamily: 'IBM Plex Mono, monospace', outline: 'none', cursor: 'pointer',
        }}>
          <option value={100}>100+ min</option>
          <option value={300}>300+ min</option>
          <option value={500}>500+ min</option>
          <option value={1000}>1000+ min</option>
        </select>

        <button onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')} style={{
          background: '#111', border: '1px solid #222', color: '#888',
          padding: '6px 12px', fontSize: '12px', fontFamily: 'IBM Plex Mono, monospace', cursor: 'pointer',
        }}>
          {sortDir === 'desc' ? '↓ Best first' : '↑ Worst first'}
        </button>
      </div>

      {/* Table */}
      <div style={{ border: '1px solid #1a1a1a' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '40px 180px 60px 1fr 70px 80px 90px',
          padding: '10px 20px', borderBottom: '1px solid #1a1a1a',
          fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.08em',
        }}>
          <span>#</span>
          <span>PLAYER</span>
          <span>TEAM</span>
          <span>NET RTG CHART</span>
          <span style={{ textAlign: 'right' }}>GAMES</span>
          <span style={{ textAlign: 'right' }}>MIN</span>
          <span style={{ textAlign: 'right' }}>NET RTG</span>
        </div>

        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#444' }}>Loading...</div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#444', fontSize: '13px' }}>No players found.</div>
        ) : sorted.map((p, i) => {
          const isPos = p.net_rtg >= 0
          const barPct = Math.abs(p.net_rtg) / maxAbs * 45
          return (
            <div key={p.player_id} style={{
              display: 'grid', gridTemplateColumns: '40px 180px 60px 1fr 70px 80px 90px',
              padding: '13px 20px', borderBottom: i < sorted.length - 1 ? '1px solid #111' : 'none',
              alignItems: 'center',
            }}>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#333' }}>{(p as any).displayRank}</span>
              <span style={{ fontSize: '13px', color: '#e0e0e0', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.player}</span>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#555' }}>{p.team}</span>
              <div style={{ display: 'flex', alignItems: 'center', paddingRight: '16px' }}>
                <div style={{ flex: 1, height: '4px', background: '#111', position: 'relative' }}>
                  <div style={{ position: 'absolute', left: '50%', top: '-2px', width: '1px', height: '8px', background: '#222' }} />
                  <div style={{
                    position: 'absolute',
                    [isPos ? 'left' : 'right']: '50%',
                    width: `${barPct}%`,
                    height: '100%',
                    background: isPos ? '#16a34a' : '#dc2626',
                  }} />
                </div>
              </div>
              <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#555' }}>{p.games}</span>
              <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#555' }}>{p.minutes}</span>
              <span style={{
                textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 600,
                color: p.net_rtg > 0 ? '#4ade80' : p.net_rtg < 0 ? '#f87171' : '#555',
              }}>
                {p.net_rtg > 0 ? '+' : ''}{p.net_rtg}
              </span>
            </div>
          )
        })}
      </div>

      {sorted.length > 0 && (
        <div style={{ marginTop: '16px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333' }}>
          {sorted.length} players · min {minMinutes} minutes · net rating per 100 possessions
        </div>
      )}
    </div>
  )
}
