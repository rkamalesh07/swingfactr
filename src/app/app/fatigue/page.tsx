'use client'

import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Cell } from 'recharts'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface FatigueFlag {
  label: string
  effect: number
  team: 'home' | 'away'
}

interface GameFatigue {
  game_id: string
  home_team: string
  away_team: string
  home_score: number | null
  away_score: number | null
  status: string
  completed: boolean
  fatigue: {
    expected_effect: number
    flags: FatigueFlag[]
    advantaged_team: 'home' | 'away' | null
  }
}

interface Effect {
  factor: string
  label: string
  coefficient: number
  p_value: number
  ci_low: number
  ci_high: number
  significant: boolean
}

export default function FatiguePage() {
  const [games, setGames] = useState<GameFatigue[]>([])
  const [effects, setEffects] = useState<Effect[]>([])
  const [meta, setMeta] = useState<{ r_squared: number | null; n_games: number | null }>({ r_squared: null, n_games: null })
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10).replace(/-/g, ''))

  useEffect(() => {
    Promise.all([
      fetch(`${API}/fatigue/today?date=${date}`).then(r => r.json()),
      fetch(`${API}/fatigue/`).then(r => r.json()),
    ]).then(([todayData, effectsData]) => {
      setGames(todayData.games || [])
      setEffects(effectsData.effects || [])
      setMeta({ r_squared: effectsData.r_squared, n_games: effectsData.n_games })
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [date])

  const chartData = effects.map(e => ({ name: e.label.split('(')[0].trim(), value: e.coefficient, significant: e.significant }))

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.12em', marginBottom: '6px' }}>
          OLS REGRESSION · SCORE MARGIN
        </div>
        <h1 style={{ fontSize: '22px', fontWeight: 400, color: '#f0f0f0' }}>Fatigue & Travel Effects</h1>
        <p style={{ fontSize: '13px', color: '#555', marginTop: '8px', maxWidth: '520px', lineHeight: 1.6 }}>
          How back-to-backs, travel, altitude, and rest affect tonight's games based on historical patterns.
        </p>
      </div>

      {/* TODAY'S GAMES SECTION */}
      <div style={{ marginBottom: '48px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.12em', marginBottom: '16px' }}>
          TODAY'S GAMES · FATIGUE CONTEXT
        </div>

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#444', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px' }}>
            Loading...
          </div>
        ) : games.length === 0 ? (
          <div style={{ padding: '32px', border: '1px solid #1a1a1a', color: '#444', fontSize: '13px', textAlign: 'center' }}>
            No games scheduled today.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {games.map(g => {
              const effect = g.fatigue.expected_effect
              const hasFlags = g.fatigue.flags.length > 0
              const advantaged = g.fatigue.advantaged_team
              const effectColor = Math.abs(effect) < 1 ? '#444' : effect > 0 ? '#4a9' : '#c55'

              return (
                <div key={g.game_id} style={{
                  border: '1px solid #1a1a1a',
                  padding: '20px 24px',
                  background: hasFlags ? '#0d0d0d' : 'transparent',
                }}>
                  {/* Matchup row */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: hasFlags ? '16px' : '0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '16px', fontWeight: 500, color: advantaged === 'away' ? '#e0e0e0' : '#666' }}>
                          {g.away_team}
                        </span>
                        <span style={{ color: '#333', fontSize: '12px' }}>@</span>
                        <span style={{ fontSize: '16px', fontWeight: 500, color: advantaged === 'home' ? '#e0e0e0' : '#666' }}>
                          {g.home_team}
                        </span>
                      </div>
                      {g.completed && g.home_score !== null && (
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', color: '#555' }}>
                          {g.away_score} – {g.home_score}
                        </span>
                      )}
                      {!g.completed && (
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#3a3', letterSpacing: '0.08em' }}>
                          LIVE
                        </span>
                      )}
                    </div>

                    {/* Effect badge */}
                    <div style={{ textAlign: 'right' }}>
                      {hasFlags ? (
                        <div>
                          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '18px', fontWeight: 600, color: effectColor }}>
                            {effect > 0 ? '+' : ''}{effect} pts
                          </div>
                          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', marginTop: '2px' }}>
                            expected home margin effect
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#333' }}>
                          no fatigue factors
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Flags */}
                  {hasFlags && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {g.fatigue.flags.map((flag, i) => (
                        <div key={i} style={{
                          padding: '4px 10px',
                          border: `1px solid ${flag.effect > 0 ? '#1a3a2a' : '#3a1a1a'}`,
                          background: flag.effect > 0 ? '#0a1a12' : '#1a0a0a',
                          fontFamily: 'IBM Plex Mono, monospace',
                          fontSize: '10px',
                          color: flag.effect > 0 ? '#4a9' : '#c55',
                          display: 'flex',
                          gap: '8px',
                          alignItems: 'center',
                        }}>
                          <span>{flag.label}</span>
                          <span style={{ opacity: 0.6 }}>{flag.effect > 0 ? '+' : ''}{flag.effect}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ADVANCED SECTION */}
      <div style={{ borderTop: '1px solid #1a1a1a', paddingTop: '40px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333', letterSpacing: '0.12em', marginBottom: '24px' }}>
          ADVANCED · MODEL COEFFICIENTS
        </div>

        {/* Meta stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1px', border: '1px solid #1a1a1a', marginBottom: '32px' }}>
          {[
            { value: meta.r_squared?.toFixed(4) ?? '—', label: 'R²' },
            { value: meta.n_games ?? '—', label: 'GAMES' },
            { value: effects.length, label: 'FACTORS' },
            { value: effects.filter(e => e.significant).length, label: 'SIGNIFICANT' },
            { value: '2024–25', label: 'SEASON' },
          ].map((s, i) => (
            <div key={i} style={{ padding: '20px', borderRight: i < 4 ? '1px solid #1a1a1a' : 'none' }}>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '22px', fontWeight: 300, color: '#e0e0e0' }}>{s.value}</div>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', marginTop: '4px', letterSpacing: '0.08em' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Chart */}
        {effects.length > 0 && (
          <div style={{ border: '1px solid #1a1a1a', padding: '24px', marginBottom: '24px' }}>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', marginBottom: '20px', letterSpacing: '0.08em' }}>
              COEFFICIENT ESTIMATES (POINTS EFFECT ON HOME MARGIN)
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#111" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#444', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace' }}
                  angle={-35} textAnchor="end" interval={0} />
                <YAxis tick={{ fill: '#444', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace' }} />
                <Tooltip contentStyle={{ background: '#0a0a0a', border: '1px solid #222', fontFamily: 'IBM Plex Mono, monospace', fontSize: 11 }}
                  labelStyle={{ color: '#888' }} itemStyle={{ color: '#e0e0e0' }} />
                <ReferenceLine y={0} stroke="#222" />
                <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.significant ? '#4a9975' : entry.value >= 0 ? '#2a2a2a' : '#2a2020'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Table */}
        <div style={{ border: '1px solid #1a1a1a' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 140px 40px', padding: '10px 20px',
            borderBottom: '1px solid #1a1a1a', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.08em' }}>
            <span>FACTOR</span><span style={{ textAlign: 'right' }}>COEF</span>
            <span style={{ textAlign: 'right' }}>P-VALUE</span>
            <span style={{ textAlign: 'right' }}>90% CI</span>
            <span style={{ textAlign: 'right' }}>SIG</span>
          </div>
          {effects.map((e, i) => (
            <div key={e.factor} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 140px 40px',
              padding: '14px 20px', borderBottom: i < effects.length - 1 ? '1px solid #111' : 'none', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', color: '#c0c0c0' }}>{e.label}</span>
              <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px',
                color: e.coefficient > 0 ? '#4a9' : '#c55', fontWeight: 500 }}>
                {e.coefficient > 0 ? '+' : ''}{e.coefficient.toFixed(3)}
              </span>
              <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#555' }}>
                {e.p_value.toFixed(4)}
              </span>
              <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#444' }}>
                [{e.ci_low.toFixed(2)}, {e.ci_high.toFixed(2)}]
              </span>
              <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px',
                color: e.significant ? '#4a9' : '#333' }}>
                {e.significant ? 'YES' : '—'}
              </span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: '12px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333', lineHeight: 1.8 }}>
          Coefficient = expected points added to home team score margin per unit of each factor, holding all others constant.
          Green = benefits home team. Red = hurts home team. Trained on {meta.n_games ?? 995} games, 2024–25 season.
        </div>
      </div>
    </div>
  )
}
