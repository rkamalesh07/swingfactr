'use client'

import { useEffect, useState, useCallback } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface TeamResult {
  team: string
  conference: string
  current_wins: number
  current_losses: number
  projected_wins: number
  net_rtg: number
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
}

const SIM_OPTIONS = [
  { label: '1 sim', value: 1, desc: 'instant' },
  { label: '100 sims', value: 100, desc: '~1s' },
  { label: '10K sims', value: 10000, desc: '~10s' },
  { label: '100K sims', value: 100000, desc: '~90s' },
  { label: '1M sims', value: 1000000, desc: '~15 min' },
]

function PctBar({ pct, color = '#4ade80' }: { pct: number; color?: string }) {
  const clamped = Math.min(100, Math.max(0, pct))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ width: '80px', height: '4px', background: '#111', flexShrink: 0, position: 'relative' }}>
        <div style={{
          position: 'absolute', left: 0, top: 0,
          width: `${clamped}%`, height: '100%', background: color,
        }} />
      </div>
      <span style={{
        fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', width: '44px', textAlign: 'right', flexShrink: 0,
        color: pct > 30 ? '#e8e8e8' : pct > 10 ? '#888' : pct > 1 ? '#555' : '#2a2a2a',
      }}>
        {pct.toFixed(1)}%
      </span>
    </div>
  )
}

function ConferenceChart({ teams, title, color }: { teams: TeamResult[]; title: string; color: string }) {
  const top8 = teams.slice(0, 10)
  const maxProj = Math.max(...top8.map(t => t.projected_wins), 1)
  return (
    <div style={{ border: '1px solid #1a1a1a', padding: '20px' }}>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color, letterSpacing: '0.1em', marginBottom: '16px' }}>
        {title} PROJECTED STANDINGS
      </div>
      {top8.map((t, i) => (
        <div key={t.team} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333', width: '16px', textAlign: 'right' }}>{i+1}</span>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', fontWeight: 700, color: i < 6 ? '#e0e0e0' : '#666', width: '36px' }}>{t.team}</span>
          <div style={{ flex: 1, height: '6px', background: '#0a0a0a', position: 'relative' }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, height: '100%',
              width: `${(t.projected_wins / maxProj) * 100}%`,
              background: i < 6 ? color : '#222',
              opacity: i >= 6 && i < 8 ? 0.6 : 1,
            }} />
          </div>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#555', width: '28px', textAlign: 'right' }}>
            {t.projected_wins}W
          </span>
          {i === 5 && (
            <div style={{ position: 'absolute', marginLeft: '-8px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#333' }} />
          )}
        </div>
      ))}
      <div style={{ marginTop: '8px', borderTop: '1px solid #111', paddingTop: '8px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#333' }}>
        1-6: auto playoff · 7-8: play-in winner · 9-10: play-in (elim risk)
      </div>
    </div>
  )
}

function ChampionshipOddsChart({ results }: { results: TeamResult[] }) {
  const top10 = results.filter(r => r.champion_pct > 0.1).slice(0, 10)
  const max = Math.max(...top10.map(r => r.champion_pct), 1)
  return (
    <div style={{ border: '1px solid #1a1a1a', padding: '20px' }}>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#fbbf24', letterSpacing: '0.1em', marginBottom: '16px' }}>
        🏆 CHAMPIONSHIP ODDS — TOP 10
      </div>
      {top10.map((r, i) => (
        <div key={r.team} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333', width: '16px', textAlign: 'right' }}>{i+1}</span>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 700, color: '#e0e0e0', width: '36px' }}>{r.team}</span>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: r.conference === 'East' ? '#3b82f6' : '#f97316', width: '28px' }}>{r.conference}</span>
          <div style={{ flex: 1, height: '8px', background: '#0a0a0a', position: 'relative' }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, height: '100%',
              width: `${(r.champion_pct / max) * 100}%`,
              background: i === 0 ? '#fbbf24' : i === 1 ? '#9ca3af' : i === 2 ? '#92400e' : '#2a2a2a',
            }} />
          </div>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 600, color: i === 0 ? '#fbbf24' : '#888', width: '44px', textAlign: 'right' }}>
            {r.champion_pct.toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  )
}

function PlayoffBubbleChart({ results }: { results: TeamResult[] }) {
  // Plot teams: x = net_rtg, y = playoff_pct. Size = champion_pct
  const w = 500, h = 260
  const pad = { l: 40, r: 20, t: 20, b: 30 }
  const rtgs = results.map(r => r.net_rtg)
  const minR = Math.min(...rtgs) - 1
  const maxR = Math.max(...rtgs) + 1
  const toX = (r: number) => pad.l + ((r - minR) / (maxR - minR)) * (w - pad.l - pad.r)
  const toY = (p: number) => pad.t + ((100 - p) / 100) * (h - pad.t - pad.b)
  const toSize = (c: number) => Math.max(4, Math.sqrt(c) * 3.5)

  return (
    <div style={{ border: '1px solid #1a1a1a', padding: '20px' }}>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.1em', marginBottom: '12px' }}>
        TEAM LANDSCAPE · net rating vs playoff odds · bubble size = championship %
      </div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible' }}>
        {/* Grid lines */}
        {[0, 25, 50, 75, 100].map(p => (
          <g key={p}>
            <line x1={pad.l} y1={toY(p)} x2={w - pad.r} y2={toY(p)} stroke="#111" strokeWidth="1" />
            <text x={pad.l - 4} y={toY(p) + 4} textAnchor="end" fontSize="8" fill="#333" fontFamily="IBM Plex Mono, monospace">{p}%</text>
          </g>
        ))}
        {/* 50% playoff line */}
        <line x1={pad.l} y1={toY(50)} x2={w - pad.r} y2={toY(50)} stroke="#1a1a1a" strokeWidth="1" strokeDasharray="4,4" />
        {/* Zero net rtg line */}
        <line x1={toX(0)} y1={pad.t} x2={toX(0)} y2={h - pad.b} stroke="#1a1a1a" strokeWidth="1" strokeDasharray="4,4" />
        {/* Bubbles */}
        {results.map(r => {
          const x = toX(r.net_rtg)
          const y = toY(r.playoff_pct)
          const s = toSize(r.champion_pct)
          const conf = r.conference === 'East' ? '#3b82f6' : '#f97316'
          return (
            <g key={r.team}>
              <circle cx={x} cy={y} r={s} fill={conf} fillOpacity={0.3} stroke={conf} strokeWidth="1" />
              <text x={x} y={y - s - 2} textAnchor="middle" fontSize="7" fill="#666" fontFamily="IBM Plex Mono, monospace">{r.team}</text>
            </g>
          )
        })}
        {/* Axis labels */}
        <text x={w/2} y={h - 4} textAnchor="middle" fontSize="8" fill="#333" fontFamily="IBM Plex Mono, monospace">Net Rating →</text>
        <text x={6} y={h/2} textAnchor="middle" fontSize="8" fill="#333" fontFamily="IBM Plex Mono, monospace" transform={`rotate(-90, 6, ${h/2})`}>Playoff %</text>
      </svg>
    </div>
  )
}

export default function PlayoffsPage() {
  const [data, setData] = useState<SimResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [hasRun, setHasRun] = useState(false)
  const [nSims, setNSims] = useState(10000)
  const [confFilter, setConfFilter] = useState<'All' | 'East' | 'West'>('All')
  const [sortCol, setSortCol] = useState<keyof TeamResult>('champion_pct')
  const [elapsed, setElapsed] = useState(0)
  const [view, setView] = useState<'table' | 'charts'>('table')

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
    .sort((a, b) => (b[sortCol] as number) - (a[sortCol] as number))

  return (
    <div>
      <div style={{ marginBottom: '28px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.12em', marginBottom: '6px' }}>
          MONTE CARLO SIMULATION · 2025–26 NBA SEASON
        </div>
        <h1 style={{ fontSize: '22px', fontWeight: 400, color: '#f0f0f0', marginBottom: '8px' }}>Playoff Simulator</h1>
        <p style={{ color: '#555', fontSize: '13px', lineHeight: 1.6, maxWidth: '580px' }}>
          Simulates every remaining regular season game using exponentially-weighted team ratings,
          runs the play-in, then simulates the full 4-round playoff bracket. More simulations = more accurate odds.
        </p>
      </div>

      {/* Sim count selector + run button */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '24px', alignItems: 'center' }}>
        {SIM_OPTIONS.map(opt => (
          <button key={opt.value} onClick={() => setNSims(opt.value)} style={{
            background: nSims === opt.value ? '#0f1f0f' : '#0a0a0a',
            border: `1px solid ${nSims === opt.value ? '#4ade80' : '#1a1a1a'}`,
            color: nSims === opt.value ? '#4ade80' : '#444',
            padding: '8px 14px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', cursor: 'pointer',
          }}>
            <div>{opt.label}</div>
            <div style={{ fontSize: '9px', color: nSims === opt.value ? '#2d7a2d' : '#333', marginTop: '2px' }}>{opt.desc}</div>
          </button>
        ))}
        <button onClick={runSim} disabled={loading} style={{
          background: loading ? '#0a0a0a' : '#0f1f0f',
          border: `1px solid ${loading ? '#222' : '#4ade80'}`,
          color: loading ? '#333' : '#4ade80',
          padding: '8px 24px', fontSize: '12px', fontFamily: 'IBM Plex Mono, monospace',
          cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '0.08em', marginLeft: '8px',
        }}>
          {loading ? `Running... ${elapsed}s` : hasRun ? '↺ Re-run' : 'RUN SIMULATION →'}
        </button>
      </div>

      {loading && (
        <div style={{ padding: '32px', border: '1px solid #1a1a1a', marginBottom: '24px' }}>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#4ade80', marginBottom: '8px' }}>
            Simulating {nSims.toLocaleString()} seasons...
          </div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', marginBottom: '12px' }}>
            {elapsed}s elapsed · fetching ESPN schedule → weighting team ratings → running {nSims.toLocaleString()} regular seasons → play-in → playoffs
          </div>
          <div style={{ height: '2px', background: '#111', width: '300px' }}>
            <div style={{ height: '100%', background: '#4ade80', width: '40%', animation: 'slide 1.5s ease-in-out infinite' }} />
          </div>
          <style>{`@keyframes slide{0%{margin-left:0;width:30%}50%{margin-left:60%;width:40%}100%{margin-left:0;width:30%}}`}</style>
        </div>
      )}

      {data && !loading && (
        <>
          {/* Meta bar */}
          <div style={{ display: 'flex', gap: '24px', marginBottom: '24px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: '#4ade80' }}>{data.n_sims.toLocaleString()} simulations complete</span>
            <span>{data.remaining_games} games remaining in season</span>
            <span>as of {data.as_of}</span>
          </div>

          {/* View toggle */}
          <div style={{ display: 'flex', gap: '1px', marginBottom: '24px', background: '#1a1a1a', width: 'fit-content' }}>
            {(['table', 'charts'] as const).map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                background: view === v ? '#1a1a1a' : '#0a0a0a',
                border: 'none', color: view === v ? '#e8e8e8' : '#444',
                padding: '8px 20px', fontSize: '11px', fontFamily: 'IBM Plex Mono, monospace',
                cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>{v}</button>
            ))}
          </div>

          {view === 'charts' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', marginBottom: '24px' }}>
              <ChampionshipOddsChart results={data.results} />
              <PlayoffBubbleChart results={data.results} />
              <ConferenceChart teams={data.east_standings} title="EASTERN" color="#3b82f6" />
              <ConferenceChart teams={data.west_standings} title="WESTERN" color="#f97316" />
            </div>
          )}

          {view === 'table' && (
            <>
              {/* Top 3 champions */}
              <div style={{ display: 'flex', gap: '1px', marginBottom: '24px' }}>
                {data.top_champions.map((t, i) => (
                  <div key={t.team} style={{
                    flex: 1, border: `1px solid ${i===0?'#fbbf24':'#1a1a1a'}`,
                    padding: '16px 20px', background: i===0?'#0a0a05':'#0a0a0a',
                  }}>
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', marginBottom: '4px' }}>
                      #{i+1} MOST LIKELY CHAMPION
                    </div>
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '22px', fontWeight: 700, color: i===0?'#fbbf24':'#888' }}>{t.team}</div>
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '16px', color: i===0?'#4ade80':'#555', marginTop: '4px' }}>{t.pct.toFixed(1)}%</div>
                  </div>
                ))}
              </div>

              {/* Filters + sort */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '1px', flexWrap: 'wrap', alignItems: 'center' }}>
                {(['All','East','West'] as const).map(c => (
                  <button key={c} onClick={() => setConfFilter(c)} style={{
                    background: confFilter===c ? '#1a1a1a' : '#0a0a0a',
                    border: '1px solid #1a1a1a', color: confFilter===c ? '#e8e8e8' : '#444',
                    padding: '5px 14px', fontSize: '11px', fontFamily: 'IBM Plex Mono, monospace', cursor: 'pointer',
                  }}>{c}</button>
                ))}
                <div style={{ flex: 1 }} />
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333' }}>Sort:</span>
                {([
                  ['champion_pct','🏆 Champ'],
                  ['finals_pct','Finals'],
                  ['conf_finals_pct','Conf Finals'],
                  ['playoff_pct','Playoffs'],
                  ['projected_wins','Proj W'],
                ] as const).map(([col, label]) => (
                  <button key={col} onClick={() => setSortCol(col as keyof TeamResult)} style={{
                    background: sortCol===col ? '#1a1a1a' : '#0a0a0a',
                    border: '1px solid #1a1a1a', color: sortCol===col ? '#e8e8e8' : '#444',
                    padding: '5px 10px', fontSize: '10px', fontFamily: 'IBM Plex Mono, monospace', cursor: 'pointer',
                  }}>{label}</button>
                ))}
              </div>

              {/* Table */}
              <div style={{ border: '1px solid #1a1a1a' }}>
                <div style={{
                  display: 'grid', gridTemplateColumns: '28px 48px 40px 72px 64px 140px 140px 140px 140px',
                  padding: '8px 16px', borderBottom: '1px solid #1a1a1a',
                  fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#444', letterSpacing: '0.06em',
                }}>
                  <span>#</span><span>TEAM</span><span>CONF</span><span>W-L</span>
                  <span>PROJ W</span><span>PLAYOFFS</span><span>CONF FINALS</span><span>FINALS</span><span>🏆 CHAMP</span>
                </div>

                {filtered.map((r, i) => {
                  const isElim = r.playoff_pct < 0.5
                  const isLocked = r.playoff_pct > 99.4
                  return (
                    <div key={r.team} style={{
                      display: 'grid', gridTemplateColumns: '28px 48px 40px 72px 64px 140px 140px 140px 140px',
                      padding: '10px 16px', borderBottom: i < filtered.length-1 ? '1px solid #0d0d0d' : 'none',
                      alignItems: 'center', opacity: isElim ? 0.35 : 1,
                      background: r.champion_pct > 20 ? '#0a0f0a' : 'transparent',
                    }}>
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333' }}>{i+1}</span>
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 700, color: '#e0e0e0' }}>{r.team}</span>
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: r.conference==='East'?'#3b82f6':'#f97316' }}>{r.conference}</span>
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#555' }}>{r.current_wins}-{r.current_losses}</span>
                      <div>
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#888' }}>{r.projected_wins}W</span>
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: r.net_rtg>0?'#4ade80':'#f87171', marginLeft: '4px' }}>
                          {r.net_rtg>0?'+':''}{r.net_rtg}
                        </span>
                      </div>
                      <PctBar pct={r.playoff_pct} color={isLocked ? '#16a34a' : '#3b82f6'} />
                      <PctBar pct={r.conf_finals_pct} color='#8b5cf6' />
                      <PctBar pct={r.finals_pct} color='#f97316' />
                      <PctBar pct={r.champion_pct} color='#fbbf24' />
                    </div>
                  )
                })}
              </div>

              <div style={{ marginTop: '12px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#2a2a2a', lineHeight: 1.8 }}>
                <div>Exponential decay ratings (λ=0.015, half-life 46d) · logistic win prob · play-in included · {data.n_sims.toLocaleString()} Monte Carlo iterations</div>
                <div>Teams faded = effectively eliminated · PROJ W = projected final win total</div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
