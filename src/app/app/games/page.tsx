'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const PAGE_SIZE = 50

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
  const [season, setSeason] = useState('2025-26')
  const [page, setPage] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [search, setSearch] = useState('')

  useEffect(() => {
    setPage(0)
    fetch(`${API}/games/count?season=${season}`)
      .then(r => r.json())
      .then(data => setTotalPages(Math.ceil(data.count / PAGE_SIZE)))
      .catch(() => setTotalPages(1))
  }, [season])

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/games/?season=${season}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`)
      .then(r => r.json())
      .then(data => { setGames(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [season, page])

  const filtered = search.trim()
    ? games.filter(g =>
        g.home_team.toLowerCase().includes(search.toLowerCase()) ||
        g.away_team.toLowerCase().includes(search.toLowerCase())
      )
    : games

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#909090', letterSpacing: '0.12em', marginBottom: '6px' }}>
          WIN PROBABILITY MODEL
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: 400, color: '#f0f0f0' }}>Games</h1>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              placeholder="Search team (e.g. OKC)"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                background: '#111', border: '1px solid #222', color: '#888',
                padding: '6px 12px', fontSize: '12px', fontFamily: 'IBM Plex Mono, monospace',
                outline: 'none', width: '180px',
              }}
            />
            <select value={season} onChange={e => { setSeason(e.target.value); setSearch('') }} style={{
              background: '#111', border: '1px solid #222', color: '#888',
              padding: '6px 12px', fontSize: '12px', fontFamily: 'IBM Plex Mono, monospace',
              outline: 'none', cursor: 'pointer',
            }}>
              <option value="2025-26">2025-26</option>
              <option value="2024-25">2024-25</option>
            </select>
          </div>
        </div>
        <div style={{ marginTop: '8px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#909090' }}>
          Click any game to view the win probability curve →
        </div>
      </div>

      <div style={{ border: '1px solid #1a1a1a' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '100px 1fr 120px 80px',
          padding: '10px 20px', borderBottom: '1px solid #222228',
          fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#909090', letterSpacing: '0.08em',
        }}>
          <span>DATE</span><span>MATCHUP</span>
          <span style={{ textAlign: 'center' }}>SCORE</span>
          <span style={{ textAlign: 'right' }}>CURVE</span>
        </div>

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#909090', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#909090', fontSize: '13px' }}>
            {search ? `No games found for "${search}"` : 'No games found.'}
          </div>
        ) : filtered.map((g, i) => (
          <Link key={g.game_id} href={`/games/${g.game_id}`} style={{ textDecoration: 'none' }}>
            <div
              style={{
                display: 'grid', gridTemplateColumns: '100px 1fr 120px 80px',
                padding: '14px 20px', borderBottom: i < filtered.length - 1 ? '1px solid #111' : 'none',
                alignItems: 'center', cursor: 'pointer',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#111')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#b0aea8' }}>{g.game_date}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontWeight: g.home_win === false ? 400 : 500, color: g.home_win === false ? '#555' : '#e0e0e0', fontSize: '13px' }}>{g.away_team}</span>
                <span style={{ color: '#909090', fontSize: '11px' }}>@</span>
                <span style={{ fontWeight: g.home_win === true ? 500 : 400, color: g.home_win === true ? '#e0e0e0' : '#555', fontSize: '13px' }}>{g.home_team}</span>
              </div>
              <div style={{ textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', color: '#888' }}>
                {g.away_score !== null && g.home_score !== null ? `${g.away_score} - ${g.home_score}` : '—'}
              </div>
              <div style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#909090' }}>→</div>
            </div>
          </Link>
        ))}
      </div>

      {!search && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '16px' }}>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#909090' }}>
            {games.length > 0 ? `${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + games.length}` : '0 games'}
            {' '}&middot; page {page + 1} of {totalPages}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{
              background: 'none', border: '1px solid #222', color: page === 0 ? '#2a2a2a' : '#888',
              padding: '4px 12px', fontSize: '11px', fontFamily: 'IBM Plex Mono, monospace',
              cursor: page === 0 ? 'not-allowed' : 'pointer',
            }}>← prev</button>
            <select value={page} onChange={e => setPage(Number(e.target.value))} style={{
              background: '#111', border: '1px solid #222', color: '#888',
              padding: '4px 8px', fontSize: '11px', fontFamily: 'IBM Plex Mono, monospace',
              outline: 'none', cursor: 'pointer',
            }}>
              {Array.from({ length: totalPages }, (_, i) => (
                <option key={i} value={i}>page {i + 1}</option>
              ))}
            </select>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={{
              background: 'none', border: '1px solid #222', color: page >= totalPages - 1 ? '#2a2a2a' : '#888',
              padding: '4px 12px', fontSize: '11px', fontFamily: 'IBM Plex Mono, monospace',
              cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer',
            }}>next →</button>
          </div>
        </div>
      )}
    </div>
  )
}
