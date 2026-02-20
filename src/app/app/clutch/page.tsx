'use client'

import { useEffect, useState } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface ClutchRow {
  team_id: number
  team: string
  clutch_net_rating: number
  clutch_off_rating: number
  clutch_def_rating: number
  clutch_stints: number
  games: number
}

export default function ClutchPage() {
  const [data, setData] = useState<ClutchRow[]>([])
  const [loading, setLoading] = useState(true)
  const [season, setSeason] = useState('2024-25')
  const [sortBy, setSortBy] = useState<'net' | 'off' | 'def'>('net')

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/clutch/?season=${season}`)
      .then((r) => r.json())
      .then((d) => { setData(d.results || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [season])

  const sorted = [...data].sort((a, b) => {
    if (sortBy === 'net') return b.clutch_net_rating - a.clutch_net_rating
    if (sortBy === 'off') return b.clutch_off_rating - a.clutch_off_rating
    return a.clutch_def_rating - b.clutch_def_rating
  })

  const maxNet = Math.max(...data.map(d => Math.abs(d.clutch_net_rating)), 1)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
        <div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.12em', marginBottom: '6px' }}>
            LAST 5 MIN · MARGIN ≤5 · PER 100 POSS
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: 400, color: '#f0f0f0' }}>Clutch Performance</h1>
        </div>
        <select value={season} onChange={(e) => setSeason(e.target.value)} style={{
          background: '#111', border: '1px solid #222', color: '#888',
          padding: '6px 12px', fontSize: '12px', fontFamily: 'IBM Plex Mono, monospace',
          outline: 'none', cursor: 'pointer',
        }}>
          <option value="2024-25">2024–25</option>
        </select>
      </div>

      <p style={{ color: '#555', fontSize: '13px', lineHeight: 1.6, maxWidth: '580px', marginBottom: '28px' }}>
        Net rating in clutch situations only: final 5 minutes of regulation with score within 5 points. 
        Separates pressure performers from aggregate noise.
      </p>

      {/* Sort tabs */}
      <div style={{ display: 'flex', gap: '1px', marginBottom: '1px', background: '#1a1a1a' }}>
        {[{ key: 'net', label: 'Net Rating' }, { key: 'off', label: 'Offensive' }, { key: 'def', label: 'Defensive' }].map(({ key, label }) => (
          <button key={key} onClick={() => setSortBy(key as any)} style={{
            background: sortBy === key ? '#1a1a1a' : '#0a0a0a',
            border: 'none', color: sortBy === key ? '#e8e8e8' : '#444',
            padding: '10px 20px', fontSize: '12px',
            fontFamily: 'IBM Plex Mono, monospace', cursor: 'pointer',
            letterSpacing: '0.06em',
          }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ border: '1px solid #1a1a1a' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '32px 80px 1fr 100px 100px 100px 70px',
          padding: '10px 20px', borderBottom: '1px solid #1a1a1a',
          fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.08em',
        }}>
          <span>#</span><span>TEAM</span><span>NET RATING CHART</span>
          <span style={{ textAlign: 'right' }}>NET RTG</span>
          <span style={{ textAlign: 'right' }}>OFF RTG</span>
          <span style={{ textAlign: 'right' }}>DEF RTG</span>
          <span style={{ textAlign: 'right' }}>GAMES</span>
        </div>

        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#444' }}>Loading...</div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#444', fontSize: '13px' }}>
            No clutch data. The clutch segments table needs more data.
          </div>
        ) : sorted.map((row, i) => {
          const barWidth = Math.abs(row.clutch_net_rating) / maxNet * 100
          const isPos = row.clutch_net_rating >= 0
          return (
            <div key={row.team_id} style={{
              display: 'grid', gridTemplateColumns: '32px 80px 1fr 100px 100px 100px 70px',
              padding: '13px 20px', borderBottom: i < sorted.length - 1 ? '1px solid #111' : 'none',
              alignItems: 'center',
            }}>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#333' }}>{i + 1}</span>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 600, color: '#e0e0e0' }}>{row.team}</span>
              <div style={{ display: 'flex', alignItems: 'center', paddingRight: '20px' }}>
                <div style={{ flex: 1, height: '4px', background: '#111', position: 'relative' }}>
                  <div style={{
                    position: 'absolute',
                    [isPos ? 'left' : 'right']: '50%',
                    width: `${barWidth / 2}%`,
                    height: '100%',
                    background: isPos ? '#16a34a' : '#dc2626',
                  }} />
                  <div style={{ position: 'absolute', left: '50%', top: '-2px', width: '1px', height: '8px', background: '#2a2a2a' }} />
                </div>
              </div>
              <span style={{
                textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 600,
                color: row.clutch_net_rating > 0 ? '#4ade80' : '#f87171',
              }}>
                {row.clutch_net_rating > 0 ? '+' : ''}{row.clutch_net_rating.toFixed(1)}
              </span>
              <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#666' }}>
                {row.clutch_off_rating.toFixed(1)}
              </span>
              <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#666' }}>
                {row.clutch_def_rating.toFixed(1)}
              </span>
              <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#444' }}>
                {row.games}
              </span>
            </div>
          )
        })}
      </div>
      {sorted.length > 0 && (
        <div style={{ marginTop: '16px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333' }}>
          {sorted.length} teams · all values per 100 possessions
        </div>
      )}
    </div>
  )
}
