'use client'

import { useState, useCallback } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface TeamResult {
  team: string
  conference: string
  current_wins: number
  current_losses: number
  projected_wins: number
  projected_wins_low: number
  projected_wins_high: number
  net_rtg: number
  sos: number
  raw_sos: number
  remaining_games: number
  home_games_left: number
  away_games_left: number
  hardest_opponents: [string, number][]
  easiest_opponents: [string, number][]
  playoff_pct: number
  conf_finals_pct: number
  finals_pct: number
  champion_pct: number
}

interface SimResult {
  n_sims: number
  remaining_games: number
  as_of: string
  top_champions: { team: string; pct: number }[]
  results: TeamResult[]
  east_standings: TeamResult[]
  west_standings: TeamResult[]
  sos_avg: number
}

const SIM_OPTIONS = [
  { label: '100', value: 100, desc: '~1s' },
  { label: '10K', value: 10000, desc: '~10s' },
  { label: '100K', value: 100000, desc: '~2min' },
  { label: '1M', value: 1000000, desc: '~20min' },
]

type SortCol = 'champion_pct' | 'finals_pct' | 'conf_finals_pct' | 'playoff_pct' | 'projected_wins' | 'sos' | 'net_rtg'

function PctBar({ pct, color = '#4ade80', width = 70 }: { pct: number; color?: string; width?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <div style={{ width, height: '4px', background: '#111', flexShrink: 0, borderRadius: '1px', overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: '100%', background: color }} />
      </div>
      <span style={{
        fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
        width: '40px', textAlign: 'right', flexShrink: 0,
        color: pct > 40 ? '#e8e8e8' : pct > 15 ? '#888' : pct > 2 ? '#555' : '#2a2a2a',
      }}>
        {pct.toFixed(1)}%
      </span>
    </div>
  )
}

function SosBar({ sos, avgSos }: { sos: number; avgSos: number }) {
  // Positive SOS = harder schedule, negative = easier
  const isHard = sos > avgSos
  const intensity = Math.min(Math.abs(sos - avgSos) / 5, 1)
  const color = isHard ? `rgba(248,113,113,${0.3 + intensity * 0.7})` : `rgba(74,222,128,${0.3 + intensity * 0.7})`
  const label = sos > 0 ? `+${sos.toFixed(1)}` : sos.toFixed(1)
  return (
    <span style={{
      fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
      color, padding: '1px 6px', background: isHard ? 'rgba(248,113,113,0.05)' : 'rgba(74,222,128,0.05)',
      border: `1px solid ${isHard ? 'rgba(248,113,113,0.15)' : 'rgba(74,222,128,0.15)'}`,
    }}>
      {label}
    </span>
  )
}

function WinRange({ low, mid, high }: { low: number; mid: number; high: number }) {
  return (
    <div>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#888' }}>{mid}W</span>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#333', marginLeft: '4px' }}>
        {low}–{high}
      </span>
    </div>
  )
}

function SOSView({ results, avgSos }: { results: TeamResult[]; avgSos: number }) {
  const sorted = [...results].sort((a, b) => b.sos - a.sos)
  const maxAbs = Math.max(...sorted.map(r => Math.abs(r.sos)), 1)

  return (
    <div>
      <div style={{ marginBottom: '16px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', lineHeight: 1.8 }}>
        <div>EFFECTIVE SOS = avg opponent net rating ± home/away adjustment (+2.5 away, -2.5 home)</div>
        <div>Positive = harder remaining schedule · Negative = easier · League avg SOS: {avgSos.toFixed(2)}</div>
        <div style={{ marginTop: '4px', color: '#333' }}>
          SOS is baked into every simulation — when OKC plays BKN vs DEN, the actual opponent rating is used for win probability.
        </div>
      </div>

      <div style={{ border: '1px solid #1a1a1a' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '28px 48px 40px 70px 80px 100px 80px 80px 1fr',
          padding: '8px 16px', borderBottom: '1px solid #1a1a1a',
          fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', letterSpacing: '0.06em',
        }}>
          <span>#</span><span>TEAM</span><span>CONF</span>
          <span>NET RTG</span><span>EFF SOS ↕</span><span>SCHED CHART</span>
          <span>G LEFT</span><span>H/A</span><span>TOUGHEST OPP</span>
        </div>

        {sorted.map((r, i) => {
          const isHard = r.sos > avgSos
          const barPct = (r.sos / maxAbs + 1) / 2 * 100 // normalize to 0-100
          return (
            <div key={r.team} style={{
              display: 'grid', gridTemplateColumns: '28px 48px 40px 70px 80px 100px 80px 80px 1fr',
              padding: '10px 16px', borderBottom: i < sorted.length - 1 ? '1px solid #0d0d0d' : 'none',
              alignItems: 'center',
              background: r.sos > avgSos + 2 ? 'rgba(248,113,113,0.03)' : r.sos < avgSos - 2 ? 'rgba(74,222,128,0.03)' : 'transparent',
            }}>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333' }}>{i + 1}</span>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 700, color: '#e0e0e0' }}>{r.team}</span>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: r.conference === 'East' ? '#3b82f6' : '#f97316' }}>{r.conference}</span>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: r.net_rtg > 0 ? '#4ade80' : '#f87171' }}>
                {r.net_rtg > 0 ? '+' : ''}{r.net_rtg}
              </span>
              <SosBar sos={r.sos} avgSos={avgSos} />
              {/* Mini schedule difficulty bar — centered at midpoint */}
              <div style={{ position: 'relative', height: '6px', background: '#111' }}>
                <div style={{ position: 'absolute', left: '50%', top: 0, width: '1px', height: '100%', background: '#2a2a2a' }} />
                <div style={{
                  position: 'absolute',
                  left: isHard ? '50%' : `${Math.max(0, 50 - Math.abs(r.sos) / maxAbs * 50)}%`,
                  width: `${Math.abs(r.sos) / maxAbs * 50}%`,
                  height: '100%',
                  background: isHard ? '#f87171' : '#4ade80',
                  opacity: 0.7,
                }} />
              </div>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#555' }}>{r.remaining_games}G</span>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444' }}>
                {r.home_games_left}H / {r.away_games_left}A
              </span>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {r.hardest_opponents.slice(0, 3).map(([opp, rtg]) => (
                  <span key={opp} style={{
                    fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px',
                    color: '#f87171', padding: '1px 4px', background: 'rgba(248,113,113,0.05)',
                  }}>
                    {opp} {rtg > 0 ? '+' : ''}{rtg}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BubbleChart({ results }: { results: TeamResult[] }) {
  const w = 520, h = 280, pad = { l: 44, r: 16, t: 16, b: 32 }
  const rtgs = results.map(r => r.net_rtg)
  const minR = Math.min(...rtgs) - 1, maxR = Math.max(...rtgs) + 1
  const toX = (r: number) => pad.l + ((r - minR) / (maxR - minR)) * (w - pad.l - pad.r)
  const toY = (p: number) => pad.t + ((100 - p) / 100) * (h - pad.t - pad.b)
  const toSize = (c: number) => Math.max(3, Math.sqrt(c + 0.1) * 3.2)

  return (
    <div style={{ border: '1px solid #1a1a1a', padding: '20px' }}>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.08em', marginBottom: '8px' }}>
        NET RATING vs PLAYOFF ODDS · bubble = championship %
      </div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`}>
        {[0, 25, 50, 75, 100].map(p => (
          <g key={p}>
            <line x1={pad.l} y1={toY(p)} x2={w - pad.r} y2={toY(p)} stroke="#111" strokeWidth="1" />
            <text x={pad.l - 4} y={toY(p) + 4} textAnchor="end" fontSize="8" fill="#2a2a2a" fontFamily="monospace">{p}%</text>
          </g>
        ))}
        <line x1={toX(0)} y1={pad.t} x2={toX(0)} y2={h - pad.b} stroke="#1a1a1a" strokeDasharray="3,3" strokeWidth="1" />
        <line x1={pad.l} y1={toY(50)} x2={w - pad.r} y2={toY(50)} stroke="#1a1a1a" strokeDasharray="3,3" strokeWidth="1" />
        {results.map(r => {
          const x = toX(r.net_rtg), y = toY(r.playoff_pct), s = toSize(r.champion_pct)
          const c = r.conference === 'East' ? '#3b82f6' : '#f97316'
          return (
            <g key={r.team}>
              <circle cx={x} cy={y} r={s} fill={c} fillOpacity={0.25} stroke={c} strokeWidth="1" />
              <text x={x} y={y - s - 2} textAnchor="middle" fontSize="7" fill="#555" fontFamily="monospace">{r.team}</text>
            </g>
          )
        })}
        <text x={w / 2} y={h - 2} textAnchor="middle" fontSize="8" fill="#333" fontFamily="monospace">Net Rating →</text>
      </svg>
    </div>
  )
}

function ChampBar({ results }: { results: TeamResult[] }) {
  const top = results.filter(r => r.champion_pct >= 0.5).slice(0, 12)
  const max = Math.max(...top.map(r => r.champion_pct), 1)
  return (
    <div style={{ border: '1px solid #1a1a1a', padding: '20px' }}>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#fbbf24', letterSpacing: '0.08em', marginBottom: '16px' }}>
        🏆 CHAMPIONSHIP PROBABILITY
      </div>
      {top.map((r, i) => (
        <div key={r.team} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '9px' }}>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333', width: '14px', textAlign: 'right' }}>{i + 1}</span>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', fontWeight: 700, color: '#e0e0e0', width: '34px' }}>{r.team}</span>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: r.conference === 'East' ? '#3b82f6' : '#f97316', width: '26px' }}>{r.conference}</span>
          <div style={{ flex: 1, height: '8px', background: '#0a0a0a', overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${(r.champion_pct / max) * 100}%`,
              background: i === 0 ? '#fbbf24' : i === 1 ? '#9ca3af' : i === 2 ? '#92400e' : '#2a2a2a',
              transition: 'width 0.5s ease',
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

function ConfStandings({ teams, title, color }: { teams: TeamResult[]; title: string; color: string }) {
  const top10 = teams.slice(0, 10)
  const maxW = Math.max(...top10.map(t => t.projected_wins), 1)
  return (
    <div style={{ border: '1px solid #1a1a1a', padding: '20px' }}>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color, letterSpacing: '0.1em', marginBottom: '14px' }}>
        {title} PROJECTED STANDINGS
      </div>
      {top10.map((t, i) => (
        <div key={t.team} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '7px' }}>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#333', width: '14px', textAlign: 'right' }}>{i + 1}</span>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', fontWeight: 700, color: i < 6 ? '#e0e0e0' : '#555', width: '34px' }}>
            {t.team}
          </span>
          {i === 6 && <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '8px', color: '#444' }}>play-in</span>}
          <div style={{ flex: 1, height: '5px', background: '#0a0a0a', overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${(t.projected_wins / maxW) * 100}%`,
              background: i < 6 ? color : '#222', opacity: i >= 6 ? 0.5 : 1,
            }} />
          </div>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#555', width: '26px', textAlign: 'right' }}>{t.projected_wins}W</span>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: t.sos > 0 ? '#f87171' : '#4ade80', width: '32px', textAlign: 'right' }}>
            {t.sos > 0 ? '+' : ''}{t.sos.toFixed(1)}
          </span>
        </div>
      ))}
      <div style={{ marginTop: '8px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '8px', color: '#2a2a2a' }}>
        right column = effective SOS (red = harder)
      </div>
    </div>
  )
}

export default function PlayoffsPage() {
  const [data, setData] = useState<SimResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [hasRun, setHasRun] = useState(false)
  const [nSims, setNSims] = useState(10000)
  const [confFilter, setConfFilter] = useState<'All' | 'East' | 'West'>('All')
  const [sortCol, setSortCol] = useState<SortCol>('champion_pct')
  const [elapsed, setElapsed] = useState(0)
  const [view, setView] = useState<'table' | 'charts' | 'sos'>('table')

  const runSim = useCallback(async () => {
    setLoading(true)
    setHasRun(true)
    setElapsed(0)
    const start = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500)
    try {
      const r = await fetch(`${API}/playoffs/simulate?n_sims=${nSims}`)
      const d = await r.json()
      setData(d)
    } catch (e) { console.error(e) }
    clearInterval(timer)
    setLoading(false)
  }, [nSims])

  const filtered = (data?.results ?? [])
    .filter(r => confFilter === 'All' || r.conference === confFilter)
    .sort((a, b) => {
      const av = a[sortCol] as number, bv = b[sortCol] as number
      // For SOS, higher = harder = sort first when sorting by SOS
      return bv - av
    })

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.12em', marginBottom: '6px' }}>
          MONTE CARLO SIMULATION · 2025–26 · SOS-ADJUSTED
        </div>
        <h1 style={{ fontSize: '22px', fontWeight: 400, color: '#f0f0f0', marginBottom: '8px' }}>Playoff Simulator</h1>
        <p style={{ color: '#555', fontSize: '13px', lineHeight: 1.6, maxWidth: '580px' }}>
          Every remaining game is simulated using actual opponent ratings — so a game vs OKC is much harder
          than a game vs BKN. Strength of schedule is implicitly baked into every simulation,
          and surfaced explicitly in the SOS tab.
        </p>
      </div>

      {/* Sim selector + run */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '24px', alignItems: 'flex-end' }}>
        {SIM_OPTIONS.map(opt => (
          <button key={opt.value} onClick={() => setNSims(opt.value)} style={{
            background: nSims === opt.value ? '#0f1f0f' : '#0a0a0a',
            border: `1px solid ${nSims === opt.value ? '#4ade80' : '#1a1a1a'}`,
            color: nSims === opt.value ? '#4ade80' : '#444',
            padding: '8px 14px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', cursor: 'pointer',
          }}>
            <div style={{ fontWeight: 600 }}>{opt.label}</div>
            <div style={{ fontSize: '9px', color: nSims === opt.value ? '#2d7a2d' : '#333', marginTop: '2px' }}>{opt.desc}</div>
          </button>
        ))}
        <button onClick={runSim} disabled={loading} style={{
          background: loading ? '#0a0a0a' : '#0f1f0f',
          border: `1px solid ${loading ? '#222' : '#4ade80'}`,
          color: loading ? '#444' : '#4ade80',
          padding: '8px 20px', fontSize: '12px', fontFamily: 'IBM Plex Mono, monospace',
          cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '0.06em', marginLeft: '8px',
          alignSelf: 'stretch',
        }}>
          {loading ? `Running... ${elapsed}s` : hasRun ? '↺ Re-run' : 'RUN →'}
        </button>
        {loading && (
          <div style={{ alignSelf: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444' }}>
            fetching schedule → rating teams → simulating {nSims.toLocaleString()} seasons → running playoffs
          </div>
        )}
      </div>

      {data && !loading && (
        <>
          {/* Meta */}
          <div style={{ display: 'flex', gap: '20px', marginBottom: '20px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', flexWrap: 'wrap' }}>
            <span style={{ color: '#4ade80' }}>{data.n_sims.toLocaleString()} simulations</span>
            <span>{data.remaining_games} games remaining</span>
            <span>as of {data.as_of}</span>
            <span>league avg SOS: {data.sos_avg > 0 ? '+' : ''}{data.sos_avg}</span>
          </div>

          {/* View tabs */}
          <div style={{ display: 'flex', gap: '1px', marginBottom: '20px', background: '#1a1a1a', width: 'fit-content' }}>
            {(['table', 'charts', 'sos'] as const).map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                background: view === v ? '#1a1a1a' : '#0a0a0a',
                border: 'none', color: view === v ? '#e8e8e8' : '#444',
                padding: '8px 18px', fontSize: '11px', fontFamily: 'IBM Plex Mono, monospace',
                cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>
                {v === 'sos' ? '📅 Schedule' : v === 'charts' ? '📊 Charts' : '📋 Table'}
              </button>
            ))}
          </div>

          {/* SOS view */}
          {view === 'sos' && <SOSView results={data.results} avgSos={data.sos_avg} />}

          {/* Charts view */}
          {view === 'charts' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px' }}>
              <ChampBar results={data.results} />
              <BubbleChart results={data.results} />
              <ConfStandings teams={data.east_standings} title="EASTERN" color="#3b82f6" />
              <ConfStandings teams={data.west_standings} title="WESTERN" color="#f97316" />
            </div>
          )}

          {/* Table view */}
          {view === 'table' && (
            <>
              {/* Top 3 */}
              <div style={{ display: 'flex', gap: '1px', marginBottom: '20px' }}>
                {data.top_champions.map((t, i) => (
                  <div key={t.team} style={{
                    flex: 1, border: `1px solid ${i === 0 ? '#fbbf24' : '#1a1a1a'}`,
                    padding: '14px 18px', background: i === 0 ? '#0c0b00' : '#0a0a0a',
                  }}>
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', marginBottom: '4px' }}>#{i + 1} CHAMPION</div>
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '20px', fontWeight: 700, color: i === 0 ? '#fbbf24' : '#666' }}>{t.team}</div>
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '15px', color: i === 0 ? '#4ade80' : '#444', marginTop: '2px' }}>{t.pct.toFixed(1)}%</div>
                  </div>
                ))}
              </div>

              {/* Filters */}
              <div style={{ display: 'flex', gap: '6px', marginBottom: '1px', flexWrap: 'wrap', alignItems: 'center' }}>
                {(['All', 'East', 'West'] as const).map(c => (
                  <button key={c} onClick={() => setConfFilter(c)} style={{
                    background: confFilter === c ? '#1a1a1a' : '#0a0a0a',
                    border: '1px solid #1a1a1a', color: confFilter === c ? '#e8e8e8' : '#444',
                    padding: '5px 12px', fontSize: '11px', fontFamily: 'IBM Plex Mono, monospace', cursor: 'pointer',
                  }}>{c}</button>
                ))}
                <div style={{ flex: 1 }} />
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#333' }}>SORT:</span>
                {([
                  ['champion_pct', '🏆'],
                  ['finals_pct', 'Finals'],
                  ['conf_finals_pct', 'Conf F'],
                  ['playoff_pct', 'Playoffs'],
                  ['projected_wins', 'Wins'],
                  ['sos', 'SOS ↕'],
                  ['net_rtg', 'Rating'],
                ] as [SortCol, string][]).map(([col, label]) => (
                  <button key={col} onClick={() => setSortCol(col)} style={{
                    background: sortCol === col ? '#1a1a1a' : '#0a0a0a',
                    border: '1px solid #1a1a1a', color: sortCol === col ? '#e8e8e8' : '#444',
                    padding: '5px 8px', fontSize: '10px', fontFamily: 'IBM Plex Mono, monospace', cursor: 'pointer',
                  }}>{label}</button>
                ))}
              </div>

              {/* Table */}
              <div style={{ border: '1px solid #1a1a1a' }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '24px 44px 36px 68px 90px 60px 120px 120px 120px 120px',
                  padding: '8px 14px', borderBottom: '1px solid #1a1a1a',
                  fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', letterSpacing: '0.05em',
                }}>
                  <span>#</span><span>TEAM</span><span>CONF</span>
                  <span>W-L</span><span>PROJ W (range)</span><span>SOS</span>
                  <span>PLAYOFFS</span><span>CONF FINALS</span><span>FINALS</span><span>🏆 CHAMP</span>
                </div>

                {filtered.map((r, i) => {
                  const isElim = r.playoff_pct < 0.5
                  const locked = r.playoff_pct > 99.4
                  return (
                    <div key={r.team} style={{
                      display: 'grid',
                      gridTemplateColumns: '24px 44px 36px 68px 90px 60px 120px 120px 120px 120px',
                      padding: '10px 14px',
                      borderBottom: i < filtered.length - 1 ? '1px solid #0d0d0d' : 'none',
                      alignItems: 'center',
                      opacity: isElim ? 0.3 : 1,
                      background: r.champion_pct > 20 ? '#0a0f0a' : 'transparent',
                    }}>
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#333' }}>{i + 1}</span>
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 700, color: '#e0e0e0' }}>{r.team}</span>
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: r.conference === 'East' ? '#3b82f6' : '#f97316' }}>{r.conference}</span>
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#555' }}>{r.current_wins}-{r.current_losses}</span>
                      <WinRange low={r.projected_wins_low} mid={r.projected_wins} high={r.projected_wins_high} />
                      <SosBar sos={r.sos} avgSos={data.sos_avg} />
                      <PctBar pct={r.playoff_pct} color={locked ? '#16a34a' : '#3b82f6'} />
                      <PctBar pct={r.conf_finals_pct} color="#8b5cf6" />
                      <PctBar pct={r.finals_pct} color="#f97316" />
                      <PctBar pct={r.champion_pct} color="#fbbf24" />
                    </div>
                  )
                })}
              </div>

              <div style={{ marginTop: '12px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#2a2a2a', lineHeight: 1.8 }}>
                <div>SOS = effective schedule difficulty (opponent rating ± home/away adj) · green = easier · red = harder</div>
                <div>PROJ W range = 10th–90th percentile across {data.n_sims.toLocaleString()} simulations · exponential decay ratings λ=0.015</div>
              </div>
            </>
          )}
        </>
      )}

      {!hasRun && !loading && (
        <div style={{ border: '1px solid #1a1a1a', padding: '48px', textAlign: 'center' }}>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#444', marginBottom: '20px', lineHeight: 1.8 }}>
            Select simulation count above and click RUN →<br />
            10K sims takes ~10 seconds and gives accurate odds to 1 decimal place.<br />
            100K sims gives odds accurate to 0.1% but takes ~2 minutes.
          </div>
        </div>
      )}
    </div>
  )
}
