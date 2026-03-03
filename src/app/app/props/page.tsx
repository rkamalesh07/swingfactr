'use client'

import { useState, useEffect, useMemo } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const STATS = [
  { key: 'all', label: 'All' },
  { key: 'pts', label: 'Points' },
  { key: 'reb', label: 'Rebounds' },
  { key: 'ast', label: 'Assists' },
  { key: 'fg3m', label: '3-Pointers' },
  { key: 'stl', label: 'Steals' },
  { key: 'blk', label: 'Blocks' },
]

const STAT_LABEL: Record<string, string> = {
  pts: 'PTS', reb: 'REB', ast: 'AST', fg3m: '3PM', stl: 'STL', blk: 'BLK'
}

interface PropRow {
  player_name: string
  team: string
  opponent: string
  is_home: boolean
  stat: string
  line: number
  over_odds: number
  under_odds: number
  implied_prob_over: number
  bookmaker: string
  avg_season: number
  avg_last5: number
  avg_last10: number
  hit_rate_season: number
  hit_rate_last5: number
  hit_rate_last10: number
  composite_score: number
  score_label: string
  score_color: string
  factors: { label: string; value: string; impact: string }[]
  game_log: { date: string; opp: string; home: boolean; val: number; min: number }[]
  is_b2b: boolean
  rest_days: number
  opp_def_label: string
  computed_at: string
}

interface BoardStats {
  total: number
  strong_overs: number
  lean_overs: number
  strong_unders: number
  last_computed: string
  players: number
  message?: string
}

function ScoreBadge({ score, label, color }: { score: number; label: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <div style={{ position: 'relative', width: '36px', height: '36px', flexShrink: 0 }}>
        <svg width="36" height="36" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="14" fill="none" stroke="#111" strokeWidth="4" />
          <circle cx="18" cy="18" r="14" fill="none" stroke={color} strokeWidth="4"
            strokeDasharray={`${score / 100 * 88} 88`}
            strokeLinecap="round" transform="rotate(-90 18 18)" />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', fontWeight: 700, color }}>{Math.round(score)}</span>
        </div>
      </div>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color, lineHeight: 1.2 }}>{label}</span>
    </div>
  )
}

function HitBar({ pct }: { pct: number }) {
  const color = pct >= 65 ? '#4ade80' : pct >= 50 ? '#86efac' : pct >= 40 ? '#fbbf24' : '#f87171'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <div style={{ width: '50px', height: '4px', background: '#111', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color }} />
      </div>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color, width: '34px' }}>{pct.toFixed(0)}%</span>
    </div>
  )
}

function ExpandedRow({ row }: { row: PropRow }) {
  const line = row.line
  return (
    <div style={{ padding: '16px 20px', background: '#070707', borderTop: '1px solid #0d0d0d' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
        {/* Averages */}
        <div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', letterSpacing: '0.08em', marginBottom: '8px' }}>AVERAGES</div>
          {[['Season', row.avg_season], ['Last 10', row.avg_last10], ['Last 5', row.avg_last5]].map(([l, v]) => (
            <div key={String(l)} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#555' }}>{l}</span>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: v != null && Number(v) > line ? '#4ade80' : '#f87171', fontWeight: 600 }}>
                {v ?? '—'}
                {v != null && <span style={{ fontSize: '9px', fontWeight: 400, marginLeft: '3px' }}>vs {line}</span>}
              </span>
            </div>
          ))}
        </div>
        {/* Score factors */}
        <div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', letterSpacing: '0.08em', marginBottom: '8px' }}>SCORE FACTORS</div>
          {row.factors?.map((f, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#555' }}>{f.label}</span>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: f.impact === 'positive' ? '#4ade80' : f.impact === 'negative' ? '#f87171' : '#888' }}>
                {f.impact === 'positive' ? '↑' : f.impact === 'negative' ? '↓' : '—'} {f.value}
              </span>
            </div>
          ))}
        </div>
        {/* Mini game log */}
        <div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', letterSpacing: '0.08em', marginBottom: '8px' }}>LAST 8 GAMES</div>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {row.game_log?.slice(0, 8).map((g, i) => {
              const over = g.val > line
              return (
                <div key={i} style={{
                  padding: '3px 6px', background: over ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
                  border: `1px solid ${over ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}`,
                  fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
                  color: over ? '#4ade80' : '#f87171',
                }}>
                  {g.val}
                </div>
              )
            })}
          </div>
          <div style={{ marginTop: '6px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#333' }}>
            green = over {line} · red = under
          </div>
        </div>
      </div>
    </div>
  )
}

export default function PropsPage() {
  const [props, setProps] = useState<PropRow[]>([])
  const [boardStats, setBoardStats] = useState<BoardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [statFilter, setStatFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [minScore, setMinScore] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)

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
    return props.filter(p => {
      if (statFilter !== 'all' && p.stat !== statFilter) return false
      if (search && !p.player_name.toLowerCase().includes(search.toLowerCase())) return false
      if (p.composite_score < minScore) return false
      return true
    })
  }, [props, statFilter, search, minScore])

  const lastUpdated = boardStats?.last_computed
    ? new Date(boardStats.last_computed).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
    : null

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.12em', marginBottom: '6px' }}>
          PROP BOARD · UPDATES 5× DAILY · NOT BETTING ADVICE
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '8px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: 400, color: '#f0f0f0' }}>Tonight's Props</h1>
          {lastUpdated && (
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333' }}>
              Last updated {lastUpdated}
            </span>
          )}
        </div>
      </div>

      {/* Summary stats */}
      {boardStats && boardStats.total > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', marginBottom: '16px' }}>
          {[
            ['TOTAL PROPS', boardStats.total, '#888'],
            ['STRONG OVER (65+)', boardStats.strong_overs, '#4ade80'],
            ['LEAN OVER (55+)', boardStats.lean_overs, '#86efac'],
            ['PLAYERS', boardStats.players, '#888'],
          ].map(([label, val, color]) => (
            <div key={String(label)} style={{ border: '1px solid #1a1a1a', padding: '12px 16px' }}>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', letterSpacing: '0.08em', marginBottom: '4px' }}>{label}</div>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '20px', fontWeight: 700, color: color as string }}>{val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '1px', alignItems: 'center' }}>
        {STATS.map(s => (
          <button key={s.key} onClick={() => setStatFilter(s.key)} style={{
            background: statFilter === s.key ? '#0f1f0f' : '#0a0a0a',
            border: `1px solid ${statFilter === s.key ? '#4ade80' : '#1a1a1a'}`,
            color: statFilter === s.key ? '#4ade80' : '#444',
            padding: '6px 12px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', cursor: 'pointer',
          }}>{s.label}</button>
        ))}
        <div style={{ flex: 1 }} />
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search player..."
          style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', color: '#e0e0e0', padding: '6px 12px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', outline: 'none', width: '160px' }}
        />
        <select value={minScore} onChange={e => setMinScore(Number(e.target.value))} style={{
          background: '#0a0a0a', border: '1px solid #1a1a1a', color: '#666',
          padding: '6px 10px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', outline: 'none',
        }}>
          <option value={0}>All scores</option>
          <option value={55}>55+ (Lean Over)</option>
          <option value={65}>65+ (Strong Over)</option>
        </select>
      </div>

      {/* Board */}
      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#444' }}>
          Loading prop board...
        </div>
      ) : boardStats?.message ? (
        <div style={{ border: '1px solid #1a1a1a', padding: '48px', textAlign: 'center' }}>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#444', marginBottom: '8px' }}>
            {boardStats.message}
          </div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333' }}>
            Refresh times: 5am · 8am · 12pm · 3pm · 7pm PST
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ border: '1px solid #1a1a1a', padding: '32px', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#444' }}>
          No props match current filters
        </div>
      ) : (
        <div style={{ border: '1px solid #1a1a1a' }}>
          {/* Header row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '24px 160px 60px 70px 60px 70px 70px 80px 80px 80px 120px',
            padding: '8px 16px', borderBottom: '1px solid #1a1a1a',
            fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', letterSpacing: '0.06em',
          }}>
            <span>#</span>
            <span>PLAYER</span>
            <span>MATCHUP</span>
            <span>STAT</span>
            <span>LINE</span>
            <span>ODDS O/U</span>
            <span>L5 HIT%</span>
            <span>L10 HIT%</span>
            <span>L10 AVG</span>
            <span>OPP DEF</span>
            <span>SCORE</span>
          </div>

          {filtered.map((row, i) => {
            const key = `${row.player_name}|${row.stat}`
            const isExpanded = expanded === key
            return (
              <div key={key} style={{ borderBottom: i < filtered.length - 1 ? '1px solid #0d0d0d' : 'none' }}>
                <div
                  onClick={() => setExpanded(isExpanded ? null : key)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '24px 160px 60px 70px 60px 70px 70px 80px 80px 80px 120px',
                    padding: '11px 16px', cursor: 'pointer', alignItems: 'center',
                    background: isExpanded ? '#0d0d0d' : row.composite_score >= 65 ? 'rgba(74,222,128,0.02)' : 'transparent',
                    transition: 'background 0.1s',
                  }}>
                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#333' }}>{i + 1}</span>

                  <div>
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', fontWeight: 700, color: '#e0e0e0' }}>{row.player_name}</div>
                    <div style={{ display: 'flex', gap: '4px', marginTop: '2px' }}>
                      {row.is_b2b && <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '8px', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)', padding: '0 3px' }}>B2B</span>}
                      {row.team && <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '8px', color: '#555' }}>{row.team}</span>}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#555' }}>
                      {row.is_home ? 'vs' : '@'} {row.opponent}
                    </div>
                  </div>

                  <span style={{
                    fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', fontWeight: 600,
                    color: '#888', padding: '2px 6px', background: '#111', width: 'fit-content',
                  }}>
                    {STAT_LABEL[row.stat] || row.stat}
                  </span>

                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 700, color: '#e0e0e0' }}>
                    {row.line}
                  </span>

                  <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px' }}>
                    <span style={{ color: row.over_odds < 0 ? '#4ade80' : '#888' }}>{row.over_odds > 0 ? '+' : ''}{row.over_odds}</span>
                    <span style={{ color: '#333', margin: '0 3px' }}>/</span>
                    <span style={{ color: row.under_odds < 0 ? '#4ade80' : '#888' }}>{row.under_odds > 0 ? '+' : ''}{row.under_odds}</span>
                  </div>

                  <div>{row.hit_rate_last5 != null ? <HitBar pct={row.hit_rate_last5} /> : <span style={{ color: '#333', fontSize: '10px', fontFamily: 'mono' }}>—</span>}</div>
                  <div>{row.hit_rate_last10 != null ? <HitBar pct={row.hit_rate_last10} /> : <span style={{ color: '#333', fontSize: '10px', fontFamily: 'mono' }}>—</span>}</div>

                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: row.avg_last10 != null && row.avg_last10 > row.line ? '#4ade80' : '#f87171' }}>
                    {row.avg_last10 ?? '—'}
                  </span>

                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px',
                    color: row.opp_def_label === 'good' ? '#f87171' : row.opp_def_label === 'poor' ? '#4ade80' : '#888' }}>
                    {row.opp_def_label ?? '—'}
                  </span>

                  <ScoreBadge score={row.composite_score} label={row.score_label} color={row.score_color} />
                </div>

                {isExpanded && <ExpandedRow row={row} />}
              </div>
            )
          })}
        </div>
      )}

      <div style={{ marginTop: '14px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#222', lineHeight: 1.8 }}>
        <div>Score = composite of recent form, season hit rate, avg vs line, opp defense, rest · updated 5× daily</div>
        <div>Lines from DraftKings via The Odds API · ⚠ For informational purposes only. Not betting advice.</div>
      </div>
    </div>
  )
}
