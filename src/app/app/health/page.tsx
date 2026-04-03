'use client'

import { useEffect, useState } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface HealthData {
  status: string
  as_of: string
  freshness: {
    status: string
    latest_game_date: string
    days_since_update: number
    first_game_date: string
  }
  volume: {
    games_completed: number
    games_scheduled: number
    total_plays: number
    total_stints: number
    total_players: number
    teams: number
    avg_plays_per_game: number
    season_progress_pct: number
  }
  coverage: {
    games_with_plays: number
    games_missing_plays: number
    games_with_stints: number
    play_coverage_pct: number
    stint_coverage_pct: number
  }
  team_coverage: {
    team: string
    completed: number
    total: number
    latest: string
  }[]
  etl_runs: {
    run_id: number
    started_at: string
    finished_at: string
    status: string
    games_processed: number
    plays_processed: number
    stints_processed: number
    errors: number
    duration_seconds: number
    latest_game_date: string
  }[]
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'fresh' ? '#4ade80' : status === 'stale_1d' ? '#fbbf24' : '#f87171'
  const label = status === 'fresh' ? 'LIVE' : status === 'stale_1d' ? 'STALE 1D' : 'STALE'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block',
        boxShadow: `0 0 6px ${color}`, animation: status === 'fresh' ? 'pulse 2s infinite' : 'none' }} />
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color }}>{label}</span>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
    </span>
  )
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div style={{ border: '1px solid #1a1a1a', padding: '16px 20px' }}>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#909090', letterSpacing: '0.1em', marginBottom: '6px' }}>{label}</div>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '22px', fontWeight: 700, color: '#e0e0e0' }}>{value}</div>
      {sub && <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#909090', marginTop: '4px' }}>{sub}</div>}
    </div>
  )
}

function CoverageBar({ label, pct, count, total, color }: {
  label: string; pct: number; count: number; total: number; color: string
}) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#666' }}>{label}</span>
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color }}>
          {count.toLocaleString()} / {total.toLocaleString()} ({pct.toFixed(1)}%)
        </span>
      </div>
      <div style={{ height: '6px', background: '#111', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: color, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  )
}

function RunRow({ run }: { run: HealthData['etl_runs'][0] }) {
  const isSuccess = run.status === 'success'
  const dt = run.started_at ? new Date(run.started_at).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }) : '—'
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '140px 80px 80px 80px 80px 80px 1fr',
      padding: '9px 16px', borderBottom: '1px solid #1f1f24',
      alignItems: 'center',
    }}>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#b0aea8' }}>{dt}</span>
      <span style={{
        fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px',
        color: isSuccess ? '#4ade80' : '#f87171',
        padding: '1px 6px', background: isSuccess ? 'rgba(74,222,128,0.05)' : 'rgba(248,113,113,0.05)',
        border: `1px solid ${isSuccess ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)'}`,
        width: 'fit-content',
      }}>
        {run.status}
      </span>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#b0aea8' }}>
        {run.games_processed ?? 0}G
      </span>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#b0aea8' }}>
        {(run.plays_processed ?? 0).toLocaleString()}P
      </span>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#b0aea8' }}>
        {(run.stints_processed ?? 0).toLocaleString()}S
      </span>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: run.errors > 0 ? '#f87171' : '#333' }}>
        {run.errors ?? 0} err
      </span>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#909090' }}>
        {run.duration_seconds ? `${run.duration_seconds.toFixed(1)}s` : '—'}
      </span>
    </div>
  )
}

export default function HealthPage() {
  const [data, setData] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const fetchHealth = () => {
    setLoading(true)
    fetch(`${API}/health`)
      .then(r => r.json())
      .then(d => { setData(d); setLastRefresh(new Date()) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, 60000) // refresh every 60s
    return () => clearInterval(interval)
  }, [])

  if (loading && !data) return (
    <div style={{ padding: '48px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#909090' }}>
      Loading pipeline health...
    </div>
  )

  if (!data) return (
    <div style={{ padding: '48px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#f87171' }}>
      Could not reach API
    </div>
  )

  const { freshness, volume, coverage, team_coverage, etl_runs } = data

  // Season progress bar
  const seasonPct = volume.season_progress_pct

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#909090', letterSpacing: '0.12em', marginBottom: '6px' }}>
            PIPELINE OBSERVABILITY · 2025–26 NBA
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: 400, color: '#f0f0f0', marginBottom: '8px' }}>Data Health</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <StatusDot status={freshness.status} />
          <button onClick={fetchHealth} style={{
            background: 'transparent', border: '1px solid #222', color: '#b0aea8',
            padding: '5px 12px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', cursor: 'pointer',
          }}>↺ Refresh</button>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#909090' }}>
            {lastRefresh.toLocaleTimeString()}
          </span>
        </div>
      </div>

      {/* Season progress */}
      <div style={{ border: '1px solid #1a1a1a', padding: '16px 20px', marginBottom: '1px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#909090', letterSpacing: '0.08em' }}>
            2025–26 SEASON PROGRESS
          </span>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#888' }}>
            {volume.games_completed} / 1,230 games · {seasonPct}%
          </span>
        </div>
        <div style={{ height: '8px', background: '#141418', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${seasonPct}%`, background: '#4ade80', transition: 'width 0.6s ease' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#909090' }}>
          <span>Oct 22</span>
          <span>Latest game: {freshness.latest_game_date || '—'}</span>
          <span>Apr 14 (reg. season end)</span>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', marginBottom: '1px' }}>
        <StatCard label="GAMES INGESTED" value={volume.games_completed.toLocaleString()} sub={`${volume.games_scheduled} remaining`} />
        <StatCard label="PLAY-BY-PLAY EVENTS" value={volume.total_plays.toLocaleString()} sub={`~${Math.round(volume.avg_plays_per_game)} per game`} />
        <StatCard label="STINTS RECONSTRUCTED" value={volume.total_stints.toLocaleString()} sub="5-man lineup segments" />
        <StatCard label="PLAYERS TRACKED" value={volume.total_players.toLocaleString()} sub={`across ${volume.teams} teams`} />
      </div>

      {/* Coverage */}
      <div style={{ border: '1px solid #1a1a1a', padding: '20px', marginBottom: '1px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#909090', letterSpacing: '0.1em', marginBottom: '16px' }}>
          DATA COVERAGE
        </div>
        <CoverageBar
          label="Play-by-play coverage"
          pct={coverage.play_coverage_pct}
          count={coverage.games_with_plays}
          total={volume.games_completed}
          color="#4ade80"
        />
        <CoverageBar
          label="Stint reconstruction coverage"
          pct={coverage.stint_coverage_pct}
          count={coverage.games_with_stints}
          total={volume.games_completed}
          color="#3b82f6"
        />
        {coverage.games_missing_plays > 0 && (
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#f87171', marginTop: '8px' }}>
            ⚠ {coverage.games_missing_plays} completed games missing play-by-play data
          </div>
        )}
      </div>

      {/* Freshness */}
      <div style={{ border: '1px solid #1a1a1a', padding: '20px', marginBottom: '1px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#909090', letterSpacing: '0.1em', marginBottom: '12px' }}>
          DATA FRESHNESS
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          <div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#909090', marginBottom: '4px' }}>LATEST GAME INGESTED</div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '14px', color: '#e0e0e0' }}>{freshness.latest_game_date || '—'}</div>
          </div>
          <div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#909090', marginBottom: '4px' }}>DAYS SINCE UPDATE</div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '14px', color: freshness.days_since_update <= 1 ? '#4ade80' : freshness.days_since_update <= 2 ? '#fbbf24' : '#f87171' }}>
              {freshness.days_since_update ?? '—'}d
            </div>
          </div>
          <div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#909090', marginBottom: '4px' }}>ETL SCHEDULE</div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '14px', color: '#888' }}>Daily · 8AM UTC</div>
          </div>
        </div>
      </div>

      {/* ETL run log */}
      <div style={{ border: '1px solid #1a1a1a', marginBottom: '1px' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #222228', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#909090', letterSpacing: '0.1em' }}>
          ETL RUN HISTORY
        </div>
        {etl_runs.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#909090' }}>
            No ETL runs logged yet. Runs will appear here after the next daily ETL.
          </div>
        ) : (
          <>
            <div style={{
              display: 'grid', gridTemplateColumns: '140px 80px 80px 80px 80px 80px 1fr',
              padding: '8px 16px', borderBottom: '1px solid #222228',
              fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#909090', letterSpacing: '0.06em',
            }}>
              <span>STARTED</span><span>STATUS</span><span>GAMES</span>
              <span>PLAYS</span><span>STINTS</span><span>ERRORS</span><span>DURATION</span>
            </div>
            {etl_runs.map(run => <RunRow key={run.run_id} run={run} />)}
          </>
        )}
      </div>

      {/* Per-team coverage */}
      <div style={{ border: '1px solid #1a1a1a' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #222228', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#909090', letterSpacing: '0.1em' }}>
          PER-TEAM GAME COVERAGE
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1px', background: '#111' }}>
          {team_coverage.map(t => {
            const pct = t.total > 0 ? t.completed / t.total : 0
            const color = pct > 0.95 ? '#4ade80' : pct > 0.8 ? '#fbbf24' : '#f87171'
            return (
              <div key={t.team} style={{ background: '#141418', padding: '10px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', fontWeight: 700, color: '#e0e0e0' }}>{t.team}</span>
                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color }}>{t.completed}/{t.total}</span>
                </div>
                <div style={{ height: '3px', background: '#111', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct * 100}%`, background: color }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ marginTop: '16px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#787672', lineHeight: 1.8 }}>
        <div>ETL runs daily at 8AM UTC via GitHub Actions · data sourced from ESPN play-by-play API</div>
        <div>Auto-refreshes every 60 seconds · last refreshed {lastRefresh.toLocaleTimeString()}</div>
      </div>
    </div>
  )
}
