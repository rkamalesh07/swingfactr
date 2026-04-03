'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const STATS = [
  { key: 'all',  label: 'All' },
  { key: 'pts',  label: 'Points' },
  { key: 'reb',  label: 'Rebounds' },
  { key: 'ast',  label: 'Assists' },
  { key: 'fg3m', label: '3-Pointers' },
  { key: 'stl',  label: 'Steals' },
  { key: 'blk',  label: 'Blocks' },
]

const TIERS = [
  { key: 'all',      label: 'All Tiers' },
  { key: 'standard', label: 'Standard' },
  { key: 'goblin',   label: '🟢 Goblin' },
]

const DIRECTIONS = [
  { key: 'all',   label: 'All' },
  { key: 'over',  label: '⬆ Overs' },
  { key: 'under', label: '⬇ Unders' },
]

const STAT_LABEL: Record<string, string> = {
  pts: 'PTS', reb: 'REB', ast: 'AST', fg3m: '3PM', stl: 'STL', blk: 'BLK'
}

const TIER_BADGE: Record<string, { color: string; bg: string }> = {
  goblin:   { color: '#4ade80', bg: 'rgba(74,222,128,0.1)' },
  standard: { color: '#b0aea8',   bg: 'transparent'           },
}

interface PropRow {
  player_name:      string
  team:             string
  opponent:         string
  is_home:          boolean
  stat:             string
  odds_type:        string
  line:             number
  pp_implied_prob:  number
  pp_american_odds: number
  avg_season:       number
  avg_last5:        number
  avg_last10:       number
  hit_rate_season:  number
  hit_rate_last5:   number
  hit_rate_last10:  number
  composite_score:  number
  score_label:      string
  score_color:      string
  factors:          { label: string; value: string; impact: string }[]
  game_log:         { date: string; opp: string; home: boolean; val: number; min: number }[]
  is_b2b:           boolean
  rest_days:        number
  opp_def_label:    string
  computed_at:      string
  edge:             number
  pick_side:        string
  is_tossup:        boolean
  p_over?:          number
  p_under?:         number
  predicted_mean?:  number
  line_movement:    number
  opening_line?:    number | null
  predicted_std?:   number
  projected_min?:   number
  model_details?:    Record<string, number>
  player_status?:    string | null
  usage_boost_mult?: number
  injured_teammates?:string[]
  confirmed_starter?:boolean
}

interface BoardStats {
  total:         number
  strong_overs:  number
  lean_overs:    number
  strong_unders: number
  last_computed: string
  players:       number
  message?:      string
}

const PP_IMPLIED = 57.7

// Convert edge (abs distance from 57.7) to 1-5 rating.
// Distribution model produces genuine edges up to ±25.
// Direction-agnostic: Strong Under scores same as Strong Over.
function edgeToRating(edge: number): number {
  const abs = Math.abs(edge)
  if (abs >= 20) return 5   // very strong — e.g. mean well below/above line
  if (abs >= 14) return 4   // strong edge
  if (abs >= 9)  return 3   // solid edge
  if (abs >= 5)  return 2   // slight edge (min threshold to appear)
  return 1
}

function RatingBadge({ score, label, color }: { score: number; label: string; color: string }) {
  const edge   = score - PP_IMPLIED
  const rating = edgeToRating(edge)
  const dots   = [1, 2, 3, 4, 5]

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
        {/* 5-dot rating */}
        <div style={{ display: 'flex', gap: '3px' }}>
          {dots.map(d => (
            <div key={d} style={{
              width: '7px', height: '7px', borderRadius: '50%',
              background: d <= rating ? color : '#1a1a1a',
              boxShadow: d <= rating ? `0 0 4px ${color}66` : 'none',
              transition: 'background 0.2s',
            }} />
          ))}
        </div>
        {/* Rating number */}
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '8px', color: '#909090' }}>
          {rating}/5
        </span>
      </div>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color, lineHeight: 1.2 }}>{label}</span>
    </div>
  )
}

function HitBar({ pct, pickSide }: { pct: number; pickSide?: string }) {
  // For unders: flip the hit% so we show "under hit rate" not "over hit rate"
  const displayPct = pickSide === 'under' ? 100 - pct : pct
  const color = displayPct >= 65 ? '#4ade80' : displayPct >= 55 ? '#86efac' : displayPct >= 40 ? '#fbbf24' : '#f87171'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <div style={{ width: '40px', height: '4px', background: '#111', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${displayPct}%`, background: color }} />
      </div>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color, width: '34px' }}>{displayPct.toFixed(0)}%</span>
    </div>
  )
}

function ExpandedRow({ row }: { row: PropRow }) {
  const line = row.line
  return (
    <div style={{ padding: '16px 20px', background: '#070707', borderTop: '1px solid #1f1f24' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
        <div>
          {/* Model prediction summary */}
          {row.predicted_mean != null && (
            <div style={{ marginBottom: '12px', padding: '8px', background: '#141418', border: '1px solid #1a1a1a' }}>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#909090', letterSpacing: '0.08em', marginBottom: '6px' }}>MODEL OUTPUT</div>
              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                {([
                  ['Predicted', `${row.predicted_mean} ± ${row.predicted_std}`],
                  ['Proj. Min', `${row.projected_min}`],
                  ['P(over)',   `${row.p_over}%`],
                  ['P(under)',  `${row.p_under}%`],
                  ['Break-even', '57.7%'],
                  ...(row.usage_boost_mult && row.usage_boost_mult > 1.01
                    ? [['Usage boost', `+${((row.usage_boost_mult-1)*100).toFixed(0)}%`] as [string,string]]
                    : []),
                ] as [string,string][]).map(([lbl, val]) => (
                  <div key={lbl}>
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#909090' }}>{lbl}</div>
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', fontWeight: 600,
                      color: lbl === 'P(over)' ? (row.p_over! > 57.7 ? '#4ade80' : '#f87171')
                           : lbl === 'P(under)' ? (row.p_under! > 57.7 ? '#4ade80' : '#f87171')
                           : '#aaa' }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {row.injured_teammates && row.injured_teammates.length > 0 && (
            <div style={{ marginBottom: '10px', padding: '6px 10px', background: '#fbbf2408', border: '1px solid #fbbf2430' }}>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#fbbf24' }}>
                ⚠ Teammate(s) OUT: {row.injured_teammates.slice(0,3).join(', ')}
                {row.usage_boost_mult && row.usage_boost_mult > 1.01
                  ? ` → +${((row.usage_boost_mult-1)*100).toFixed(0)}% usage boost applied`
                  : ''}
              </span>
            </div>
          )}
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#909090', letterSpacing: '0.08em', marginBottom: '8px' }}>AVERAGES</div>
          {([['Season', row.avg_season], ['Last 10', row.avg_last10], ['Last 5', row.avg_last5]] as [string, number][]).map(([l, v]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#b0aea8' }}>{l}</span>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', fontWeight: 600,
                color: v != null && Number(v) > line ? '#4ade80' : '#f87171' }}>{v ?? '—'}</span>
            </div>
          ))}
          <div style={{ marginTop: '8px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#909090' }}>
            PrizePicks line · {row.odds_type} · implied {PP_IMPLIED}%
          </div>
        </div>
        <div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#909090', letterSpacing: '0.08em', marginBottom: '8px' }}>SCORE FACTORS</div>
          {row.factors?.map((f, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#b0aea8' }}>{f.label}</span>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px',
                color: f.impact === 'positive' ? '#4ade80' : f.impact === 'negative' ? '#f87171' : '#888' }}>
                {f.impact === 'positive' ? '↑' : f.impact === 'negative' ? '↓' : '—'} {f.value}
              </span>
            </div>
          ))}
        </div>
        <div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#909090', letterSpacing: '0.08em', marginBottom: '8px' }}>LAST 8 GAMES</div>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {row.game_log?.slice(0, 8).map((g, i) => {
              const over = g.val > line
              return (
                <div key={i} style={{
                  padding: '3px 6px',
                  background: over ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
                  border: `1px solid ${over ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}`,
                  fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
                  color: over ? '#4ade80' : '#f87171',
                }}>{g.val}</div>
              )
            })}
          </div>
          <div style={{ marginTop: '6px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#909090' }}>
            green = over {line} · red = under
          </div>
          <Link href="/props/parlay" style={{
            display: 'inline-block', marginTop: '10px',
            fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px',
            color: '#4ade80', border: '1px solid rgba(74,222,128,0.3)',
            padding: '4px 8px', textDecoration: 'none',
          }}>
            + Add to Parlay Builder →
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function PropsPage() {
  const [props, setProps]           = useState<PropRow[]>([])
  const [boardStats, setBoardStats] = useState<BoardStats | null>(null)
  const [loading, setLoading]       = useState(true)
  const [statFilter, setStatFilter] = useState('all')
  const [tierFilter, setTierFilter] = useState('all')
  const [search, setSearch]         = useState('')
  const [minScore, setMinScore]     = useState(0)
  const [sortBy, setSortBy]         = useState<'composite_score' | 'edge'>('composite_score')
  const [hideTossups, setHideTossups] = useState(false)
  const [directionFilter, setDirectionFilter] = useState('all')
  const [expanded, setExpanded]     = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch(`${API}/props/board`).then(r => r.json()),
      fetch(`${API}/props/board/stats`).then(r => r.json()),
    ]).then(([board, stats]) => {
      setProps(board.results || [])
      setBoardStats(stats)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    return props
      .filter(p => {
        if (statFilter !== 'all' && p.stat !== statFilter) return false
        if (tierFilter !== 'all' && p.odds_type !== tierFilter) return false
        if (search && !p.player_name.toLowerCase().includes(search.toLowerCase())) return false
        if (p.composite_score < minScore) return false
        if (directionFilter !== 'all' && p.pick_side !== directionFilter) return false
        if (hideTossups && p.is_tossup) return false
        return true
      })
      .sort((a, b) =>
        sortBy === 'edge'
          ? Math.abs(b.edge) - Math.abs(a.edge)
          : b.composite_score - a.composite_score
      )
  }, [props, statFilter, tierFilter, directionFilter, search, minScore, sortBy, hideTossups])

  const lastUpdated = boardStats?.last_computed
    ? new Date(boardStats.last_computed).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
    : null

  const COLS = '24px 170px 60px 56px 80px 72px 72px 80px 80px 130px 64px 36px'

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#909090', letterSpacing: '0.12em', marginBottom: '6px' }}>
          PROP BOARD · PRIZEPICKS · UPDATES 3× DAILY · NOT BETTING ADVICE
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <h1 style={{ fontSize: '22px', fontWeight: 400, color: '#f0f0f0', margin: 0 }}>Tonight's Props</h1>
            <Link href="/props/parlay" style={{
              fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px',
              color: '#4ade80', border: '1px solid rgba(74,222,128,0.3)',
              padding: '5px 12px', textDecoration: 'none', letterSpacing: '0.06em',
            }}>
              ⚡ Parlay Builder →
            </Link>
          </div>
          {lastUpdated && (
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#909090' }}>
              Updated {lastUpdated}
            </span>
          )}
        </div>
      </div>

      {/* Summary stats */}
      {boardStats && boardStats.total > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1px', marginBottom: '16px' }}>
          {([
            ['TOTAL PROPS',  boardStats.total,          '#888'],
            ['STRONG OVER',  boardStats.strong_overs,   '#4ade80'],
            ['LEAN OVER',    boardStats.lean_overs,     '#86efac'],
            ['STRONG UNDER', boardStats.strong_unders,  '#f87171'],
            ['PLAYERS',      boardStats.players,        '#888'],
          ] as [string, number, string][]).map(([label, val, color]) => (
            <div key={label} style={{ border: '1px solid #1a1a1a', padding: '12px 16px' }}>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#909090', letterSpacing: '0.08em', marginBottom: '4px' }}>{label}</div>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '20px', fontWeight: 700, color }}>{val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters row 1 — stat + tier */}
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '4px', alignItems: 'center' }}>
        {STATS.map(s => (
          <button key={s.key} onClick={() => setStatFilter(s.key)} style={{
            background: statFilter === s.key ? '#0f1f0f' : 'transparent',
            border: `1px solid ${statFilter === s.key ? '#4ade80' : '#1a1a1a'}`,
            color: statFilter === s.key ? '#4ade80' : '#444',
            padding: '6px 12px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', cursor: 'pointer',
          }}>{s.label}</button>
        ))}
        <div style={{ width: '1px', height: '24px', background: '#1a1a1a', margin: '0 4px' }} />
        {TIERS.map(t => (
          <button key={t.key} onClick={() => setTierFilter(t.key)} style={{
            background: tierFilter === t.key ? '#0f1f0f' : 'transparent',
            border: `1px solid ${tierFilter === t.key ? '#4ade80' : '#1a1a1a'}`,
            color: tierFilter === t.key ? '#4ade80' : '#444',
            padding: '6px 10px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', cursor: 'pointer',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Direction filter */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '4px', alignItems: 'center' }}>
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#909090', marginRight: '4px' }}>PICK</span>
        {DIRECTIONS.map(d => (
          <button key={d.key} onClick={() => setDirectionFilter(d.key)} style={{
            background: directionFilter === d.key ? (d.key === 'over' ? '#0f1f0f' : d.key === 'under' ? '#1f0f0f' : '#0f0f0f') : 'transparent',
            border: `1px solid ${directionFilter === d.key ? (d.key === 'over' ? '#4ade80' : d.key === 'under' ? '#f87171' : '#4ade80') : '#1a1a1a'}`,
            color: directionFilter === d.key ? (d.key === 'over' ? '#4ade80' : d.key === 'under' ? '#f87171' : '#aaa') : '#444',
            padding: '6px 12px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', cursor: 'pointer',
          }}>{d.label}</button>
        ))}
      </div>

      {/* Filters row 2 */}
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '1px', alignItems: 'center' }}>
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#909090' }}>SORT</span>
        {(['composite_score', 'edge'] as const).map(key => (
          <button key={key} onClick={() => setSortBy(key)} style={{
            background: sortBy === key ? '#0f1f0f' : 'transparent',
            border: `1px solid ${sortBy === key ? '#4ade80' : '#1a1a1a'}`,
            color: sortBy === key ? '#4ade80' : '#444',
            padding: '6px 10px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', cursor: 'pointer',
          }}>{key === 'composite_score' ? 'Score' : 'Edge'}</button>
        ))}
        <button onClick={() => setHideTossups(h => !h)} style={{
          background: hideTossups ? '#1a0f00' : 'transparent',
          border: `1px solid ${hideTossups ? '#fbbf24' : '#1a1a1a'}`,
          color: hideTossups ? '#fbbf24' : '#444',
          padding: '6px 10px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', cursor: 'pointer',
        }}>Hide Toss-ups</button>
        <div style={{ flex: 1 }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search player..."
          style={{ background: 'transparent', border: '1px solid #1a1a1a', color: '#e0e0e0',
            padding: '6px 12px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', outline: 'none', width: '150px' }} />
        <select value={minScore} onChange={e => setMinScore(Number(e.target.value))} style={{
          background: '#141418', border: '1px solid #1a1a1a', color: '#b0aea8',
          padding: '6px 10px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', outline: 'none',
        }}>
          <option value={0}>All scores</option>
          <option value={61.7}>Lean Over (61.7+)</option>
          <option value={67.7}>Strong Over (67.7+)</option>
        </select>
      </div>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#909090' }}>
          Loading prop board...
        </div>
      ) : boardStats?.message ? (
        <div style={{ border: '1px solid #1a1a1a', padding: '48px', textAlign: 'center' }}>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#909090', marginBottom: '8px' }}>{boardStats.message}</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#909090' }}>Refresh times: 6:30am · 12pm · 3:30pm PST</div>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ border: '1px solid #1a1a1a', padding: '32px', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#909090' }}>
          No props match current filters
        </div>
      ) : (
        <div style={{ border: '1px solid #1a1a1a' }}>
          <div style={{ display: 'grid', gridTemplateColumns: COLS, padding: '8px 16px',
            borderBottom: '1px solid #222228',
            fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#909090', letterSpacing: '0.06em' }}>
            <span>#</span><span>PLAYER</span><span>MATCHUP</span><span>STAT</span>
            <span>LINE / TIER</span><span>{directionFilter === 'under' ? 'L5 U%' : 'L5 HIT%'}</span><span>{directionFilter === 'under' ? 'L10 U%' : 'L10 HIT%'}</span>
            <span>L10 AVG</span><span>OPP DEF</span><span>RATING</span><span>EDGE</span><span>PICK</span>
          </div>

          {filtered.map((row, i) => {
            const key        = `${row.player_name}|${row.stat}|${row.odds_type}`
            const isExpanded = expanded === key
            const tier       = TIER_BADGE[row.odds_type] || TIER_BADGE.standard
            const isOver     = row.pick_side === 'over'

            return (
              <div key={key} style={{ borderBottom: i < filtered.length - 1 ? '1px solid #0d0d0d' : 'none' }}>
                <div onClick={() => setExpanded(isExpanded ? null : key)}
                  style={{
                    display: 'grid', gridTemplateColumns: COLS,
                    padding: '11px 16px', cursor: 'pointer', alignItems: 'center',
                    background: isExpanded ? '#0d0d0d'
                      : row.composite_score >= 67.7 ? 'rgba(74,222,128,0.02)' : 'transparent',
                    opacity: row.is_tossup ? 0.6 : 1,
                  }}>

                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#909090' }}>{i + 1}</span>

                  <div>
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', fontWeight: 700, color: '#e0e0e0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <a
                        href={`/player/${row.player_name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`}
                        onClick={e => e.stopPropagation()}
                        style={{ color: '#e0e0e0', textDecoration: 'none', transition: 'color 0.1s' }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#4ade80')}
                        onMouseLeave={e => (e.currentTarget.style.color = '#e0e0e0')}
                      >
                        {row.player_name}
                      </a>
                      {row.player_status === 'GTD' && (
                        <span style={{ fontSize: '9px', fontWeight: 700, color: '#fbbf24', background: '#fbbf2420', border: '1px solid #fbbf2440', padding: '1px 4px' }}>GTD</span>
                      )}
                    {row.confirmed_starter && (
                        <span style={{ fontSize: '9px', fontWeight: 700, color: '#4ade80', background: '#4ade8015', border: '1px solid #4ade8030', padding: '1px 4px' }}>START</span>
                      )}
                      {row.injured_teammates && row.injured_teammates.length > 0 && (
                        <span style={{ fontSize: '9px', color: '#fb923c' }} title={`Teammates OUT: ${row.injured_teammates.join(', ')}`}>⚡</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '4px', marginTop: '2px', alignItems: 'center' }}>
                      {row.team && <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '8px', color: '#b0aea8' }}>{row.team}</span>}
                      {row.is_b2b && <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '8px', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)', padding: '0 3px' }}>B2B</span>}
                    </div>
                  </div>

                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#b0aea8' }}>
                    {row.is_home ? 'vs' : '@'} {row.opponent}
                  </span>

                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', fontWeight: 600, color: '#666' }}>
                    {STAT_LABEL[row.stat] || row.stat}
                  </span>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 700, color: '#e0e0e0' }}>
                      {row.line}
                    </span>
                    {row.odds_type !== 'standard' && (
                      <span style={{
                        fontFamily: 'IBM Plex Mono, monospace', fontSize: '8px',
                        color: tier.color, background: tier.bg,
                        border: `1px solid ${tier.color}40`, padding: '1px 4px',
                      }}>{row.odds_type.toUpperCase()}</span>
                    )}
                    {row.line_movement !== 0 && row.line_movement != null && (
                      <span title={`Opened at ${row.opening_line}`} style={{
                        fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', fontWeight: 700,
                        color: row.line_movement > 0 ? '#4ade80' : '#f87171',
                        background: row.line_movement > 0 ? '#4ade8015' : '#f8717115',
                        border: `1px solid ${row.line_movement > 0 ? '#4ade8040' : '#f8717140'}`,
                        padding: '1px 4px', borderRadius: '3px',
                      }}>
                        {row.line_movement > 0 ? '▲' : '▼'}{Math.abs(row.line_movement)}
                      </span>
                    )}
                  </div>

                  <div>{row.hit_rate_last5 != null ? <HitBar pct={row.hit_rate_last5} pickSide={row.pick_side} />
                    : <span style={{ color: '#909090', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px' }}>—</span>}
                  </div>

                  <div>{row.hit_rate_last10 != null ? <HitBar pct={row.hit_rate_last10} pickSide={row.pick_side} />
                    : <span style={{ color: '#909090', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px' }}>—</span>}
                  </div>

                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px',
                    color: row.avg_last10 != null
                      ? (row.pick_side === 'under'
                          ? (row.avg_last10 < row.line ? '#4ade80' : '#f87171')   // under: good if avg < line
                          : (row.avg_last10 > row.line ? '#4ade80' : '#f87171'))  // over: good if avg > line
                      : '#555' }}>
                    {row.avg_last10 ?? '—'}
                  </span>

                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px',
                    color: row.opp_def_label === 'good' ? '#f87171' : row.opp_def_label === 'poor' ? '#4ade80' : '#555' }}>
                    {row.opp_def_label ?? '—'}
                  </span>

                  <RatingBadge score={row.composite_score} label={row.score_label} color={row.score_color} />

                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', fontWeight: 600,
                    color: row.edge > 4 ? '#4ade80' : row.edge < -4 ? '#f87171' : '#555' }}>
                    {row.edge > 0 ? '+' : ''}{row.edge.toFixed(1)}
                  </span>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '14px', fontWeight: 800,
                      color: isOver ? '#4ade80' : '#f87171' }}>
                      {isOver ? 'O' : 'U'}
                    </span>
                    {row.odds_type !== 'standard' && (
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '7px', color: '#909090', marginTop: '-2px' }}>only</span>
                    )}
                  </div>
                </div>
                {isExpanded && <ExpandedRow row={row} />}
              </div>
            )
          })}
        </div>
      )}

      <div style={{ marginTop: '14px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#787672', lineHeight: 1.8 }}>
        <div>🟢 Goblin = discounted line (over only) · Standard = over or under available</div>
        <div>Score anchored at 57.7% (PrizePicks 6-pick flex break-even) · Edge = model prob minus 57.7%</div>
        <div>Lines from PrizePicks · ⚠ For informational purposes only. Not betting advice.</div>
      </div>
    </div>
  )
}
