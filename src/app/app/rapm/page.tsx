'use client'

import { useEffect, useState } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface RAPMRow {
  rank: number
  player_id: number
  player: string
  team: string
  rapm: number
  minutes: number
}

export default function RAPMPage() {
  const [data, setData] = useState<RAPMRow[]>([])
  const [loading, setLoading] = useState(true)
  const [season, setSeason] = useState('2025-26')
  const [minMinutes, setMinMinutes] = useState(200)
  const [team, setTeam] = useState('')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')

  useEffect(() => {
    setLoading(true)
    const teamParam = team ? `&team=${team}` : ''
    fetch(`${API}/rapm/?season=${season}&min_minutes=${minMinutes}${teamParam}`)
      .then(r => r.json())
      .then(d => { setData(d.results || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [season, minMinutes, team])

  const sorted = [...data]
    .sort((a, b) => sortDir === 'desc' ? b.rapm - a.rapm : a.rapm - b.rapm)
    .map((r, i) => ({ ...r, displayRank: i + 1 }))

  const maxAbs = Math.max(...data.map(p => Math.abs(p.rapm)), 1)

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#909090', letterSpacing: '0.12em', marginBottom: '6px' }}>
          RIDGE REGRESSION · ADJUSTED FOR TEAMMATES & OPPONENTS
        </div>
        <h1 style={{ fontSize: '22px', fontWeight: 400, color: '#f0f0f0', marginBottom: '8px' }}>RAPM</h1>
        <p style={{ color: '#b0aea8', fontSize: '13px', lineHeight: 1.6, maxWidth: '600px' }}>
          Regularized Adjusted Plus/Minus — how many points per 100 possessions each player adds above replacement, 
          controlling for the quality of teammates and opponents on the court. The same metric used by NBA front offices.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <select value={season} onChange={e => setSeason(e.target.value)} style={{
          background: '#111', border: '1px solid #222', color: '#888',
          padding: '6px 12px', fontSize: '12px', fontFamily: 'IBM Plex Mono, monospace', outline: 'none', cursor: 'pointer',
        }}>
          <option value="2025-26">2025-26</option>
          <option value="2024-25">2024-25</option>
        </select>

        <select value={minMinutes} onChange={e => setMinMinutes(Number(e.target.value))} style={{
          background: '#111', border: '1px solid #222', color: '#888',
          padding: '6px 12px', fontSize: '12px', fontFamily: 'IBM Plex Mono, monospace', outline: 'none', cursor: 'pointer',
        }}>
          <option value={100}>100+ min</option>
          <option value={200}>200+ min</option>
          <option value={500}>500+ min</option>
          <option value={1000}>1000+ min</option>
        </select>

        <input
          type="text"
          placeholder="Filter team (e.g. OKC)"
          value={team}
          onChange={e => setTeam(e.target.value.toUpperCase())}
          style={{
            background: '#111', border: '1px solid #222', color: '#888',
            padding: '6px 12px', fontSize: '12px', fontFamily: 'IBM Plex Mono, monospace',
            outline: 'none', width: '160px',
          }}
        />

        <button onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')} style={{
          background: '#111', border: '1px solid #222', color: '#888',
          padding: '6px 12px', fontSize: '12px', fontFamily: 'IBM Plex Mono, monospace', cursor: 'pointer',
        }}>
          {sortDir === 'desc' ? '↓ Best first' : '↑ Worst first'}
        </button>
      </div>

      <div style={{ border: '1px solid #1a1a1a' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '40px 180px 60px 1fr 80px 90px',
          padding: '10px 20px', borderBottom: '1px solid #222228',
          fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#909090', letterSpacing: '0.08em',
        }}>
          <span>#</span><span>PLAYER</span><span>TEAM</span>
          <span>RAPM CHART</span>
          <span style={{ textAlign: 'right' }}>MIN</span>
          <span style={{ textAlign: 'right' }}>RAPM</span>
        </div>

        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#909090' }}>
            Computing RAPM... (this may take 10-15 seconds)
          </div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#909090', fontSize: '13px' }}>No data found.</div>
        ) : sorted.map((p, i) => {
          const isPos = p.rapm >= 0
          const barPct = Math.abs(p.rapm) / maxAbs * 45
          return (
            <div key={p.player_id} style={{
              display: 'grid', gridTemplateColumns: '40px 180px 60px 1fr 80px 90px',
              padding: '13px 20px', borderBottom: i < sorted.length - 1 ? '1px solid #111' : 'none',
              alignItems: 'center',
            }}>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#909090' }}>{p.displayRank}</span>
              <span style={{ fontSize: '13px', color: '#e0e0e0', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.player}</span>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#b0aea8' }}>{p.team}</span>
              <div style={{ display: 'flex', alignItems: 'center', paddingRight: '16px' }}>
                <div style={{ flex: 1, height: '4px', background: '#111', position: 'relative' }}>
                  <div style={{ position: 'absolute', left: '50%', top: '-2px', width: '1px', height: '8px', background: '#222' }} />
                  <div style={{
                    position: 'absolute',
                    [isPos ? 'left' : 'right']: '50%',
                    width: `${barPct}%`, height: '100%',
                    background: isPos ? '#16a34a' : '#dc2626',
                  }} />
                </div>
              </div>
              <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#b0aea8' }}>{p.minutes}</span>
              <span style={{
                textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 600,
                color: p.rapm > 0 ? '#4ade80' : p.rapm < 0 ? '#f87171' : '#555',
              }}>
                {p.rapm > 0 ? '+' : ''}{p.rapm}
              </span>
            </div>
          )
        })}
      </div>

      {sorted.length > 0 && (
        <div style={{ marginTop: '16px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#909090' }}>
          {sorted.length} players · min {minMinutes} minutes · ridge regression α=2000
        </div>
      )}
    </div>
  )
}
