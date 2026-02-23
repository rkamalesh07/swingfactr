'use client'

import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts'

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

function getAdvantageBlurb(game: GameFatigue): string {
  const { advantaged_team, flags, expected_effect } = game.fatigue
  const homeRest = (game.fatigue as any).home_rest_days
  const awayRest = (game.fatigue as any).away_rest_days

  if (!advantaged_team || Math.abs(expected_effect) < 0.25) {
    if (homeRest !== undefined && awayRest !== undefined) {
      return `${game.away_team}: ${awayRest}d rest · ${game.home_team}: ${homeRest}d rest — no significant edge`
    }
    return 'No significant fatigue edge.'
  }

  const team = advantaged_team === 'home' ? game.home_team : game.away_team
  const topFlag = [...flags].sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))[0]

  let reason = ''
  if (topFlag.label.includes('B2B')) reason = 'on a back-to-back'
  else if (topFlag.label.includes('altitude')) reason = 'altitude advantage'
  else if (topFlag.label.includes('road trip')) reason = 'opponent on long road trip'
  else if (topFlag.label.includes('Rest') || topFlag.label.includes('rest')) reason = 'more rest'
  else if (topFlag.label.includes('asymmetry')) reason = 'opponent on B2B'
  else reason = topFlag.label.toLowerCase()

  const restNote = homeRest !== undefined ? ` · ${game.away_team}: ${awayRest}d, ${game.home_team}: ${homeRest}d` : ''
  return `Edge: ${team} (${reason}, ${Math.abs(expected_effect).toFixed(1)} pts)${restNote}`
}

export default function FatiguePage() {
  const [games, setGames] = useState<GameFatigue[]>([])
  const [effects, setEffects] = useState<Effect[]>([])
  const [gamesLoading, setGamesLoading] = useState(true)
  const [effectsLoading, setEffectsLoading] = useState(true)
  const [meta, setMeta] = useState<{ r_squared?: number; n_games?: number }>({})

  useEffect(() => {
    fetch(`${API}/fatigue/today`)
      .then(r => r.json())
      .then(d => { setGames(d.games || []); setGamesLoading(false) })
      .catch(() => setGamesLoading(false))

    fetch(`${API}/fatigue/`)
      .then(r => r.json())
      .then(d => { setEffects(d.effects || []); setMeta({ r_squared: d.r_squared, n_games: d.n_games }); setEffectsLoading(false) })
      .catch(() => setEffectsLoading(false))
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
          How back-to-backs, travel, altitude, and rest affect game outcomes — applied to today's slate.
        </p>
      </div>

      {/* TODAY'S GAMES */}
      <div style={{ marginBottom: '48px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.12em', marginBottom: '16px' }}>
          TODAY'S GAMES · FATIGUE CONTEXT
        </div>

        {gamesLoading ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#444', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px' }}>Loading...</div>
        ) : games.length === 0 ? (
          <div style={{ padding: '32px', border: '1px solid #1a1a1a', color: '#444', fontSize: '13px', textAlign: 'center' }}>No games today.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: '#1a1a1a' }}>
            {games.map(g => {
              const effect = g.fatigue.expected_effect
              const hasEdge = Math.abs(effect) >= 1
              const effectColor = !hasEdge ? '#444' : effect > 0 ? '#4ade80' : '#f87171'
              const blurb = getAdvantageBlurb(g)

              return (
                <div key={g.game_id} style={{ background: '#0a0a0a', padding: '18px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  {/* Left: matchup + status */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                      <span style={{ fontSize: '15px', fontWeight: 500, color: g.fatigue.advantaged_team === 'away' ? '#e0e0e0' : '#666' }}>
                        {g.away_team}
                      </span>
                      <span style={{ color: '#333', fontSize: '12px' }}>@</span>
                      <span style={{ fontSize: '15px', fontWeight: 500, color: g.fatigue.advantaged_team === 'home' ? '#e0e0e0' : '#666' }}>
                        {g.home_team}
                      </span>
                      {g.completed && g.home_score !== null ? (
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#555', marginLeft: '8px' }}>
                          {g.away_score} – {g.home_score} Final
                        </span>
                      ) : (
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#3a3', letterSpacing: '0.08em', marginLeft: '8px' }}>
                          {g.status || 'UPCOMING'}
                        </span>
                      )}
                    </div>
                    {/* Flags */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {g.fatigue.flags.length === 0 ? (
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#2a2a2a' }}>No fatigue factors</span>
                      ) : g.fatigue.flags.map((f, i) => (
                        <span key={i} style={{
                          fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px',
                          color: f.effect > 0 ? '#4ade80' : '#f87171',
                          background: f.effect > 0 ? '#0a1a12' : '#1a0a0a',
                          border: `1px solid ${f.effect > 0 ? '#1a3a2a' : '#3a1a1a'}`,
                          padding: '2px 8px',
                        }}>
                          {f.label} ({f.effect > 0 ? '+' : ''}{f.effect})
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Right: effect + blurb */}
                  <div style={{ textAlign: 'right', minWidth: '160px' }}>
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '20px', fontWeight: 600, color: effectColor }}>
                      {effect > 0 ? '+' : ''}{effect} pts
                    </div>
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', marginBottom: '4px' }}>
                      home margin effect
                    </div>
                    <div style={{ fontSize: '11px', color: '#666', maxWidth: '200px', lineHeight: 1.4 }}>
                      {blurb}
                    </div>
                  </div>
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

        {!effectsLoading && (
          <div style={{ display: 'flex', gap: '1px', background: '#1a1a1a', marginBottom: '32px', border: '1px solid #1a1a1a' }}>
            {[
              { label: 'R²', value: meta.r_squared?.toFixed(4) },
              { label: 'Games', value: meta.n_games?.toLocaleString() },
              { label: 'Factors', value: effects.length },
              { label: 'Significant', value: effects.filter(e => e.significant).length },
              { label: 'Season', value: '2024–25' },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: '#0a0a0a', padding: '16px 24px', flex: 1 }}>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '18px', fontWeight: 600, color: '#e8e8e8', marginBottom: '4px' }}>{value}</div>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.08em' }}>{label.toUpperCase()}</div>
              </div>
            ))}
          </div>
        )}

        {effects.length > 0 && (
          <>
            <div style={{ background: '#111', border: '1px solid #1a1a1a', padding: '28px', marginBottom: '24px' }}>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.08em', marginBottom: '20px' }}>
                COEFFICIENT ESTIMATES (POINTS EFFECT ON HOME MARGIN)
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} margin={{ top: 0, right: 20, left: 20, bottom: 80 }}>
                  <XAxis dataKey="factor" angle={-35} textAnchor="end"
                    tick={{ fill: '#555', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace' }}
                    tickFormatter={v => (LABELS[v] || v).split('(')[0].trim().slice(0, 22)} />
                  <YAxis tick={{ fill: '#555', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace' }} tickFormatter={v => v.toFixed(2)} />
                  <Tooltip content={({ active, payload }) => {
                    if (active && payload?.length) {
                      const d = payload[0].payload as Effect
                      return (
                        <div style={{ background: '#111', border: '1px solid #222', padding: '12px 16px', fontSize: '12px' }}>
                          <div style={{ color: '#e0e0e0', marginBottom: '6px' }}>{LABELS[d.factor] || d.factor}</div>
                          <div style={{ fontFamily: 'IBM Plex Mono, monospace', color: d.coefficient > 0 ? '#4ade80' : '#f87171' }}>
                            {d.coefficient > 0 ? '+' : ''}{d.coefficient.toFixed(3)} pts
                          </div>
                          <div style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#444', fontSize: '11px' }}>p = {d.p_value.toFixed(4)}</div>
                          {d.significant && <div style={{ color: '#e8e8e8', fontSize: '10px', marginTop: '4px' }}>SIGNIFICANT</div>}
                        </div>
                      )
                    }
                    return null
                  }} />
                  <ReferenceLine y={0} stroke="#222" />
                  <Bar dataKey="coefficient" radius={[2, 2, 0, 0]}>
                    {chartData.map((e, i) => (
                      <Cell key={i} fill={e.significant ? (e.coefficient > 0 ? '#16a34a' : '#dc2626') : '#2a2a2a'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={{ border: '1px solid #1a1a1a' }}>
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 90px 90px 140px 80px',
                padding: '10px 20px', borderBottom: '1px solid #1a1a1a',
                fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.08em',
              }}>
                <span>FACTOR</span><span style={{ textAlign: 'right' }}>COEF</span>
                <span style={{ textAlign: 'right' }}>P-VALUE</span>
                <span style={{ textAlign: 'right' }}>90% CI</span>
                <span style={{ textAlign: 'right' }}>SIG</span>
              </div>
              {effects.map((e, i) => (
                <div key={e.factor} style={{
                  display: 'grid', gridTemplateColumns: '1fr 90px 90px 140px 80px',
                  padding: '14px 20px', borderBottom: i < effects.length - 1 ? '1px solid #111' : 'none', alignItems: 'center',
                }}>
                  <span style={{ color: '#ccc', fontSize: '13px' }}>{LABELS[e.factor] || e.factor}</span>
                  <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 600, color: e.coefficient > 0 ? '#4ade80' : '#f87171' }}>
                    {e.coefficient > 0 ? '+' : ''}{e.coefficient.toFixed(3)}
                  </span>
                  <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#555' }}>{e.p_value.toFixed(4)}</span>
                  <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#444' }}>[{e.ci_low.toFixed(2)}, {e.ci_high.toFixed(2)}]</span>
                  <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', letterSpacing: '0.08em' }}>
                    {e.significant ? <span style={{ color: '#e8e8e8' }}>YES</span> : <span style={{ color: '#333' }}>—</span>}
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
    </div>
  )
}
