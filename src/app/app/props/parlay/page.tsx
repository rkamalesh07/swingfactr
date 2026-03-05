'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'

const API        = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const PP_IMPLIED = 57.7

// ---------------------------------------------------------------------------
// Correct payout schedules per PDF section 3.1
// Power: all legs must hit
// Flex: partial payouts
// ---------------------------------------------------------------------------
const POWER_MULTIPLIERS: Record<number, number> = { 2: 3, 3: 5, 4: 10, 5: 20, 6: 25 }

// r_k = payout multiplier when k legs hit (0 = loss)
const FLEX_SCHEDULE: Record<number, Record<number, number>> = {
  2: { 2: 3,    1: 0,    0: 0 },
  3: { 3: 2.25, 2: 1.25, 1: 0, 0: 0 },
  4: { 4: 5,    3: 1.5,  2: 0, 1: 0, 0: 0 },
  5: { 5: 10,   4: 2,    3: 0.4, 2: 0, 1: 0, 0: 0 },
  6: { 6: 25,   5: 2,    4: 0.4, 3: 0, 2: 0, 1: 0, 0: 0 },
}

// Power break-even per leg (PDF section 2.1)
const POWER_BREAKEVEN: Record<number, number> = {
  2: 57.7, 3: 58.5, 4: 56.2, 5: 54.9, 6: 58.5
}

const STAT_LABEL: Record<string, string> = {
  pts: 'PTS', reb: 'REB', ast: 'AST', fg3m: '3PM', stl: 'STL', blk: 'BLK'
}

interface PropRow {
  player_name:     string
  team:            string
  opponent:        string
  is_home:         boolean
  stat:            string
  odds_type:       string
  line:            number
  composite_score: number
  score_label:     string
  score_color:     string
  avg_last10:      number
  hit_rate_last10: number
  edge:            number
  pick_side:       string
}

interface ParlayLeg {
  prop: PropRow
  side: 'over' | 'under'
  prob: number  // calibrated probability 0-1
}

// ---------------------------------------------------------------------------
// Poisson-binomial DP — exact hit-count distribution for independent legs
// PDF section 3.2
// ---------------------------------------------------------------------------
function poissonBinomialDP(probs: number[]): number[] {
  let dp = [1.0]
  for (const p of probs) {
    const newDp = new Array(dp.length + 1).fill(0)
    for (let k = 0; k < dp.length; k++) {
      newDp[k]     += dp[k] * (1 - p)   // this leg misses
      newDp[k + 1] += dp[k] * p          // this leg hits
    }
    dp = newDp
  }
  return dp  // dp[k] = P(exactly k hits)
}

// ---------------------------------------------------------------------------
// Correlation penalty — PDF section 5
// ---------------------------------------------------------------------------
function correlationPenalty(legs: ParlayLeg[]): number {
  let c = 1.0
  const teams = legs.map(l => l.prop.team)
  const games = legs.map(l => `${l.prop.team}-${l.prop.opponent}`)

  // Same player in entry
  const playerCounts: Record<string, number> = {}
  for (const l of legs) {
    playerCounts[l.prop.player_name] = (playerCounts[l.prop.player_name] || 0) + 1
  }
  for (const count of Object.values(playerCounts)) {
    if (count > 1) c *= 0.90  // same player: PDF says 0.90

  }

  // Same game (both teams involved)
  const gameSeen = new Set<string>()
  for (const g of games) {
    const gKey = g.split('-').sort().join('-')
    if (gameSeen.has(gKey)) {
      c *= 0.95  // same game: PDF says 0.95
    }
    gameSeen.add(gKey)
  }

  // Related stats (REB + AST = PRA type, or REB+PTS)
  const stats = legs.map(l => l.prop.stat)
  const relatedPairs = [['pts','reb'],['pts','ast'],['reb','ast'],['pts','fg3m']]
  const samePlayer   = Object.keys(playerCounts).filter(p => playerCounts[p] > 1)
  for (const player of samePlayer) {
    const playerStats = legs.filter(l => l.prop.player_name === player).map(l => l.prop.stat)
    for (const [s1, s2] of relatedPairs) {
      if (playerStats.includes(s1) && playerStats.includes(s2)) {
        c *= 0.92  // strongly related stats: PDF says 0.92
      }
    }
  }

  return c
}

// ---------------------------------------------------------------------------
// EV computation — Power and Flex
// ---------------------------------------------------------------------------
function evPower(probs: number[], entry: number, corrPenalty: number): {
  ev: number; evPct: number; winProb: number; payout: number
} {
  const n = probs.length
  const M = POWER_MULTIPLIERS[n]
  if (!M) return { ev: 0, evPct: 0, winProb: 0, payout: 0 }
  const winProb = probs.reduce((a, p) => a * p, 1) * corrPenalty
  const payout  = entry * M
  const ev      = M * winProb - 1  // ROI per $1
  return {
    ev:      r2(ev * entry),
    evPct:   r2(ev * 100),
    winProb: r2(winProb * 100),
    payout,
  }
}

function evFlex(probs: number[], entry: number): {
  ev: number; evPct: number
  breakdown: { k: number; prob: number; payout: number; contribution: number }[]
} {
  const n        = probs.length
  const schedule = FLEX_SCHEDULE[n]
  if (!schedule) return { ev: 0, evPct: 0, breakdown: [] }

  const dp = poissonBinomialDP(probs)
  let expectedMult = 0
  const breakdown = []

  for (let k = 0; k <= n; k++) {
    const mult   = schedule[k] || 0
    const prob   = dp[k]
    const payout = entry * mult
    const contrib = prob * payout
    expectedMult += prob * mult
    if (mult > 0) {
      breakdown.push({ k, prob: r2(prob * 100), payout: r2(payout), contribution: r2(contrib) })
    }
  }

  return {
    ev:        r2(expectedMult * entry - entry),
    evPct:     r2((expectedMult - 1) * 100),
    breakdown: breakdown.sort((a, b) => b.k - a.k),
  }
}

function r2(n: number) { return Math.round(n * 100) / 100 }

export default function ParlayBuilderPage() {
  const [props,       setProps]      = useState<PropRow[]>([])
  const [loading,     setLoading]    = useState(true)
  const [parlay,      setParlay]     = useState<ParlayLeg[]>([])
  const [entry,       setEntry]      = useState(10)
  const [entryType,   setEntryType]  = useState<'flex' | 'power'>('flex')
  const [search,      setSearch]     = useState('')
  const [statFilter,  setStatFilter] = useState('all')

  useEffect(() => {
    fetch(`${API}/props/board`)
      .then(r => r.json())
      .then(d => { setProps(d.results || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  function addToParlay(prop: PropRow) {
    if (parlay.length >= 6) return
    if (parlay.find(l => l.prop.player_name === prop.player_name && l.prop.stat === prop.stat)) return
    // calibrated prob: composite_score is 0-100 calibrated probability
    const prob = Math.min(0.95, Math.max(0.05, prop.composite_score / 100))
    setParlay(p => [...p, { prop, side: prop.pick_side as 'over' | 'under', prob }])
  }

  function removeFromParlay(idx: number) {
    setParlay(p => p.filter((_, i) => i !== idx))
  }

  function toggleSide(idx: number) {
    setParlay(p => p.map((leg, i) =>
      i !== idx ? leg : { ...leg, side: leg.side === 'over' ? 'under' : 'over', prob: 1 - leg.prob }
    ))
  }

  const n        = parlay.length
  const probs    = parlay.map(l => l.prob)
  const corrP    = n >= 2 ? correlationPenalty(parlay) : 1.0
  const hasCorr  = corrP < 0.999

  const flexEV   = n >= 2 ? evFlex(probs, entry) : null
  const powerEV  = n >= 2 ? evPower(probs, entry, corrP) : null
  const activeEV = entryType === 'flex' ? flexEV : powerEV

  const breakeven = POWER_BREAKEVEN[n] ?? 57.7

  const filtered = useMemo(() => props.filter(p => {
    if (statFilter !== 'all' && p.stat !== statFilter) return false
    if (search && !p.player_name.toLowerCase().includes(search.toLowerCase())) return false
    if (parlay.find(l => l.prop.player_name === p.player_name && l.prop.stat === p.stat)) return false
    return true
  }), [props, statFilter, search, parlay])

  const evColor = (ev: number) => ev > 0 ? '#4ade80' : '#f87171'

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.12em', marginBottom: '4px' }}>
          PARLAY BUILDER · PRIZEPICKS · POISSON-BINOMIAL EV · NOT BETTING ADVICE
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: 400, color: '#f0f0f0', margin: 0 }}>Flex Parlay Builder</h1>
          <Link href="/props" style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#555', textDecoration: 'none' }}>
            ← Back to Props
          </Link>
        </div>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333', marginTop: '4px' }}>
          EV uses Poisson-binomial DP with correlation penalties. Probabilities are calibrated model estimates.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 390px', gap: '16px', alignItems: 'start' }}>

        {/* Left: prop picker */}
        <div>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '8px', alignItems: 'center' }}>
            {['all','pts','reb','ast','fg3m','stl','blk'].map(s => (
              <button key={s} onClick={() => setStatFilter(s)} style={{
                background: statFilter === s ? '#0f1f0f' : 'transparent',
                border: `1px solid ${statFilter === s ? '#4ade80' : '#1a1a1a'}`,
                color: statFilter === s ? '#4ade80' : '#444',
                padding: '5px 10px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', cursor: 'pointer',
              }}>{s === 'all' ? 'All' : STAT_LABEL[s]}</button>
            ))}
            <div style={{ flex: 1 }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search player..."
              style={{ background: 'transparent', border: '1px solid #1a1a1a', color: '#e0e0e0',
                padding: '5px 10px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
                outline: 'none', width: '140px' }} />
          </div>

          <div style={{ border: '1px solid #1a1a1a', maxHeight: '620px', overflowY: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '160px 46px 56px 68px 68px 70px 32px',
              padding: '7px 12px', borderBottom: '1px solid #1a1a1a',
              fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', letterSpacing: '0.06em',
              position: 'sticky', top: 0, background: '#0a0a0a' }}>
              <span>PLAYER</span><span>STAT</span><span>LINE</span>
              <span>L10 AVG</span><span>L10 HIT%</span><span>CAL PROB</span><span>ADD</span>
            </div>

            {loading ? (
              <div style={{ padding: '32px', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#444' }}>Loading...</div>
            ) : filtered.map((p, i) => {
              const isOver = p.pick_side === 'over'
              const prob   = (p.composite_score).toFixed(1)
              return (
                <div key={`${p.player_name}|${p.stat}|${p.odds_type}`}
                  style={{ display: 'grid', gridTemplateColumns: '160px 46px 56px 68px 68px 70px 32px',
                    padding: '9px 12px', borderBottom: i < filtered.length - 1 ? '1px solid #0a0a0a' : 'none',
                    alignItems: 'center', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>

                  <div>
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', fontWeight: 600, color: '#e0e0e0' }}>
                      {p.player_name}
                    </div>
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '8px', color: '#444', marginTop: '1px' }}>
                      {p.is_home ? 'vs' : '@'} {p.opponent}
                      {p.odds_type !== 'standard' && (
                        <span style={{ color: '#4ade80', marginLeft: '4px' }}>{p.odds_type}</span>
                      )}
                    </div>
                  </div>

                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#666' }}>
                    {STAT_LABEL[p.stat]}
                  </span>

                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', fontWeight: 700, color: '#e0e0e0' }}>
                    {p.line}
                  </span>

                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
                    color: p.avg_last10 > p.line ? '#4ade80' : '#f87171' }}>
                    {p.avg_last10 ?? '—'}
                  </span>

                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
                    color: p.hit_rate_last10 >= 60 ? '#4ade80' : p.hit_rate_last10 >= 50 ? '#fbbf24' : '#f87171' }}>
                    {p.hit_rate_last10?.toFixed(0) ?? '—'}%
                  </span>

                  <div>
                    <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', fontWeight: 700,
                      color: isOver ? '#4ade80' : '#f87171' }}>{isOver ? 'O' : 'U'} </span>
                    <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px',
                      color: p.edge > 4 ? '#4ade80' : p.edge < -4 ? '#f87171' : '#666' }}>
                      {prob}%
                    </span>
                  </div>

                  <button onClick={() => addToParlay(p)} disabled={parlay.length >= 6}
                    style={{ background: parlay.length >= 6 ? 'transparent' : '#0f1f0f',
                      border: `1px solid ${parlay.length >= 6 ? '#222' : '#4ade80'}`,
                      color: parlay.length >= 6 ? '#222' : '#4ade80',
                      width: '26px', height: '22px', fontFamily: 'IBM Plex Mono, monospace',
                      fontSize: '14px', cursor: parlay.length >= 6 ? 'default' : 'pointer', lineHeight: 1 }}>
                    +
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right: parlay slip */}
        <div style={{ position: 'sticky', top: '16px' }}>
          <div style={{ border: '1px solid #1a1a1a', padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', letterSpacing: '0.1em' }}>
                PARLAY SLIP — {n}/6 PICKS
              </div>
              {n >= 2 && (
                <div style={{ display: 'flex', gap: '3px' }}>
                  {(['flex','power'] as const).map(t => (
                    <button key={t} onClick={() => setEntryType(t)} style={{
                      background: entryType === t ? '#0f1f0f' : 'transparent',
                      border: `1px solid ${entryType === t ? '#4ade80' : '#1a1a1a'}`,
                      color: entryType === t ? '#4ade80' : '#444',
                      padding: '3px 8px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', cursor: 'pointer',
                    }}>{t.toUpperCase()}</button>
                  ))}
                </div>
              )}
            </div>

            {n === 0 ? (
              <div style={{ padding: '28px 0', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#333' }}>
                Add 2–6 props to build a parlay
              </div>
            ) : (
              <>
                {parlay.map((leg, i) => {
                  const isOver   = leg.side === 'over'
                  const canFlip  = leg.prop.odds_type === 'standard'
                  const aboveBreakeven = leg.prob * 100 > breakeven
                  return (
                    <div key={i} style={{ padding: '9px 0', borderBottom: '1px solid #0d0d0d' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', fontWeight: 700, color: '#e0e0e0' }}>
                            {leg.prop.player_name}
                          </div>
                          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#555', marginTop: '2px' }}>
                            {STAT_LABEL[leg.prop.stat]} {leg.prop.line}
                            {' · '}
                            <span style={{ color: isOver ? '#4ade80' : '#f87171', fontWeight: 700 }}>
                              {isOver ? 'OVER' : 'UNDER'}
                            </span>
                          </div>
                          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', marginTop: '2px',
                            color: aboveBreakeven ? '#4ade80' : '#f87171' }}>
                            {(leg.prob * 100).toFixed(1)}% cal. prob
                            {' · '}
                            {aboveBreakeven ? `+${((leg.prob*100) - breakeven).toFixed(1)}% edge` : `${((leg.prob*100) - breakeven).toFixed(1)}% edge`}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '3px' }}>
                          {canFlip && (
                            <button onClick={() => toggleSide(i)}
                              style={{ background: 'transparent', border: '1px solid #2a2a2a',
                                color: '#555', padding: '3px 6px', fontFamily: 'IBM Plex Mono, monospace',
                                fontSize: '9px', cursor: 'pointer' }}>⇅</button>
                          )}
                          <button onClick={() => removeFromParlay(i)}
                            style={{ background: 'transparent', border: '1px solid #2a2a2a',
                              color: '#f87171', padding: '3px 6px', fontFamily: 'IBM Plex Mono, monospace',
                              fontSize: '11px', cursor: 'pointer' }}>×</button>
                        </div>
                      </div>
                    </div>
                  )
                })}

                {/* Correlation warning */}
                {hasCorr && (
                  <div style={{ margin: '8px 0', padding: '6px 8px',
                    background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.2)' }}>
                    <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#fbbf24' }}>
                      ⚠ Correlation penalty applied ({(corrP * 100).toFixed(0)}%) — same team/game/stats detected
                    </span>
                  </div>
                )}

                {/* Entry amount */}
                <div style={{ margin: '10px 0', display: 'flex', gap: '3px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444' }}>ENTRY $</span>
                  {[5, 10, 25, 50, 100].map(amt => (
                    <button key={amt} onClick={() => setEntry(amt)} style={{
                      background: entry === amt ? '#0f1f0f' : 'transparent',
                      border: `1px solid ${entry === amt ? '#4ade80' : '#1a1a1a'}`,
                      color: entry === amt ? '#4ade80' : '#555',
                      padding: '3px 7px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', cursor: 'pointer',
                    }}>{amt}</button>
                  ))}
                  <input type="number" value={entry} onChange={e => setEntry(Number(e.target.value))}
                    style={{ background: 'transparent', border: '1px solid #1a1a1a', color: '#e0e0e0',
                      padding: '3px 7px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px',
                      outline: 'none', width: '55px' }} />
                </div>

                {n >= 2 && activeEV && (
                  <>
                    {/* EV Summary */}
                    <div style={{ background: activeEV.ev > 0 ? 'rgba(74,222,128,0.05)' : 'rgba(248,113,113,0.05)',
                      border: `1px solid ${activeEV.ev > 0 ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}`,
                      padding: '10px', marginBottom: '10px' }}>

                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#555' }}>Expected Value</span>
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '15px', fontWeight: 700, color: evColor(activeEV.ev) }}>
                          {activeEV.ev >= 0 ? '+' : ''}${activeEV.ev.toFixed(2)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#555' }}>ROI</span>
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', fontWeight: 600, color: evColor(activeEV.ev) }}>
                          {activeEV.evPct >= 0 ? '+' : ''}{activeEV.evPct.toFixed(1)}%
                        </span>
                      </div>
                      {'winProb' in activeEV && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#555' }}>Win prob (w/ corr)</span>
                          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#888' }}>
                            {(activeEV as any).winProb}%
                          </span>
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#555' }}>Break-even per leg</span>
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#666' }}>
                          {breakeven}%
                        </span>
                      </div>
                    </div>

                    {/* Flex breakdown */}
                    {'breakdown' in activeEV && activeEV.breakdown.length > 0 && (
                      <>
                        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', letterSpacing: '0.08em', marginBottom: '5px' }}>
                          FLEX PAYOUT BREAKDOWN (POISSON-BINOMIAL)
                        </div>
                        {(activeEV as any).breakdown.map((b: any, i: number) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #0a0a0a' }}>
                            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#555' }}>
                              {b.k}/{n} correct
                            </span>
                            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#666' }}>
                              {b.prob}% chance
                            </span>
                            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#4ade80' }}>
                              ${b.payout.toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </>
                    )}

                    {/* Power breakdown */}
                    {entryType === 'power' && 'winProb' in activeEV && (
                      <div style={{ marginTop: '8px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#555' }}>
                        Power Play: all {n} legs must hit · {POWER_MULTIPLIERS[n]}x multiplier
                      </div>
                    )}

                    <div style={{ marginTop: '8px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#333', lineHeight: 1.6 }}>
                      {entryType === 'flex' ? 'Flex EV uses Poisson-binomial DP.' : 'Power EV uses product rule with correlation penalty.'}
                      {' '}Assumes independent legs. Not betting advice.
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          {/* Quick-add top picks */}
          {n === 0 && !loading && (
            <div style={{ marginTop: '12px', border: '1px solid #1a1a1a', padding: '12px' }}>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', letterSpacing: '0.08em', marginBottom: '8px' }}>
                QUICK ADD — TOP 5 BY CALIBRATED PROB
              </div>
              {props.slice(0, 5).map((p, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '6px 0', borderBottom: i < 4 ? '1px solid #0a0a0a' : 'none' }}>
                  <div>
                    <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#ccc' }}>{p.player_name}</span>
                    <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#555', marginLeft: '6px' }}>
                      {STAT_LABEL[p.stat]} {p.line} {p.pick_side === 'over' ? 'O' : 'U'} · {p.composite_score.toFixed(1)}%
                    </span>
                  </div>
                  <button onClick={() => addToParlay(p)} style={{
                    background: '#0f1f0f', border: '1px solid #4ade80', color: '#4ade80',
                    padding: '3px 8px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', cursor: 'pointer',
                  }}>+ Add</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
