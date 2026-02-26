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
}

const CONF_COLORS: Record<string, string> = {
  East: '#3b82f6',
  West: '#f97316',
}

function PctBar({ pct, max, color = '#4ade80' }: { pct: number; max: number; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
      <div style={{ flex: 1, height: '4px', background: '#111', position: 'relative', minWidth: 60 }}>
        <div style={{
          position: 'absolute', left: 0, top: 0,
          width: `${Math.max(1, (pct / max) * 100)}%`,
          height: '100%', background: color,
          transition: 'width 0.6s ease',
        }} />
      </div>
      <span style={{
        fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px',
        color: pct > 20 ? '#e8e8e8' : pct > 5 ? '#888' : '#444',
        minWidth: '42px', textAlign: 'right',
      }}>
        {pct.toFixed(1)}%
      </span>
    </div>
  )
}

function ChampionPodium({ top3 }: { top3: { team: string; pct: number }[] }) {
  if (top3.length === 0) return null
  const heights = [120, 90, 70]
  const order = [1, 0, 2] // 2nd, 1st, 3rd display order
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: '2px', height: '160px', marginBottom: '32px' }}>
      {order.map(idx => {
        const t = top3[idx]
        if (!t) return null
        const isFirst = idx === 0
        return (
          <div key={t.team} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            width: '120px',
          }}>
            <div style={{
              fontFamily: 'IBM Plex Mono, monospace',
              fontSize: isFirst ? '28px' : '20px',
              fontWeight: 700, color: isFirst ? '#fbbf24' : '#888',
              marginBottom: '4px',
            }}>{t.team}</div>
            <div style={{
              fontFamily: 'IBM Plex Mono, monospace',
              fontSize: isFirst ? '20px' : '14px',
              color: isFirst ? '#4ade80' : '#555',
              marginBottom: '8px',
            }}>{t.pct.toFixed(1)}%</div>
            <div style={{
              width: '100%', height: `${heights[idx]}px`,
              background: isFirst ? '#1a2e1a' : '#111',
              border: `1px solid ${isFirst ? '#4ade80' : '#1a1a1a'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#444' }}>
                #{idx + 1}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function PlayoffsPage() {
  const [data, setData] = useState<SimResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [confFilter, setConfFilter] = useState<'All' | 'East' | 'West'>('All')
  const [sortCol, setSortCol] = useState<'champion_pct' | 'playoff_pct' | 'finals_pct' | 'projected_wins'>('champion_pct')
  const [hasRun, setHasRun] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  const runSim = useCallback(async () => {
    setLoading(true)
    setHasRun(true)
    setElapsed(0)
    const start = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500)
    try {
      const r = await fetch(`${API}/playoffs/simulate?n_sims=10000`)
      const d = await r.json()
      setData(d)
    } catch (e) {
      console.error(e)
    }
    clearInterval(timer)
    setLoading(false)
  }, [])

  const filtered = data?.results.filter(r =>
    confFilter === 'All' || r.conference === confFilter
  ).sort((a, b) => b[sortCol] - a[sortCol]) ?? []

  const maxChamp = Math.max(...(data?.results.map(r => r.champion_pct) ?? [1]))
  const maxFinals = Math.max(...(data?.results.map(r => r.finals_pct) ?? [1]))
  const maxPlayoff = Math.max(...(data?.results.map(r => r.playoff_pct) ?? [1]))

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.12em', marginBottom: '6px' }}>
          MONTE CARLO · 10,000 SIMULATIONS · 2025–26
        </div>
        <h1 style={{ fontSize: '22px', fontWeight: 400, color: '#f0f0f0', marginBottom: '8px' }}>
          NBA Playoff Simulator
        </h1>
        <p style={{ color: '#555', fontSize: '13px', lineHeight: 1.6, maxWidth: '600px' }}>
          Simulates every remaining regular season game using exponentially weighted team ratings,
          runs the play-in tournament, then simulates the full playoff bracket — 10,000 times.
          Gives each team a true probability of winning the championship.
        </p>
      </div>

      {/* Run button */}
      {!hasRun && (
        <div style={{ marginBottom: '32px' }}>
          <button onClick={runSim} style={{
            background: '#0f1f0f', border: '1px solid #4ade80', color: '#4ade80',
            padding: '14px 32px', fontSize: '13px', fontFamily: 'IBM Plex Mono, monospace',
            cursor: 'pointer', letterSpacing: '0.08em',
          }}>
            RUN 10,000 SIMULATIONS →
          </button>
          <div style={{ marginTop: '8px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333' }}>
            Takes ~10-15 seconds · Fetches live schedule from ESPN · Uses current team ratings
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ padding: '48px', textAlign: 'center' }}>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', color: '#4ade80', marginBottom: '12px' }}>
            Simulating {(10000).toLocaleString()} seasons...
          </div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#444' }}>
            {elapsed}s elapsed · fetching schedule → simulating regular season → running play-in → running playoffs
          </div>
          <div style={{ marginTop: '16px', width: '200px', height: '2px', background: '#111', margin: '16px auto 0' }}>
            <div style={{ height: '100%', background: '#4ade80', animation: 'loading 2s ease-in-out infinite', width: '30%' }} />
          </div>
          <style>{`@keyframes loading { 0%{margin-left:0} 50%{margin-left:70%} 100%{margin-left:0} }`}</style>
        </div>
      )}

      {/* Results */}
      {data && !loading && (
        <>
          {/* Meta */}
          <div style={{ display: 'flex', gap: '24px', marginBottom: '24px', flexWrap: 'wrap', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444' }}>
            <span>{data.n_sims.toLocaleString()} simulations</span>
            <span>{data.remaining_games} games remaining</span>
            <span>as of {data.as_of}</span>
            <button onClick={runSim} style={{
              background: 'transparent', border: '1px solid #222', color: '#555',
              padding: '2px 10px', fontSize: '10px', fontFamily: 'IBM Plex Mono, monospace',
              cursor: 'pointer',
            }}>↺ Re-run</button>
          </div>

          {/* Champion podium */}
          <div style={{ marginBottom: '8px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.1em' }}>
            MOST LIKELY CHAMPIONS
          </div>
          <ChampionPodium top3={data.top_champions} />

          {/* Filters */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '1px', flexWrap: 'wrap' }}>
            {(['All', 'East', 'West'] as const).map(c => (
              <button key={c} onClick={() => setConfFilter(c)} style={{
                background: confFilter === c ? '#1a1a1a' : '#0a0a0a',
                border: '1px solid #1a1a1a', color: confFilter === c ? '#e8e8e8' : '#444',
                padding: '6px 16px', fontSize: '11px', fontFamily: 'IBM Plex Mono, monospace',
                cursor: 'pointer',
              }}>{c}</button>
            ))}
            <div style={{ flex: 1 }} />
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333', alignSelf: 'center' }}>Sort by:</span>
            {([
              ['champion_pct', '🏆 Champion'],
              ['finals_pct', 'Finals'],
              ['playoff_pct', 'Playoffs'],
              ['projected_wins', 'Wins'],
            ] as const).map(([col, label]) => (
              <button key={col} onClick={() => setSortCol(col)} style={{
                background: sortCol === col ? '#1a1a1a' : '#0a0a0a',
                border: '1px solid #1a1a1a', color: sortCol === col ? '#e8e8e8' : '#444',
                padding: '6px 12px', fontSize: '11px', fontFamily: 'IBM Plex Mono, monospace',
                cursor: 'pointer',
              }}>{label}</button>
            ))}
          </div>

          {/* Table */}
          <div style={{ border: '1px solid #1a1a1a' }}>
            {/* Header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '32px 70px 55px 80px 80px 1fr 1fr 1fr 1fr',
              padding: '10px 16px', borderBottom: '1px solid #1a1a1a',
              fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.06em',
            }}>
              <span>#</span>
              <span>TEAM</span>
              <span>CONF</span>
              <span>NOW</span>
              <span>PROJ W</span>
              <span>PLAYOFFS</span>
              <span>CONF FINALS</span>
              <span>FINALS</span>
              <span>🏆 CHAMP</span>
            </div>

            {filtered.map((r, i) => {
              const confColor = CONF_COLORS[r.conference] || '#888'
              const isEliminated = r.playoff_pct < 1
              return (
                <div key={r.team} style={{
                  display: 'grid',
                  gridTemplateColumns: '32px 70px 55px 80px 80px 1fr 1fr 1fr 1fr',
                  padding: '12px 16px',
                  borderBottom: i < filtered.length - 1 ? '1px solid #0d0d0d' : 'none',
                  alignItems: 'center',
                  opacity: isEliminated ? 0.4 : 1,
                  background: r.champion_pct > 15 ? '#0a150a' : 'transparent',
                }}>
                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#333' }}>{i + 1}</span>
                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '14px', fontWeight: 700, color: '#e0e0e0' }}>{r.team}</span>
                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: confColor }}>{r.conference}</span>
                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#555' }}>
                    {r.current_wins}-{r.current_losses}
                  </span>
                  <div>
                    <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#888' }}>
                      {r.projected_wins}W
                    </span>
                    <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#333', marginLeft: '4px' }}>
                      ({r.net_rtg > 0 ? '+' : ''}{r.net_rtg})
                    </span>
                  </div>
                  <PctBar pct={r.playoff_pct} max={maxPlayoff} color='#3b82f6' />
                  <PctBar pct={r.conf_finals_pct} max={50} color='#8b5cf6' />
                  <PctBar pct={r.finals_pct} max={maxFinals} color='#f97316' />
                  <PctBar pct={r.champion_pct} max={maxChamp} color='#fbbf24' />
                </div>
              )
            })}
          </div>

          <div style={{ marginTop: '16px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#2a2a2a', lineHeight: 1.8 }}>
            <div>Methodology: exponential decay team ratings (λ=0.015) · win prob via logistic model · play-in included · {data.n_sims.toLocaleString()} Monte Carlo iterations</div>
            <div>Teams with playoff_pct &lt; 1% shown faded · Re-run for fresh simulation</div>
          </div>
        </>
      )}
    </div>
  )
}
