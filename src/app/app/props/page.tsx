'use client'

import { useState, useEffect, useCallback } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const STATS = [
  { key: 'pts', label: 'Points' },
  { key: 'reb', label: 'Rebounds' },
  { key: 'ast', label: 'Assists' },
  { key: 'fg3m', label: '3-Pointers' },
  { key: 'stl', label: 'Steals' },
  { key: 'blk', label: 'Blocks' },
]

const TEAMS = [
  'ATL','BKN','BOS','CHA','CHI','CLE','DAL','DEN','DET','GSW',
  'HOU','IND','LAC','LAL','MEM','MIA','MIL','MIN','NOP','NYK',
  'OKC','ORL','PHI','PHX','POR','SAC','SAS','TOR','UTA','WAS',
]

interface OddsInfo {
  line: number
  over_odds: number
  under_odds: number
  implied_prob_over: number
  bookmaker: string
}

interface PropScore {
  score: number
  label: string
  color: string
  factors: { label: string; value: string; impact: string }[]
}

interface Context {
  avg_season: number
  avg_last5: number
  avg_last10: number
  avg_last20: number
  home_avg: number
  away_avg: number
  max: number
  min: number
  games_played: number
  line?: number
  hit_rate_season?: number
  hit_rate_last10?: number
  hit_rate_last5?: number
  over_avg_margin?: number
  under_avg_margin?: number
  game_log: { date: string; opp: string; home: boolean; val: number; min: number }[]
}

interface PlayerResult {
  player: string
  team: string
  stat: string
  line: number | null
  line_source: string
  odds: OddsInfo | null
  prop_score: PropScore
  context: Context
  vs_opponent: { games: number; avg: number; high: number; low: number; hit_rate?: number } | null
  opponent_defense: { opp: string; def_margin: number; def_rating_label: string } | null
  rest: { is_home: boolean; is_b2b: boolean; rest_days: number; opponent: string } | null
}

function ScoreGauge({ score, label, color }: { score: number; label: string; color: string }) {
  return (
    <div style={{ border: `1px solid ${color}30`, background: `${color}08`, padding: '16px 20px', display: 'flex', gap: '16px', alignItems: 'center' }}>
      <div style={{ position: 'relative', width: '64px', height: '64px', flexShrink: 0 }}>
        <svg width="64" height="64" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="26" fill="none" stroke="#111" strokeWidth="6" />
          <circle cx="32" cy="32" r="26" fill="none" stroke={color} strokeWidth="6"
            strokeDasharray={`${score / 100 * 163} 163`}
            strokeLinecap="round"
            transform="rotate(-90 32 32)" />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 700, color }}>{Math.round(score)}</span>
        </div>
      </div>
      <div>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '16px', fontWeight: 700, color, marginBottom: '4px' }}>{label}</div>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444' }}>composite prop score</div>
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, highlight }: { label: string; value: string | number; sub?: string; highlight?: 'good' | 'bad' | 'neutral' }) {
  const border = highlight === 'good' ? '#4ade80' : highlight === 'bad' ? '#f87171' : '#1a1a1a'
  const bg = highlight === 'good' ? 'rgba(74,222,128,0.04)' : highlight === 'bad' ? 'rgba(248,113,113,0.04)' : '#0a0a0a'
  return (
    <div style={{ border: `1px solid ${border}`, background: bg, padding: '12px 14px' }}>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', letterSpacing: '0.08em', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '20px', fontWeight: 700, color: '#e0e0e0' }}>{value}</div>
      {sub && <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#555', marginTop: '2px' }}>{sub}</div>}
    </div>
  )
}

function HitBar({ pct, label }: { pct: number; label: string }) {
  const color = pct >= 65 ? '#4ade80' : pct >= 50 ? '#86efac' : pct >= 40 ? '#fbbf24' : '#f87171'
  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#555' }}>{label}</span>
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color, fontWeight: 600 }}>{pct.toFixed(1)}%</span>
      </div>
      <div style={{ height: '5px', background: '#111', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

function OddsChip({ odds, label }: { odds: number; label: string }) {
  const isFav = odds < 0
  const color = isFav ? '#4ade80' : '#f87171'
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', marginBottom: '2px' }}>{label}</div>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '14px', fontWeight: 700, color }}>
        {odds > 0 ? '+' : ''}{odds}
      </div>
    </div>
  )
}

function GameLog({ log, line }: { log: Context['game_log']; line?: number }) {
  return (
    <div style={{ border: '1px solid #1a1a1a' }}>
      <div style={{ padding: '8px 14px', borderBottom: '1px solid #1a1a1a', fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', letterSpacing: '0.08em' }}>
        GAME LOG · LAST {log.length} GAMES
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '90px 44px 30px 52px 1fr 60px', padding: '6px 14px', borderBottom: '1px solid #0d0d0d', fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#333' }}>
        <span>DATE</span><span>OPP</span><span>H/A</span><span>MIN</span><span>STAT</span><span style={{ textAlign: 'right' }}>vs LINE</span>
      </div>
      {log.map((g, i) => {
        const over = line != null ? g.val > line : null
        return (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '90px 44px 30px 52px 1fr 60px',
            padding: '7px 14px', borderBottom: i < log.length - 1 ? '1px solid #0a0a0a' : 'none',
            background: over === true ? 'rgba(74,222,128,0.025)' : over === false ? 'rgba(248,113,113,0.025)' : 'transparent',
          }}>
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444' }}>{g.date}</span>
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#666' }}>{g.opp}</span>
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444' }}>{g.home ? 'H' : 'A'}</span>
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444' }}>{g.min.toFixed(0)}</span>
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 600, color: over === true ? '#4ade80' : over === false ? '#f87171' : '#888' }}>
              {g.val}
            </span>
            {line != null && (
              <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: over ? '#4ade80' : '#f87171' }}>
                {over ? '+' : ''}{(g.val - line).toFixed(1)}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function PropsPage() {
  const [playerName, setPlayerName] = useState('')
  const [team, setTeam] = useState('BOS')
  const [opponent, setOpponent] = useState('')
  const [stat, setStat] = useState('pts')
  const [manualLine, setManualLine] = useState('')
  const [result, setResult] = useState<PlayerResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tonightGames, setTonightGames] = useState<any[]>([])
  const [oddsLoaded, setOddsLoaded] = useState(false)

  useEffect(() => {
    fetch(`${API}/props/tonight`)
      .then(r => r.json())
      .then(d => {
        setTonightGames(d.games || [])
        setOddsLoaded(d.players_with_props > 0)
      })
      .catch(() => {})
  }, [])

  const search = useCallback(async () => {
    if (!playerName.trim()) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const params = new URLSearchParams({ name: playerName, team, stat, n_games: '20' })
      if (opponent) params.set('opponent', opponent)
      if (manualLine) params.set('line', manualLine)
      const r = await fetch(`${API}/props/player?${params}`)
      const d = await r.json()
      if (d.error) setError(d.error)
      else setResult(d)
    } catch {
      setError('Failed to fetch player data')
    }
    setLoading(false)
  }, [playerName, team, opponent, stat, manualLine])

  const ctx = result?.context
  const line = result?.line ?? undefined

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.12em', marginBottom: '6px' }}>
          PROP RESEARCH · ODDS API + ESPN BOX SCORES · NOT BETTING ADVICE
        </div>
        <h1 style={{ fontSize: '22px', fontWeight: 400, color: '#f0f0f0', marginBottom: '8px' }}>Props Research</h1>
        <p style={{ color: '#555', fontSize: '13px', lineHeight: 1.6, maxWidth: '580px' }}>
          Player prop lines pulled automatically from DraftKings via The Odds API.
          Historical context from ESPN box scores. Composite score weighs recent form, season average, matchup history, opponent defense, and rest.
        </p>
      </div>

      {/* Tonight's games */}
      {tonightGames.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#333', letterSpacing: '0.08em', marginBottom: '6px' }}>
            TONIGHT · CLICK TO SET MATCHUP
            {oddsLoaded && <span style={{ color: '#4ade80', marginLeft: '12px' }}>● ODDS LOADED</span>}
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {tonightGames.map((g, i) => (
              <button key={i} onClick={() => { setTeam(g.home); setOpponent(g.away) }} style={{
                background: '#0a0a0a', border: '1px solid #1a1a1a', color: '#666',
                padding: '6px 12px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', cursor: 'pointer',
              }}>
                {g.away} @ {g.home}
                {g.time && <span style={{ fontSize: '9px', color: '#333', marginLeft: '6px' }}>{g.time}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div style={{ border: '1px solid #1a1a1a', padding: '18px', marginBottom: '20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 110px 110px', gap: '8px', marginBottom: '10px' }}>
          <div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', marginBottom: '3px' }}>PLAYER NAME</div>
            <input value={playerName} onChange={e => setPlayerName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && search()}
              placeholder="e.g. Jayson Tatum"
              style={{ width: '100%', background: '#0a0a0a', border: '1px solid #222', color: '#e0e0e0', padding: '8px 10px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', marginBottom: '3px' }}>TEAM</div>
            <select value={team} onChange={e => setTeam(e.target.value)} style={{ width: '100%', background: '#0a0a0a', border: '1px solid #222', color: '#888', padding: '8px 10px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', outline: 'none' }}>
              {TEAMS.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', marginBottom: '3px' }}>OPPONENT</div>
            <select value={opponent} onChange={e => setOpponent(e.target.value)} style={{ width: '100%', background: '#0a0a0a', border: '1px solid #222', color: '#888', padding: '8px 10px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', outline: 'none' }}>
              <option value="">Any</option>
              {TEAMS.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', marginBottom: '3px' }}>OVERRIDE LINE</div>
            <input value={manualLine} onChange={e => setManualLine(e.target.value)}
              placeholder="auto" type="number" step="0.5"
              style={{ width: '100%', background: '#0a0a0a', border: '1px solid #222', color: '#e0e0e0', padding: '8px 10px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', outline: 'none', boxSizing: 'border-box' }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          {STATS.map(s => (
            <button key={s.key} onClick={() => setStat(s.key)} style={{
              background: stat === s.key ? '#0f1f0f' : '#0a0a0a',
              border: `1px solid ${stat === s.key ? '#4ade80' : '#1a1a1a'}`,
              color: stat === s.key ? '#4ade80' : '#444',
              padding: '7px 14px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', cursor: 'pointer',
            }}>{s.label}</button>
          ))}
          <div style={{ flex: 1 }} />
          <button onClick={search} disabled={loading || !playerName.trim()} style={{
            background: loading ? '#0a0a0a' : '#0f1f0f',
            border: `1px solid ${loading ? '#222' : '#4ade80'}`,
            color: loading ? '#444' : '#4ade80',
            padding: '7px 20px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
            cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '0.06em',
          }}>
            {loading ? 'Loading...' : 'SEARCH →'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ border: '1px solid rgba(248,113,113,0.3)', padding: '12px 16px', color: '#f87171', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      {result && ctx && (
        <div>
          {/* Player header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', marginBottom: '3px' }}>
                {result.team}{result.rest?.opponent ? ` vs ${result.rest.opponent}` : ''}
              </div>
              <div style={{ fontSize: '20px', fontWeight: 400, color: '#f0f0f0' }}>{result.player}</div>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#555', marginTop: '3px' }}>
                {STATS.find(s => s.key === stat)?.label} · {ctx.games_played} games
                {line != null && <span style={{ color: '#888', marginLeft: '8px' }}>Line: {line} {result.line_source === 'odds_api' ? '(DraftKings)' : '(manual)'}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {result.rest?.is_b2b && (
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)', padding: '3px 8px' }}>⚠ B2B</span>
              )}
              {result.rest && (
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#555', border: '1px solid #1a1a1a', padding: '3px 8px' }}>
                  {result.rest.rest_days}d rest · {result.rest.is_home ? 'HOME' : 'AWAY'}
                </span>
              )}
              {result.opponent_defense && (
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', padding: '3px 8px', border: '1px solid #1a1a1a',
                  color: result.opponent_defense.def_rating_label === 'good' ? '#f87171' : result.opponent_defense.def_rating_label === 'poor' ? '#4ade80' : '#888' }}>
                  {result.opponent_defense.opp} DEF: {result.opponent_defense.def_rating_label.toUpperCase()}
                </span>
              )}
            </div>
          </div>

          {/* Top row: score + odds + averages */}
          <div style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr', gap: '1px', marginBottom: '1px' }}>
            {result.prop_score?.score != null && (
              <ScoreGauge score={result.prop_score.score} label={result.prop_score.label} color={result.prop_score.color} />
            )}

            {result.odds && (
              <div style={{ border: '1px solid #1a1a1a', padding: '16px 20px', display: 'flex', gap: '20px', alignItems: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', marginBottom: '4px' }}>LINE</div>
                  <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '22px', fontWeight: 700, color: '#e0e0e0' }}>{result.odds.line}</div>
                  <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#333' }}>{result.odds.bookmaker}</div>
                </div>
                <OddsChip odds={result.odds.over_odds} label="OVER" />
                <OddsChip odds={result.odds.under_odds} label="UNDER" />
                {result.odds.implied_prob_over && (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', marginBottom: '4px' }}>IMPLIED</div>
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '16px', fontWeight: 600, color: '#888' }}>{result.odds.implied_prob_over}%</div>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: '1px' }}>
              <StatCard label="SEASON AVG" value={ctx.avg_season} />
              {ctx.avg_last5 != null && <StatCard label="LAST 5" value={ctx.avg_last5} highlight={line != null ? (ctx.avg_last5 > line ? 'good' : 'bad') : undefined} />}
              {ctx.avg_last10 != null && <StatCard label="LAST 10" value={ctx.avg_last10} highlight={line != null ? (ctx.avg_last10 > line ? 'good' : 'bad') : undefined} />}
              {ctx.home_avg != null && <StatCard label={result.rest?.is_home ? 'HOME ★' : 'HOME'} value={ctx.home_avg} highlight={result.rest?.is_home && line != null ? (ctx.home_avg > line ? 'good' : 'bad') : undefined} />}
              {ctx.away_avg != null && <StatCard label={!result.rest?.is_home ? 'AWAY ★' : 'AWAY'} value={ctx.away_avg} highlight={!result.rest?.is_home && line != null ? (ctx.away_avg > line ? 'good' : 'bad') : undefined} />}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', marginBottom: '1px' }}>
            {/* Hit rates */}
            {line != null && (
              <div style={{ border: '1px solid #1a1a1a', padding: '16px 20px' }}>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', letterSpacing: '0.08em', marginBottom: '12px' }}>
                  HIT RATE OVER {line}
                </div>
                {ctx.hit_rate_last5 != null && <HitBar pct={ctx.hit_rate_last5} label="Last 5 games" />}
                {ctx.hit_rate_last10 != null && <HitBar pct={ctx.hit_rate_last10} label="Last 10 games" />}
                {ctx.hit_rate_season != null && <HitBar pct={ctx.hit_rate_season} label="Full season" />}
                {result.vs_opponent?.hit_rate != null && <HitBar pct={result.vs_opponent.hit_rate} label={`vs ${opponent}`} />}
                {ctx.over_avg_margin != null && (
                  <div style={{ marginTop: '10px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#555' }}>
                    When over: avg +{ctx.over_avg_margin} above line · When under: avg -{ctx.under_avg_margin} below
                  </div>
                )}
              </div>
            )}

            {/* vs opponent + factors */}
            <div style={{ border: '1px solid #1a1a1a', padding: '16px 20px' }}>
              {result.vs_opponent ? (
                <>
                  <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', letterSpacing: '0.08em', marginBottom: '12px' }}>
                    VS {opponent} THIS SEASON ({result.vs_opponent.games}G)
                  </div>
                  <div style={{ display: 'flex', gap: '16px', marginBottom: '12px' }}>
                    {[['AVG', result.vs_opponent.avg, '#888'], ['HIGH', result.vs_opponent.high, '#4ade80'], ['LOW', result.vs_opponent.low, '#f87171']].map(([l, v, c]) => (
                      <div key={String(l)}>
                        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', marginBottom: '2px' }}>{l}</div>
                        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '20px', fontWeight: 700, color: c as string }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', letterSpacing: '0.08em', marginBottom: '12px' }}>
                  SCORE FACTORS
                </div>
              )}
              {result.prop_score?.factors && (
                <div>
                  {result.prop_score.factors.map((f, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#555' }}>{f.label}</span>
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: f.impact === 'positive' ? '#4ade80' : f.impact === 'negative' ? '#f87171' : '#888' }}>
                        {f.impact === 'positive' ? '↑' : f.impact === 'negative' ? '↓' : '—'} {f.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <GameLog log={ctx.game_log} line={line} />

          <div style={{ marginTop: '12px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#2a2a2a', lineHeight: 1.8 }}>
            <div>Lines from DraftKings via The Odds API · box scores from ESPN · team defense from our DB</div>
            <div>⚠ For informational purposes only. Not betting advice.</div>
          </div>
        </div>
      )}
    </div>
  )
}
