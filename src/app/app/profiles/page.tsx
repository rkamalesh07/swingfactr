'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

// ─── Types ────────────────────────────────────────────────────────────────────

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
}

interface Shot {
  x:         number
  y:         number
  made:      boolean
  shot_type: string
  zone:      string
  distance:  number
  date:      string
}

interface ShotData {
  player_name: string
  range:       string
  total:       number
  made:        number
  fg_pct:      number
  shots:       Shot[]
  error?:      string
}

// ─── Sort config ──────────────────────────────────────────────────────────────

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
]

// ─── Basketball court SVG ─────────────────────────────────────────────────────
// Court is 500×470 units. NBA shot coordinates: x in [-250,250], y in [-50,420]



// ─── Hexagonal shot chart ─────────────────────────────────────────────────────

interface HexBin {
  cx:    number
  cy:    number
  shots: Shot[]
  made:  number
}

function hexKey(col: number, row: number) { return `${col},${row}` }

function shotsToHexBins(shots: Shot[], hexR = 18): Map<string, HexBin> {
  const bins = new Map<string, HexBin>()
  const w = hexR * 2
  const h = Math.sqrt(3) * hexR

  for (const s of shots) {
    const col = Math.round(s.x / w)
    const row = Math.round(s.y / h)
    const key = hexKey(col, row)
    const cx  = col * w + (row % 2 === 0 ? 0 : hexR)
    const cy  = row * h

    if (!bins.has(key)) bins.set(key, { cx, cy, shots: [], made: 0 })
    const bin = bins.get(key)!
    bin.shots.push(s)
    if (s.made) bin.made++
  }
  return bins
}

function hexPath(r: number): string {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 6
    return `${r * Math.cos(a)},${r * Math.sin(a)}`
  })
  return `M ${pts.join(' L ')} Z`
}

: { shots: Shot[]; loading: boolean }) {
  const bins = useMemo(() => shotsToHexBins(shots, 16), [shots])
  const maxCount = useMemo(() =>
    Math.max(1, ...Array.from(bins.values()).map(b => b.shots.length)), [bins])

  // scale: viewBox maps court coords
  const VW = 500, VH = 470
  const path = hexPath(14)

  if (loading) return (
    <div style={{ width: '100%', aspectRatio: '500/470', background: '#0a0a0a',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#333' }}>
      Loading shot chart...
    </div>
  )

  if (shots.length === 0) return (
    <div style={{ width: '100%', aspectRatio: '500/470', background: '#0a0a0a',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#2a2a2a' }}>
      No shots found for this range
    </div>
  )

  return (
    <svg viewBox={`${-VW/2} -50 ${VW} ${VH}`} style={{ width: '100%', background: '#080808' }}
      xmlns="http://www.w3.org/2000/svg">
      <CourtSVG />
      {Array.from(bins.values()).map((bin, i) => {
        const freq    = bin.shots.length / maxCount
        const fgPct   = bin.made / bin.shots.length
        // B&W: size by frequency, fill by made/missed
        const opacity = 0.25 + freq * 0.75
        const fill    = fgPct >= 0.5 ? '#e0e0e0' : '#2a2a2a'
        const stroke  = fgPct >= 0.5 ? '#888' : '#1a1a1a'
        const scale   = 0.4 + freq * 0.6
        return (
          <g key={i} transform={`translate(${bin.cx},${bin.cy}) scale(${scale})`} opacity={opacity}>
            <path d={path} fill={fill} stroke={stroke} strokeWidth={1}/>
          </g>
        )
      })}

      {/* Legend */}
      <g transform={`translate(${-VW/2 + 8}, ${VH - 60})`}>
        <rect width={8} height={8} fill="#e0e0e0" stroke="#888" strokeWidth={0.5}/>
        <text x={12} y={8} fill="#555" fontSize={9} fontFamily="IBM Plex Mono, monospace">Above avg FG%</text>
        <rect y={14} width={8} height={8} fill="#2a2a2a" stroke="#1a1a1a" strokeWidth={0.5}/>
        <text x={12} y={22} fill="#555" fontSize={9} fontFamily="IBM Plex Mono, monospace">Below avg FG%</text>
        <text y={38} fill="#444" fontSize={8} fontFamily="IBM Plex Mono, monospace">Size = frequency</text>
      </g>
    </svg>
  )
}

// ─── Radar chart ─────────────────────────────────────────────────────────────

function RadarChart({ player, allPlayers }: { player: Player; allPlayers: Player[] }) {
  const AXES = [
    { key: 'ppg',  label: 'PTS', max: 35 },
    { key: 'rpg',  label: 'REB', max: 14 },
    { key: 'apg',  label: 'AST', max: 12 },
    { key: 'spg',  label: 'STL', max: 3  },
    { key: 'bpg',  label: 'BLK', max: 3  },
    { key: 'fg3m', label: '3PM', max: 5  },
  ]
  const N = AXES.axes?.length ?? AXES.length
  const CX = 120, CY = 110, R = 85

  const angleOf = (i: number) => (Math.PI * 2 * i) / N - Math.PI / 2

  const pts = AXES.map((ax, i) => {
    const val = Math.min(1, (Number(player[ax.key as keyof Player]) || 0) / ax.max)
    const a = angleOf(i)
    return { x: CX + R * val * Math.cos(a), y: CY + R * val * Math.sin(a) }
  })

  const polyPoints = pts.map(p => `${p.x},${p.y}`).join(' ')

  // Grid rings
  const rings = [0.25, 0.5, 0.75, 1.0]

  return (
    <svg viewBox={`0 0 240 220`} style={{ width: '100%', maxWidth: '260px' }}>
      {/* Grid rings */}
      {rings.map(r => {
        const ringPts = AXES.map((_, i) => {
          const a = angleOf(i)
          return `${CX + R * r * Math.cos(a)},${CY + R * r * Math.sin(a)}`
        }).join(' ')
        return <polygon key={r} points={ringPts} fill="none" stroke="#1a1a1a" strokeWidth="0.5" />
      })}

      {/* Axis lines */}
      {AXES.map((ax, i) => {
        const a = angleOf(i)
        return <line key={ax.key}
          x1={CX} y1={CY}
          x2={CX + R * Math.cos(a)} y2={CY + R * Math.sin(a)}
          stroke="#1a1a1a" strokeWidth="0.5" />
      })}

      {/* Data polygon */}
      <polygon points={polyPoints} fill="#4ade8018" stroke="#4ade80" strokeWidth="1.5" />

      {/* Data points */}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="#4ade80" />
      ))}

      {/* Axis labels */}
      {AXES.map((ax, i) => {
        const a = angleOf(i)
        const lx = CX + (R + 14) * Math.cos(a)
        const ly = CY + (R + 14) * Math.sin(a)
        const val = Number(player[ax.key as keyof Player]) || 0
        return (
          <g key={ax.key}>
            <text x={lx} y={ly - 4} textAnchor="middle" fontSize="7"
              fill="#444" fontFamily="IBM Plex Mono, monospace" letterSpacing="0.05em">
              {ax.label}
            </text>
            <text x={lx} y={ly + 6} textAnchor="middle" fontSize="8"
              fill="#e0e0e0" fontFamily="IBM Plex Mono, monospace" fontWeight="700">
              {val}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ vals, color = '#4ade80', height = 32 }: { vals: number[]; color?: string; height?: number }) {
  if (vals.length < 2) return null
  const w = 120
  const min = Math.min(...vals), max = Math.max(...vals)
  const range = max - min || 1
  const pts = vals.map((v, i) =>
    `${(i / (vals.length - 1)) * w},${height - ((v - min) / range) * (height - 4) - 2}`
  ).join(' ')
  return (
    <svg width={w} height={height} style={{ overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
      <circle
        cx={(vals.length - 1) / (vals.length - 1) * w}
        cy={height - ((vals[vals.length - 1] - min) / range) * (height - 4) - 2}
        r="2.5" fill={color} />
    </svg>
  )
}

// ─── Game log fetch ───────────────────────────────────────────────────────────

interface GameLog {
  game_date: string; opponent_abbr: string; pts: number; reb: number
  ast: number; fg3m: number; stl: number; blk: number; minutes: number; is_home: boolean
}

// ─── Player modal ─────────────────────────────────────────────────────────────

function PlayerModal({ player, allPlayers, onClose }: { player: Player; allPlayers: Player[]; onClose: () => void }) {
  const [gamelog, setGamelog] = useState<GameLog[]>([])
  const [logLoading, setLogLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'radar'|'gamelog'>('radar')

  useEffect(() => {
    setLogLoading(true)
    fetch(`${API}/props/player/profile?name=${encodeURIComponent(player.player_name)}`)
      .then(r => r.json())
      .then(d => setGamelog((d.game_logs || []).slice(0, 20)))
      .catch(() => {})
      .finally(() => setLogLoading(false))
  }, [player.player_name])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const STATS = [
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
  ]

  const ptsVals = gamelog.map(g => g.pts).reverse()
  const rebVals = gamelog.map(g => g.reb).reverse()
  const astVals = gamelog.map(g => g.ast).reverse()

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose() }} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px', backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '6px',
        width: '100%', maxWidth: '900px', maxHeight: '90vh', overflow: 'auto',
        fontFamily: 'IBM Plex Mono, monospace',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #111',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '9px', color: '#333', letterSpacing: '0.15em', marginBottom: '6px' }}>
              {player.team_abbr} · {player.position || '—'} · {player.gp}G
            </div>
            <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#e0e0e0',
              margin: 0, letterSpacing: '-0.01em' }}>{player.player_name}</h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none',
            cursor: 'pointer', color: '#444', fontSize: '20px', padding: '4px', lineHeight: 1 }}>×</button>
        </div>

        {/* Stat line */}
        <div style={{ display: 'flex', flexWrap: 'wrap', borderBottom: '1px solid #111' }}>
          {STATS.map(s => {
            const val = player[s.key as keyof Player]
            const display = s.key === 'fg_pct' && val != null ? `${val}%` : val ?? '—'
            return (
              <div key={s.key} style={{ padding: '12px 16px', borderRight: '1px solid #0d0d0d',
                minWidth: '68px', textAlign: 'center', flex: '1' }}>
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#e0e0e0',
                  marginBottom: '3px' }}>{display}</div>
                <div style={{ fontSize: '8px', color: '#333', letterSpacing: '0.1em' }}>{s.label}</div>
              </div>
            )
          })}
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid #111' }}>
          {(['radar', 'gamelog'] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '10px 20px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px',
              color: activeTab === t ? '#e0e0e0' : '#333',
              borderBottom: activeTab === t ? '2px solid #4ade80' : '2px solid transparent',
              letterSpacing: '0.08em',
            }}>
              {t === 'radar' ? 'RADAR CHART' : 'GAME LOG'}
            </button>
          ))}
        </div>

        <div style={{ padding: '24px' }}>
          {/* Radar tab */}
          {activeTab === 'radar' && (
            <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '32px', alignItems: 'start' }}>
              <RadarChart player={player} allPlayers={allPlayers} />
              <div>
                <div style={{ fontSize: '9px', color: '#2a2a2a', letterSpacing: '0.15em', marginBottom: '16px' }}>
                  RECENT TRENDS
                </div>
                {[
                  { label: 'PTS', vals: ptsVals, color: '#60a5fa' },
                  { label: 'REB', vals: rebVals, color: '#34d399' },
                  { label: 'AST', vals: astVals, color: '#fbbf24' },
                ].map(({ label, vals, color }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '16px',
                    marginBottom: '14px', padding: '10px 0', borderBottom: '1px solid #0d0d0d' }}>
                    <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px',
                      color: '#333', letterSpacing: '0.1em', width: '28px' }}>{label}</span>
                    <Sparkline vals={vals} color={color} />
                    {vals.length > 0 && (
                      <div style={{ marginLeft: '8px' }}>
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '14px',
                          fontWeight: 700, color }}>
                          {vals[vals.length - 1]}
                        </span>
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px',
                          color: '#333', marginLeft: '4px' }}>last game</span>
                      </div>
                    )}
                  </div>
                ))}
                <div style={{ marginTop: '8px', fontFamily: 'IBM Plex Mono, monospace',
                  fontSize: '8px', color: '#1a1a1a', lineHeight: 1.8 }}>
                  Radar axes normalized to position-adjusted max values<br />
                  Sparklines show last 20 games (oldest → newest)
                </div>
              </div>
            </div>
          )}

          {/* Game log tab */}
          {activeTab === 'gamelog' && (
            <div>
              {logLoading ? (
                <div style={{ padding: '40px', textAlign: 'center', fontSize: '11px', color: '#2a2a2a' }}>Loading...</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <div style={{ display: 'grid',
                    gridTemplateColumns: '90px 55px 50px 50px 50px 50px 50px 50px 50px',
                    padding: '6px 0', fontFamily: 'IBM Plex Mono, monospace', fontSize: '8px',
                    color: '#2a2a2a', letterSpacing: '0.1em', borderBottom: '1px solid #111',
                    minWidth: '520px' }}>
                    <span>DATE</span><span>OPP</span><span>MIN</span>
                    <span>PTS</span><span>REB</span><span>AST</span>
                    <span>STL</span><span>BLK</span><span>3PM</span>
                  </div>
                  {gamelog.map((g, i) => (
                    <div key={i} style={{ display: 'grid',
                      gridTemplateColumns: '90px 55px 50px 50px 50px 50px 50px 50px 50px',
                      padding: '8px 0', borderBottom: '1px solid #0d0d0d',
                      minWidth: '520px', alignItems: 'center',
                      background: i % 2 === 0 ? 'transparent' : '#080808' }}>
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#333' }}>
                        {String(g.game_date).slice(5)}
                      </span>
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444' }}>
                        {g.is_home ? '' : '@'}{g.opponent_abbr}
                      </span>
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#555' }}>
                        {Math.round(g.minutes)}
                      </span>
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px',
                        fontWeight: 700, color: '#e0e0e0' }}>{g.pts}</span>
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#888' }}>{g.reb}</span>
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: '#888' }}>{g.ast}</span>
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#555' }}>{g.stl}</span>
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#555' }}>{g.blk}</span>
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#555' }}>{g.fg3m}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main profiles page ───────────────────────────────────────────────────────

export default function ProfilesPage() {
  const [players,     setPlayers]     = useState<Player[]>([])
  const [loading,     setLoading]     = useState(true)
  const [search,      setSearch]      = useState('')
  const [sortKey,     setSortKey]     = useState('ppg')
  const [sortDir,     setSortDir]     = useState<'desc'|'asc'>('desc')
  const [selected,    setSelected]    = useState<Player | null>(null)
  const [teamFilter,  setTeamFilter]  = useState('ALL')

  useEffect(() => {
    fetch(`${API}/props/players/list`)
      .then(r => r.json())
      .then(d => setPlayers(d.players || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const teams = useMemo(() =>
    ['ALL', ...Array.from(new Set(players.map(p => p.team_abbr))).sort()],
    [players]
  )

  const filtered = useMemo(() => {
    let list = [...players]
    if (search) list = list.filter(p =>
      p.player_name.toLowerCase().includes(search.toLowerCase())
    )
    if (teamFilter !== 'ALL') list = list.filter(p => p.team_abbr === teamFilter)
    list.sort((a, b) => {
      const av = (a[sortKey as keyof Player] as number) ?? -Infinity
      const bv = (b[sortKey as keyof Player] as number) ?? -Infinity
      return sortDir === 'desc' ? bv - av : av - bv
    })
    return list
  }, [players, search, sortKey, sortDir, teamFilter])

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#080808', color: '#888',
      fontFamily: 'IBM Plex Mono, monospace' }}>

      {selected && (
        <PlayerModal player={selected} allPlayers={players} onClose={() => setSelected(null)} />
      )}

      {/* Header */}
      <div style={{ borderBottom: '1px solid #0f0f0f', padding: '12px 24px',
        display: 'flex', alignItems: 'center', gap: '16px' }}>
        <Link href="/" style={{ color: '#333', textDecoration: 'none',
          fontSize: '11px', letterSpacing: '0.05em' }}>← HOME</Link>
        <span style={{ color: '#1a1a1a' }}>·</span>
        <span style={{ color: '#333', fontSize: '11px', letterSpacing: '0.1em' }}>
          PLAYER PROFILES · 2025–26
        </span>
        {!loading && (
          <span style={{ color: '#222', fontSize: '11px' }}>
            {filtered.length} players
          </span>
        )}
      </div>

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '28px 24px' }}>

        {/* Title + search */}
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontSize: '26px', fontWeight: 700, color: '#e0e0e0',
            letterSpacing: '-0.02em', margin: '0 0 16px' }}>
            Player Profiles
          </h1>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search player..."
              style={{ padding: '8px 12px', background: '#0a0a0a',
                border: '1px solid #1a1a1a', borderRadius: '4px', outline: 'none',
                fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px',
                color: '#e0e0e0', width: '200px' }}
            />
            <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)}
              style={{ padding: '8px 10px', background: '#0a0a0a',
                border: '1px solid #1a1a1a', borderRadius: '4px', outline: 'none',
                fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#888',
                cursor: 'pointer' }}>
              {teams.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <div style={{ fontSize: '10px', color: '#2a2a2a', marginLeft: 'auto' }}>
              Click a player to view shot chart + stats
            </div>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ padding: '60px', textAlign: 'center', fontSize: '11px', color: '#222' }}>
            Loading players...
          </div>
        ) : (
          <div style={{ background: '#0a0a0a', border: '1px solid #111', borderRadius: '6px',
            overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #111' }}>
                  <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: '9px',
                    color: '#2a2a2a', letterSpacing: '0.12em', fontWeight: 400,
                    position: 'sticky', left: 0, background: '#0a0a0a' }}>PLAYER</th>
                  <th style={{ padding: '10px 8px', fontSize: '9px', color: '#2a2a2a',
                    letterSpacing: '0.1em', fontWeight: 400, textAlign: 'center' }}>TEAM</th>
                  <th style={{ padding: '10px 8px', fontSize: '9px', color: '#2a2a2a',
                    letterSpacing: '0.1em', fontWeight: 400, textAlign: 'center' }}>POS</th>
                  {SORT_OPTIONS.map(s => (
                    <th key={s.key} onClick={() => toggleSort(s.key)} style={{
                      padding: '10px 12px', fontSize: '9px', letterSpacing: '0.1em',
                      fontWeight: 400, textAlign: 'right', cursor: 'pointer',
                      color: sortKey === s.key ? '#4ade80' : '#2a2a2a',
                      whiteSpace: 'nowrap', userSelect: 'none',
                    }}>
                      {s.label} {sortKey === s.key ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => (
                  <tr key={p.player_name} onClick={() => setSelected(p)}
                    style={{ borderBottom: '1px solid #0d0d0d', cursor: 'pointer',
                      background: i % 2 === 0 ? 'transparent' : '#080808',
                      transition: 'background 0.1s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#0f0f0f')}
                    onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : '#080808')}>
                    <td style={{ padding: '10px 16px', fontSize: '12px', fontWeight: 600,
                      color: '#e0e0e0', whiteSpace: 'nowrap',
                      position: 'sticky', left: 0, background: 'inherit' }}>
                      {p.player_name}
                    </td>
                    <td style={{ padding: '10px 8px', fontSize: '10px', color: '#444',
                      textAlign: 'center' }}>{p.team_abbr}</td>
                    <td style={{ padding: '10px 8px', fontSize: '10px', color: '#333',
                      textAlign: 'center' }}>{p.position || '—'}</td>
                    {SORT_OPTIONS.map(s => {
                      const val = p[s.key as keyof Player]
                      const display = s.key === 'fg_pct' && val != null ? `${val}%` : val ?? '—'
                      const isSort = sortKey === s.key
                      return (
                        <td key={s.key} style={{ padding: '10px 12px', textAlign: 'right',
                          fontSize: isSort ? '12px' : '11px',
                          fontWeight: isSort ? 700 : 400,
                          color: isSort ? '#e0e0e0' : '#444' }}>
                          {display}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: '16px', fontSize: '9px', color: '#1a1a1a' }}>
          Min 5 games · 2025-26 regular season · Click any row to view shot chart
        </div>
      </div>
    </div>
  )
}
