'use client'

import { useState, useEffect, useCallback } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TeamStanding {
  team:    string
  wins:    number
  losses:  number
  pct:     number
  gb:      number
  net_rtg: number
  seed:    number
  status:  'playoff' | 'playin' | 'eliminated'
  streak:  string
  l10:     string
}

interface Series {
  round:      number
  conference: string
  home:       string
  away:       string
  home_wins:  number
  away_wins:  number
  winner:     string
  status:     'complete' | 'in_progress'
}

interface SimResult {
  team:            string
  conference:      string
  current_wins:    number
  current_losses:  number
  net_rtg:         number
  playoff_pct:     number
  conf_finals_pct: number
  finals_pct:      number
  champion_pct:    number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CONF_COLORS = { East: '#60a5fa', West: '#f87171' }
const STATUS_COLORS = { playoff: '#4ade80', playin: '#fbbf24', eliminated: '#333' }

function pctColor(pct: number): string {
  if (pct >= 40) return '#4ade80'
  if (pct >= 15) return '#fbbf24'
  if (pct >= 5)  return '#888'
  return '#333'
}

function PctBar({ pct, max = 100 }: { pct: number; max?: number }) {
  const color = pctColor(pct)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ width: '80px', height: '3px', background: '#111',
        borderRadius: '2px', overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ width: `${Math.min(100, (pct / max) * 100)}%`,
          height: '100%', background: color, borderRadius: '2px' }} />
      </div>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
        color, minWidth: '40px' }}>{pct.toFixed(1)}%</span>
    </div>
  )
}

// ─── Series card ──────────────────────────────────────────────────────────────

function SeriesCard({ series }: { series: Series }) {
  const done = series.status === 'complete'
  const winner = series.winner
  return (
    <div style={{ padding: '10px 14px', background: '#0a0a0a',
      border: `1px solid ${done ? '#1a1a1a' : '#222'}`, borderRadius: '4px',
      minWidth: '160px' }}>
      <div style={{ fontSize: '8px', color: '#2a2a2a', letterSpacing: '0.12em',
        marginBottom: '8px', fontFamily: 'IBM Plex Mono, monospace' }}>
        {done ? 'FINAL' : 'IN PROGRESS'}
      </div>
      {[series.home, series.away].map((team, i) => {
        const wins = i === 0 ? series.home_wins : series.away_wins
        const isWinner = done && team === winner
        return (
          <div key={team} style={{ display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', padding: '4px 0',
            borderBottom: i === 0 ? '1px solid #0d0d0d' : 'none' }}>
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px',
              fontWeight: isWinner ? 700 : 400,
              color: isWinner ? '#e0e0e0' : done ? '#333' : '#888' }}>
              {team}
            </span>
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '14px',
              fontWeight: 700,
              color: isWinner ? '#4ade80' : wins > 0 ? '#888' : '#2a2a2a' }}>
              {wins}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Bracket column ───────────────────────────────────────────────────────────

function BracketRound({ title, series }: { title: string; series: Series[] }) {
  if (series.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px',
        color: '#2a2a2a', letterSpacing: '0.15em', marginBottom: '4px',
        textAlign: 'center' }}>{title}</div>
      {series.map((s, i) => <SeriesCard key={i} series={s} />)}
    </div>
  )
}

// ─── Standings table ──────────────────────────────────────────────────────────

function StandingsTable({ teams, title, color }: {
  teams: TeamStanding[]; title: string; color: string
}) {
  return (
    <div style={{ flex: 1, minWidth: '280px' }}>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px',
        color, letterSpacing: '0.15em', marginBottom: '12px',
        borderBottom: `1px solid ${color}30`, paddingBottom: '8px' }}>
        {title}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['#','TEAM','W','L','PCT','NET RTG',''].map(h => (
              <th key={h} style={{ padding: '4px 8px', fontSize: '8px', color: '#2a2a2a',
                letterSpacing: '0.1em', fontWeight: 400,
                textAlign: h === 'TEAM' ? 'left' : 'center',
                fontFamily: 'IBM Plex Mono, monospace' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {teams.map((t, i) => {
            const sc = STATUS_COLORS[t.status]
            const isPlayIn = t.status === 'playin'
            return (
              <tr key={t.team} style={{
                borderBottom: '1px solid #0d0d0d',
                borderTop: isPlayIn && t.seed === 7 ? '2px dashed #333' : 'none',
                background: i % 2 === 0 ? 'transparent' : '#080808',
              }}>
                <td style={{ padding: '7px 8px', textAlign: 'center',
                  fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px',
                  color: '#333' }}>{t.seed}</td>
                <td style={{ padding: '7px 8px', textAlign: 'left' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%',
                      background: sc, flexShrink: 0 }} />
                    <span style={{ fontFamily: 'IBM Plex Mono, monospace',
                      fontSize: '12px', fontWeight: 600,
                      color: t.status === 'eliminated' ? '#333' : '#e0e0e0' }}>
                      {t.team}
                    </span>
                  </div>
                </td>
                <td style={{ padding: '7px 8px', textAlign: 'center',
                  fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
                  color: '#888' }}>{t.wins}</td>
                <td style={{ padding: '7px 8px', textAlign: 'center',
                  fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
                  color: '#555' }}>{t.losses}</td>
                <td style={{ padding: '7px 8px', textAlign: 'center',
                  fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px',
                  color: '#444' }}>{(t.pct * 100).toFixed(1)}</td>
                <td style={{ padding: '7px 8px', textAlign: 'center',
                  fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
                  color: t.net_rtg > 0 ? '#4ade80' : t.net_rtg < 0 ? '#f87171' : '#555' }}>
                  {t.net_rtg > 0 ? '+' : ''}{t.net_rtg}
                </td>
                <td style={{ padding: '7px 8px', textAlign: 'right',
                  fontFamily: 'IBM Plex Mono, monospace', fontSize: '8px',
                  color: '#222' }}>
                  {t.status === 'playin' ? 'play-in' : ''}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div style={{ marginTop: '8px', display: 'flex', gap: '12px',
        fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#2a2a2a' }}>
        <span><span style={{ color: STATUS_COLORS.playoff }}>●</span> Playoff (1–6)</span>
        <span><span style={{ color: STATUS_COLORS.playin }}>●</span> Play-in (7–10)</span>
        <span style={{ borderTop: '1px dashed #333', paddingTop: '2px' }}>- - - Play-in line</span>
      </div>
    </div>
  )
}

// ─── Sim results table ────────────────────────────────────────────────────────

function SimTable({ results, title, color }: {
  results: SimResult[]; title: string; color: string
}) {
  const maxChamp = Math.max(...results.map(r => r.champion_pct), 1)
  return (
    <div style={{ flex: 1, minWidth: '300px' }}>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px',
        color, letterSpacing: '0.15em', marginBottom: '12px',
        borderBottom: `1px solid ${color}30`, paddingBottom: '8px' }}>
        {title}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['TEAM','NET RTG','PLAYOFF','CONF F','FINALS','CHAMP'].map(h => (
              <th key={h} style={{ padding: '4px 8px', fontSize: '8px', color: '#2a2a2a',
                letterSpacing: '0.1em', fontWeight: 400, fontFamily: 'IBM Plex Mono, monospace',
                textAlign: h === 'TEAM' ? 'left' : 'right' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => (
            <tr key={r.team} style={{
              borderBottom: '1px solid #0d0d0d',
              background: i % 2 === 0 ? 'transparent' : '#080808',
            }}>
              <td style={{ padding: '7px 8px', fontFamily: 'IBM Plex Mono, monospace',
                fontSize: '12px', fontWeight: 600, color: '#e0e0e0' }}>{r.team}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right',
                fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
                color: r.net_rtg > 0 ? '#4ade80' : '#f87171' }}>
                {r.net_rtg > 0 ? '+' : ''}{r.net_rtg}
              </td>
              <td style={{ padding: '7px 8px', textAlign: 'right' }}>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
                  color: pctColor(r.playoff_pct) }}>{r.playoff_pct.toFixed(0)}%</span>
              </td>
              <td style={{ padding: '7px 8px', textAlign: 'right' }}>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
                  color: pctColor(r.conf_finals_pct) }}>{r.conf_finals_pct.toFixed(1)}%</span>
              </td>
              <td style={{ padding: '7px 8px', textAlign: 'right' }}>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
                  color: pctColor(r.finals_pct) }}>{r.finals_pct.toFixed(1)}%</span>
              </td>
              <td style={{ padding: '7px 8px', textAlign: 'right' }}>
                <PctBar pct={r.champion_pct} max={maxChamp} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}


// ─── Chart components ─────────────────────────────────────────────────────────

function ChampBar({ results }: { results: SimResult[] }) {
  const top = results.filter(r => r.champion_pct >= 0.5).slice(0, 12)
  const max = Math.max(...top.map(r => r.champion_pct), 1)
  return (
    <div style={{ border: '1px solid #1a1a1a', padding: '20px', background: '#0a0a0a', borderRadius: '4px' }}>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#fbbf24', letterSpacing: '0.08em', marginBottom: '16px' }}>
        CHAMPIONSHIP PROBABILITY
      </div>
      {top.map((r, i) => (
        <div key={r.team} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '9px' }}>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333', width: '14px', textAlign: 'right' }}>{i + 1}</span>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', fontWeight: 700, color: '#e0e0e0', width: '34px' }}>{r.team}</span>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: r.conference === 'East' ? '#60a5fa' : '#f87171', width: '26px' }}>{r.conference[0]}</span>
          <div style={{ flex: 1, height: '8px', background: '#111', overflow: 'hidden', borderRadius: '1px' }}>
            <div style={{
              height: '100%', width: `${(r.champion_pct / max) * 100}%`,
              background: i === 0 ? '#fbbf24' : i === 1 ? '#9ca3af' : i === 2 ? '#92400e' : '#2a2a2a',
              transition: 'width 0.5s ease', borderRadius: '1px',
            }} />
          </div>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', fontWeight: i < 3 ? 600 : 400, color: i === 0 ? '#fbbf24' : '#666', width: '42px', textAlign: 'right' }}>
            {r.champion_pct.toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  )
}

function BubbleChart({ results }: { results: SimResult[] }) {
  const w = 520, h = 280, pad = { l: 44, r: 16, t: 16, b: 32 }
  const rtgs = results.map(r => r.net_rtg)
  const minR = Math.min(...rtgs) - 1, maxR = Math.max(...rtgs) + 1
  const toX = (r: number) => pad.l + ((r - minR) / (maxR - minR)) * (w - pad.l - pad.r)
  const toY = (p: number) => pad.t + ((100 - p) / 100) * (h - pad.t - pad.b)
  const toSize = (c: number) => Math.max(3, Math.sqrt(c + 0.1) * 3.2)
  return (
    <div style={{ border: '1px solid #1a1a1a', padding: '20px', background: '#0a0a0a', borderRadius: '4px' }}>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.08em', marginBottom: '8px' }}>
        NET RATING vs PLAYOFF ODDS · bubble size = championship %
      </div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`}>
        {[0, 25, 50, 75, 100].map(p => (
          <g key={p}>
            <line x1={pad.l} y1={toY(p)} x2={w - pad.r} y2={toY(p)} stroke="#111" strokeWidth="1" />
            <text x={pad.l - 4} y={toY(p) + 4} textAnchor="end" fontSize="8" fill="#2a2a2a" fontFamily="monospace">{p}%</text>
          </g>
        ))}
        <line x1={toX(0)} y1={pad.t} x2={toX(0)} y2={h - pad.b} stroke="#1a1a1a" strokeDasharray="3,3" strokeWidth="1" />
        {results.map(r => {
          const x = toX(r.net_rtg), y = toY(r.playoff_pct), s = toSize(r.champion_pct)
          const c = r.conference === 'East' ? '#60a5fa' : '#f87171'
          return (
            <g key={r.team}>
              <circle cx={x} cy={y} r={s} fill={c} fillOpacity={0.25} stroke={c} strokeWidth="1" />
              <text x={x} y={y - s - 2} textAnchor="middle" fontSize="7" fill="#555" fontFamily="monospace">{r.team}</text>
            </g>
          )
        })}
        <text x={w / 2} y={h - 2} textAnchor="middle" fontSize="8" fill="#333" fontFamily="monospace">Net Rating</text>
      </svg>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Tab = 'standings' | 'bracket' | 'simulator'

export default function PlayoffsPage() {
  const [tab,         setTab]         = useState<Tab>('standings')
  const [standings,   setStandings]   = useState<{east: TeamStanding[]; west: TeamStanding[]; as_of: string} | null>(null)
  const [bracket,     setBracket]     = useState<{east: Series[]; west: Series[]; finals: Series | null; stage: string} | null>(null)
  const [simResult,   setSimResult]   = useState<{results: SimResult[]; east: SimResult[]; west: SimResult[]; stage: string; top_champions: any[]; n_sims: number; as_of: string} | null>(null)
  const [simLoading,  setSimLoading]  = useState(false)
  const [nSims,       setNSims]       = useState(10000)
  const [simView,     setSimView]     = useState<'table'|'charts'>('table')
  const [loadingStandings, setLoadingStandings] = useState(false)
  const [loadingBracket,   setLoadingBracket]   = useState(false)

  useEffect(() => {
    setLoadingStandings(true)
    fetch(`${API}/playoffs/standings`)
      .then(r => r.json())
      .then(setStandings)
      .catch(() => {})
      .finally(() => setLoadingStandings(false))
  }, [])

  useEffect(() => {
    if (tab === 'bracket' && !bracket) {
      setLoadingBracket(true)
      fetch(`${API}/playoffs/bracket`)
        .then(r => r.json())
        .then(setBracket)
        .catch(() => {})
        .finally(() => setLoadingBracket(false))
    }
  }, [tab, bracket])

  const runSim = useCallback(async () => {
    setSimLoading(true)
    try {
      const r = await fetch(`${API}/playoffs/simulate-from-now?n_sims=${nSims}`)
      const d = await r.json()
      setSimResult(d)
    } catch {}
    setSimLoading(false)
  }, [nSims])

  const stageLabel = (s: string) => ({
    regular_season: 'Regular Season',
    first_round:    'First Round',
    second_round:   'Second Round',
    conf_finals:    'Conference Finals',
    finals:         'NBA Finals',
  }[s] || s)

  const TABS: { key: Tab; label: string }[] = [
    { key: 'standings', label: 'Standings + Playoff Picture' },
    { key: 'bracket',   label: 'Live Bracket' },
    { key: 'simulator', label: 'Playoff Simulator' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#080808', color: '#888',
      fontFamily: 'IBM Plex Mono, monospace' }}>

      {/* Page header */}
      <div style={{ borderBottom: '1px solid #0f0f0f', padding: '16px 28px' }}>
        <div style={{ fontSize: '9px', color: '#2a2a2a', letterSpacing: '0.15em',
          marginBottom: '6px' }}>2025–26 NBA PLAYOFFS</div>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#e0e0e0', margin: 0,
          letterSpacing: '-0.01em' }}>Playoff Central</h1>
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid #0f0f0f', padding: '0 28px',
        display: 'flex', gap: '0' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '12px 20px', fontSize: '11px', letterSpacing: '0.06em',
            color: tab === t.key ? '#e0e0e0' : '#333',
            borderBottom: tab === t.key ? '2px solid #4ade80' : '2px solid transparent',
            marginBottom: '-1px', transition: 'color 0.15s',
            fontFamily: 'IBM Plex Mono, monospace',
          }}>{t.label}</button>
        ))}
      </div>

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '28px 28px' }}>

        {/* ── STANDINGS TAB ── */}
        {tab === 'standings' && (
          <div>
            {loadingStandings && (
              <div style={{ padding: '60px', textAlign: 'center', fontSize: '11px',
                color: '#2a2a2a' }}>Loading standings...</div>
            )}
            {standings && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', marginBottom: '24px' }}>
                  <div style={{ fontSize: '9px', color: '#2a2a2a' }}>
                    AS OF {standings.as_of}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '40px', flexWrap: 'wrap' }}>
                  <StandingsTable teams={standings.east} title="EASTERN CONFERENCE"
                    color={CONF_COLORS.East} />
                  <StandingsTable teams={standings.west} title="WESTERN CONFERENCE"
                    color={CONF_COLORS.West} />
                </div>
              </>
            )}
          </div>
        )}

        {/* ── BRACKET TAB ── */}
        {tab === 'bracket' && (
          <div>
            {loadingBracket && (
              <div style={{ padding: '60px', textAlign: 'center', fontSize: '11px',
                color: '#2a2a2a' }}>Loading bracket...</div>
            )}
            {bracket && bracket.stage === 'regular_season' && (
              <div style={{ padding: '60px', textAlign: 'center' }}>
                <div style={{ fontSize: '14px', color: '#333', marginBottom: '8px' }}>
                  Playoffs haven't started yet
                </div>
                <div style={{ fontSize: '11px', color: '#222' }}>
                  Current stage: Regular Season · Check back when playoffs begin
                </div>
              </div>
            )}
            {bracket && bracket.stage !== 'regular_season' && (
              <div>
                <div style={{ fontSize: '9px', color: '#2a2a2a', marginBottom: '20px',
                  letterSpacing: '0.12em' }}>
                  CURRENT STAGE: {stageLabel(bracket.stage).toUpperCase()}
                </div>

                {/* East bracket */}
                <div style={{ marginBottom: '32px' }}>
                  <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px',
                    color: CONF_COLORS.East, letterSpacing: '0.15em', marginBottom: '16px',
                    borderBottom: `1px solid ${CONF_COLORS.East}30`, paddingBottom: '8px' }}>
                    EASTERN CONFERENCE
                  </div>
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    <BracketRound title="FIRST ROUND"
                      series={bracket.east.filter(s => s.round === 1)} />
                    <BracketRound title="SEMIFINALS"
                      series={bracket.east.filter(s => s.round === 2)} />
                    <BracketRound title="CONF FINALS"
                      series={bracket.east.filter(s => s.round === 3)} />
                  </div>
                </div>

                {/* West bracket */}
                <div style={{ marginBottom: '32px' }}>
                  <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px',
                    color: CONF_COLORS.West, letterSpacing: '0.15em', marginBottom: '16px',
                    borderBottom: `1px solid ${CONF_COLORS.West}30`, paddingBottom: '8px' }}>
                    WESTERN CONFERENCE
                  </div>
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    <BracketRound title="FIRST ROUND"
                      series={bracket.west.filter(s => s.round === 1)} />
                    <BracketRound title="SEMIFINALS"
                      series={bracket.west.filter(s => s.round === 2)} />
                    <BracketRound title="CONF FINALS"
                      series={bracket.west.filter(s => s.round === 3)} />
                  </div>
                </div>

                {/* Finals */}
                {bracket.finals && (
                  <div>
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px',
                      color: '#fbbf24', letterSpacing: '0.15em', marginBottom: '16px',
                      borderBottom: '1px solid #fbbf2430', paddingBottom: '8px' }}>
                      NBA FINALS
                    </div>
                    <SeriesCard series={bracket.finals} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── SIMULATOR TAB ── */}
        {tab === 'simulator' && (
          <div>
            {/* Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px',
              marginBottom: '28px', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '11px', color: '#333' }}>Simulations:</div>
              {[
                { label: '1K',   value: 1000 },
                { label: '10K',  value: 10000 },
                { label: '100K', value: 100000 },
                { label: '1M',   value: 1000000 },
              ].map(o => (
                <button key={o.value} onClick={() => setNSims(o.value)} style={{
                  padding: '6px 14px', background: nSims === o.value ? '#111' : 'none',
                  border: `1px solid ${nSims === o.value ? '#333' : '#111'}`,
                  borderRadius: '3px', cursor: 'pointer',
                  fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
                  color: nSims === o.value ? '#e0e0e0' : '#333',
                }}>{o.label}</button>
              ))}
              <button onClick={runSim} disabled={simLoading} style={{
                padding: '8px 24px', background: simLoading ? '#0a0a0a' : '#4ade80',
                border: 'none', borderRadius: '4px', cursor: simLoading ? 'default' : 'pointer',
                fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', fontWeight: 700,
                color: simLoading ? '#333' : '#080808',
                transition: 'background 0.15s',
              }}>
                {simLoading ? 'Simulating...' : 'Run Simulation →'}
              </button>
              {simResult && (
                <div style={{ fontSize: '10px', color: '#2a2a2a' }}>
                  {simResult.n_sims.toLocaleString()} sims ·{' '}
                  {stageLabel(simResult.stage)} ·{' '}
                  as of {simResult.as_of}
                </div>
              )}
            </div>

            {!simResult && !simLoading && (
              <div style={{ padding: '60px', textAlign: 'center', border: '1px solid #0f0f0f',
                borderRadius: '6px' }}>
                <div style={{ fontSize: '13px', color: '#2a2a2a', marginBottom: '8px' }}>
                  Simulate the playoff race from current standings
                </div>
                <div style={{ fontSize: '11px', color: '#1a1a1a', lineHeight: 1.7 }}>
                  Locks in completed series results · Simulates in-progress series from current scores
                  <br />Works from any point: pre-playoffs, mid-series, conference finals, or Finals
                </div>
              </div>
            )}

            {simLoading && (
              <div style={{ padding: '60px', textAlign: 'center', fontSize: '11px',
                color: '#2a2a2a' }}>
                Running {nSims.toLocaleString()} simulations...
              </div>
            )}

            {simResult && !simLoading && (
              <>
                {/* Top champions */}
                {simResult.top_champions.length > 0 && (
                  <div style={{ marginBottom: '28px', display: 'flex', gap: '8px',
                    flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: '9px', color: '#2a2a2a',
                      letterSpacing: '0.12em' }}>TOP FAVORITES</span>
                    {simResult.top_champions.map((c: any, i: number) => (
                      <div key={c.team} style={{ padding: '6px 14px',
                        background: i === 0 ? '#4ade8015' : '#0a0a0a',
                        border: `1px solid ${i === 0 ? '#4ade8040' : '#1a1a1a'}`,
                        borderRadius: '4px', display: 'flex', gap: '10px',
                        alignItems: 'center' }}>
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace',
                          fontSize: '13px', fontWeight: 700,
                          color: i === 0 ? '#4ade80' : '#888' }}>{c.team}</span>
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace',
                          fontSize: '11px', color: i === 0 ? '#4ade80' : '#444' }}>
                          {c.pct.toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* View toggle */}
                <div style={{ display: 'flex', gap: '2px', marginBottom: '20px' }}>
                  {(['table', 'charts'] as const).map(v => (
                    <button key={v} onClick={() => setSimView(v)} style={{
                      padding: '6px 16px', background: simView === v ? '#111' : 'none',
                      border: `1px solid ${simView === v ? '#333' : '#111'}`,
                      borderRadius: '3px', cursor: 'pointer',
                      fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px',
                      color: simView === v ? '#e0e0e0' : '#333',
                      letterSpacing: '0.08em',
                    }}>{v === 'table' ? 'TABLE' : 'CHARTS'}</button>
                  ))}
                </div>
                {simView === 'charts' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                    <ChampBar results={simResult.results} />
                    <BubbleChart results={simResult.results} />
                  </div>
                )}
                {simView === 'table' && (
                  <div style={{ display: 'flex', gap: '40px', flexWrap: 'wrap' }}>
                    <SimTable results={simResult.east} title="EASTERN CONFERENCE"
                      color={CONF_COLORS.East} />
                    <SimTable results={simResult.west} title="WESTERN CONFERENCE"
                      color={CONF_COLORS.West} />
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
