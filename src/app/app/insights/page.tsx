'use client'

import { useState, useEffect, useCallback } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const MONO = 'IBM Plex Mono, monospace'
const STATS = ['pts','reb','ast','fg3m','stl','blk']
const STAT_LABEL: Record<string,string> = {pts:'PTS',reb:'REB',ast:'AST',fg3m:'3PM',stl:'STL',blk:'BLK'}

interface StreakPlayer {
  player_name: string; team: string; position: string
  season_avg: number; l5_avg: number; pct_change: number; z_score: number; streak: string; gp: number
}
interface BreakoutPlayer {
  player_name: string; team: string; position: string; gp: number
  breakout_score: number; pts_season: number; pts_l10: number; pts_l5: number
  min_season: number; min_l10: number; pts_trend_pct: number; min_trend_pct: number
}

const sc = (s: string) => s==='hot'?'#f97316':s==='warm'?'#fbbf24':s==='cold'?'#60a5fa':s==='cool'?'#93c5fd':'#555'
const pc = (p: number) => p>15?'#4ade80':p>5?'#86efac':p<-15?'#f87171':p<-5?'#fca5a5':'#888'

function HotCold() {
  const [data, setData] = useState<{hot:StreakPlayer[];cold:StreakPlayer[]}|null>(null)
  const [loading, setLoading] = useState(true)
  const [stat, setStat] = useState('pts')

  const load = useCallback(async (s: string) => {
    setLoading(true)
    try { setData(await fetch(`${API}/insights/streaks?stat=${s}&min_gp=10&limit=20`).then(r=>r.json())) }
    catch {}
    setLoading(false)
  }, [])

  useEffect(() => { load(stat) }, [stat])

  return (
    <div style={{ marginBottom:'48px' }}>
      <h2 style={{ fontFamily:MONO, fontSize:'13px', fontWeight:700, color:'#e0e0e0',
        letterSpacing:'0.12em', margin:'0 0 4px' }}>HOT / COLD STREAK DETECTOR</h2>
      <div style={{ fontFamily:MONO, fontSize:'10px', color:'#333', marginBottom:'20px' }}>
        L5 average vs season average · Z-score = standard deviations from mean
      </div>

      <div style={{ display:'flex', gap:'6px', marginBottom:'20px' }}>
        {STATS.map(s => (
          <button key={s} onClick={() => setStat(s)} style={{
            padding:'5px 12px', background:stat===s?'#111':'none',
            border:`1px solid ${stat===s?'#333':'#111'}`, borderRadius:'3px',
            cursor:'pointer', fontFamily:MONO, fontSize:'10px',
            color:stat===s?'#e0e0e0':'#333', letterSpacing:'0.08em',
          }}>{STAT_LABEL[s]}</button>
        ))}
      </div>

      {loading && <div style={{ fontFamily:MONO, fontSize:'11px', color:'#2a2a2a', padding:'20px' }}>Loading...</div>}

      {!loading && data && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'20px' }}>
          {[
            {list:data.hot,  label:'RUNNING HOT',  color:'#f97316'},
            {list:data.cold, label:'RUNNING COLD', color:'#60a5fa'},
          ].map(({list,label,color}) => (
            <div key={label}>
              <div style={{ fontFamily:MONO, fontSize:'9px', color, letterSpacing:'0.12em', marginBottom:'8px' }}>
                {label} — {list.length} players
              </div>
              <div style={{ background:'#0a0a0a', border:'1px solid #111', borderRadius:'4px', overflow:'hidden' }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 55px 65px 65px 80px 70px',
                  padding:'6px 14px', fontFamily:MONO, fontSize:'8px', color:'#2a2a2a',
                  letterSpacing:'0.1em', borderBottom:'1px solid #111' }}>
                  <span>PLAYER</span><span>SEASON</span><span>L5</span>
                  <span>CHANGE</span><span>STREAK</span><span>Z</span>
                </div>
                {list.map(p => (
                  <div key={p.player_name} style={{ display:'grid',
                    gridTemplateColumns:'1fr 55px 65px 65px 80px 70px',
                    padding:'9px 14px', borderBottom:'1px solid #0d0d0d', alignItems:'center' }}>
                    <div>
                      <div style={{ fontFamily:MONO, fontSize:'12px', fontWeight:600, color:'#e0e0e0' }}>{p.player_name}</div>
                      <div style={{ fontFamily:MONO, fontSize:'9px', color:'#333' }}>{p.team} · {p.gp}G</div>
                    </div>
                    <span style={{ fontFamily:MONO, fontSize:'11px', color:'#555' }}>{p.season_avg}</span>
                    <span style={{ fontFamily:MONO, fontSize:'14px', fontWeight:700, color:sc(p.streak) }}>{p.l5_avg}</span>
                    <span style={{ fontFamily:MONO, fontSize:'11px', color:pc(p.pct_change) }}>
                      {p.pct_change>0?'+':''}{p.pct_change}%
                    </span>
                    <span style={{ fontFamily:MONO, fontSize:'9px', color:sc(p.streak), letterSpacing:'0.06em' }}>
                      {p.streak.toUpperCase()}
                    </span>
                    <span style={{ fontFamily:MONO, fontSize:'10px', color:'#333' }}>
                      {p.z_score>0?'+':''}{p.z_score}σ
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Breakout() {
  const [data, setData] = useState<BreakoutPlayer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API}/insights/breakout?limit=25`)
      .then(r=>r.json()).then(d=>setData(d.results||[])).catch(()=>{}).finally(()=>setLoading(false))
  }, [])

  const maxScore = Math.max(...data.map(d=>d.breakout_score), 1)

  return (
    <div>
      <h2 style={{ fontFamily:MONO, fontSize:'13px', fontWeight:700, color:'#e0e0e0',
        letterSpacing:'0.12em', margin:'0 0 4px' }}>BREAKOUT PROBABILITY</h2>
      <div style={{ fontFamily:MONO, fontSize:'10px', color:'#333', marginBottom:'20px' }}>
        Rising players across points, minutes, and usage · Score out of 100
      </div>
      {loading && <div style={{ fontFamily:MONO, fontSize:'11px', color:'#2a2a2a', padding:'20px' }}>Loading...</div>}
      {!loading && (
        <div style={{ background:'#0a0a0a', border:'1px solid #111', borderRadius:'4px', overflowX:'auto' }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 45px 100px 90px 90px 75px 90px 90px',
            padding:'6px 16px', fontFamily:MONO, fontSize:'8px', color:'#2a2a2a',
            letterSpacing:'0.1em', borderBottom:'1px solid #111', minWidth:'740px' }}>
            <span>PLAYER</span><span>GP</span><span>SCORE</span>
            <span>PTS SEASON</span><span>PTS L10</span><span>PTS L5</span>
            <span>MIN TREND</span><span>PTS TREND</span>
          </div>
          {data.map((p,i) => (
            <div key={p.player_name} style={{ display:'grid',
              gridTemplateColumns:'1fr 45px 100px 90px 90px 75px 90px 90px',
              padding:'10px 16px', borderBottom:'1px solid #0d0d0d', alignItems:'center',
              minWidth:'740px', background:i%2===0?'transparent':'#080808' }}>
              <div>
                <div style={{ fontFamily:MONO, fontSize:'12px', fontWeight:600, color:'#e0e0e0' }}>{p.player_name}</div>
                <div style={{ fontFamily:MONO, fontSize:'9px', color:'#333' }}>{p.team} · {p.position}</div>
              </div>
              <span style={{ fontFamily:MONO, fontSize:'10px', color:'#444' }}>{p.gp}</span>
              <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                <div style={{ width:'44px', height:'4px', background:'#111', borderRadius:'2px', overflow:'hidden' }}>
                  <div style={{ width:`${(p.breakout_score/maxScore)*100}%`, height:'100%', background:'#a78bfa' }} />
                </div>
                <span style={{ fontFamily:MONO, fontSize:'11px', color:'#a78bfa', fontWeight:600 }}>
                  {p.breakout_score.toFixed(0)}
                </span>
              </div>
              <span style={{ fontFamily:MONO, fontSize:'12px', color:'#555' }}>{p.pts_season}</span>
              <span style={{ fontFamily:MONO, fontSize:'13px', fontWeight:600,
                color:p.pts_l10>p.pts_season?'#4ade80':'#f87171' }}>{p.pts_l10}</span>
              <span style={{ fontFamily:MONO, fontSize:'13px', fontWeight:700,
                color:p.pts_l5>p.pts_l10?'#4ade80':p.pts_l5<p.pts_l10?'#f87171':'#888' }}>{p.pts_l5}</span>
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

export default function InsightsPage() {
  return (
    <div style={{ minHeight:'100vh', background:'#080808', color:'#888', fontFamily:MONO }}>
      <div style={{ borderBottom:'1px solid #0f0f0f', padding:'16px 28px' }}>
        <div style={{ fontSize:'9px', color:'#2a2a2a', letterSpacing:'0.15em', marginBottom:'6px' }}>
          DAILY INTELLIGENCE · 2025–26
        </div>
        <h1 style={{ fontSize:'22px', fontWeight:700, color:'#e0e0e0', margin:'0 0 4px' }}>Insights</h1>
        <div style={{ fontFamily:MONO, fontSize:'10px', color:'#333' }}>
          Who's trending, who's cooling off, and who's about to break out
        </div>
      </div>
      <div style={{ maxWidth:'1200px', margin:'0 auto', padding:'32px 28px' }}>
        <HotCold />
        <Breakout />
      </div>
    </div>
  )
}
