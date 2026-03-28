'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const STATS = ['pts','reb','ast','fg3m','stl','blk']
const STAT_LABEL: Record<string,string> = {
  pts:'PTS', reb:'REB', ast:'AST', fg3m:'3PM', stl:'STL', blk:'BLK'
}
const STAT_COLOR: Record<string,string> = {
  pts:'#60a5fa', reb:'#34d399', ast:'#f59e0b',
  fg3m:'#a78bfa', stl:'#f87171', blk:'#fb923c'
}

interface StatSummary {
  avg_season: number | null
  avg_l5:     number | null
  avg_l10:    number | null
  std:        number | null
  n_games:    number
}

interface HitRate {
  line:   number
  season: number | null
  l10:    number | null
}

interface TodayProp {
  stat:        string
  odds_type:   string
  line:        number
  edge:        number
  pick_side:   string
  score_label: string
  model_details: Record<string, any>
}

interface GameLog {
  game_date:    string
  minutes:      number
  pts:          number
  reb:          number
  ast:          number
  fg3m:         number
  stl:          number
  blk:          number
  is_home:      boolean
  opponent_abbr: string
}

interface Profile {
  player_name:  string
  team:         string
  position:     string
  games_played: number
  stat_summary: Record<string, StatSummary>
  hit_rates:    Record<string, HitRate>
  todays_props: TodayProp[]
  game_logs:    GameLog[]
}

// Mini sparkline using inline SVG
function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (!values || values.length < 2) return <span style={{ color: '#333', fontSize: '10px' }}>—</span>
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const w = 80, h = 28
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = h - ((v - min) / range) * h
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" opacity={0.8} />
      <circle cx={(values.length-1)/(values.length-1)*w}
              cy={h - ((values[values.length-1] - min)/range)*h}
              r="2.5" fill={color} />
    </svg>
  )
}

function HitBar({ pct, side }: { pct: number | null; side: 'over' | 'under' }) {
  if (pct == null) return <span style={{ color: '#333', fontSize: '10px' }}>—</span>
  const good = side === 'over' ? pct >= 60 : pct <= 40
  const color = good ? '#4ade80' : pct >= 50 ? '#fbbf24' : '#f87171'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <div style={{ width: '60px', height: '4px', background: '#111', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '2px' }} />
      </div>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color }}>{pct}%</span>
    </div>
  )
}

export default function PlayerProfilePage({ params }: { params: { slug: string } }) {
  const slug     = params?.slug || ''
  const nameStr  = decodeURIComponent(slug).replace(/-/g, ' ')

  const [profile,  setProfile]  = useState<Profile | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [activeStat, setActiveStat] = useState<string>('pts')

  useEffect(() => {
    if (!nameStr) return
    setLoading(true)
    fetch(`${API}/props/player/profile?name=${encodeURIComponent(nameStr)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setLoading(false); return }
        setProfile(d)
        setLoading(false)
      })
      .catch(() => { setError('Failed to load profile'); setLoading(false) })
  }, [nameStr])

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#080808', display: 'flex',
      alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#333', fontSize: '13px',
        letterSpacing: '0.1em' }}>LOADING PROFILE...</div>
    </div>
  )

  if (error || !profile) return (
    <div style={{ minHeight: '100vh', background: '#080808', display: 'flex',
      alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px' }}>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#f87171', fontSize: '13px' }}>
        {error || 'Player not found'}
      </div>
      <Link href="/props" style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
        color: '#4ade80', textDecoration: 'none' }}>← back to props board</Link>
    </div>
  )

  const statSum  = profile.stat_summary[activeStat]
  const hitRate  = profile.hit_rates[activeStat]
  const todayProp = profile.todays_props.find(p => p.stat === activeStat && p.odds_type === 'standard')
  const recentVals = profile.game_logs
    .slice(0, 20)
    .map(g => g[activeStat as keyof GameLog] as number)
    .filter(v => v != null)
    .reverse()

  return (
    <div style={{ minHeight: '100vh', background: '#080808', color: '#e0e0e0',
      fontFamily: 'IBM Plex Mono, monospace' }}>

      {/* Header */}
      <div style={{ borderBottom: '1px solid #111', padding: '12px 24px',
        display: 'flex', alignItems: 'center', gap: '16px' }}>
        <Link href="/props" style={{ color: '#333', textDecoration: 'none',
          fontSize: '11px', letterSpacing: '0.05em' }}>← PROPS</Link>
        <span style={{ color: '#1a1a1a' }}>·</span>
        <span style={{ color: '#555', fontSize: '11px', letterSpacing: '0.1em' }}>PLAYER PROFILE</span>
      </div>

      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '32px 24px' }}>

        {/* Player Header */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
          marginBottom: '40px', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ fontSize: '11px', color: '#333', letterSpacing: '0.15em',
              marginBottom: '8px' }}>
              {profile.team} · {profile.position || '—'} · {profile.games_played}G THIS SEASON
            </div>
            <h1 style={{ fontSize: '36px', fontWeight: 700, color: '#e8e8e8',
              letterSpacing: '-0.02em', margin: 0, fontFamily: 'IBM Plex Mono, monospace' }}>
              {profile.player_name}
            </h1>
          </div>

          {/* Today's props summary */}
          {profile.todays_props.length > 0 && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {profile.todays_props.filter(p => p.odds_type === 'standard').map(p => {
                const edgeColor = p.edge > 0 ? '#4ade80' : '#f87171'
                return (
                  <div key={p.stat} onClick={() => setActiveStat(p.stat)}
                    style={{ cursor: 'pointer', padding: '8px 12px', background: '#0d0d0d',
                      border: `1px solid ${activeStat === p.stat ? edgeColor : '#1a1a1a'}`,
                      borderRadius: '4px', transition: 'border-color 0.15s' }}>
                    <div style={{ fontSize: '9px', color: '#444', letterSpacing: '0.1em', marginBottom: '4px' }}>
                      {STAT_LABEL[p.stat]}
                    </div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#e0e0e0' }}>{p.line}</div>
                    <div style={{ fontSize: '9px', color: edgeColor, marginTop: '2px' }}>
                      {p.pick_side.toUpperCase()} {p.edge > 0 ? '+' : ''}{p.edge}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Stat tabs */}
        <div style={{ display: 'flex', gap: '2px', marginBottom: '32px',
          borderBottom: '1px solid #111', paddingBottom: '0' }}>
          {STATS.map(s => (
            <button key={s} onClick={() => setActiveStat(s)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '8px 16px', fontSize: '11px', letterSpacing: '0.08em',
              color: activeStat === s ? STAT_COLOR[s] : '#333',
              borderBottom: activeStat === s ? `2px solid ${STAT_COLOR[s]}` : '2px solid transparent',
              marginBottom: '-1px', transition: 'color 0.15s',
            }}>{STAT_LABEL[s]}</button>
          ))}
        </div>

        {/* Main content grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px',
          marginBottom: '32px' }}>

          {/* Season averages */}
          <div style={{ background: '#0a0a0a', border: '1px solid #111',
            borderRadius: '6px', padding: '20px' }}>
            <div style={{ fontSize: '9px', color: '#333', letterSpacing: '0.15em',
              marginBottom: '16px' }}>AVERAGES</div>
            {[
              ['SEASON', statSum?.avg_season],
              ['LAST 10', statSum?.avg_l10],
              ['LAST 5',  statSum?.avg_l5],
            ].map(([label, val]) => (
              <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', padding: '8px 0',
                borderBottom: '1px solid #0d0d0d' }}>
                <span style={{ fontSize: '10px', color: '#444' }}>{label}</span>
                <span style={{ fontSize: '18px', fontWeight: 700,
                  color: val != null ? STAT_COLOR[activeStat] : '#222' }}>
                  {val ?? '—'}
                </span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', padding: '8px 0' }}>
              <span style={{ fontSize: '10px', color: '#444' }}>STD DEV</span>
              <span style={{ fontSize: '14px', color: '#333' }}>±{statSum?.std ?? '—'}</span>
            </div>
          </div>

          {/* Sparkline + today's line */}
          <div style={{ background: '#0a0a0a', border: '1px solid #111',
            borderRadius: '6px', padding: '20px' }}>
            <div style={{ fontSize: '9px', color: '#333', letterSpacing: '0.15em',
              marginBottom: '16px' }}>LAST 20 GAMES</div>
            <div style={{ marginBottom: '16px' }}>
              <Sparkline values={recentVals} color={STAT_COLOR[activeStat]} />
            </div>
            {hitRate && (
              <>
                <div style={{ fontSize: '9px', color: '#333', letterSpacing: '0.1em',
                  marginBottom: '12px' }}>HIT RATE VS LINE {hitRate.line}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '10px', color: '#444' }}>SEASON</span>
                    <HitBar pct={hitRate.season} side="over" />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '10px', color: '#444' }}>L10</span>
                    <HitBar pct={hitRate.l10} side="over" />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Model details */}
          <div style={{ background: '#0a0a0a', border: '1px solid #111',
            borderRadius: '6px', padding: '20px' }}>
            <div style={{ fontSize: '9px', color: '#333', letterSpacing: '0.15em',
              marginBottom: '16px' }}>MODEL PROJECTION</div>
            {todayProp ? (() => {
              const md = todayProp.model_details || {}
              const edgeColor = todayProp.edge > 0 ? '#4ade80' : '#f87171'
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '10px', color: '#444' }}>PROJECTED</span>
                    <span style={{ fontSize: '14px', color: STAT_COLOR[activeStat], fontWeight: 700 }}>
                      {md.predicted_mean ?? '—'} ± {md.predicted_std ?? '—'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '10px', color: '#444' }}>LINE</span>
                    <span style={{ fontSize: '14px', color: '#e0e0e0' }}>{todayProp.line}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '10px', color: '#444' }}>P(OVER)</span>
                    <span style={{ fontSize: '14px', color: edgeColor }}>{md.prob_over_raw ?? '—'}%</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '10px', color: '#444' }}>EDGE</span>
                    <span style={{ fontSize: '14px', color: edgeColor, fontWeight: 700 }}>
                      {todayProp.edge > 0 ? '+' : ''}{todayProp.edge}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '10px', color: '#444' }}>PROJ MIN</span>
                    <span style={{ fontSize: '12px', color: '#555' }}>{md.projected_min ?? '—'}</span>
                  </div>
                  {md.injured_teammates?.length > 0 && (
                    <div style={{ fontSize: '9px', color: '#4ade80', marginTop: '4px',
                      padding: '6px 8px', background: '#4ade8008', borderRadius: '3px',
                      border: '1px solid #4ade8020' }}>
                      ⚡ BOOST: {md.injured_teammates.join(', ')} OUT
                    </div>
                  )}
                  <div style={{ padding: '8px', background: `${edgeColor}08`,
                    border: `1px solid ${edgeColor}20`, borderRadius: '3px', marginTop: '4px' }}>
                    <span style={{ fontSize: '10px', color: edgeColor }}>
                      {todayProp.score_label.toUpperCase()}
                    </span>
                  </div>
                </div>
              )
            })() : (
              <div style={{ fontSize: '11px', color: '#222', marginTop: '8px' }}>
                No prop for {STAT_LABEL[activeStat]} today
              </div>
            )}
          </div>
        </div>

        {/* Game log table */}
        <div style={{ background: '#0a0a0a', border: '1px solid #111', borderRadius: '6px' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #111',
            fontSize: '9px', color: '#333', letterSpacing: '0.15em' }}>
            GAME LOG — LAST 30 GAMES
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #111' }}>
                  {['DATE','OPP','MIN','PTS','REB','AST','3PM','STL','BLK'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', fontSize: '9px', color: '#333',
                      letterSpacing: '0.1em', textAlign: h === 'DATE' || h === 'OPP' ? 'left' : 'right',
                      fontWeight: 400 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {profile.game_logs.map((g, i) => {
                  const activeVal = g[activeStat as keyof GameLog] as number
                  const lineVal = hitRate?.line
                  const hitLine = lineVal != null && activeVal != null && activeVal > lineVal
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid #0d0d0d',
                      background: i % 2 === 0 ? 'transparent' : '#080808' }}>
                      <td style={{ padding: '7px 12px', fontSize: '11px', color: '#444' }}>
                        {g.game_date.slice(5)}
                      </td>
                      <td style={{ padding: '7px 12px', fontSize: '11px', color: '#555' }}>
                        {g.is_home ? 'vs' : '@'} {g.opponent_abbr}
                      </td>
                      <td style={{ padding: '7px 12px', fontSize: '11px', color: '#333',
                        textAlign: 'right' }}>{g.minutes ?? '—'}</td>
                      {['pts','reb','ast','fg3m','stl','blk'].map(s => {
                        const val = g[s as keyof GameLog] as number
                        const isActive = s === activeStat
                        const above = lineVal != null && val != null && val > lineVal
                        return (
                          <td key={s} style={{ padding: '7px 12px', textAlign: 'right',
                            fontSize: isActive ? '12px' : '11px',
                            fontWeight: isActive ? 700 : 400,
                            color: isActive
                              ? (above ? '#4ade80' : val != null && lineVal != null ? '#f87171' : STAT_COLOR[s])
                              : '#333',
                            background: isActive ? '#ffffff05' : 'transparent',
                          }}>{val ?? '—'}</td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}
