'use client'

import { useState } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const MONO = 'IBM Plex Mono, monospace'
const STATS = ['pts','reb','ast','fg3m','stl','blk']
const STAT_LABEL: Record<string,string> = {pts:'PTS',reb:'REB',ast:'AST',fg3m:'3PM',stl:'STL',blk:'BLK'}
const STAT_FULL: Record<string,string> = {pts:'Points',reb:'Rebounds',ast:'Assists',fg3m:'3-Pointers',stl:'Steals',blk:'Blocks'}

interface StatSummary { avg: number; std: number; cv: number; max: number; min: number }
interface Player {
  player_name: string; team: string; position: string; gp: number
  [key: string]: any
}
interface CompareResult {
  player1: Player; player2: Player; advantages: Record<string,string>
}

export default function ComparePage() {
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [result, setResult] = useState<CompareResult|null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string|null>(null)

  const run = async () => {
    if (!p1.trim() || !p2.trim()) return
    setLoading(true); setError(null); setResult(null)
    try {
      const r = await fetch(`${API}/insights/compare?p1=${encodeURIComponent(p1)}&p2=${encodeURIComponent(p2)}`)
      const d = await r.json()
      if (d.error) setError(d.error)
      else setResult(d)
    } catch { setError('Request failed') }
    setLoading(false)
  }

  const p1Name = result?.player1.player_name.split(' ').pop() || ''
  const p2Name = result?.player2.player_name.split(' ').pop() || ''

  return (
    <div style={{ minHeight:'100vh', background:'#080808', color:'#888', fontFamily:MONO }}>
      <div style={{ borderBottom:'1px solid #0f0f0f', padding:'16px 28px' }}>
        <div style={{ fontSize:'9px', color:'#2a2a2a', letterSpacing:'0.15em', marginBottom:'6px' }}>
          HEAD-TO-HEAD · 2025–26
        </div>
        <h1 style={{ fontSize:'22px', fontWeight:700, color:'#e0e0e0', margin:'0 0 4px' }}>Player vs Player</h1>
        <div style={{ fontFamily:MONO, fontSize:'10px', color:'#333' }}>
          Compare any two players — season averages, L10 splits, consistency, and per-stat edges
        </div>
      </div>

      <div style={{ maxWidth:'1000px', margin:'0 auto', padding:'32px 28px' }}>

        {/* Input */}
        <div style={{ display:'flex', gap:'12px', marginBottom:'32px', alignItems:'center', flexWrap:'wrap' }}>
          <input value={p1} onChange={e=>setP1(e.target.value)}
            placeholder="Player 1 — e.g. LeBron James"
            onKeyDown={e=>e.key==='Enter'&&run()}
            style={{ padding:'10px 14px', background:'#0a0a0a', border:'1px solid #1a1a1a',
              borderRadius:'4px', fontFamily:MONO, fontSize:'12px', color:'#e0e0e0',
              outline:'none', width:'240px' }} />
          <span style={{ fontFamily:MONO, fontSize:'13px', color:'#222', fontWeight:700 }}>VS</span>
          <input value={p2} onChange={e=>setP2(e.target.value)}
            placeholder="Player 2 — e.g. Kevin Durant"
            onKeyDown={e=>e.key==='Enter'&&run()}
            style={{ padding:'10px 14px', background:'#0a0a0a', border:'1px solid #1a1a1a',
              borderRadius:'4px', fontFamily:MONO, fontSize:'12px', color:'#e0e0e0',
              outline:'none', width:'240px' }} />
          <button onClick={run} disabled={loading} style={{
            padding:'10px 24px', background:loading?'#0a0a0a':'#e0e0e0',
            border:'none', borderRadius:'4px', cursor:loading?'default':'pointer',
            fontFamily:MONO, fontSize:'12px', fontWeight:700,
            color:loading?'#333':'#080808', letterSpacing:'0.06em' }}>
            {loading?'Loading...':'COMPARE'}
          </button>
        </div>

        {error && (
          <div style={{ fontFamily:MONO, fontSize:'11px', color:'#f87171',
            padding:'12px 16px', background:'#0a0a0a', border:'1px solid #1a1a1a',
            borderRadius:'4px', marginBottom:'20px' }}>{error}</div>
        )}

        {!result && !loading && !error && (
          <div style={{ padding:'60px', textAlign:'center', border:'1px solid #0f0f0f',
            borderRadius:'6px', fontFamily:MONO }}>
            <div style={{ fontSize:'12px', color:'#2a2a2a', marginBottom:'8px' }}>
              Enter two player names above
            </div>
            <div style={{ fontSize:'10px', color:'#1a1a1a' }}>
              Try: Stephen Curry vs Klay Thompson · or · LeBron James vs Kevin Durant
            </div>
          </div>
        )}

        {result && (
          <div>
            {/* Player headers */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 80px 1fr',
              marginBottom:'2px', gap:'2px' }}>
              {[result.player1, result.player2].map((p, i) => (
                <div key={p.player_name} style={{
                  gridColumn: i===0?1:3,
                  padding:'20px 24px',
                  background:'#0a0a0a', border:'1px solid #111', borderRadius:'4px',
                  textAlign: i===0?'right':'left',
                }}>
                  <div style={{ fontFamily:MONO, fontSize:'18px', fontWeight:700, color:'#e0e0e0' }}>
                    {p.player_name}
                  </div>
                  <div style={{ fontFamily:MONO, fontSize:'9px', color:'#333', marginTop:'4px' }}>
                    {p.team} · {p.position || '—'} · {p.gp} games
                  </div>
                </div>
              ))}
              <div style={{ gridColumn:2, display:'flex', alignItems:'center', justifyContent:'center' }}>
                <span style={{ fontFamily:MONO, fontSize:'11px', color:'#2a2a2a' }}>vs</span>
              </div>
            </div>

            {/* Stat rows */}
            <div style={{ background:'#0a0a0a', border:'1px solid #111', borderRadius:'4px', overflow:'hidden' }}>
              {/* Header */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 100px 120px 100px 1fr',
                padding:'8px 20px', borderBottom:'1px solid #1a1a1a',
                fontFamily:MONO, fontSize:'8px', color:'#2a2a2a', letterSpacing:'0.1em' }}>
                <span style={{ textAlign:'right' }}>{p1Name.toUpperCase()}</span>
                <span style={{ textAlign:'right' }}>L10</span>
                <span style={{ textAlign:'center' }}>STAT</span>
                <span>L10</span>
                <span>{p2Name.toUpperCase()}</span>
              </div>

              {STATS.map(s => {
                const v1 = result.player1[`${s}_season`] as StatSummary
                const v2 = result.player2[`${s}_season`] as StatSummary
                const v1l10 = result.player1[`${s}_l10`] as StatSummary
                const v2l10 = result.player2[`${s}_l10`] as StatSummary
                const adv = result.advantages[s]
                const p1wins = adv === result.player1.player_name
                const p2wins = adv === result.player2.player_name

                return (
                  <div key={s} style={{ display:'grid', gridTemplateColumns:'1fr 100px 120px 100px 1fr',
                    padding:'14px 20px', borderBottom:'1px solid #0d0d0d', alignItems:'center' }}>
                    {/* P1 season */}
                    <div style={{ textAlign:'right' }}>
                      <span style={{ fontFamily:MONO, fontSize:'22px', fontWeight:700,
                        color:p1wins?'#4ade80':'#555' }}>{v1?.avg??'—'}</span>
                      {v1 && <div style={{ fontFamily:MONO, fontSize:'8px', color:'#2a2a2a', marginTop:'2px' }}>
                        cv: {v1.cv}%
                      </div>}
                    </div>
                    {/* P1 L10 */}
                    <div style={{ textAlign:'right', fontFamily:MONO, fontSize:'12px',
                      color:v1l10&&v1?(v1l10.avg>v1.avg?'#4ade80':'#f87171'):'#333' }}>
                      {v1l10?.avg??'—'}
                    </div>
                    {/* Stat label + advantage */}
                    <div style={{ textAlign:'center' }}>
                      <div style={{ fontFamily:MONO, fontSize:'11px', color:'#444',
                        letterSpacing:'0.1em', marginBottom:'4px' }}>{STAT_LABEL[s]}</div>
                      <div style={{ fontFamily:MONO, fontSize:'8px', letterSpacing:'0.06em',
                        color: p1wins?'#60a5fa':p2wins?'#f97316':'#222' }}>
                        {p1wins ? `← ${p1Name}` : p2wins ? `${p2Name} →` : 'TIED'}
                      </div>
                    </div>
                    {/* P2 L10 */}
                    <div style={{ fontFamily:MONO, fontSize:'12px',
                      color:v2l10&&v2?(v2l10.avg>v2.avg?'#4ade80':'#f87171'):'#333' }}>
                      {v2l10?.avg??'—'}
                    </div>
                    {/* P2 season */}
                    <div>
                      <span style={{ fontFamily:MONO, fontSize:'22px', fontWeight:700,
                        color:p2wins?'#4ade80':'#555' }}>{v2?.avg??'—'}</span>
                      {v2 && <div style={{ fontFamily:MONO, fontSize:'8px', color:'#2a2a2a', marginTop:'2px' }}>
                        cv: {v2.cv}%
                      </div>}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Edge summary */}
            <div style={{ marginTop:'16px', padding:'14px 20px', background:'#0a0a0a',
              border:'1px solid #111', borderRadius:'4px', display:'flex', gap:'12px',
              flexWrap:'wrap', alignItems:'center' }}>
              <span style={{ fontFamily:MONO, fontSize:'9px', color:'#2a2a2a', letterSpacing:'0.12em' }}>EDGES</span>
              {Object.entries(result.advantages).map(([s, winner]) => {
                const isP1 = winner === result.player1.player_name
                const isP2 = winner === result.player2.player_name
                return (
                  <div key={s} style={{ display:'flex', alignItems:'center', gap:'4px' }}>
                    <span style={{ fontFamily:MONO, fontSize:'9px', color:'#333' }}>{STAT_FULL[s]}:</span>
                    <span style={{ fontFamily:MONO, fontSize:'9px', fontWeight:600,
                      color:isP1?'#60a5fa':isP2?'#f97316':'#333',
                      padding:'2px 6px', background:'#111', borderRadius:'2px' }}>
                      {isP1?p1Name:isP2?p2Name:'TIE'}
                    </span>
                  </div>
                )
              })}
            </div>

            <div style={{ marginTop:'10px', fontFamily:MONO, fontSize:'9px', color:'#1a1a1a' }}>
              Season avg · cv = coefficient of variation (lower = more consistent) · L10 = last 10 games
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
