'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const MONO = 'IBM Plex Mono, monospace'

interface Player {
  player_name: string
  team_abbr:   string
  position:    string | null
  gp:          number
  mpg:         number | null
  ppg:         number | null
  rpg:         number | null
  apg:         number | null
  spg:         number | null
  bpg:         number | null
  fg3m:        number | null
  tov:         number | null
  fg_pct:      number | null
  efg_pct:     number | null
  fg3_pct_est: number | null
}

interface GameLog {
  game_date:     string
  opponent_abbr: string
  pts:           number
  reb:           number
  ast:           number
  fg3m:          number
  stl:           number
  blk:           number
  minutes:       number
  is_home:       boolean
}

const SORT_OPTIONS = [
  { key: 'ppg',    label: 'PTS' },
  { key: 'rpg',    label: 'REB' },
  { key: 'apg',    label: 'AST' },
  { key: 'spg',    label: 'STL' },
  { key: 'bpg',    label: 'BLK' },
  { key: 'fg3m',   label: '3PM' },
  { key: 'fg_pct', label: 'FG%' },
  { key: 'tov',    label: 'TOV' },
  { key: 'mpg',    label: 'MIN' },
  { key: 'gp',     label: 'GP'  },
  { key: 'efg_pct',     label: 'eFG%' },
  { key: 'fg3_pct_est', label: '3P%*' },
]

// ─── Radar ────────────────────────────────────────────────────────────────────

function RadarChart({ player }: { player: Player }) {
  const AXES = [
    { key: 'ppg',  label: 'PTS', max: 35 },
    { key: 'rpg',  label: 'REB', max: 14 },
    { key: 'apg',  label: 'AST', max: 12 },
    { key: 'spg',  label: 'STL', max: 3  },
    { key: 'bpg',  label: 'BLK', max: 3  },
    { key: 'fg3m', label: '3PM', max: 5  },
  ]
  const N = AXES.length
  const CX = 120, CY = 115, R = 80
  const angle = (i: number) => (Math.PI * 2 * i) / N - Math.PI / 2
  const gridPts = (r: number) =>
    AXES.map((_, i) => `${(CX + R * r * Math.cos(angle(i))).toFixed(1)},${(CY + R * r * Math.sin(angle(i))).toFixed(1)}`).join(' ')
  const dataPts = AXES.map((ax, i) => {
    const v = Math.min(1, Math.max(0, (Number(player[ax.key as keyof Player]) || 0) / ax.max))
    return `${(CX + R * v * Math.cos(angle(i))).toFixed(1)},${(CY + R * v * Math.sin(angle(i))).toFixed(1)}`
  })

  return (
    <svg viewBox="0 0 240 230" style={{ width: '100%', maxWidth: '260px' }}>
      {[0.25, 0.5, 0.75, 1.0].map(r => (
        <polygon key={r} points={gridPts(r)} fill="none"
          stroke={r === 1.0 ? '#222' : '#111'} strokeWidth={r === 1.0 ? 1 : 0.5} />
      ))}
      {AXES.map((_, i) => (
        <line key={i} x1={CX} y1={CY}
          x2={(CX + R * Math.cos(angle(i))).toFixed(1)}
          y2={(CY + R * Math.sin(angle(i))).toFixed(1)}
          stroke="#111" strokeWidth="0.5" />
      ))}
      <polygon points={dataPts.join(' ')} fill="rgba(74,222,128,0.1)" stroke="#4ade80" strokeWidth="1.5" />
      {dataPts.map((pt, i) => {
        const [x, y] = pt.split(',')
        return <circle key={i} cx={x} cy={y} r="2.5" fill="#4ade80" />
      })}
      {AXES.map((ax, i) => {
        const lx = (CX + (R + 16) * Math.cos(angle(i))).toFixed(1)
        const ly = (CY + (R + 16) * Math.sin(angle(i))).toFixed(1)
        return (
          <g key={ax.key}>
            <text x={lx} y={String(Number(ly) - 4)} textAnchor="middle"
              fontSize="7" fill="#444" fontFamily={MONO}>{ax.label}</text>
            <text x={lx} y={String(Number(ly) + 7)} textAnchor="middle"
              fontSize="9" fill="#e0e0e0" fontFamily={MONO} fontWeight="700">
              {Number(player[ax.key as keyof Player]) || 0}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ vals, color = '#4ade80' }: { vals: number[]; color?: string }) {
  if (vals.length < 2) return null
  const w = 120, h = 32
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1
  const pts = vals.map((v, i) =>
    `${((i / (vals.length - 1)) * w).toFixed(1)},${(h - ((v - min) / range) * (h - 6) - 3).toFixed(1)}`
  ).join(' ')
  return (
    <svg width={w} height={h} style={{ overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
      <circle cx={w} cy={(h - ((vals[vals.length-1]-min)/range)*(h-6)-3).toFixed(1)} r="2.5" fill={color} />
    </svg>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function PlayerModal({ player, onClose }: { player: Player; onClose: () => void }) {
  const [gamelog, setGamelog] = useState<GameLog[]>([])
  const [logLoading, setLogLoading] = useState(true)
  const [tab, setTab] = useState('radar')

  useEffect(() => {
    fetch(`${API}/props/player/profile?name=${encodeURIComponent(player.player_name)}`)
      .then(r => r.json())
      .then(d => setGamelog((d.game_logs || []).slice(0, 20)))
      .catch(() => {})
      .finally(() => setLogLoading(false))
  }, [player.player_name])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const reversed = [...gamelog].reverse()
  const ptsVals = reversed.map(g => g.pts)
  const rebVals = reversed.map(g => g.reb)
  const astVals = reversed.map(g => g.ast)

  const STATS = [
    { key: 'ppg', label: 'PTS' }, { key: 'rpg', label: 'REB' },
    { key: 'apg', label: 'AST' }, { key: 'spg', label: 'STL' },
    { key: 'bpg', label: 'BLK' }, { key: 'fg3m', label: '3PM' },
    { key: 'fg_pct', label: 'FG%' }, { key: 'tov', label: 'TOV' },
    { key: 'mpg', label: 'MIN' }, { key: 'gp', label: 'GP' },
  ]

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px', backdropFilter: 'blur(4px)' }}>
      <div style={{ background: '#141418', border: '1px solid #1a1a1a', borderRadius: '6px',
        width: '100%', maxWidth: '900px', maxHeight: '90vh', overflow: 'auto', fontFamily: MONO }}>

        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #222228',
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '9px', color: '#787672', letterSpacing: '0.15em', marginBottom: '6px' }}>
              {player.team_abbr} · {player.position || '—'} · {player.gp}G
            </div>
            <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#e0e0e0', margin: 0 }}>
              {player.player_name}
            </h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none',
            cursor: 'pointer', color: '#787672', fontSize: '20px', padding: '4px', lineHeight: 1 }}>
            ×
          </button>
        </div>

        {/* Stat strip */}
        <div style={{ display: 'flex', flexWrap: 'wrap', borderBottom: '1px solid #222228' }}>
          {STATS.map(s => {
            const v = player[s.key as keyof Player]
            const d = (s.key === 'fg_pct' || s.key === 'efg_pct' || s.key === 'fg3_pct_est') && v != null ? `${v}%` : v ?? '—'
            return (
              <div key={s.key} style={{ padding: '12px 14px', borderRight: '1px solid #0d0d0d',
                minWidth: '64px', textAlign: 'center', flex: 1 }}>
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#e0e0e0', marginBottom: '3px' }}>
                  {String(d)}
                </div>
                <div style={{ fontSize: '8px', color: '#787672', letterSpacing: '0.1em' }}>{s.label}</div>
              </div>
            )
          })}
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid #222228' }}>
          {[['radar', 'RADAR CHART'], ['gamelog', 'GAME LOG']].map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '10px 20px', fontFamily: MONO, fontSize: '10px',
              color: tab === t ? '#e0e0e0' : '#333',
              borderBottom: tab === t ? '2px solid #4ade80' : '2px solid transparent',
              letterSpacing: '0.08em',
            }}>{label}</button>
          ))}
        </div>

        <div style={{ padding: '24px' }}>
          {tab === 'radar' && (
            <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '32px', alignItems: 'start' }}>
              <RadarChart player={player} />
              <div>
                <div style={{ fontSize: '9px', color: '#55534f', letterSpacing: '0.15em', marginBottom: '16px' }}>
                  LAST 20 GAMES — TREND
                </div>
                {[
                  { label: 'PTS', vals: ptsVals, color: '#60a5fa' },
                  { label: 'REB', vals: rebVals, color: '#34d399' },
                  { label: 'AST', vals: astVals, color: '#fbbf24' },
                ].map(({ label, vals, color }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '16px',
                    marginBottom: '14px', padding: '10px 0', borderBottom: '1px solid #1f1f24' }}>
                    <span style={{ fontSize: '9px', color: '#787672', letterSpacing: '0.1em', width: '28px' }}>
                      {label}
                    </span>
                    <Sparkline vals={vals} color={color} />
                    {vals.length > 0 && (
                      <>
                        <span style={{ fontSize: '15px', fontWeight: 700, color, marginLeft: '8px' }}>
                          {vals[vals.length - 1]}
                        </span>
                        <span style={{ fontSize: '9px', color: '#787672' }}>last</span>
                        {vals.length > 1 && (
                          <span style={{ fontSize: '11px',
                            color: vals[vals.length-1] > vals[vals.length-2] ? '#4ade80' : '#f87171' }}>
                            {vals[vals.length-1] > vals[vals.length-2] ? '↑' : '↓'}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                ))}
                <div style={{ marginTop: '12px', fontSize: '8px', color: '#55534f', lineHeight: 1.8 }}>
                  Radar normalized to position-adjusted maximums · Sparklines oldest→newest
                </div>
              </div>
            </div>
          )}

          {tab === 'gamelog' && (
            logLoading ? (
              <div style={{ padding: '40px', textAlign: 'center', fontSize: '11px', color: '#55534f' }}>Loading...</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <div style={{ display: 'grid',
                  gridTemplateColumns: '90px 60px 50px 55px 55px 55px 50px 50px 50px',
                  padding: '6px 0', fontSize: '8px', color: '#55534f',
                  letterSpacing: '0.1em', borderBottom: '1px solid #222228', minWidth: '520px' }}>
                  <span>DATE</span><span>OPP</span><span>MIN</span>
                  <span>PTS</span><span>REB</span><span>AST</span>
                  <span>STL</span><span>BLK</span><span>3PM</span>
                </div>
                {gamelog.map((g, i) => (
                  <div key={i} style={{ display: 'grid',
                    gridTemplateColumns: '90px 60px 50px 55px 55px 55px 50px 50px 50px',
                    padding: '8px 0', borderBottom: '1px solid #1f1f24',
                    minWidth: '520px', background: i % 2 === 0 ? 'transparent' : '#080808' }}>
                    <span style={{ fontSize: '9px', color: '#787672' }}>{String(g.game_date).slice(5)}</span>
                    <span style={{ fontSize: '10px', color: '#787672' }}>{g.is_home ? '' : '@'}{g.opponent_abbr}</span>
                    <span style={{ fontSize: '10px', color: '#909090' }}>{Math.round(g.minutes)}</span>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: '#e0e0e0' }}>{g.pts}</span>
                    <span style={{ fontSize: '12px', color: '#888' }}>{g.reb}</span>
                    <span style={{ fontSize: '12px', color: '#888' }}>{g.ast}</span>
                    <span style={{ fontSize: '11px', color: '#909090' }}>{g.stl}</span>
                    <span style={{ fontSize: '11px', color: '#909090' }}>{g.blk}</span>
                    <span style={{ fontSize: '11px', color: '#909090' }}>{g.fg3m}</span>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProfilesPage() {
  const [players,    setPlayers]    = useState<Player[]>([])
  const [loading,    setLoading]    = useState(true)
  const [search,     setSearch]     = useState('')
  const [sortKey,    setSortKey]    = useState('ppg')
  const [sortDir,    setSortDir]    = useState<'desc' | 'asc'>('desc')
  const [selected,   setSelected]   = useState<Player | null>(null)
  const [teamFilter, setTeamFilter] = useState('ALL')

  useEffect(() => {
    fetch(`${API}/props/players/list`)
      .then(r => r.json())
      .then(d => setPlayers(d.players || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const teams = useMemo(() =>
    ['ALL', ...players.map(p => p.team_abbr).filter((v, i, a) => a.indexOf(v) === i).sort()],
    [players]
  )

  const filtered = useMemo(() => {
    let list = [...players]
    if (search) list = list.filter(p => p.player_name.toLowerCase().includes(search.toLowerCase()))
    if (teamFilter !== 'ALL') list = list.filter(p => p.team_abbr === teamFilter)
    list.sort((a, b) => {
      const av = (a[sortKey as keyof Player] as number) ?? (sortDir === 'desc' ? -Infinity : Infinity)
      const bv = (b[sortKey as keyof Player] as number) ?? (sortDir === 'desc' ? -Infinity : Infinity)
      return sortDir === 'desc' ? bv - av : av - bv
    })
    return list
  }, [players, search, sortKey, sortDir, teamFilter])

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0e0e12', color: '#888', fontFamily: MONO }}>
      {selected && <PlayerModal player={selected} onClose={() => setSelected(null)} />}

      <div style={{ borderBottom: '1px solid #0f0f0f', padding: '12px 24px',
        display: 'flex', alignItems: 'center', gap: '16px' }}>
        <Link href="/" style={{ color: '#787672', textDecoration: 'none', fontSize: '11px' }}>← HOME</Link>
        <span style={{ color: '#55534f' }}>·</span>
        <span style={{ color: '#787672', fontSize: '11px', letterSpacing: '0.1em' }}>PLAYER PROFILES · 2025–26</span>
        {!loading && <span style={{ color: '#55534f', fontSize: '11px' }}>{filtered.length} players</span>}
      </div>

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '28px 24px' }}>
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontSize: '26px', fontWeight: 700, color: '#e0e0e0', margin: '0 0 16px' }}>
            Player Profiles
          </h1>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search player..."
              style={{ padding: '8px 12px', background: '#141418', border: '1px solid #1a1a1a',
                borderRadius: '4px', outline: 'none', fontFamily: MONO, fontSize: '12px',
                color: '#e0e0e0', width: '200px' }} />
            <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)}
              style={{ padding: '8px 10px', background: '#141418', border: '1px solid #1a1a1a',
                borderRadius: '4px', outline: 'none', fontFamily: MONO, fontSize: '11px',
                color: '#888', cursor: 'pointer' }}>
              {teams.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <span style={{ fontSize: '10px', color: '#55534f', marginLeft: 'auto' }}>
              Click any row → radar chart + game log
            </span>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: '60px', textAlign: 'center', fontSize: '11px', color: '#55534f' }}>Loading players...</div>
        ) : (
          <div style={{ background: '#141418', border: '1px solid #222228', borderRadius: '6px', overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #222228' }}>
                  <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: '9px',
                    color: '#55534f', letterSpacing: '0.12em', fontWeight: 400,
                    position: 'sticky', left: 0, background: '#141418' }}>PLAYER</th>
                  <th style={{ padding: '10px 8px', fontSize: '9px', color: '#55534f',
                    fontWeight: 400, textAlign: 'center' }}>TEAM</th>
                  <th style={{ padding: '10px 8px', fontSize: '9px', color: '#55534f',
                    fontWeight: 400, textAlign: 'center' }}>POS</th>
                  {SORT_OPTIONS.map(s => (
                    <th key={s.key} onClick={() => toggleSort(s.key)} style={{
                      padding: '10px 12px', fontSize: '9px', fontWeight: 400,
                      textAlign: 'right', cursor: 'pointer', userSelect: 'none',
                      color: sortKey === s.key ? '#c8f135' : '#787672', whiteSpace: 'nowrap',
                    }}>
                      {s.label}{sortKey === s.key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => (
                  <tr key={`${p.player_name}-${i}`} onClick={() => setSelected(p)}
                    style={{ borderBottom: '1px solid #1f1f24', cursor: 'pointer',
                      background: i % 2 === 0 ? 'transparent' : '#080808' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#0f0f0f')}
                    onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : '#080808')}>
                    <td style={{ padding: '10px 16px', fontSize: '12px', fontWeight: 600,
                      color: '#e0e0e0', whiteSpace: 'nowrap', position: 'sticky',
                      left: 0, background: 'inherit' }}>{p.player_name}</td>
                    <td style={{ padding: '10px 8px', fontSize: '10px', color: '#787672', textAlign: 'center' }}>
                      {p.team_abbr}
                    </td>
                    <td style={{ padding: '10px 8px', fontSize: '10px', color: '#787672', textAlign: 'center' }}>
                      {p.position || '—'}
                    </td>
                    {SORT_OPTIONS.map(s => {
                      const v = p[s.key as keyof Player]
                      const d = (s.key === 'fg_pct' || s.key === 'efg_pct' || s.key === 'fg3_pct_est') && v != null ? `${v}%` : v ?? '—'
                      return (
                        <td key={s.key} style={{ padding: '10px 12px', textAlign: 'right',
                          fontSize: sortKey === s.key ? '12px' : '11px',
                          fontWeight: sortKey === s.key ? 700 : 400,
                          color: sortKey === s.key ? '#f2f0eb' : '#b0aea8' }}>
                          {String(d)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ marginTop: '16px', fontSize: '9px', color: '#55534f' }}>
          Min 5 games · 2025-26 regular season
        </div>
      </div>
    </div>
  )
}
