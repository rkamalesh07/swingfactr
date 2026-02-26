'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface LiveGame {
  espn_id: string
  game_id: string
  game_date: string
  game_time: string
  home_team: string
  away_team: string
  home_score: number | null
  away_score: number | null
  state: 'pre' | 'in' | 'post'
  status_desc: string
  period: number
  clock: string
  home_win_prob: number | null
}

interface LiveDetail {
  espn_id: string
  game_id: string
  home_team: string
  away_team: string
  home_score: number
  away_score: number
  state: string
  period: number
  clock: string
  live_home_win_prob: number
  series: { game_seconds: number; home_win_prob: number; score_diff: number; quarter: number }[]
}


export default function LivePage() {
  const [games, setGames] = useState<LiveGame[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<LiveDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<string>('')
  const [detailLoading, setDetailLoading] = useState(false)

  const fetchGames = useCallback(async () => {
    try {
      const r = await fetch(`${API}/live/today`)
      const d = await r.json()
      setGames(d.games || [])
      setLastUpdated(new Date().toLocaleTimeString())
      setLoading(false)
    } catch {
      setLoading(false)
    }
  }, [])

  const fetchDetail = useCallback(async (espnId: string) => {
    setDetailLoading(true)
    try {
      const r = await fetch(`${API}/live/${espnId}/live`)
      const d = await r.json()
      setDetail(d)
    } catch {}
    setDetailLoading(false)
  }, [])

  useEffect(() => {
    fetchGames()
    const interval = setInterval(fetchGames, 30000)
    return () => clearInterval(interval)
  }, [fetchGames])

  useEffect(() => {
    if (!selected) return
    fetchDetail(selected)
    const interval = setInterval(() => fetchDetail(selected), 30000)
    return () => clearInterval(interval)
  }, [selected, fetchDetail])

  const liveGames = games.filter(g => g.state === 'in')
  const upcomingGames = games.filter(g => g.state === 'pre')
  const completedGames = games.filter(g => g.state === 'post')

  const StateLabel = ({ state, desc }: { state: string; desc: string }) => {
    if (state === 'in') return (
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#ef4444', letterSpacing: '0.08em' }}>
        🔴 {desc}
      </span>
    )
    if (state === 'pre') return (
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#555' }}>{desc}</span>
    )
    return <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333' }}>FINAL</span>
  }

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.12em', marginBottom: '6px' }}>
              LIVE · TODAY'S GAMES
            </div>
            <h1 style={{ fontSize: '22px', fontWeight: 400, color: '#f0f0f0' }}>Live Win Probability</h1>
          </div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333' }}>
            {lastUpdated && `updated ${lastUpdated}`}
            {liveGames.length > 0 && <span style={{ color: '#ef4444', marginLeft: '8px' }}>● auto-refresh 30s</span>}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#444' }}>Loading...</div>
      ) : games.length === 0 ? (
        <div style={{ padding: '48px', textAlign: 'center', color: '#444', fontSize: '13px' }}>No games today.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1.4fr' : '1fr', gap: '1px', alignItems: 'start' }}>
          {/* Games list */}
          <div style={{ border: '1px solid #1a1a1a' }}>
            {/* Live games */}
            {liveGames.length > 0 && (
              <>
                <div style={{ padding: '8px 16px', background: '#0f0f0f', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#ef4444', letterSpacing: '0.1em' }}>
                  🔴 IN PROGRESS
                </div>
                {liveGames.map((g, i) => (
                  <GameRow key={g.espn_id} game={g} selected={selected === g.espn_id}
                    onClick={() => setSelected(selected === g.espn_id ? null : g.espn_id)} />
                ))}
              </>
            )}

            {/* Upcoming */}
            {upcomingGames.length > 0 && (
              <>
                <div style={{ padding: '8px 16px', background: '#0f0f0f', borderTop: liveGames.length > 0 ? '1px solid #1a1a1a' : 'none', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.1em' }}>
                  UPCOMING
                </div>
                {upcomingGames.map(g => (
                  <GameRow key={g.espn_id} game={g} selected={selected === g.espn_id}
                    onClick={() => setSelected(selected === g.espn_id ? null : g.espn_id)} />
                ))}
              </>
            )}

            {/* Completed */}
            {completedGames.length > 0 && (
              <>
                <div style={{ padding: '8px 16px', background: '#0f0f0f', borderTop: '1px solid #1a1a1a', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333', letterSpacing: '0.1em' }}>
                  FINAL
                </div>
                {completedGames.map(g => (
                  <GameRow key={g.espn_id} game={g} selected={selected === g.espn_id}
                    onClick={() => setSelected(selected === g.espn_id ? null : g.espn_id)} />
                ))}
              </>
            )}
          </div>

          {/* Detail panel */}
          {selected && (
            <div style={{ border: '1px solid #1a1a1a', padding: '24px' }}>
              {detailLoading && !detail ? (
                <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#444' }}>Loading...</div>
              ) : detail ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '20px', fontWeight: 700, color: '#e0e0e0' }}>{detail.away_team}</span>
                      {detail.state !== 'pre' && <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '24px', color: '#888' }}>{detail.away_score}</span>}
                      <span style={{ color: '#333' }}>@</span>
                      {detail.state !== 'pre' && <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '24px', color: '#888' }}>{detail.home_score}</span>}
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '20px', fontWeight: 700, color: '#e0e0e0' }}>{detail.home_team}</span>
                    </div>
                    {detail.state === 'in' && (
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#ef4444' }}>
                        Q{detail.period} {detail.clock}
                      </span>
                    )}
                  </div>

                  {detail.state !== 'pre' && (
                    <div style={{ marginBottom: '20px' }}>
                      <ProbBar prob={detail.live_home_win_prob} homeTeam={detail.home_team} awayTeam={detail.away_team} />
                    </div>
                  )}

                  {detail.state === 'pre' && (
                    <div style={{ padding: '12px 0', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#555' }}>
                      Game hasn't started — click below for projected win probability based on team ratings.
                    </div>
                  )}

                  {detail.series.length > 1 && detail.state !== 'pre' && (
                    <>
                      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.08em', marginBottom: '12px' }}>
                        WIN PROBABILITY CURVE
                      </div>
                      <ResponsiveContainer width="100%" height={200}>
                        <AreaChart data={detail.series} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="live-wp" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#e8e8e8" stopOpacity={0.1} />
                              <stop offset="95%" stopColor="#e8e8e8" stopOpacity={0.01} />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="game_seconds" ticks={[0,720,1440,2160,2880]}
                            tickFormatter={v => `Q${Math.min(Math.floor(v/720)+1,4)}`}
                            stroke="#1a1a1a" tick={{ fill: '#444', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace' }} />
                          <YAxis domain={[0,1]} tickFormatter={v => `${(v*100).toFixed(0)}%`}
                            stroke="#1a1a1a" tick={{ fill: '#444', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace' }} width={36} />
                          <Tooltip formatter={(v: number) => `${(v*100).toFixed(1)}%`} contentStyle={{ background: '#111', border: '1px solid #222', fontSize: '11px' }} />
                          <ReferenceLine y={0.5} stroke="#2a2a2a" strokeDasharray="4 4" />
                          {[720,1440,2160].map(s => <ReferenceLine key={s} x={s} stroke="#1a1a1a" />)}
                          <Area type="monotone" dataKey="home_win_prob" stroke="#e8e8e8" strokeWidth={1.5}
                            fill="url(#live-wp)" dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </>
                  )}

                  <div style={{ marginTop: '16px' }}>
                    <Link href={`/games/${detail.game_id}`} style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#444', textDecoration: 'none' }}>
                      View full game page →
                    </Link>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function GameRow({ game, selected, onClick }: { game: LiveGame; selected: boolean; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{
      padding: '14px 16px', borderBottom: '1px solid #111', cursor: 'pointer',
      background: selected ? '#111' : 'transparent',
    }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = '#0d0d0d' }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: game.state !== 'pre' ? '8px' : '0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 600, color: '#e0e0e0' }}>{game.away_team}</span>
          {game.state !== 'pre' && <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '14px', color: '#888' }}>{game.away_score}</span>}
          <span style={{ color: '#222', fontSize: '10px' }}>@</span>
          {game.state !== 'pre' && <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '14px', color: '#888' }}>{game.home_score}</span>}
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 600, color: '#e0e0e0' }}>{game.home_team}</span>
        </div>
        <div>
          {game.state === 'in' ? (
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#ef4444' }}>
              Q{game.period} {game.clock}
            </span>
          ) : game.state === 'pre' ? (
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444' }}>{game.game_time}</span>
          ) : (
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333' }}>FINAL</span>
          )}
        </div>
      </div>
      {game.home_win_prob !== null && game.state === 'in' && (
        <ProbBar prob={game.home_win_prob} homeTeam={game.home_team} awayTeam={game.away_team} />
      )}
    </div>
  )
}

function ProbBar({ prob, homeTeam, awayTeam }: { prob: number; homeTeam: string; awayTeam: string }) {
  const homePct = Math.round(prob * 100)
  const awayPct = 100 - homePct
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', marginBottom: '3px' }}>
        <span style={{ color: prob < 0.5 ? '#4ade80' : '#555' }}>{awayTeam} {awayPct}%</span>
        <span style={{ color: prob > 0.5 ? '#4ade80' : '#555' }}>{homeTeam} {homePct}%</span>
      </div>
      <div style={{ height: '4px', background: '#1a1a1a', display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: `${awayPct}%`, background: prob < 0.5 ? '#16a34a' : '#222', transition: 'width 1s ease' }} />
        <div style={{ width: `${homePct}%`, background: prob > 0.5 ? '#16a34a' : '#222', transition: 'width 1s ease' }} />
      </div>
    </div>
  )
}
