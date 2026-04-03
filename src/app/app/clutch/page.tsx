'use client'

import { useEffect, useState } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface TeamRow {
  rank: number
  team: string
  clutch_net_rating: number
  clutch_off_rating: number
  clutch_def_rating: number
  games: number
}

interface PlayerRow {
  rank: number
  player_id: number
  player: string
  team: string
  games: number
  clutch_stints: number
  clutch_minutes: number
  clutch_net_rtg: number
}

export default function ClutchPage() {
  const [view, setView] = useState<'teams' | 'players'>('teams')
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [players, setPlayers] = useState<PlayerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [season, setSeason] = useState('2025-26')
  const [teamFilter, setTeamFilter] = useState('')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')

  useEffect(() => {
    setLoading(true)
    if (view === 'teams') {
      fetch(`${API}/clutch/teams?season=${season}`)
        .then(r => r.json())
        .then(d => { setTeams(d.results || []); setLoading(false) })
        .catch(() => setLoading(false))
    } else {
      const tf = teamFilter ? `&team=${teamFilter}` : ''
      fetch(`${API}/clutch/players?season=${season}${tf}&min_clutch_fga=5`)
        .then(r => r.json())
        .then(d => { setPlayers(d.results || []); setLoading(false) })
        .catch(() => setLoading(false))
    }
  }, [view, season, teamFilter])

  const sortedTeams = [...teams].sort((a, b) =>
    sortDir === 'desc' ? b.clutch_net_rating - a.clutch_net_rating : a.clutch_net_rating - b.clutch_net_rating
  ).map((r, i) => ({ ...r, displayRank: i + 1 }))

  const sortedPlayers = [...players].sort((a, b) =>
    sortDir === 'desc' ? b.clutch_net_rtg - a.clutch_net_rtg : a.clutch_net_rtg - b.clutch_net_rtg
  ).map((r, i) => ({ ...r, displayRank: i + 1 }))

  const maxTeamNet = Math.max(...teams.map(t => Math.abs(t.clutch_net_rating)), 1)
  const maxPlayerNet = Math.max(...players.map(p => Math.abs(p.clutch_net_rtg)), 1)

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#909090', letterSpacing: '0.12em', marginBottom: '6px' }}>
          LAST 5 MIN · MARGIN ≤5 · PER 100 POSS
        </div>
        <h1 style={{ fontSize: '22px', fontWeight: 400, color: '#f0f0f0', marginBottom: '8px' }}>Clutch Performance</h1>
        <p style={{ color: '#b0aea8', fontSize: '13px', lineHeight: 1.6, maxWidth: '560px' }}>
          Net rating in clutch situations only: final 5 minutes with score within 5 points.
        </p>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '1px', flexWrap: 'wrap' }}>
        <select value={season} onChange={e => setSeason(e.target.value)} style={{
          background: '#111', border: '1px solid #222', color: '#888',
          padding: '6px 12px', fontSize: '12px', fontFamily: 'IBM Plex Mono, monospace', outline: 'none', cursor: 'pointer',
        }}>
          <option value="2024-25">2024-25</option>
          <option value="2025-26">2025-26</option>
        </select>

        {view === 'players' && (
          <input
            type="text"
            placeholder="Filter by team (e.g. OKC)"
            value={teamFilter}
            onChange={e => setTeamFilter(e.target.value.toUpperCase())}
            style={{
              background: '#111', border: '1px solid #222', color: '#888',
              padding: '6px 12px', fontSize: '12px', fontFamily: 'IBM Plex Mono, monospace',
              outline: 'none', width: '180px',
            }}
          />
        )}

        <button onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')} style={{
          background: '#111', border: '1px solid #222', color: '#888',
          padding: '6px 12px', fontSize: '12px', fontFamily: 'IBM Plex Mono, monospace', cursor: 'pointer',
        }}>
          {sortDir === 'desc' ? '↓ Best first' : '↑ Worst first'}
        </button>
      </div>

      {/* View tabs */}
      <div style={{ display: 'flex', gap: '1px', marginBottom: '1px', background: '#1a1a1a' }}>
        {(['teams', 'players'] as const).map(v => (
          <button key={v} onClick={() => { setView(v); setSortDir('desc') }} style={{
            background: view === v ? '#1a1a1a' : '#0a0a0a',
            border: 'none', color: view === v ? '#e8e8e8' : '#444',
            padding: '10px 24px', fontSize: '12px',
            fontFamily: 'IBM Plex Mono, monospace', cursor: 'pointer', letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}>
            {v}
          </button>
        ))}
      </div>

      {/* Teams table */}
      {view === 'teams' && (
        <div style={{ border: '1px solid #1a1a1a' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '40px 80px 1fr 100px 100px 100px 70px',
            padding: '10px 20px', borderBottom: '1px solid #222228',
            fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#909090', letterSpacing: '0.08em',
          }}>
            <span>#</span><span>TEAM</span><span>NET RTG CHART</span>
            <span style={{ textAlign: 'right' }}>NET RTG</span>
            <span style={{ textAlign: 'right' }}>OFF RTG</span>
            <span style={{ textAlign: 'right' }}>DEF RTG</span>
            <span style={{ textAlign: 'right' }}>GAMES</span>
          </div>
          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#909090' }}>Loading...</div>
          ) : sortedTeams.map((r, i) => {
            const isPos = r.clutch_net_rating >= 0
            const barPct = Math.abs(r.clutch_net_rating) / maxTeamNet * 45
            return (
              <div key={r.team} style={{
                display: 'grid', gridTemplateColumns: '40px 80px 1fr 100px 100px 100px 70px',
                padding: '13px 20px', borderBottom: i < sortedTeams.length - 1 ? '1px solid #111' : 'none', alignItems: 'center',
              }}>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#909090' }}>{r.displayRank}</span>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 600, color: '#e0e0e0' }}>{r.team}</span>
                <div style={{ display: 'flex', alignItems: 'center', paddingRight: '16px' }}>
                  <div style={{ flex: 1, height: '4px', background: '#111', position: 'relative' }}>
                    <div style={{ position: 'absolute', [isPos ? 'left' : 'right']: '50%', width: `${barPct}%`, height: '100%', background: isPos ? '#16a34a' : '#dc2626' }} />
                    <div style={{ position: 'absolute', left: '50%', top: '-2px', width: '1px', height: '8px', background: '#2a2a2a' }} />
                  </div>
                </div>
                <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 600, color: r.clutch_net_rating > 0 ? '#4ade80' : '#f87171' }}>
                  {r.clutch_net_rating > 0 ? '+' : ''}{r.clutch_net_rating.toFixed(1)}
                </span>
                <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#666' }}>{r.clutch_off_rating.toFixed(1)}</span>
                <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#666' }}>{r.clutch_def_rating.toFixed(1)}</span>
                <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#909090' }}>{r.games}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Players table */}
      {view === 'players' && (
        <div style={{ border: '1px solid #1a1a1a' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '40px 180px 60px 1fr 70px 80px 100px',
            padding: '10px 20px', borderBottom: '1px solid #222228',
            fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#909090', letterSpacing: '0.08em',
          }}>
            <span>#</span><span>PLAYER</span><span>TEAM</span><span>CLUTCH NET RTG CHART</span>
            <span style={{ textAlign: 'right' }}>GAMES</span>
            <span style={{ textAlign: 'right' }}>MIN</span>
            <span style={{ textAlign: 'right' }}>NET RTG</span>
          </div>
          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#909090' }}>Loading...</div>
          ) : sortedPlayers.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#909090', fontSize: '13px' }}>No clutch data found.</div>
          ) : sortedPlayers.map((p, i) => {
            const isPos = p.clutch_net_rtg >= 0
            const barPct = Math.abs(p.clutch_net_rtg) / maxPlayerNet * 45
            return (
              <div key={p.player_id} style={{
                display: 'grid', gridTemplateColumns: '40px 180px 60px 1fr 70px 80px 100px',
                padding: '13px 20px', borderBottom: i < sortedPlayers.length - 1 ? '1px solid #111' : 'none', alignItems: 'center',
              }}>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#909090' }}>{p.displayRank}</span>
                <span style={{ fontSize: '13px', color: '#e0e0e0', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.player}</span>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#b0aea8' }}>{p.team}</span>
                <div style={{ display: 'flex', alignItems: 'center', paddingRight: '16px' }}>
                  <div style={{ flex: 1, height: '4px', background: '#111', position: 'relative' }}>
                    <div style={{ position: 'absolute', [isPos ? 'left' : 'right']: '50%', width: `${barPct}%`, height: '100%', background: isPos ? '#16a34a' : '#dc2626' }} />
                    <div style={{ position: 'absolute', left: '50%', top: '-2px', width: '1px', height: '8px', background: '#2a2a2a' }} />
                  </div>
                </div>
                <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#b0aea8' }}>{p.games}</span>
                <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#b0aea8' }}>{p.clutch_minutes.toFixed(0)}</span>
                <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 600, color: p.clutch_net_rtg > 0 ? '#4ade80' : '#f87171' }}>
                  {p.clutch_net_rtg > 0 ? '+' : ''}{p.clutch_net_rtg.toFixed(1)}
                </span>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ marginTop: '16px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#909090' }}>
        {view === 'teams' ? `${sortedTeams.length} teams` : `${sortedPlayers.length} players`} · clutch = last 5 min, margin ≤5 · per 100 possessions
      </div>
    </div>
  )
}
