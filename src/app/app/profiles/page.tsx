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

function CourtSVG() {
  const stroke = '#333'
  const sw = 1.5
  return (
    <g>
      {/* Court outline */}
      <rect x={-250} y={-50} width={500} height={470} fill="none" stroke={stroke} strokeWidth={sw}/>
      {/* Paint */}
      <rect x={-80} y={-50} width={160} height={190} fill="none" stroke={stroke} strokeWidth={sw}/>
      {/* Restricted area */}
      <path d="M -40 -50 A 40 40 0 0 1 40 -50" fill="none" stroke={stroke} strokeWidth={sw}/>
      {/* Free throw circle */}
      <circle cx={0} cy={140} r={60} fill="none" stroke={stroke} strokeWidth={sw}/>
      {/* Basket */}
      <circle cx={0} cy={0} r={7.5} fill="none" stroke={stroke} strokeWidth={2}/>
      <line x1={-30} y1={-7.5} x2={30} y2={-7.5} stroke={stroke} strokeWidth={2}/>
      {/* 3pt line */}
      <path
        d="M -220 -50 L -220 90 A 237.5 237.5 0 0 0 220 90 L 220 -50"
        fill="none" stroke={stroke} strokeWidth={sw}
      />
      {/* Half court */}
      <line x1={-250} y1={420} x2={250} y2={420} stroke={stroke} strokeWidth={sw}/>
      <circle cx={0} cy={420} r={60} fill="none" stroke={stroke} strokeWidth={sw}/>
      <circle cx={0} cy={420} r={6} fill={stroke}/>
    </g>
  )
}

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

function ShotChart({ shots, loading }: { shots: Shot[]; loading: boolean }) {
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

// ─── Player modal ─────────────────────────────────────────────────────────────

function PlayerModal({ player, onClose }: { player: Player; onClose: () => void }) {
  const [shotRange, setShotRange] = useState<'season'|'l25'|'l10'>('season')
  const [shotData,  setShotData]  = useState<ShotData | null>(null)
  const [shotLoading, setShotLoading] = useState(false)
  const [shotError,   setShotError]   = useState<string | null>(null)

  const loadShots = useCallback(async (range: 'season'|'l25'|'l10') => {
    setShotLoading(true)
    setShotError(null)
    try {
      const lastN = range === 'l10' ? 10 : range === 'l25' ? 25 : 0

      // Step 1: Get NBA player ID from commonallplayers
      const playersUrl = `https://stats.nba.com/stats/commonallplayers?IsOnlyCurrentSeason=1&LeagueID=00&Season=2025-26`
      const playersResp = await fetch(playersUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://www.nba.com/',
          'Accept': 'application/json',
          'x-nba-stats-origin': 'stats',
          'x-nba-stats-token': 'true',
        },
      })
      const playersData = await playersResp.json()
      const pHeaders = playersData.resultSets[0].headers
      const pRows    = playersData.resultSets[0].rowSet
      const nameIdx  = pHeaders.indexOf('DISPLAY_FIRST_LAST')
      const idIdx    = pHeaders.indexOf('PERSON_ID')
      const nameLower = player.player_name.toLowerCase()
      const playerRow = pRows.find((r: any[]) =>
        r[nameIdx]?.toLowerCase() === nameLower ||
        r[nameIdx]?.toLowerCase().includes(nameLower)
      )
      if (!playerRow) {
        setShotError(`Player '${player.player_name}' not found in NBA Stats`)
        setShotLoading(false)
        return
      }
      const playerId = playerRow[idIdx]

      // Step 2: Fetch shot chart
      const shotUrl = `https://stats.nba.com/stats/shotchartdetail?PlayerID=${playerId}&Season=2025-26&SeasonType=Regular+Season&ContextMeasure=FGA&LeagueID=00&TeamID=0&GameID=&Outcome=&Location=&Month=0&SeasonSegment=&DateFrom=&DateTo=&OpponentTeamID=0&VsConference=&VsDivision=&Position=&RookieYear=&GameSegment=&Period=0&LastNGames=${lastN}&AheadBehind=&PointDiff=&RangeType=0&StartPeriod=0&EndPeriod=0&StartRange=0&EndRange=0`
      const shotResp = await fetch(shotUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://www.nba.com/',
          'Accept': 'application/json',
          'x-nba-stats-origin': 'stats',
          'x-nba-stats-token': 'true',
        },
      })
      const shotData = await shotResp.json()
      const sHeaders = shotData.resultSets[0].headers
      const sRows    = shotData.resultSets[0].rowSet
      const shots: Shot[] = sRows.map((r: any[]) => {
        const d = Object.fromEntries(sHeaders.map((h: string, i: number) => [h, r[i]]))
        return {
          x:         d.LOC_X,
          y:         d.LOC_Y,
          made:      Boolean(d.SHOT_MADE_FLAG),
          shot_type: d.SHOT_TYPE || '',
          zone:      d.SHOT_ZONE_BASIC || '',
          distance:  d.SHOT_DISTANCE || 0,
          date:      d.GAME_DATE || '',
        }
      })
      const made = shots.filter(s => s.made).length
      setShotData({
        player_name: player.player_name,
        range,
        total:  shots.length,
        made,
        fg_pct: shots.length > 0 ? Math.round(made / shots.length * 1000) / 10 : 0,
        shots,
      })
    } catch (err: any) {
      // NBA Stats CORS blocked — fall back to backend proxy
      try {
        const r = await fetch(`${API}/props/shotchart?name=${encodeURIComponent(player.player_name)}&range=${range}`)
        const d = await r.json()
        if (d.error) {
          setShotError(`Shot chart unavailable: ${d.error}`)
        } else {
          setShotData(d)
        }
      } catch {
        setShotError('Shot chart unavailable — NBA Stats API is rate limited')
      }
    }
    setShotLoading(false)
  }, [player.player_name])

  useEffect(() => { loadShots('season') }, [loadShots])
  useEffect(() => { loadShots(shotRange) }, [shotRange, loadShots])

  // Close on backdrop click
  const onBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  // Close on Escape
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

  const shots = shotData?.shots ?? []

  return (
    <div onClick={onBackdrop} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px', backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '6px',
        width: '100%', maxWidth: '860px', maxHeight: '90vh', overflow: 'auto',
        fontFamily: 'IBM Plex Mono, monospace',
      }}>
        {/* Modal header */}
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
            cursor: 'pointer', color: '#333', fontSize: '20px', padding: '4px',
            lineHeight: 1 }}>×</button>
        </div>

        {/* Stat line */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0',
          borderBottom: '1px solid #111' }}>
          {STATS.map(s => {
            const val = player[s.key as keyof Player]
            const display = s.key === 'fg_pct' && val != null
              ? `${val}%`
              : val ?? '—'
            return (
              <div key={s.key} style={{ padding: '14px 16px', borderRight: '1px solid #0d0d0d',
                minWidth: '72px', textAlign: 'center' }}>
                <div style={{ fontSize: '16px', fontWeight: 700, color: '#e0e0e0',
                  marginBottom: '4px' }}>{display}</div>
                <div style={{ fontSize: '8px', color: '#333', letterSpacing: '0.1em' }}>{s.label}</div>
              </div>
            )
          })}
        </div>

        {/* Shot chart section */}
        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: '16px' }}>
            <div style={{ fontSize: '9px', color: '#333', letterSpacing: '0.15em' }}>
              SHOT CHART
              {shotData && !shotLoading && (
                <span style={{ color: '#555', marginLeft: '12px' }}>
                  {shotData.made}/{shotData.total} FGM · {shotData.fg_pct}% FG
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              {(['season','l25','l10'] as const).map(r => (
                <button key={r} onClick={() => setShotRange(r)} style={{
                  padding: '4px 10px', background: shotRange === r ? '#1a1a1a' : 'none',
                  border: `1px solid ${shotRange === r ? '#333' : '#111'}`,
                  borderRadius: '3px', cursor: 'pointer',
                  fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px',
                  color: shotRange === r ? '#e0e0e0' : '#333',
                  letterSpacing: '0.08em',
                }}>
                  {r === 'season' ? 'SEASON' : r === 'l25' ? 'L25' : 'L10'}
                </button>
              ))}
            </div>
          </div>

          {shotError ? (
            <div style={{ padding: '40px', textAlign: 'center', fontSize: '11px',
              color: '#2a2a2a', background: '#080808', borderRadius: '4px' }}>
              {shotError}
              <div style={{ marginTop: '8px', fontSize: '10px', color: '#1a1a1a' }}>
                NBA Stats API may be temporarily unavailable
              </div>
            </div>
          ) : (
            <div style={{ maxWidth: '420px', margin: '0 auto' }}>
              <ShotChart shots={shots} loading={shotLoading} />
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
        <PlayerModal player={selected} onClose={() => setSelected(null)} />
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
