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
  weighted_margin: number
  full_season_margin: number
}

interface FormRow {
  team: string
  team_id: number
  full_season_margin: number
  weighted_margin: number
  trend: number
  trending: 'up' | 'down' | 'neutral'
  l5: string
  l10: string
  l5_margin: number
  l10_margin: number
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
  const [view, setView] = useState<'teams' | 'form' | 'lineups'>('teams')
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [form, setForm] = useState<FormRow[]>([])
  const [lineups, setLineups] = useState<LineupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [season, setSeason] = useState('2025-26')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')
  const [minPoss, setMinPoss] = useState(50)

  useEffect(() => {
    setLoading(true)
    if (view === 'teams') {
      fetch(`${API}/teams/rankings?season=${season}`)
        .then(r => r.json())
        .then(d => { setTeams(d.results || []); setLoading(false) })
        .catch(() => setLoading(false))
    } else if (view === 'form') {
      fetch(`${API}/teams/form?season=${season}`)
        .then(r => r.json())
        .then(d => { setForm(d.results || []); setLoading(false) })
        .catch(() => setLoading(false))
    } else {
      fetch(`${API}/teams/lineups?season=${season}&min_possessions=${minPoss}`)
        .then(r => r.json())
        .then(d => { setLineups(d.results || []); setLoading(false) })
        .catch(() => setLoading(false))
    }
  }, [view, season, minPoss])

  const sortedTeams = [...teams]
    .sort((a, b) => sortDir === 'desc' ? b.net_rtg - a.net_rtg : a.net_rtg - b.net_rtg)
    .map((r, i) => ({ ...r, displayRank: i + 1 }))

  const sortedForm = [...form]
    .sort((a, b) => sortDir === 'desc' ? b.trend - a.trend : a.trend - b.trend)

  const sortedLineups = [...lineups]
    .sort((a, b) => sortDir === 'desc' ? b.net_rtg - a.net_rtg : a.net_rtg - b.net_rtg)
    .map((r, i) => ({ ...r, displayRank: i + 1 }))

  const maxTeamNet = Math.max(...teams.map(t => Math.abs(t.net_rtg)), 1)
  const maxLineupNet = Math.max(...lineups.map(l => Math.abs(l.net_rtg)), 1)
  const maxTrend = Math.max(...form.map(f => Math.abs(f.trend)), 1)

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.12em', marginBottom: '6px' }}>
          EXPONENTIAL DECAY WEIGHTING · λ=0.015 · HALF-LIFE 46 DAYS
        </div>
        <h1 style={{ fontSize: '22px', fontWeight: 400, color: '#f0f0f0', marginBottom: '8px' }}>Team Rankings</h1>
        <p style={{ color: '#555', fontSize: '13px', lineHeight: 1.6, maxWidth: '600px' }}>
          Rankings use exponential decay weighting — recent games count more than old ones.
          The <strong style={{ color: '#888' }}>Form</strong> tab shows which teams are trending up or down relative to their season average.
        </p>
      </div>

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
        {(['teams', 'form', 'lineups'] as const).map(v => (
          <button key={v} onClick={() => { setView(v); setSortDir('desc') }} style={{
            background: view === v ? '#1a1a1a' : '#0a0a0a',
            border: 'none', color: view === v ? '#e8e8e8' : '#444',
            padding: '10px 24px', fontSize: '12px',
            fontFamily: 'IBM Plex Mono, monospace', cursor: 'pointer',
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            {v === 'form' ? '🔥 Form' : v}
          </button>
        ))}
      </div>

      {/* Teams table */}
      {view === 'teams' && (
        <div style={{ border: '1px solid #1a1a1a' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '40px 70px 70px 1fr 110px 110px 70px',
            padding: '10px 20px', borderBottom: '1px solid #1a1a1a',
            fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.08em',
          }}>
            <span>#</span><span>TEAM</span><span>W-L</span>
            <span>WEIGHTED RATING</span>
            <span style={{ textAlign: 'right' }}>WEIGHTED</span>
            <span style={{ textAlign: 'right' }}>FULL SEASON</span>
            <span style={{ textAlign: 'right' }}>GAMES</span>
          </div>
          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#444' }}>Loading...</div>
          ) : sortedTeams.map((t, i) => {
            const isPos = t.net_rtg >= 0
            const barPct = Math.abs(t.net_rtg) / maxTeamNet * 45
            const delta = t.weighted_margin - t.full_season_margin
            return (
              <div key={t.team_id} style={{
                display: 'grid', gridTemplateColumns: '40px 70px 70px 1fr 110px 110px 70px',
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
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 600, color: t.net_rtg > 0 ? '#4ade80' : '#f87171' }}>
                    {t.net_rtg > 0 ? '+' : ''}{t.net_rtg}
                  </span>
                  {Math.abs(delta) > 0.3 && (
                    <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: delta > 0 ? '#4ade80' : '#f87171', marginLeft: '6px' }}>
                      {delta > 0 ? '↑' : '↓'}
                    </span>
                  )}
                </div>
                <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#444' }}>
                  {t.full_season_margin > 0 ? '+' : ''}{t.full_season_margin}
                </span>
                <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#333' }}>{t.games}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Form table */}
      {view === 'form' && (
        <div style={{ border: '1px solid #1a1a1a' }}>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid #1a1a1a', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', lineHeight: 1.8 }}>
            TREND = weighted recent margin minus full season margin. Positive = team is playing better than their season avg. Sorted by trend.
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: '70px 1fr 80px 80px 80px 80px 80px',
            padding: '10px 20px', borderBottom: '1px solid #1a1a1a',
            fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.08em',
          }}>
            <span>TEAM</span><span>TREND CHART</span>
            <span style={{ textAlign: 'right' }}>TREND</span>
            <span style={{ textAlign: 'right' }}>RECENT</span>
            <span style={{ textAlign: 'right' }}>SEASON</span>
            <span style={{ textAlign: 'right' }}>L5</span>
            <span style={{ textAlign: 'right' }}>L10</span>
          </div>
          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#444' }}>Loading...</div>
          ) : sortedForm.map((f, i) => {
            const isUp = f.trend > 0
            const barPct = Math.abs(f.trend) / maxTrend * 45
            return (
              <div key={f.team} style={{
                display: 'grid', gridTemplateColumns: '70px 1fr 80px 80px 80px 80px 80px',
                padding: '13px 20px', borderBottom: i < sortedForm.length - 1 ? '1px solid #111' : 'none',
                alignItems: 'center',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 700, color: '#e0e0e0' }}>{f.team}</span>
                  {f.trending === 'up' && <span style={{ fontSize: '10px' }}>🔥</span>}
                  {f.trending === 'down' && <span style={{ fontSize: '10px' }}>❄️</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', paddingRight: '16px' }}>
                  <div style={{ flex: 1, height: '4px', background: '#111', position: 'relative' }}>
                    <div style={{ position: 'absolute', left: '50%', top: '-2px', width: '1px', height: '8px', background: '#222' }} />
                    <div style={{
                      position: 'absolute', [isUp ? 'left' : 'right']: '50%',
                      width: `${barPct}%`, height: '100%',
                      background: isUp ? '#16a34a' : '#dc2626',
                    }} />
                  </div>
                </div>
                <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 600, color: isUp ? '#4ade80' : '#f87171' }}>
                  {f.trend > 0 ? '+' : ''}{f.trend}
                </span>
                <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: f.weighted_margin > 0 ? '#4ade80' : '#f87171' }}>
                  {f.weighted_margin > 0 ? '+' : ''}{f.weighted_margin}
                </span>
                <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#555' }}>
                  {f.full_season_margin > 0 ? '+' : ''}{f.full_season_margin}
                </span>
                <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#555' }}>{f.l5}</span>
                <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#555' }}>{f.l10}</span>
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
            <span>NET RTG</span>
            <span style={{ textAlign: 'right' }}>POSS</span>
            <span style={{ textAlign: 'right' }}>MIN</span>
            <span style={{ textAlign: 'right' }}>NET RTG</span>
          </div>
          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#444' }}>Loading...</div>
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
                      width: `${barPct}%`, height: '100%', background: isPos ? '#16a34a' : '#dc2626',
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
        {view === 'teams' && `${sortedTeams.length} teams · exponential decay weighted · λ=0.015 · half-life 46 days`}
        {view === 'form' && `${sortedForm.length} teams · trend = recent weighted margin minus full season avg`}
        {view === 'lineups' && `${sortedLineups.length} lineups · net rating per 100 possessions`}
      </div>
    </div>
  )
}
