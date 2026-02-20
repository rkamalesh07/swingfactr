'use client'

import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Effect {
  factor: string
  label: string
  coefficient: number
  p_value: number
  ci_low: number
  ci_high: number
  significant: boolean
}

const LABELS: Record<string, string> = {
  rest_advantage: 'Rest advantage (home − away days)',
  away_b2b: 'Away team on back-to-back',
  home_b2b: 'Home team on back-to-back',
  travel_miles_100: 'Travel distance (per 100 mi)',
  tz_change: 'Timezone change (hrs)',
  high_altitude: 'High altitude venue (DEN / UTA)',
  long_trip: 'Long road trip (1500+ mi)',
  fatigue_asymmetry: 'Fatigue asymmetry (away − home B2B)',
}

export default function FatiguePage() {
  const [effects, setEffects] = useState<Effect[]>([])
  const [loading, setLoading] = useState(true)
  const [meta, setMeta] = useState<{ r_squared?: number; n_games?: number }>({})

  useEffect(() => {
    fetch(`${API}/fatigue/`)
      .then((r) => r.json())
      .then((d) => {
        setEffects(d.effects || [])
        setMeta({ r_squared: d.r_squared, n_games: d.n_games })
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const chartData = effects.map(e => ({ ...e, label: LABELS[e.factor] || e.factor }))

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.12em', marginBottom: '6px' }}>
          OLS REGRESSION · SCORE MARGIN
        </div>
        <h1 style={{ fontSize: '22px', fontWeight: 400, color: '#f0f0f0', marginBottom: '8px' }}>Fatigue & Travel Effects</h1>
        <p style={{ color: '#555', fontSize: '13px', lineHeight: 1.6, maxWidth: '560px' }}>
          Coefficient = expected points added to home team score margin per unit of each factor, 
          holding all others constant. Green = benefits home team. Red = hurts home team.
        </p>
      </div>

      {/* Model meta row */}
      {!loading && meta.r_squared !== undefined && (
        <div style={{ display: 'flex', gap: '1px', background: '#1a1a1a', marginBottom: '32px', border: '1px solid #1a1a1a' }}>
          {[
            { label: 'R²', value: meta.r_squared?.toFixed(4) },
            { label: 'Games', value: meta.n_games?.toLocaleString() },
            { label: 'Factors', value: effects.length },
            { label: 'Significant', value: effects.filter(e => e.significant).length },
            { label: 'Season', value: '2024–25' },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: '#0a0a0a', padding: '16px 24px', flex: 1 }}>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '18px', fontWeight: 600, color: '#e8e8e8', marginBottom: '4px' }}>
                {value}
              </div>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.08em' }}>
                {label.toUpperCase()}
              </div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ padding: '60px', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#444' }}>
          Loading model...
        </div>
      ) : effects.length === 0 ? (
        <div style={{ padding: '60px', textAlign: 'center', color: '#444', fontSize: '13px' }}>
          No fatigue model found. Run <code style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#666' }}>python -m src.models.train_all</code> first.
        </div>
      ) : (
        <>
          {/* Chart */}
          <div style={{ background: '#111', border: '1px solid #1a1a1a', padding: '28px', marginBottom: '24px' }}>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.08em', marginBottom: '20px' }}>
              COEFFICIENT ESTIMATES (POINTS EFFECT ON HOME MARGIN)
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ top: 0, right: 20, left: 20, bottom: 80 }}>
                <XAxis
                  dataKey="factor"
                  angle={-35}
                  textAnchor="end"
                  tick={{ fill: '#555', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace' }}
                  tickFormatter={(v) => (LABELS[v] || v).split('(')[0].trim().slice(0, 22)}
                />
                <YAxis
                  tick={{ fill: '#555', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace' }}
                  tickFormatter={(v) => v.toFixed(2)}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload?.length) {
                      const d = payload[0].payload as Effect
                      return (
                        <div style={{ background: '#111', border: '1px solid #222', padding: '12px 16px', fontSize: '12px' }}>
                          <div style={{ color: '#e0e0e0', marginBottom: '6px', fontWeight: 500 }}>{LABELS[d.factor] || d.factor}</div>
                          <div style={{ fontFamily: 'IBM Plex Mono, monospace', color: d.coefficient > 0 ? '#4ade80' : '#f87171', marginBottom: '4px' }}>
                            {d.coefficient > 0 ? '+' : ''}{d.coefficient.toFixed(3)} pts
                          </div>
                          <div style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#444', fontSize: '11px' }}>p = {d.p_value.toFixed(4)}</div>
                          <div style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#444', fontSize: '11px' }}>
                            90% CI [{d.ci_low.toFixed(2)}, {d.ci_high.toFixed(2)}]
                          </div>
                          {d.significant && <div style={{ color: '#e8e8e8', fontSize: '10px', marginTop: '4px', letterSpacing: '0.08em' }}>STATISTICALLY SIGNIFICANT</div>}
                        </div>
                      )
                    }
                    return null
                  }}
                />
                <ReferenceLine y={0} stroke="#222" />
                <Bar dataKey="coefficient" radius={[2, 2, 0, 0]}>
                  {chartData.map((e, i) => (
                    <Cell key={i} fill={e.significant ? (e.coefficient > 0 ? '#16a34a' : '#dc2626') : '#2a2a2a'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Table */}
          <div style={{ border: '1px solid #1a1a1a' }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 90px 90px 140px 80px',
              padding: '10px 20px', borderBottom: '1px solid #1a1a1a',
              fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.08em',
            }}>
              <span>FACTOR</span>
              <span style={{ textAlign: 'right' }}>COEF</span>
              <span style={{ textAlign: 'right' }}>P-VALUE</span>
              <span style={{ textAlign: 'right' }}>90% CI</span>
              <span style={{ textAlign: 'right' }}>SIG</span>
            </div>
            {effects.map((e, i) => (
              <div key={e.factor} style={{
                display: 'grid', gridTemplateColumns: '1fr 90px 90px 140px 80px',
                padding: '14px 20px',
                borderBottom: i < effects.length - 1 ? '1px solid #111' : 'none',
                alignItems: 'center',
              }}>
                <span style={{ color: '#ccc', fontSize: '13px' }}>{LABELS[e.factor] || e.factor}</span>
                <span style={{
                  textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 600,
                  color: e.coefficient > 0 ? '#4ade80' : '#f87171',
                }}>
                  {e.coefficient > 0 ? '+' : ''}{e.coefficient.toFixed(3)}
                </span>
                <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#555' }}>
                  {e.p_value.toFixed(4)}
                </span>
                <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#444' }}>
                  [{e.ci_low.toFixed(2)}, {e.ci_high.toFixed(2)}]
                </span>
                <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', letterSpacing: '0.08em' }}>
                  {e.significant
                    ? <span style={{ color: '#e8e8e8' }}>YES</span>
                    : <span style={{ color: '#333' }}>—</span>}
                </span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: '16px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333', lineHeight: 1.8 }}>
            Significant = p &lt; 0.05 · Coefficient unit = points on home score margin · Gray bars = not significant
          </div>
        </>
      )}
    </div>
  )
}
