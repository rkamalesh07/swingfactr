'use client'

import { useState, useEffect, useMemo } from 'react'

const API        = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const PP_IMPLIED = 57.7

// PrizePicks Flex payout table
// [picks]: [[correct, multiplier], ...]
const FLEX_PAYOUTS: Record<number, [number, number][]> = {
  2: [[2, 3]],
  3: [[3, 5], [2, 1.25]],
  4: [[4, 10], [3, 2], [2, 0.4]],
  5: [[5, 20], [4, 2], [3, 0.4]],
  6: [[6, 25], [5, 2], [4, 0.4]],
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
  factors:         { label: string; value: string; impact: string }[]
}

interface ParlayLeg {
  prop:      PropRow
  side:      'over' | 'under'
  prob:      number   // model probability 0-1
}

// Compute flex EV given leg probabilities and entry amount
function computeFlexEV(probs: number[], entry: number): {
  ev: number
  evPct: number
  breakdown: { correct: number; prob: number; payout: number; contribution: number }[]
} {
  const n = probs.length
  const payouts = FLEX_PAYOUTS[n]
  if (!payouts) return { ev: 0, evPct: 0, breakdown: [] }

  // Compute probability of getting exactly k correct (simplified: assume independence)
  // Use inclusion-exclusion for small n
  function probExactlyK(k: number): number {
    // Sum over all subsets of size k
    const indices = Array.from({ length: n }, (_, i) => i)
    let total = 0
    function choose(start: number, chosen: number[]): void {
      if (chosen.length === k) {
        let p = 1
        for (let i = 0; i < n; i++) {
          p *= chosen.includes(i) ? probs[i] : (1 - probs[i])
        }
        total += p
        return
      }
      for (let i = start; i < n; i++) {
        choose(i + 1, [...chosen, i])
      }
    }
    choose(0, [])
    return total
  }

  let ev = 0
  const breakdown: { correct: number; prob: number; payout: number; contribution: number }[] = []

  for (const [correct, multiplier] of payouts) {
    const prob    = probExactlyK(correct)
    const payout  = entry * multiplier
    const contrib = prob * payout
    ev           += contrib
    breakdown.push({ correct, prob, payout, contribution: contrib })
  }

  return {
    ev:     round2(ev - entry),
    evPct:  round2((ev / entry - 1) * 100),
    breakdown,
  }
}

function round2(n: number) { return Math.round(n * 100) / 100 }

function combinedProb(probs: number[]): number {
  return probs.reduce((acc, p) => acc * p, 1)
}

function nCr(n: number, r: number): number {
  if (r > n) return 0
  let result = 1
  for (let i = 0; i < r; i++) {
    result *= (n - i) / (i + 1)
  }
  return result
}

export default function ParlayBuilderPage() {
  const [props,   setProps]   = useState<PropRow[]>([])
  const [loading, setLoading] = useState(true)
  const [parlay,  setParlay]  = useState<ParlayLeg[]>([])
  const [entry,   setEntry]   = useState(10)
  const [search,  setSearch]  = useState('')
  const [statFilter, setStatFilter] = useState('all')

  useEffect(() => {
    fetch(`${API}/props/board`)
      .then(r => r.json())
      .then(d => { setProps(d.results || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  function addToParlay(prop: PropRow) {
    if (parlay.length >= 6) return
    if (parlay.find(l => l.prop.player_name === prop.player_name && l.prop.stat === prop.stat)) return

    const prob = Math.min(0.95, Math.max(0.05, prop.composite_score / 100))
    const side = prop.pick_side as 'over' | 'under'
    setParlay(p => [...p, { prop, side, prob }])
  }

  function removeFromParlay(idx: number) {
    setParlay(p => p.filter((_, i) => i !== idx))
  }

  function toggleSide(idx: number) {
    setParlay(p => p.map((leg, i) => {
      if (i !== idx) return leg
      const newSide = leg.side === 'over' ? 'under' : 'over'
      // Flip probability
      const newProb = 1 - leg.prob
      return { ...leg, side: newSide, prob: newProb }
    }))
  }

  const probs   = parlay.map(l => l.prob)
  const flexEV  = parlay.length >= 2 ? computeFlexEV(probs, entry) : null
  const combP   = parlay.length >= 2 ? combinedProb(probs) : null

  const filtered = useMemo(() => props.filter(p => {
    if (statFilter !== 'all' && p.stat !== statFilter) return false
    if (search && !p.player_name.toLowerCase().includes(search.toLowerCase())) return false
    // Don't show already-added props
    if (parlay.find(l => l.prop.player_name === p.player_name && l.prop.stat === p.stat)) return false
    return true
  }), [props, statFilter, search, parlay])

  const evColor = flexEV
    ? flexEV.ev > 0 ? '#4ade80' : '#f87171'
    : '#888'

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.12em', marginBottom: '6px' }}>
          PARLAY BUILDER · PRIZEPICKS FLEX · NOT BETTING ADVICE
        </div>
        <h1 style={{ fontSize: '22px', fontWeight: 400, color: '#f0f0f0' }}>Flex Parlay Builder</h1>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333', marginTop: '4px' }}>
          Build a 2–6 pick flex parlay. EV calculated from model probabilities vs PrizePicks flex payouts.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '16px', alignItems: 'start' }}>

        {/* Left: prop picker */}
        <div>
          {/* Filters */}
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
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search player..."
              style={{ background: 'transparent', border: '1px solid #1a1a1a', color: '#e0e0e0',
                padding: '5px 10px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
                outline: 'none', width: '140px' }} />
          </div>

          {/* Prop list */}
          <div style={{ border: '1px solid #1a1a1a', maxHeight: '600px', overflowY: 'auto' }}>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: '160px 50px 60px 70px 70px 60px 36px',
              padding: '7px 12px', borderBottom: '1px solid #1a1a1a',
              fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', letterSpacing: '0.06em',
              position: 'sticky', top: 0, background: '#0a0a0a' }}>
              <span>PLAYER</span><span>STAT</span><span>LINE</span>
              <span>L10 AVG</span><span>L10 HIT%</span><span>SCORE</span><span>ADD</span>
            </div>

            {loading ? (
              <div style={{ padding: '32px', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#444' }}>
                Loading props...
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#444' }}>
                No props available
              </div>
            ) : filtered.map((p, i) => {
              const isOver = p.pick_side === 'over'
              const atMax  = parlay.length >= 6
              return (
                <div key={`${p.player_name}|${p.stat}|${p.odds_type}`}
                  style={{ display: 'grid', gridTemplateColumns: '160px 50px 60px 70px 70px 60px 36px',
                    padding: '9px 12px', borderBottom: i < filtered.length - 1 ? '1px solid #0a0a0a' : 'none',
                    alignItems: 'center',
                    background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>

                  <div>
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', fontWeight: 600, color: '#e0e0e0' }}>
                      {p.player_name}
                    </div>
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '8px', color: '#444', marginTop: '1px' }}>
                      {p.is_home ? 'vs' : '@'} {p.opponent}
                      {p.odds_type !== 'standard' && (
                        <span style={{ color: p.odds_type === 'goblin' ? '#4ade80' : '#f87171', marginLeft: '4px' }}>
                          {p.odds_type}
                        </span>
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

                  <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', fontWeight: 700,
                      color: isOver ? '#4ade80' : '#f87171' }}>{isOver ? 'O' : 'U'}</span>
                    <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px',
                      color: p.edge > 4 ? '#4ade80' : p.edge < -4 ? '#f87171' : '#555' }}>
                      {p.edge > 0 ? '+' : ''}{p.edge.toFixed(1)}
                    </span>
                  </div>

                  <button onClick={() => addToParlay(p)} disabled={atMax}
                    style={{ background: atMax ? 'transparent' : '#0f1f0f',
                      border: `1px solid ${atMax ? '#222' : '#4ade80'}`,
                      color: atMax ? '#222' : '#4ade80',
                      width: '28px', height: '24px', fontFamily: 'IBM Plex Mono, monospace',
                      fontSize: '14px', cursor: atMax ? 'default' : 'pointer', lineHeight: 1 }}>
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
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', letterSpacing: '0.1em', marginBottom: '12px' }}>
              PARLAY SLIP — {parlay.length}/6 PICKS
            </div>

            {parlay.length === 0 ? (
              <div style={{ padding: '32px 0', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#333' }}>
                Add 2–6 props to build a flex parlay
              </div>
            ) : (
              <>
                {/* Legs */}
                {parlay.map((leg, i) => {
                  const isOver = leg.side === 'over'
                  const canFlip = leg.prop.odds_type === 'standard'
                  return (
                    <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid #0d0d0d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                          {' · '}
                          <span style={{ color: '#666' }}>{(leg.prob * 100).toFixed(0)}% model prob</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        {canFlip && (
                          <button onClick={() => toggleSide(i)} title="Flip over/under"
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
                  )
                })}

                {/* Entry amount */}
                <div style={{ marginTop: '12px', marginBottom: '12px', display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444' }}>ENTRY $</span>
                  {[5, 10, 25, 50, 100].map(amt => (
                    <button key={amt} onClick={() => setEntry(amt)} style={{
                      background: entry === amt ? '#0f1f0f' : 'transparent',
                      border: `1px solid ${entry === amt ? '#4ade80' : '#1a1a1a'}`,
                      color: entry === amt ? '#4ade80' : '#555',
                      padding: '4px 8px', fontFamily: 'IBM Plex Mono, monospace',
                      fontSize: '10px', cursor: 'pointer',
                    }}>{amt}</button>
                  ))}
                  <input type="number" value={entry} onChange={e => setEntry(Number(e.target.value))}
                    style={{ background: 'transparent', border: '1px solid #1a1a1a', color: '#e0e0e0',
                      padding: '4px 8px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px',
                      outline: 'none', width: '60px' }} />
                </div>

                {parlay.length >= 2 && flexEV && (
                  <>
                    {/* EV Summary */}
                    <div style={{ background: flexEV.ev > 0 ? 'rgba(74,222,128,0.05)' : 'rgba(248,113,113,0.05)',
                      border: `1px solid ${flexEV.ev > 0 ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}`,
                      padding: '12px', marginBottom: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#555' }}>Expected Value</span>
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '14px', fontWeight: 700, color: evColor }}>
                          {flexEV.ev >= 0 ? '+' : ''}${flexEV.ev.toFixed(2)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#555' }}>ROI</span>
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', fontWeight: 600, color: evColor }}>
                          {flexEV.evPct >= 0 ? '+' : ''}{flexEV.evPct.toFixed(1)}%
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#555' }}>All correct prob</span>
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#888' }}>
                          {((combP ?? 0) * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>

                    {/* Payout breakdown */}
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', letterSpacing: '0.08em', marginBottom: '6px' }}>
                      FLEX PAYOUT BREAKDOWN
                    </div>
                    {flexEV.breakdown.map((b, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0',
                        borderBottom: '1px solid #0a0a0a' }}>
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#555' }}>
                          {b.correct}/{parlay.length} correct
                        </span>
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#666' }}>
                          {(b.prob * 100).toFixed(1)}% chance
                        </span>
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#4ade80' }}>
                          ${b.payout.toFixed(2)}
                        </span>
                      </div>
                    ))}

                    <div style={{ marginTop: '10px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#333', lineHeight: 1.6 }}>
                      EV assumes leg independence. Model probabilities are estimates, not guarantees.
                      Not betting advice.
                    </div>
                  </>
                )}

                {parlay.length === 1 && (
                  <div style={{ padding: '12px 0', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333', textAlign: 'center' }}>
                    Add at least 1 more pick to see EV
                  </div>
                )}
              </>
            )}
          </div>

          {/* Quick add: top picks */}
          {parlay.length === 0 && !loading && (
            <div style={{ marginTop: '12px', border: '1px solid #1a1a1a', padding: '12px' }}>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', letterSpacing: '0.08em', marginBottom: '8px' }}>
                QUICK ADD — TOP 5 BY EDGE
              </div>
              {props.slice(0, 5).map((p, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '6px 0', borderBottom: i < 4 ? '1px solid #0a0a0a' : 'none' }}>
                  <div>
                    <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#ccc' }}>{p.player_name}</span>
                    <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#555', marginLeft: '6px' }}>
                      {STAT_LABEL[p.stat]} {p.line} {p.pick_side === 'over' ? 'O' : 'U'}
                    </span>
                  </div>
                  <button onClick={() => addToParlay(p)} style={{
                    background: '#0f1f0f', border: '1px solid #4ade80', color: '#4ade80',
                    padding: '3px 8px', fontFamily: 'IBM Plex Mono, monospace',
                    fontSize: '10px', cursor: 'pointer',
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
