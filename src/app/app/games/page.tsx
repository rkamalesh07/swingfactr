'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Game {
  game_id: string
  game_date: string
  home_team: string
  away_team: string
  home_score: number | null
  away_score: number | null
  home_win: boolean | null
}

export default function GamesPage() {
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [season, setSeason] = useState('2024-25')

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/games/?season=${season}&limit=50`)
      .then((r) => r.json())
      .then((data) => { setGames(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [season])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '32px' }}>
        <div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.12em', marginBottom: '6px' }}>
            WIN PROBABILITY MODEL
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: 400, color: '#f0f0f0' }}>Games</h1>
        </div>
        <select value={season} onChange={(e) => setSeason(e.target.value)} style={{
          background: '#111', border: '1px solid #222', color: '#888',
          padding: '6px 12px', fontSize: '12px', fontFamily: 'IBM Plex Mono, monospace',
          outline: 'none', cursor: 'pointer',
        }}>
          <option value="2024-25">2024–25</option>
          <option value="2023-24">2023–24</option>
        </select>
      </div>

      <div style={{ border: '1px solid #1a1a1a' }}>
        {/* Table header */}
        <div style={{
          display: 'grid', gridTemplateColumns: '100px 1fr 120px 80px',
          padding: '10px 20px', borderBottom: '1px solid #1a1a1a',
          fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px',
          color: '#444', letterSpacing: '0.08em',
        }}>
          <span>DATE</span><span>MATCHUP</span><span style={{ textAlign: 'center' }}>SCORE</span><span style={{ textAlign: 'right' }}>WIN PROB</span>
        </div>

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#444', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px' }}>
            Loading...
          </div>
        ) : games.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#444', fontSize: '13px' }}>
            No games found for this season.
          </div>
        ) : games.map((g, i) => (
          <Link key={g.game_id} href={`/games/${g.game_id}`} style={{ textDecoration: 'none' }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '100px 1fr 120px 80px',
              padding: '14px 20px',
              borderBottom: i < games.length - 1 ? '1px solid #111' : 'none',
              alignItems: 'center',
              cursor: 'pointer',
              transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#111')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#555' }}>
                {g.game_date}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontWeight: g.home_win === false ? 400 : 500, color: g.home_win === false ? '#555' : '#e0e0e0', fontSize: '13px' }}>
                  {g.away_team}
                </span>
                <span style={{ color: '#333', fontSize: '11px' }}>@</span>
                <span style={{ fontWeight: g.home_win === true ? 500 : 400, color: g.home_win === true ? '#e0e0e0' : '#555', fontSize: '13px' }}>
                  {g.home_team}
                </span>
              </div>
              <div style={{ textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', color: '#888' }}>
                {g.away_score !== null && g.home_score !== null
                  ? `${g.away_score} – ${g.home_score}`
                  : '—'}
              </div>
              <div style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#444' }}>
                →
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div style={{ marginTop: '16px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333' }}>
        {games.length} games · click any game to view win probability curve
      </div>
    </div>
  )
}
