'use client'

import { useState, useEffect, useCallback } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const MONO = 'IBM Plex Mono, monospace'
const STATS = ['pts','reb','ast','fg3m','stl','blk']
const STAT_LABEL: Record<string,string> = {pts:'PTS',reb:'REB',ast:'AST',fg3m:'3PM',stl:'STL',blk:'BLK'}

interface StreakPlayer {
  player_name: string; team: string; position: string
  season_avg: number; l5_avg: number; l10_avg?: number
  pct_change: number; z_score: number; streak: string; gp: number
}

interface OverallPlayer {
  player_name: string; team: string; position: string; gp: number
  composite_z: number; streak: string; best_stat: string
  pts_season: number; pts_l10: number; pts_l5: number; pts_pct: number; accel: number
  reb_season: number; reb_l10: number
  ast_season: number; ast_l10: number
}

interface BreakoutPlayer {
  player_name: string; team: string; position: string; gp: number
  breakout_score: number; pts_season: number; pts_l10: number; pts_l5: number
  min_season: number; min_l10: number; pts_trend_pct: number; min_trend_pct: number
}

const sc = (s: string) => s==='hot'?'#f97316':s==='warm'?'#fbbf24':s==='cold'?'#60a5fa':s==='cool'?'#93c5fd':'#555'
const pc = (p: number) => p>15?'#4ade80':p>5?'#86efac':p<-15?'#f87171':p<-5?'#fca5a5':'#888'

type StreakTab = 'overall' | 'pts' | 'reb' | 'ast' | 'fg3m' | 'stl' | 'blk'

// ─── Overall Hot/Cold ─────────────────────────────────────────────────────────

function OverallStreaks() {
  const [data, setData] = useState<{hot:OverallPlayer[];cold:OverallPlayer[]}|null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API}/insights/streaks/overall?min_gp=10&limit=15`)
      .then(r=>r.json()).then(setData).catch(()=>{}).finally(()=>setLoading(false))
  }, [])

  const Row = ({ p, side }: { p: OverallPlayer; side: 'hot'|'cold' }) => {
    const color = sc(p.streak)
    const accelColor = p.accel > 2 ? '#4ade80' : p.accel < -2 ? '#f87171' : '#555'
    return (
      <div style={{ display:'grid', gridTemplateColumns:'1fr 40px 65px 65px 65px 70px 60px 60px',
        padding:'9px 14px', borderBottom:'1px solid #1f1f24', alignItems:'center' }}>
        <div>
          <div style={{ fontFamily:MONO, fontSize:'12px', fontWeight:600, color:'#e0e0e0' }}>{p.player_name}</div>
          <div style={{ fontFamily:MONO, fontSize:'9px', color:'#787672' }}>{p.team} · {p.gp}G</div>
        </div>
        <span style={{ fontFamily:MONO, fontSize:'10px', color:'#787672' }}>{p.gp}</span>
        {/* PTS */}
        <div>
          <span style={{ fontFamily:MONO, fontSize:'13px', fontWeight:700, color }}>{p.pts_l10}</span>
          <span style={{ fontFamily:MONO, fontSize:'9px', color:'#787672', marginLeft:'4px' }}>L10</span>
        </div>
        <span style={{ fontFamily:MONO, fontSize:'11px', color:pc(p.pts_pct) }}>
          {p.pts_pct>0?'+':''}{p.pts_pct}%
        </span>
        {/* L5 accel */}
        <div>
          <span style={{ fontFamily:MONO, fontSize:'12px', fontWeight:600, color:accelColor }}>{p.pts_l5}</span>
          <span style={{ fontFamily:MONO, fontSize:'8px', color:'#55534f', marginLeft:'3px' }}>L5</span>
        </div>
        <span style={{ fontFamily:MONO, fontSize:'10px', color:accelColor }}>
          {p.accel > 0 ? '+' : ''}{p.accel}↑↓
        </span>
        {/* Composite z */}
        <span style={{ fontFamily:MONO, fontSize:'10px', color }}>
          z={p.composite_z > 0 ? '+' : ''}{p.composite_z}
        </span>
        <span style={{ fontFamily:MONO, fontSize:'8px', color, letterSpacing:'0.06em' }}>
          {p.streak.toUpperCase()}
        </span>
      </div>
    )
  }

  const Header = () => (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 40px 65px 65px 65px 70px 60px 60px',
      padding:'6px 14px', fontFamily:MONO, fontSize:'8px', color:'#55534f',
      letterSpacing:'0.1em', borderBottom:'1px solid #111' }}>
      <span>PLAYER</span><span>GP</span><span>PTS L10</span><span>CHNG</span>
      <span>PTS L5</span><span>ACCEL</span><span>Z-SCORE</span><span>STREAK</span>
    </div>
  )

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'20px' }}>
      <div>
        <div style={{ fontFamily:MONO, fontSize:'9px', color:'#f97316',
          letterSpacing:'0.12em', marginBottom:'8px' }}>
          OVERALL HOT — composite z-score across PTS/REB/AST/3PM
        </div>
        <div style={{ background:'#141418', border:'1px solid #222228', borderRadius:'4px', overflow:'hidden' }}>
          <Header />
          {loading
            ? <div style={{ padding:'20px', fontFamily:MONO, fontSize:'11px', color:'#55534f' }}>Loading...</div>
            : data?.hot.map(p => <Row key={p.player_name} p={p} side="hot" />)
          }
        </div>
        <div style={{ fontFamily:MONO, fontSize:'8px', color:'#55534f', marginTop:'8px' }}>
          L10 = last 10 games vs season avg · L5 = acceleration signal · Z = composite standard deviations
        </div>
      </div>
      <div>
        <div style={{ fontFamily:MONO, fontSize:'9px', color:'#60a5fa',
          letterSpacing:'0.12em', marginBottom:'8px' }}>
          OVERALL COLD — composite z-score across PTS/REB/AST/3PM
        </div>
        <div style={{ background:'#141418', border:'1px solid #222228', borderRadius:'4px', overflow:'hidden' }}>
          <Header />
          {loading
            ? <div style={{ padding:'20px', fontFamily:MONO, fontSize:'11px', color:'#55534f' }}>Loading...</div>
            : data?.cold.map(p => <Row key={p.player_name} p={p} side="cold" />)
          }
        </div>
      </div>
    </div>
  )
}

// ─── Per-Stat Hot/Cold ────────────────────────────────────────────────────────

function StatStreaks({ stat }: { stat: string }) {
  const [data, setData] = useState<{hot:StreakPlayer[];cold:StreakPlayer[]}|null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (s: string) => {
    setLoading(true)
    try { setData(await fetch(`${API}/insights/streaks?stat=${s}&min_gp=10&limit=15`).then(r=>r.json())) }
    catch {}
    setLoading(false)
  }, [])

  useEffect(() => { load(stat) }, [stat])

  const Row = ({ p }: { p: StreakPlayer }) => (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 55px 65px 65px 70px 70px',
      padding:'9px 14px', borderBottom:'1px solid #1f1f24', alignItems:'center' }}>
      <div>
        <div style={{ fontFamily:MONO, fontSize:'12px', fontWeight:600, color:'#e0e0e0' }}>{p.player_name}</div>
        <div style={{ fontFamily:MONO, fontSize:'9px', color:'#787672' }}>{p.team} · {p.gp}G</div>
      </div>
      <span style={{ fontFamily:MONO, fontSize:'11px', color:'#909090' }}>{p.season_avg}</span>
      <span style={{ fontFamily:MONO, fontSize:'14px', fontWeight:700, color:sc(p.streak) }}>{p.l5_avg}</span>
      <span style={{ fontFamily:MONO, fontSize:'11px', color:pc(p.pct_change) }}>
        {p.pct_change>0?'+':''}{p.pct_change}%
      </span>
      <span style={{ fontFamily:MONO, fontSize:'9px', color:sc(p.streak), letterSpacing:'0.08em' }}>
        {p.streak.toUpperCase()}
      </span>
      <span style={{ fontFamily:MONO, fontSize:'10px', color:'#787672' }}>
        {p.z_score>0?'+':''}{p.z_score}σ
      </span>
    </div>
  )

  const Hdr = () => (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 55px 65px 65px 70px 70px',
      padding:'6px 14px', fontFamily:MONO, fontSize:'8px', color:'#55534f',
      letterSpacing:'0.1em', borderBottom:'1px solid #111' }}>
      <span>PLAYER</span><span>SEASON</span><span>L5</span>
      <span>CHANGE</span><span>STREAK</span><span>Z</span>
    </div>
  )

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'20px' }}>
      {[{list:data?.hot||[], label:'HOT', color:'#f97316'},
        {list:data?.cold||[], label:'COLD', color:'#60a5fa'}].map(({list,label,color}) => (
        <div key={label}>
          <div style={{ fontFamily:MONO, fontSize:'9px', color, letterSpacing:'0.12em', marginBottom:'8px' }}>
            {label} {STAT_LABEL[stat]} — {list.length} players
          </div>
          <div style={{ background:'#141418', border:'1px solid #222228', borderRadius:'4px', overflow:'hidden' }}>
            <Hdr />
            {loading
              ? <div style={{ padding:'20px', fontFamily:MONO, fontSize:'11px', color:'#55534f' }}>Loading...</div>
              : list.map(p => <Row key={p.player_name} p={p} />)
            }
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Breakout ─────────────────────────────────────────────────────────────────

function Breakout() {
  const [data, setData] = useState<BreakoutPlayer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API}/insights/breakout?limit=20`)
      .then(r=>r.json()).then(d=>setData(d.results||[])).catch(()=>{}).finally(()=>setLoading(false))
  }, [])

  const maxScore = Math.max(...data.map(d=>d.breakout_score), 1)

  return (
    <div>
      <h2 style={{ fontFamily:MONO, fontSize:'13px', fontWeight:700, color:'#e0e0e0',
        letterSpacing:'0.12em', margin:'0 0 4px' }}>BREAKOUT PROBABILITY</h2>
      <div style={{ fontFamily:MONO, fontSize:'10px', color:'#787672', marginBottom:'4px' }}>
        Multi-dimensional efficiency analysis for players ≤26 years old · PER-proxy + playmaking + defense + usage
      </div>
      <div style={{ fontFamily:MONO, fontSize:'9px', color:'#55534f', marginBottom:'20px' }}>
        Score = weighted composite of: PER improvement (30%) · minutes expansion (20%) · scoring efficiency (15%) · playmaking (15%) · rebounding (10%) · defense (10%)
      </div>
      {loading && <div style={{ fontFamily:MONO, fontSize:'11px', color:'#55534f', padding:'20px' }}>Loading...</div>}
      {!loading && (
        <div style={{ background:'#141418', border:'1px solid #222228', borderRadius:'4px', overflowX:'auto' }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 35px 40px 100px 100px 90px 90px 75px 80px',
            padding:'6px 16px', fontFamily:MONO, fontSize:'8px', color:'#55534f',
            letterSpacing:'0.1em', borderBottom:'1px solid #111', minWidth:'800px' }}>
            <span>PLAYER</span><span>GP</span><span>AGE</span><span>SCORE</span>
            <span>LEAD DIM</span><span>PTS L10</span><span>PER TREND</span>
            <span>MIN TREND</span><span>PTS TREND</span>
          </div>
          {data.map((p,i) => (
            <div key={p.player_name} style={{ display:'grid',
              gridTemplateColumns:'1fr 35px 40px 100px 100px 90px 90px 75px 80px',
              padding:'10px 16px', borderBottom:'1px solid #1f1f24', alignItems:'center',
              minWidth:'800px', background:i%2===0?'transparent':'#080808' }}>
              <div>
                <div style={{ fontFamily:MONO, fontSize:'12px', fontWeight:600, color:'#e0e0e0' }}>{p.player_name}</div>
                <div style={{ fontFamily:MONO, fontSize:'9px', color:'#787672' }}>{p.team} · {p.position}</div>
              </div>
              <span style={{ fontFamily:MONO, fontSize:'10px', color:'#787672' }}>{p.gp}</span>
              <span style={{ fontFamily:MONO, fontSize:'10px', color:(p as any).age <= 22 ? '#4ade80' : '#555' }}>
                {(p as any).age || '—'}
              </span>
              <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                <div style={{ width:'36px', height:'4px', background:'#111', borderRadius:'2px', overflow:'hidden' }}>
                  <div style={{ width:`${(p.breakout_score/maxScore)*100}%`, height:'100%', background:'#a78bfa' }} />
                </div>
                <span style={{ fontFamily:MONO, fontSize:'11px', color:'#a78bfa', fontWeight:600 }}>
                  {p.breakout_score.toFixed(0)}
                </span>
              </div>
              <span style={{ fontFamily:MONO, fontSize:'9px', color:'#a78bfa',
                letterSpacing:'0.06em', textTransform:'uppercase' as const }}>
                {(p as any).lead_dimension || '—'}
              </span>
              <span style={{ fontFamily:MONO, fontSize:'13px', fontWeight:600,
                color:p.pts_l10>p.pts_season?'#4ade80':'#f87171' }}>{p.pts_l10}</span>
              <span style={{ fontFamily:MONO, fontSize:'11px',
                color:(p as any).z_per>0?'#4ade80':'#f87171' }}>
                {(p as any).z_per>0?'+':''}{((p as any).z_per||0).toFixed(2)}σ
              </span>
              <span style={{ fontFamily:MONO, fontSize:'11px',
                color:p.min_trend_pct>0?'#4ade80':'#f87171' }}>
                {p.min_trend_pct>0?'+':''}{p.min_trend_pct}%
              </span>
              <span style={{ fontFamily:MONO, fontSize:'11px',
                color:p.pts_trend_pct>0?'#4ade80':'#f87171' }}>
                {p.pts_trend_pct>0?'+':''}{p.pts_trend_pct}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InsightsPage() {
  const [streakTab, setStreakTab] = useState<StreakTab>('overall')

  return (
    <div style={{ minHeight:'100vh', background:'#0e0e12', color:'#888', fontFamily:MONO }}>
      <div style={{ borderBottom:'1px solid #0f0f0f', padding:'16px 28px' }}>
        <div style={{ fontSize:'9px', color:'#55534f', letterSpacing:'0.15em', marginBottom:'6px' }}>
          DAILY INTELLIGENCE · 2025–26
        </div>
        <h1 style={{ fontSize:'22px', fontWeight:700, color:'#e0e0e0', margin:'0 0 4px' }}>Insights</h1>
        <div style={{ fontFamily:MONO, fontSize:'10px', color:'#787672' }}>
          Who's trending, who's cooling off, and who's about to break out
        </div>
      </div>

      <div style={{ maxWidth:'1200px', margin:'0 auto', padding:'32px 28px' }}>

        {/* Hot/Cold section */}
        <div style={{ marginBottom:'48px' }}>
          <div style={{ display:'flex', alignItems:'baseline', gap:'16px', marginBottom:'20px' }}>
            <h2 style={{ fontFamily:MONO, fontSize:'13px', fontWeight:700, color:'#e0e0e0',
              letterSpacing:'0.12em', margin:0 }}>HOT / COLD STREAK DETECTOR</h2>
            <div style={{ fontFamily:MONO, fontSize:'10px', color:'#787672' }}>
              L10 primary signal · L5 acceleration · Z-score vs season mean
            </div>
          </div>

          {/* Stat tabs */}
          <div style={{ display:'flex', gap:'4px', marginBottom:'20px', flexWrap:'wrap' }}>
            <button onClick={() => setStreakTab('overall')} style={{
              padding:'5px 14px', background:streakTab==='overall'?'#111':'none',
              border:`1px solid ${streakTab==='overall'?'#333':'#111'}`, borderRadius:'3px',
              cursor:'pointer', fontFamily:MONO, fontSize:'10px',
              color:streakTab==='overall'?'#4ade80':'#333', letterSpacing:'0.08em',
            }}>OVERALL</button>
            {STATS.map(s => (
              <button key={s} onClick={() => setStreakTab(s as StreakTab)} style={{
                padding:'5px 12px', background:streakTab===s?'#111':'none',
                border:`1px solid ${streakTab===s?'#333':'#111'}`, borderRadius:'3px',
                cursor:'pointer', fontFamily:MONO, fontSize:'10px',
                color:streakTab===s?'#e0e0e0':'#333', letterSpacing:'0.08em',
              }}>{STAT_LABEL[s]}</button>
            ))}
          </div>

          {streakTab === 'overall'
            ? <OverallStreaks />
            : <StatStreaks stat={streakTab} />
          }
        </div>

        {/* Breakout section */}
        <Breakout />
      </div>
    </div>
  )
}
