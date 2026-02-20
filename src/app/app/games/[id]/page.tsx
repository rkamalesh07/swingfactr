'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, CartesianGrid } from 'recharts'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface WinProbPoint {
  game_seconds: number
  home_win_prob: number
  quarter: number
  score_diff: number
}

interface WinProbData {
  game_id: string
  home_team_id: number
  away_team_id: number
  home_team: string
  away_team: string
  home_score: number | null
  away_score: number | null
  series: WinProbPoint[]
}

function formatTime(seconds: number): string {
  const q = Math.min(Math.floor(seconds / 720) + 1, 4)
  const secInQ = seconds % 720
  const remaining = 720 - secInQ
  const m = Math.floor(remaining / 60)
  const s = remaining % 60
  return `Q${q} ${m}:${String(s).padStart(2, '0')}`
}

const CustomTooltip = ({ active, payload, label, homeTeam, awayTeam }: any) => {
  if (active && payload && payload.length) {
    const prob = payload[0].value as number
    const diff = payload[0].payload.score_diff
    return (
      <div style={{ background: '#111', border: '1px solid #222', padding: '12px 16px', fontSize: '12px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#555', marginBottom: '6px' }}>{formatTime(label)}</div>
        <div style={{ color: '#e0e0e0', marginBottom: '4px' }}>
          {homeTeam} win prob: <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, color: prob > 0.5 ? '#4ade80' : '#f87171' }}>
            {(prob * 100).toFixed(1)}%
          </span>
        </div>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#444', fontSize: '11px' }}>
          Score diff: {diff > 0 ? '+' : ''}{diff}
        </div>
      </div>
    )
  }
  return null
}

export default function GamePage() {
  const { id } = useParams<{ id: string }>()
  const [winProb, setWinProb] = useState<WinProbData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    fetch(`${API}/game/${id}/winprob`)
      .then((r) => r.json())
      .then((wp) => { setWinProb(wp); setLoading(false) })
      .catch(() => { setError('Could not load game data.'); setLoading(false) })
  }, [id])

  if (loading) return (
    <div style={{ padding: '80px', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#444' }}>
      Loading...
    </div>
  )

  if (error || !winProb) return (
    <div style={{ padding: '80px', textAlign: 'center', color: '#555', fontSize: '13px' }}>
      {error || 'Game not found.'}
    </div>
  )

  const hasSeries = winProb.series && winProb.series.length > 0
  const finalProb = hasSeries ? winProb.series[winProb.series.length - 1].home_win_prob : null

  // Momentum swings
  const swings = hasSeries ? winProb.series
    .map((pt, i) => i > 0 ? { ...pt, delta: Math.abs(pt.home_win_prob - winProb.series[i - 1].home_win_prob) } : { ...pt, delta: 0 })
    .filter(s => s.delta > 0.03)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 5) : []

  const homeTeam = winProb.home_team || 'Home'
  const awayTeam = winProb.away_team || 'Away'

  return (
    <div>
      {/* Game header */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.12em', marginBottom: '12px' }}>
          GAME · {id}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '24px', fontWeight: 600, color: winProb.home_win === false ? '#555' : '#e0e0e0' }}>
              {awayTeam}
            </div>
            {winProb.away_score !== null && (
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '32px', fontWeight: 600, color: '#e0e0e0', marginTop: '4px' }}>
                {winProb.away_score}
              </div>
            )}
            <div style={{ fontSize: '11px', color: '#444', marginTop: '4px' }}>Away</div>
          </div>
          <div style={{ color: '#333', fontSize: '20px', fontFamily: 'IBM Plex Mono, monospace', padding: '0 8px' }}>@</div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '24px', fontWeight: 600, color: winProb.home_win === true ? '#e0e0e0' : '#555' }}>
              {homeTeam}
            </div>
            {winProb.home_score !== null && (
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '32px', fontWeight: 600, color: '#e0e0e0', marginTop: '4px' }}>
                {winProb.home_score}
              </div>
            )}
            <div style={{ fontSize: '11px', color: '#444', marginTop: '4px' }}>Home</div>
          </div>
          {finalProb !== null && (
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.08em', marginBottom: '4px' }}>
                FINAL HOME WIN PROB
              </div>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '28px', fontWeight: 600, color: finalProb > 0.5 ? '#4ade80' : '#f87171' }}>
                {(finalProb * 100).toFixed(1)}%
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Win prob chart */}
      <div style={{ background: '#111', border: '1px solid #1a1a1a', padding: '28px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.08em' }}>
            WIN PROBABILITY · CALIBRATED XGBOOST
          </div>
          <div style={{ display: 'flex', gap: '20px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444' }}>
            <span>{awayTeam} favored</span>
            <span>50%</span>
            <span>{homeTeam} favored</span>
          </div>
        </div>
        {!hasSeries ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#444', fontSize: '13px' }}>
            No win probability data for this game yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={winProb.series} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="wp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#e8e8e8" stopOpacity={0.12} />
                  <stop offset="95%" stopColor="#e8e8e8" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke="#1a1a1a" vertical={false} />
              <XAxis
                dataKey="game_seconds"
                ticks={[0, 720, 1440, 2160, 2880]}
                tickFormatter={(v) => `Q${Math.min(Math.floor(v / 720) + 1, 4)}`}
                stroke="#1a1a1a"
                tick={{ fill: '#444', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace' }}
              />
              <YAxis
                domain={[0, 1]}
                tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                stroke="#1a1a1a"
                tick={{ fill: '#444', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace' }}
                width={40}
              />
              <Tooltip content={<CustomTooltip homeTeam={homeTeam} awayTeam={awayTeam} />} />
              <ReferenceLine y={0.5} stroke="#2a2a2a" strokeDasharray="4 4" />
              {[720, 1440, 2160].map(s => (
                <ReferenceLine key={s} x={s} stroke="#1a1a1a" />
              ))}
              <Area
                type="monotone"
                dataKey="home_win_prob"
                stroke="#e8e8e8"
                strokeWidth={1.5}
                fill="url(#wp)"
                dot={false}
                activeDot={{ r: 3, fill: '#e8e8e8', strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Momentum swings */}
      {swings.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.12em', marginBottom: '12px' }}>
            LARGEST MOMENTUM SWINGS
          </div>
          <div style={{ border: '1px solid #1a1a1a' }}>
            {swings.map((s, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 20px',
                borderBottom: i < swings.length - 1 ? '1px solid #111' : 'none',
              }}>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#666' }}>
                  {formatTime(s.game_seconds)}
                  <span style={{ marginLeft: '16px', color: '#444' }}>score diff: {s.score_diff > 0 ? '+' : ''}{s.score_diff}</span>
                </div>
                <div style={{
                  fontFamily: 'IBM Plex Mono, monospace', fontSize: '14px', fontWeight: 600,
                  color: s.delta > 0.1 ? '#e8e8e8' : '#888',
                }}>
                  Δ {(s.delta * 100).toFixed(1)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
