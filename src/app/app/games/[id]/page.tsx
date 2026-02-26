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
  is_simulated?: boolean
}

interface GameData {
  game_id: string
  home_team_id?: number
  away_team_id?: number
  home_team: string
  away_team: string
  home_score: number | null
  away_score: number | null
  home_win: boolean | null
  home_net_rtg?: number
  away_net_rtg?: number
  pregame_home_win_prob?: number
  expected_margin?: number
  series: WinProbPoint[]
  is_preview?: boolean
  state?: string
  period?: number
  clock?: string
  live_home_win_prob?: number
}

function formatTime(seconds: number): string {
  if (seconds >= 2880) return 'Q4 0:00'
  const q = Math.floor(seconds / 720) + 1
  const secInQ = seconds % 720
  const remaining = 720 - secInQ
  const m = Math.floor(remaining / 60)
  const s = remaining % 60
  return `Q${q} ${m}:${String(s).padStart(2, '0')}`
}

const CustomTooltip = ({ active, payload, label, homeTeam, awayTeam, isPreview }: any) => {
  if (active && payload && payload.length) {
    const prob = payload[0].value as number
    const diff = payload[0].payload.score_diff
    return (
      <div style={{ background: '#111', border: '1px solid #222', padding: '12px 16px', fontSize: '12px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#555', marginBottom: '6px' }}>
          {formatTime(label)}{isPreview ? ' (projected)' : ''}
        </div>
        <div style={{ color: '#e0e0e0', marginBottom: '4px' }}>
          {homeTeam} win prob: <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, color: prob > 0.5 ? '#4ade80' : '#f87171' }}>
            {(prob * 100).toFixed(1)}%
          </span>
        </div>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#444', fontSize: '11px' }}>
          {isPreview ? 'Projected diff' : 'Score diff'}: {typeof diff === 'number' ? (diff > 0 ? '+' : '') + diff.toFixed(isPreview ? 1 : 0) : '—'}
        </div>
      </div>
    )
  }
  return null
}

export default function GamePage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<GameData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    const espnId = id.replace('espn_', '')

    // Try 3 sources in order:
    // 1. Live ESPN data (works for any game, past or future)
    // 2. DB winprob (completed games with plays stored)
    // 3. DB preview (team ratings projection)

    const tryLive = fetch(`${API}/live/${espnId}/live`)
      .then(r => r.json())
      .then(live => {
        if (live.home_team && live.home_team !== '?') {
          // Map live response to GameData format
          return {
            game_id: id,
            home_team: live.home_team,
            away_team: live.away_team,
            home_score: live.state !== 'pre' ? live.home_score : null,
            away_score: live.state !== 'pre' ? live.away_score : null,
            home_win: live.state === 'post' ? live.home_score > live.away_score : null,
            series: live.series || [],
            state: live.state,
            period: live.period,
            clock: live.clock,
            live_home_win_prob: live.live_home_win_prob,
            is_preview: live.state === 'pre',
          } as GameData
        }
        return null
      }).catch(() => null)

    const tryDB = fetch(`${API}/game/${id}/winprob`)
      .then(r => r.json())
      .then(wp => (wp.series && wp.series.length > 10 && wp.home_team) ? wp : null)
      .catch(() => null)

    const tryPreview = fetch(`${API}/game/${id}/preview`)
      .then(r => r.json())
      .then(p => (p.series && p.series.length > 10 && p.home_team) ? p : null)
      .catch(() => null)

    Promise.all([tryLive, tryDB, tryPreview]).then(([live, db, preview]) => {
      if (db && db.series.length > 10) {
        // Completed game with real plays — most accurate
        setData(db)
      } else if (live && live.series && live.series.length > 10) {
        // Live game with real plays from ESPN
        setData(live)
      } else if (preview) {
        // Pre-game or no plays yet — use simulated preview curve
        setData(preview)
      } else if (live) {
        setData(live)
      } else {
        setError('Game data not available.')
      }
      setLoading(false)
    })
  }, [id])

  if (loading) return (
    <div style={{ padding: '80px', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#444' }}>
      Loading...
    </div>
  )

  if (error || !data) return (
    <div style={{ padding: '80px', textAlign: 'center', color: '#555', fontSize: '13px' }}>
      {error || 'Game not found.'}
    </div>
  )

  const isPreview = data.is_preview === true || data.state === 'pre'
  const isLive = data.state === 'in'
  const hasSeries = data.series && data.series.length > 0
  const finalProb = hasSeries ? data.series[data.series.length - 1].home_win_prob : data.live_home_win_prob
  const homeTeam = data.home_team || 'Home'
  const awayTeam = data.away_team || 'Away'

  const swings = (!isPreview && hasSeries && data.series.length > 10) ? data.series
    .map((pt, i) => i > 0 ? { ...pt, delta: Math.abs(pt.home_win_prob - data.series[i - 1].home_win_prob) } : { ...pt, delta: 0 })
    .filter(s => s.delta > 0.05)
    .sort((a: any, b: any) => b.delta - a.delta)
    .slice(0, 5) : []

  return (
    <div>
      <div style={{ marginBottom: '32px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.12em', marginBottom: '12px' }}>
          {isLive ? '🔴 LIVE · WIN PROBABILITY' : isPreview ? 'GAME PREVIEW · PROJECTION' : 'GAME · WIN PROBABILITY'}
          {isLive && data.period && data.clock && (
            <span style={{ color: '#ef4444', marginLeft: '12px' }}>Q{data.period} {data.clock}</span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '32px', flexWrap: 'wrap' }}>
          <div style={{ textAlign: 'center', minWidth: '80px' }}>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '28px', fontWeight: 700, color: data.home_win === false ? '#e0e0e0' : '#888' }}>
              {awayTeam}
            </div>
            {data.away_score !== null && data.away_score !== undefined ? (
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '40px', fontWeight: 700, color: '#e0e0e0', lineHeight: 1 }}>
                {data.away_score}
              </div>
            ) : data.away_net_rtg !== undefined && (
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', color: (data.away_net_rtg || 0) > 0 ? '#4ade80' : '#f87171', marginTop: '4px' }}>
                {(data.away_net_rtg || 0) > 0 ? '+' : ''}{data.away_net_rtg?.toFixed(1)} net rtg
              </div>
            )}
            <div style={{ fontSize: '11px', color: '#333', marginTop: '4px' }}>Away</div>
          </div>

          <div style={{ color: '#222', fontSize: '24px', fontFamily: 'IBM Plex Mono, monospace' }}>@</div>

          <div style={{ textAlign: 'center', minWidth: '80px' }}>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '28px', fontWeight: 700, color: data.home_win === true ? '#e0e0e0' : '#888' }}>
              {homeTeam}
            </div>
            {data.home_score !== null && data.home_score !== undefined ? (
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '40px', fontWeight: 700, color: '#e0e0e0', lineHeight: 1 }}>
                {data.home_score}
              </div>
            ) : data.home_net_rtg !== undefined && (
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', color: (data.home_net_rtg || 0) > 0 ? '#4ade80' : '#f87171', marginTop: '4px' }}>
                {(data.home_net_rtg || 0) > 0 ? '+' : ''}{data.home_net_rtg?.toFixed(1)} net rtg
              </div>
            )}
            <div style={{ fontSize: '11px', color: '#333', marginTop: '4px' }}>Home</div>
          </div>

          {finalProb !== null && finalProb !== undefined && (
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.08em', marginBottom: '4px' }}>
                {isLive ? 'LIVE HOME WIN PROB' : isPreview ? 'PROJECTED HOME WIN PROB' : 'FINAL HOME WIN PROB'}
              </div>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '36px', fontWeight: 700, color: finalProb > 0.5 ? '#4ade80' : '#f87171', lineHeight: 1 }}>
                {(finalProb * 100).toFixed(1)}%
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ background: '#111', border: '1px solid #1a1a1a', padding: '28px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.08em' }}>
            {isPreview ? 'PROJECTED WIN PROBABILITY · TEAM RATINGS' : isLive ? 'LIVE WIN PROBABILITY · RANDOM WALK MODEL' : 'WIN PROBABILITY · RANDOM WALK MODEL'}
          </div>
          <div style={{ display: 'flex', gap: '12px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333' }}>
            <span>{awayTeam} favored · 50% · {homeTeam} favored</span>
          </div>
        </div>

        {isPreview && (
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#555', marginBottom: '16px', padding: '8px 12px', border: '1px solid #1a1a1a', display: 'inline-block' }}>
            ⚠ SIMULATION — based on team net ratings. Not a score prediction.
          </div>
        )}

        {!hasSeries ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#444', fontSize: '13px' }}>
            No win probability data available yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data.series} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="wp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={isPreview ? '#4ade80' : '#e8e8e8'} stopOpacity={0.08} />
                  <stop offset="95%" stopColor={isPreview ? '#4ade80' : '#e8e8e8'} stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke="#1a1a1a" vertical={false} />
              <XAxis dataKey="game_seconds" ticks={[0, 720, 1440, 2160, 2880]}
                tickFormatter={(v) => `Q${Math.min(Math.floor(v / 720) + 1, 4)}`}
                stroke="#1a1a1a" tick={{ fill: '#444', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace' }} />
              <YAxis domain={[0, 1]} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                stroke="#1a1a1a" tick={{ fill: '#444', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace' }} width={40} />
              <Tooltip content={<CustomTooltip homeTeam={homeTeam} awayTeam={awayTeam} isPreview={isPreview} />} />
              <ReferenceLine y={0.5} stroke="#2a2a2a" strokeDasharray="4 4" />
              {[720, 1440, 2160].map(s => <ReferenceLine key={s} x={s} stroke="#1a1a1a" />)}
              <Area type="monotone" dataKey="home_win_prob"
                stroke={isPreview ? '#4ade80' : isLive ? '#ef4444' : '#e8e8e8'}
                strokeWidth={isPreview ? 1 : 1.5}
                strokeDasharray={isPreview ? '6 3' : undefined}
                fill="url(#wp)" dot={false}
                activeDot={{ r: 3, fill: isPreview ? '#4ade80' : '#e8e8e8', strokeWidth: 0 }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {swings.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.12em', marginBottom: '12px' }}>
            LARGEST MOMENTUM SWINGS
          </div>
          <div style={{ border: '1px solid #1a1a1a' }}>
            {swings.map((s: any, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: i < swings.length - 1 ? '1px solid #111' : 'none' }}>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#666' }}>
                  {formatTime(s.game_seconds)}
                  <span style={{ marginLeft: '16px', color: '#444' }}>score diff: {s.score_diff > 0 ? '+' : ''}{s.score_diff}</span>
                </div>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '14px', fontWeight: 600, color: s.delta > 0.1 ? '#e8e8e8' : '#888' }}>
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
