'use client'

import { useState, useEffect, useMemo } from 'react'

const API           = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const PASSWORD_HASH = '6bde5eb933b7bb25535f8f5d62c5c65e0b5110fe654a9caf2cdcc32a077d8b97'
// Dynamic break-even probability per leg count
// Formula: (1 / payout) ** (1 / num_legs) * 100
const PP_PAYOUTS: Record<number, number> = { 2: 3.0, 3: 5.0, 4: 10.0, 5: 20.0, 6: 25.0 }
function ppBreakEven(numLegs = 2): number {
  const payout = PP_PAYOUTS[numLegs] ?? PP_PAYOUTS[2]
  return parseFloat(((1.0 / payout) ** (1.0 / numLegs) * 100).toFixed(2))
}
const PP_IMPLIED = ppBreakEven(2)   // ≈ 57.74 — single-leg 2-pick default

async function sha256(msg: string): Promise<string> {
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

interface Result {
  game_date:       string
  player_name:     string
  team:            string
  stat:            string
  odds_type:       string
  line:            number
  actual_value:    number
  hit:             boolean
  composite_score: number
  score_label:     string
  edge:            number
  pick_side:       string
  correct:         boolean
}

const STAT_LABEL: Record<string, string> = {
  pts: 'PTS', reb: 'REB', ast: 'AST', fg3m: '3PM', stl: 'STL', blk: 'BLK'
}

const BUCKET_RANGES = [
  { label: 'Strong Over (67.7+)',   min: 67.7,  max: 95,   side: 'over'  },
  { label: 'Lean Over (61.7–67.7)', min: 61.7,  max: 67.7, side: 'over'  },
  { label: 'Toss-up (53.7–61.7)',   min: 53.7,  max: 61.7, side: 'any'   },
  { label: 'Lean Under (47.7–53.7)',min: 47.7,  max: 53.7, side: 'under' },
  { label: 'Strong Under (≤47.7)',  min: 0,     max: 47.7, side: 'under' },
]

function pct(n: number, d: number) {
  return d === 0 ? '—' : `${(n / d * 100).toFixed(1)}%`
}

function StatRow({ label, val, color = '#888' }: { label: string; val: string | number; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1f1f24' }}>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#b0aea8' }}>{label}</span>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', fontWeight: 700, color }}>{val}</span>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid #1a1a1a', padding: '16px', marginBottom: '12px' }}>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#909090', letterSpacing: '0.1em', marginBottom: '12px' }}>{title}</div>
      {children}
    </div>
  )
}

export default function AdminPage() {
  const [authed,   setAuthed]   = useState(false)
  const [pw,       setPw]       = useState('')
  const [pwError,  setPwError]  = useState(false)
  const [results,  setResults]  = useState<Result[]>([])
  const [loading,  setLoading]  = useState(false)
  const [days,     setDays]     = useState(30)
  const [statFilter, setStatFilter] = useState('all')
  const [tierFilter, setTierFilter] = useState('all')

  async function handleLogin() {
    const hash = await sha256(pw)
    if (hash === PASSWORD_HASH) {
      setAuthed(true)
      setPwError(false)
    } else {
      setPwError(true)
    }
  }

  useEffect(() => {
    if (!authed) return
    setLoading(true)
    fetch(`${API}/props/results?days=${days}`)
      .then(r => r.json())
      .then(d => { setResults(d.results || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [authed, days])

  const filtered = useMemo(() => results.filter(r => {
    if (statFilter !== 'all' && r.stat !== statFilter) return false
    if (tierFilter !== 'all' && r.odds_type !== tierFilter) return false
    return true
  }), [results, statFilter, tierFilter])

  // Overall accuracy
  const withOutcome = filtered.filter(r => r.correct !== null && r.correct !== undefined)
  const totalCorrect = withOutcome.filter(r => r.correct).length

  // By score bucket
  const buckets = BUCKET_RANGES.map(b => {
    const rows = withOutcome.filter(r => r.composite_score >= b.min && r.composite_score < b.max)
    const correct = rows.filter(r => r.correct).length
    return { ...b, total: rows.length, correct }
  })

  // By tier
  const tiers = ['standard', 'goblin', 'demon'].map(t => {
    const rows = withOutcome.filter(r => r.odds_type === t)
    const correct = rows.filter(r => r.correct).length
    return { tier: t, total: rows.length, correct }
  })

  // By stat
  const stats = ['pts', 'reb', 'ast', 'fg3m', 'stl', 'blk'].map(s => {
    const rows = withOutcome.filter(r => r.stat === s)
    const correct = rows.filter(r => r.correct).length
    return { stat: s, total: rows.length, correct }
  })

  // Calibration: group by score decile
  const calibration = Array.from({ length: 9 }, (_, i) => {
    const lo = 50 + i * 5
    const hi = lo + 5
    const rows = withOutcome.filter(r => r.composite_score >= lo && r.composite_score < hi)
    const hits = rows.filter(r => r.hit).length
    return { label: `${lo}–${hi}`, total: rows.length, hitRate: rows.length ? hits / rows.length * 100 : null }
  })

  // Recent results table
  const recent = [...filtered].sort((a, b) => b.game_date.localeCompare(a.game_date)).slice(0, 50)

  if (!authed) {
    return (
      <div style={{ maxWidth: '360px', margin: '80px auto', padding: '32px', border: '1px solid #1a1a1a' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#909090', letterSpacing: '0.1em', marginBottom: '20px' }}>
          ADMIN ACCESS · OUTCOMES TRACKER
        </div>
        <input
          type="password"
          value={pw}
          onChange={e => setPw(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleLogin()}
          placeholder="Enter password"
          style={{
            width: '100%', background: 'transparent', border: `1px solid ${pwError ? '#f87171' : '#1a1a1a'}`,
            color: '#e0e0e0', padding: '10px 12px', fontFamily: 'IBM Plex Mono, monospace',
            fontSize: '13px', outline: 'none', boxSizing: 'border-box', marginBottom: '8px',
          }}
        />
        {pwError && <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#f87171', marginBottom: '8px' }}>Incorrect password</div>}
        <button onClick={handleLogin} style={{
          width: '100%', background: '#0f1f0f', border: '1px solid #4ade80',
          color: '#4ade80', padding: '10px', fontFamily: 'IBM Plex Mono, monospace',
          fontSize: '12px', cursor: 'pointer', letterSpacing: '0.08em',
        }}>ENTER</button>
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#909090', letterSpacing: '0.12em', marginBottom: '6px' }}>
          ADMIN · OUTCOMES TRACKER · INTERNAL ONLY
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: 400, color: '#f0f0f0' }}>Model Performance</h1>
          <div style={{ display: 'flex', gap: '4px' }}>
            {[7, 14, 30, 60].map(d => (
              <button key={d} onClick={() => setDays(d)} style={{
                background: days === d ? '#0f1f0f' : 'transparent',
                border: `1px solid ${days === d ? '#4ade80' : '#1a1a1a'}`,
                color: days === d ? '#4ade80' : '#444',
                padding: '5px 10px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', cursor: 'pointer',
              }}>Last {d}d</button>
            ))}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {['all','pts','reb','ast','fg3m','stl','blk'].map(s => (
          <button key={s} onClick={() => setStatFilter(s)} style={{
            background: statFilter === s ? '#0f1f0f' : 'transparent',
            border: `1px solid ${statFilter === s ? '#4ade80' : '#1a1a1a'}`,
            color: statFilter === s ? '#4ade80' : '#444',
            padding: '5px 9px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', cursor: 'pointer',
          }}>{s === 'all' ? 'All Stats' : STAT_LABEL[s]}</button>
        ))}
        <div style={{ width: '1px', height: '24px', background: '#1a1a1a', margin: '0 4px' }} />
        {['all','standard','goblin','demon'].map(t => (
          <button key={t} onClick={() => setTierFilter(t)} style={{
            background: tierFilter === t ? '#0f1f0f' : 'transparent',
            border: `1px solid ${tierFilter === t ? '#4ade80' : '#1a1a1a'}`,
            color: tierFilter === t ? '#4ade80' : '#444',
            padding: '5px 9px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', cursor: 'pointer',
          }}>{t === 'all' ? 'All Tiers' : t}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#909090' }}>Loading results...</div>
      ) : withOutcome.length === 0 ? (
        <div style={{ border: '1px solid #1a1a1a', padding: '48px', textAlign: 'center' }}>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#909090', marginBottom: '6px' }}>No outcome data yet</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#909090' }}>
            Outcome checker runs nightly at 10pm PST. First results available tomorrow.
          </div>
        </div>
      ) : (
        <>
          {/* Overview */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', marginBottom: '16px' }}>
            {([
              ['PICKS TRACKED', withOutcome.length, '#888'],
              ['CORRECT',       totalCorrect,        '#4ade80'],
              ['ACCURACY',      pct(totalCorrect, withOutcome.length), totalCorrect / withOutcome.length > PP_IMPLIED / 100 ? '#4ade80' : '#f87171'],
              ['VS PP IMPLIED', `${((totalCorrect / withOutcome.length - PP_IMPLIED / 100) * 100).toFixed(1)}%`, totalCorrect / withOutcome.length > PP_IMPLIED / 100 ? '#4ade80' : '#f87171'],
            ] as [string, string | number, string][]).map(([label, val, color]) => (
              <div key={label} style={{ border: '1px solid #1a1a1a', padding: '12px 16px' }}>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#909090', letterSpacing: '0.08em', marginBottom: '4px' }}>{label}</div>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '20px', fontWeight: 700, color }}>{val}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>

            {/* By score bucket */}
            <Card title="ACCURACY BY SCORE BUCKET">
              {buckets.map(b => (
                <div key={b.label} style={{ marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#b0aea8' }}>{b.label}</span>
                    <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px',
                      color: b.total > 0 && b.correct / b.total > PP_IMPLIED / 100 ? '#4ade80' : b.total > 0 ? '#f87171' : '#333' }}>
                      {pct(b.correct, b.total)} <span style={{ color: '#909090' }}>({b.total})</span>
                    </span>
                  </div>
                  {b.total > 0 && (
                    <div style={{ height: '3px', background: '#111', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${b.correct / b.total * 100}%`,
                        background: b.correct / b.total > PP_IMPLIED / 100 ? '#4ade80' : '#f87171' }} />
                    </div>
                  )}
                </div>
              ))}
            </Card>

            {/* By tier */}
            <Card title="ACCURACY BY TIER">
              {tiers.map(t => (
                <div key={t.tier} style={{ marginBottom: '10px' }}>
                  <StatRow
                    label={`${t.tier === 'goblin' ? '🟢 ' : t.tier === 'demon' ? '🔴 ' : ''}${t.tier} (${t.total})`}
                    val={pct(t.correct, t.total)}
                    color={t.total > 0 && t.correct / t.total > PP_IMPLIED / 100 ? '#4ade80' : t.total > 0 ? '#f87171' : '#555'}
                  />
                </div>
              ))}
            </Card>

            {/* By stat */}
            <Card title="ACCURACY BY STAT">
              {stats.filter(s => s.total > 0).map(s => (
                <StatRow key={s.stat}
                  label={`${STAT_LABEL[s.stat]} (${s.total})`}
                  val={pct(s.correct, s.total)}
                  color={s.correct / s.total > PP_IMPLIED / 100 ? '#4ade80' : '#f87171'}
                />
              ))}
            </Card>
          </div>

          {/* Calibration */}
          <Card title="CALIBRATION — DOES OUR SCORE MEAN ANYTHING?">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '80px' }}>
              {calibration.map(c => {
                const height = c.hitRate != null ? `${c.hitRate}%` : '0%'
                const color  = c.hitRate != null && c.hitRate > PP_IMPLIED ? '#4ade80' : '#f87171'
                return (
                  <div key={c.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
                    <div style={{ width: '100%', height, background: c.hitRate != null ? color : '#1a1a1a', minHeight: '2px', position: 'relative' }}>
                      {c.hitRate != null && (
                        <div style={{ position: 'absolute', top: '-14px', left: '50%', transform: 'translateX(-50%)',
                          fontFamily: 'IBM Plex Mono, monospace', fontSize: '7px', color, whiteSpace: 'nowrap' }}>
                          {c.hitRate.toFixed(0)}%
                        </div>
                      )}
                    </div>
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '7px', color: '#909090', marginTop: '4px', textAlign: 'center' }}>{c.label}</div>
                    {c.total > 0 && <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '7px', color: '#787672' }}>n={c.total}</div>}
                  </div>
                )
              })}
            </div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#909090', marginTop: '8px' }}>
              Ideal: bars should increase left to right. Green = above {PP_IMPLIED.toFixed(1)}% break-even.
            </div>
          </Card>

          {/* Recent results table */}
          <Card title={`RECENT PICKS (last ${recent.length})`}>
            <div style={{ display: 'grid', gridTemplateColumns: '80px 140px 50px 50px 50px 55px 55px 40px 50px', gap: '0',
              fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#909090', letterSpacing: '0.06em',
              padding: '4px 0', borderBottom: '1px solid #222228', marginBottom: '4px' }}>
              <span>DATE</span><span>PLAYER</span><span>STAT</span><span>TIER</span>
              <span>LINE</span><span>ACTUAL</span><span>SCORE</span><span>PICK</span><span>RESULT</span>
            </div>
            {recent.map((r, i) => (
              <div key={i} style={{ display: 'grid',
                gridTemplateColumns: '80px 140px 50px 50px 50px 55px 55px 40px 50px',
                padding: '5px 0', borderBottom: '1px solid #0a0a0a', alignItems: 'center' }}>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#909090' }}>{r.game_date}</span>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.player_name}</span>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#b0aea8' }}>{STAT_LABEL[r.stat] || r.stat}</span>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px',
                  color: r.odds_type === 'goblin' ? '#4ade80' : r.odds_type === 'demon' ? '#f87171' : '#444' }}>
                  {r.odds_type}
                </span>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#888' }}>{r.line}</span>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
                  color: r.actual_value > r.line ? '#4ade80' : '#f87171' }}>{r.actual_value}</span>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px',
                  color: r.composite_score >= 67.7 ? '#4ade80' : r.composite_score >= 61.7 ? '#86efac' : '#555' }}>
                  {r.composite_score?.toFixed(1)}
                </span>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', fontWeight: 700,
                  color: r.pick_side === 'over' ? '#4ade80' : '#f87171' }}>
                  {r.pick_side === 'over' ? 'O' : 'U'}
                </span>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', fontWeight: 700,
                  color: r.correct ? '#4ade80' : '#f87171' }}>
                  {r.correct ? '✓' : '✗'}
                </span>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  )
}
