'use client'

import { useEffect, useState } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const TEAMS = [
  { id: 1, name: 'ATL — Hawks' },
  { id: 17, name: 'BKN — Nets' },
  { id: 2, name: 'BOS — Celtics' },
  { id: 30, name: 'CHA — Hornets' },
  { id: 4, name: 'CHI — Bulls' },
  { id: 5, name: 'CLE — Cavaliers' },
  { id: 6, name: 'DAL — Mavericks' },
  { id: 7, name: 'DEN — Nuggets' },
  { id: 8, name: 'DET — Pistons' },
  { id: 9, name: 'GS — Warriors' },
  { id: 10, name: 'HOU — Rockets' },
  { id: 11, name: 'IND — Pacers' },
  { id: 12, name: 'LAC — Clippers' },
  { id: 13, name: 'LAL — Lakers' },
  { id: 29, name: 'MEM — Grizzlies' },
  { id: 14, name: 'MIA — Heat' },
  { id: 15, name: 'MIL — Bucks' },
  { id: 16, name: 'MIN — Timberwolves' },
  { id: 3, name: 'NO — Pelicans' },
  { id: 18, name: 'NY — Knicks' },
  { id: 25, name: 'OKC — Thunder' },
  { id: 19, name: 'ORL — Magic' },
  { id: 20, name: 'PHI — 76ers' },
  { id: 21, name: 'PHX — Suns' },
  { id: 22, name: 'POR — Trail Blazers' },
  { id: 23, name: 'SAC — Kings' },
  { id: 24, name: 'SA — Spurs' },
  { id: 28, name: 'TOR — Raptors' },
  { id: 26, name: 'UTAH — Jazz' },
  { id: 27, name: 'WSH — Wizards' },
]

interface Lineup {
  lineup_id: string
  lineup_display: string
  total_minutes: number
  net_rating: number | null
  off_rating: number | null
  def_rating: number | null
  rapm_estimate: number | null
  rapm_ci_low: number | null
  rapm_ci_high: number | null
  stint_count: number
}

const fmt = (v: number | null, d = 1) => v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(d)
const fmtAbs = (v: number | null, d = 1) => v == null ? '—' : v.toFixed(d)

export default function LineupsPage() {
  const [teamId, setTeamId] = useState(2)
  const [season] = useState('2025-26')
  const [lineups, setLineups] = useState<Lineup[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/team/${teamId}/lineup_rankings?season=${season}&min_minutes=3`)
      .then((r) => r.json())
      .then((d) => { setLineups(d.lineups || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [teamId, season])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
        <div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.12em', marginBottom: '6px' }}>
            RAPM · RIDGE REGRESSION · α=2000
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: 400, color: '#f0f0f0' }}>Lineup Rankings</h1>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <select value={teamId} onChange={(e) => setTeamId(Number(e.target.value))} style={{
            background: '#111', border: '1px solid #222', color: '#888',
            padding: '6px 12px', fontSize: '12px', fontFamily: 'IBM Plex Mono, monospace',
            outline: 'none', cursor: 'pointer',
          }}>
            {TEAMS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>

      <p style={{ color: '#555', fontSize: '13px', lineHeight: 1.6, maxWidth: '600px', marginBottom: '28px' }}>
        RAPM isolates lineup impact by controlling for opponent quality via ridge regression.
        Confidence intervals from 50 bootstrap samples. Minimum 3 minutes played.
      </p>

      <div style={{ border: '1px solid #1a1a1a' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '32px 1fr 70px 80px 80px 80px 120px',
          padding: '10px 20px', borderBottom: '1px solid #1a1a1a',
          fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.08em',
        }}>
          <span>#</span><span>LINEUP</span>
          <span style={{ textAlign: 'right' }}>MIN</span>
          <span style={{ textAlign: 'right' }}>NET RTG</span>
          <span style={{ textAlign: 'right' }}>OFF</span>
          <span style={{ textAlign: 'right' }}>DEF</span>
          <span style={{ textAlign: 'right' }}>RAPM (90% CI)</span>
        </div>

        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#444' }}>Loading...</div>
        ) : lineups.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#444', fontSize: '13px' }}>
            No lineup data for this team. Try another team.
          </div>
        ) : lineups.map((l, i) => (
          <div key={l.lineup_id} style={{
            display: 'grid', gridTemplateColumns: '32px 1fr 70px 80px 80px 80px 120px',
            padding: '14px 20px',
            borderBottom: i < lineups.length - 1 ? '1px solid #111' : 'none',
            alignItems: 'center',
          }}>
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#333' }}>{i + 1}</span>
            <span style={{ fontSize: '13px', color: '#ccc' }}>{l.lineup_display || l.lineup_id}</span>
            <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#555' }}>
              {l.total_minutes ? Math.round(l.total_minutes) : '—'}
            </span>
            <span style={{
              textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 600,
              color: l.net_rating == null ? '#444' : l.net_rating > 0 ? '#4ade80' : '#f87171',
            }}>
              {fmt(l.net_rating)}
            </span>
            <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#666' }}>
              {fmtAbs(l.off_rating)}
            </span>
            <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#666' }}>
              {fmtAbs(l.def_rating)}
            </span>
            <div style={{ textAlign: 'right' }}>
              <span style={{
                fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 600,
                color: l.rapm_estimate == null ? '#444' : l.rapm_estimate > 0 ? '#4ade80' : '#f87171',
              }}>
                {fmt(l.rapm_estimate)}
              </span>
              {l.rapm_ci_low != null && l.rapm_ci_high != null && (
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333', marginLeft: '6px' }}>
                  [{l.rapm_ci_low.toFixed(1)}, {l.rapm_ci_high.toFixed(1)}]
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {lineups.length > 0 && (
        <div style={{ marginTop: '16px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333' }}>
          {lineups.length} lineups · sorted by RAPM desc · all values per 100 possessions
        </div>
      )}
    </div>
  )
}
