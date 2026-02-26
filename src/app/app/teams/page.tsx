'use client'

import { useEffect, useState } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface TeamRow {
  rank: number
  team_id: number
  team: string
  wins: number
  losses: number
  games: number
  avg_margin: number
  net_rtg: number
}

interface LineupRow {
  rank: number
  lineup_id: string
  team: string
  team_id: number
  players: string[]
  games: number
  possessions: number
  minutes: number
  net_rtg: number
}

export default function TeamsPage() {
  const [view, setView] = useState<'teams' | 'lineups'>('teams')
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [lineups, setLineups] = useState<LineupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [season, setSeason] = useState('2025-26')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')
  const [teamFilter, setTeamFilter] = useState('')
  const [minPoss, setMinPoss] = useState(50)

  useEffect(() => {
    setLoading(true)
    if (view === 'teams') {
      fetch(`${API}/teams/rankings?season=${season}`)
        .then(r => r.json())
        .then(d => { setTeams(d.results || []); setLoading(false) })
        .catch(() => setLoading(false))
    } else {
      const tf = teamFilter ? `&team_id=${teamFilter}` : ''
      fetch(`${API}/teams/lineups?season=${season}&min_possessions=${minPoss}${tf}`)
        .then(r => r.json())
        .then(d => { setLineups(d.results || []); setLoading(false) })
        .catch(() => setLoading(false))
    }
  }, [view, season, teamFilter, minPoss])

  const sortedTeams = [...teams]
    .sort((a, b) => sortDir === 'desc' ? b.net_rtg - a.net_rtg : a.net_rtg - b.net_rtg)
    .map((r, i) => ({ ...r, displayRank: i + 1 }))

  const sortedLineups = [...lineups]
    .sort((a, b) => sortDir === 'desc' ? b.net_rtg - a.net_rtg : a.net_rtg - b.net_rtg)
    .map((r, i) => ({ ...r, displayRank: i + 1 }))

  const maxTeamNet = Math.max(...teams.map(t => Math.abs(t.net_rtg)), 1)
  const maxLineupNet = Math.max(...lineups.map(l => Math.abs(l.net_rtg)), 1)

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.12em', marginBottom: '6px' }}>
          NET RATING · PER 100 POSSESSIONS · {season}
        </div>
        <h1 style={{ fontSize: '22px', fontWeight: 400, color: '#f0f0f0', marginBottom: '8px' }}>Team Rankings</h1>
        <p style={{ color: '#555', fontSize: '13px', lineHeight: 1.6, maxWidth: '560px' }}>
          Team and lineup net ratings computed from 5-man stint data. Net rating = offensive rating minus defensive rating per 100 possessions.
        </p>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '1px', flexWrap: 'wrap' }}>
        <select value={season} onChange={e => setSeason(e.target.value)} style={{
          background: '#111', border: '1px solid #222', color: '#888',
          padding: '6px 12px', fontSize: '12px', fontFamily: 'IBM Plex Mono, monospace', outline: 'none', cursor: 'pointer',
        }}>
          <option value="2025-26">2025-26</option>
          <option value="2024-25">2024-25</option>
        </select>

        {view === 'lineups' && (
          <select value={minPoss} onChange={e => setMinPoss(Number(e.target.value))} style={{
            background: '#111', border: '1px solid #222', color: '#888',
            padding: '6px 12px', fontSize: '12px', fontFamily: 'IBM Plex Mono, monospace', outline: 'none', cursor: 'pointer',
          }}>
            <option value={20}>20+ poss</option>
            <option value={50}>50+ poss</option>
            <option value={100}>100+ poss</option>
            <option value={200}>200+ poss</option>
          </select>
        )}

        <button onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')} style={{
          background: '#111', border: '1px solid #222', color: '#888',
          padding: '6px 12px', fontSize: '12px', fontFamily: 'IBM Plex Mono, monospace', cursor: 'pointer',
        }}>
          {sortDir === 'desc' ? '↓ Best first' : '↑ Worst first'}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '1px', marginBottom: '1px', background: '#1a1a1a' }}>
        {(['teams', 'lineups'] as const).map(v => (
          <button key={v} onClick={() => { setView(v); setSortDir('desc') }} style={{
            background: view === v ? '#1a1a1a' : '#0a0a0a',
            border: 'none', color: view === v ? '#e8e8e8' : '#444',
            padding: '10px 24px', fontSize: '12px',
            fontFamily: 'IBM Plex Mono, monospace', cursor: 'pointer',
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            {v}
          </button>
        ))}
      </div>

      {/* Teams table */}
      {view === 'teams' && (
        <div style={{ border: '1px solid #1a1a1a' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '40px 80px 80px 1fr 90px 90px 90px',
            padding: '10px 20px', borderBottom: '1px solid #1a1a1a',
            fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.08em',
          }}>
            <span>#</span><span>TEAM</span><span>RECORD</span>
            <span>NET RTG CHART</span>
            <span style={{ textAlign: 'right' }}>NET RTG</span>
            <span style={{ textAlign: 'right' }}>MARGIN</span>
            <span style={{ textAlign: 'right' }}>GAMES</span>
          </div>
          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#444' }}>Loading...</div>
          ) : sortedTeams.map((t, i) => {
            const isPos = t.net_rtg >= 0
            const barPct = Math.abs(t.net_rtg) / maxTeamNet * 45
            return (
              <div key={t.team_id} style={{
                display: 'grid', gridTemplateColumns: '40px 80px 80px 1fr 90px 90px 90px',
                padding: '13px 20px', borderBottom: i < sortedTeams.length - 1 ? '1px solid #111' : 'none',
                alignItems: 'center',
              }}>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#333' }}>{t.displayRank}</span>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '14px', fontWeight: 700, color: '#e0e0e0' }}>{t.team}</span>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#555' }}>{t.wins}-{t.losses}</span>
                <div style={{ display: 'flex', alignItems: 'center', paddingRight: '16px' }}>
                  <div style={{ flex: 1, height: '4px', background: '#111', position: 'relative' }}>
                    <div style={{ position: 'absolute', left: '50%', top: '-2px', width: '1px', height: '8px', background: '#222' }} />
                    <div style={{
                      position: 'absolute', [isPos ? 'left' : 'right']: '50%',
                      width: `${barPct}%`, height: '100%',
                      background: isPos ? '#16a34a' : '#dc2626',
                    }} />
                  </div>
                </div>
                <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 600, color: t.net_rtg > 0 ? '#4ade80' : '#f87171' }}>
                  {t.net_rtg > 0 ? '+' : ''}{t.net_rtg}
                </span>
                <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#555' }}>
                  {t.avg_margin > 0 ? '+' : ''}{t.avg_margin}
                </span>
                <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#444' }}>{t.games}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Lineups table */}
      {view === 'lineups' && (
        <div style={{ border: '1px solid #1a1a1a' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '40px 60px 1fr 1fr 70px 80px 90px',
            padding: '10px 20px', borderBottom: '1px solid #1a1a1a',
            fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.08em',
          }}>
            <span>#</span><span>TEAM</span><span>LINEUP</span>
            <span>NET RTG CHART</span>
            <span style={{ textAlign: 'right' }}>POSS</span>
            <span style={{ textAlign: 'right' }}>MIN</span>
            <span style={{ textAlign: 'right' }}>NET RTG</span>
          </div>
          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#444' }}>Loading...</div>
          ) : sortedLineups.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#444', fontSize: '13px' }}>No lineups found.</div>
          ) : sortedLineups.map((l, i) => {
            const isPos = l.net_rtg >= 0
            const barPct = Math.abs(l.net_rtg) / maxLineupNet * 45
            const playerStr = l.players.map(p => p.split(' ').pop()).join(' · ')
            return (
              <div key={l.lineup_id} style={{
                display: 'grid', gridTemplateColumns: '40px 60px 1fr 1fr 70px 80px 90px',
                padding: '13px 20px', borderBottom: i < sortedLineups.length - 1 ? '1px solid #111' : 'none',
                alignItems: 'center',
              }}>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#333' }}>{l.displayRank}</span>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', fontWeight: 700, color: '#e0e0e0' }}>{l.team}</span>
                <span style={{ fontSize: '12px', color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '12px' }} title={l.players.join(', ')}>
                  {playerStr}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', paddingRight: '16px' }}>
                  <div style={{ flex: 1, height: '4px', background: '#111', position: 'relative' }}>
                    <div style={{ position: 'absolute', left: '50%', top: '-2px', width: '1px', height: '8px', background: '#222' }} />
                    <div style={{
                      position: 'absolute', [isPos ? 'left' : 'right']: '50%',
                      width: `${barPct}%`, height: '100%',
                      background: isPos ? '#16a34a' : '#dc2626',
                    }} />
                  </div>
                </div>
                <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#555' }}>{l.possessions}</span>
                <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#555' }}>{l.minutes}</span>
                <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 600, color: l.net_rtg > 0 ? '#4ade80' : '#f87171' }}>
                  {l.net_rtg > 0 ? '+' : ''}{l.net_rtg}
                </span>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ marginTop: '16px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333' }}>
        {view === 'teams' ? `${sortedTeams.length} teams` : `${sortedLineups.length} lineups`} · net rating per 100 possessions
      </div>
    </div>
  )
}
