'use client'

import { useState } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const MONO = 'IBM Plex Mono, monospace'
const STATS = ['pts','reb','ast','fg3m','stl','blk']
const STAT_LABEL: Record<string,string> = {pts:'PTS',reb:'REB',ast:'AST',fg3m:'3PM',stl:'STL',blk:'BLK'}

interface MatchupStat {
  player_avg: number; adj_expected: number; def_ratio: number
  difficulty: string; hist_avg: number|null; hist_games: number
}
interface MatchupResult {
  player_name: string; team: string; position: string; opponent: string
  overall: string; avg_def_ratio: number
  stats: Record<string, MatchupStat>
  vs_games: {pts:number;reb:number;ast:number;minutes:number;game_date:string}[]
}

function diffColor(d: string) {
  return d==='easy'?'#4ade80':d==='tough'?'#f87171':'#888'
}

// Example matchup suggestions
const EXAMPLES = [
  { player: 'Stephen Curry', opp: 'BOS' },
  { player: 'Nikola Jokic', opp: 'LAL' },
  { player: 'Shai Gilgeous-Alexander', opp: 'DEN' },
  { player: 'Jaylen Brown', opp: 'NYK' },
]

export default function MatchupPage() {
  const [player, setPlayer] = useState('')
  const [opp, setOpp]       = useState('')
  const [result, setResult] = useState<MatchupResult|null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string|null>(null)

  const run = async (p?: string, o?: string) => {
    const pl = p || player; const op = o || opp
    if (!pl.trim() || !op.trim()) return
    setLoading(true); setError(null); setResult(null)
    try {
      const r = await fetch(`${API}/insights/matchup?player=${encodeURIComponent(pl)}&opp=${encodeURIComponent(op)}`)
      const d = await r.json()
      if (d.error) setError(d.error)
      else setResult(d)
    } catch { setError('Request failed') }
    setLoading(false)
  }

  const useExample = (ex: typeof EXAMPLES[0]) => {
    setPlayer(ex.player); setOpp(ex.opp); run(ex.player, ex.opp)
  }

  const overallColor = result ? diffColor(result.overall) : '#888'

  return (
    <div style={{ minHeight:'100vh', background:'#080808', color:'#888', fontFamily:MONO }}>
      <div style={{ borderBottom:'1px solid #0f0f0f', padding:'16px 28px' }}>
        <div style={{ fontSize:'9px', color:'#2a2a2a', letterSpacing:'0.15em', marginBottom:'6px' }}>
          MATCHUP ANALYSIS · 2025–26
        </div>
        <h1 style={{ fontSize:'22px', fontWeight:700, color:'#e0e0e0', margin:'0 0 4px' }}>Matchup Difficulty</h1>
        <div style={{ fontFamily:MONO, fontSize:'10px', color:'#333' }}>
          How tough is tonight's matchup? Defensive profiles + historical head-to-head data
        </div>
      </div>

      <div style={{ maxWidth:'1000px', margin:'0 auto', padding:'32px 28px' }}>

        {/* Input */}
        <div style={{ display:'flex', gap:'12px', marginBottom:'16px', alignItems:'center', flexWrap:'wrap' }}>
          <input value={player} onChange={e=>setPlayer(e.target.value)}
            placeholder="Player name — e.g. LeBron James"
            onKeyDown={e=>e.key==='Enter'&&run()}
            style={{ padding:'10px 14px', background:'#0a0a0a', border:'1px solid #1a1a1a',
              borderRadius:'4px', fontFamily:MONO, fontSize:'12px', color:'#e0e0e0',
              outline:'none', width:'260px' }} />
          <span style={{ fontFamily:MONO, fontSize:'11px', color:'#333' }}>vs</span>
          <input value={opp} onChange={e=>setOpp(e.target.value.toUpperCase())}
            placeholder="Team (e.g. BOS)"
            onKeyDown={e=>e.key==='Enter'&&run()}
            style={{ padding:'10px 14px', background:'#0a0a0a', border:'1px solid #1a1a1a',
              borderRadius:'4px', fontFamily:MONO, fontSize:'12px', color:'#e0e0e0',
              outline:'none', width:'130px' }} />
          <button onClick={() => run()} disabled={loading} style={{
            padding:'10px 24px', background:loading?'#0a0a0a':'#e0e0e0',
            border:'none', borderRadius:'4px', cursor:loading?'default':'pointer',
            fontFamily:MONO, fontSize:'12px', fontWeight:700,
            color:loading?'#333':'#080808', letterSpacing:'0.06em' }}>
            {loading?'Analyzing...':'ANALYZE'}
          </button>
        </div>

        {/* Example pills */}
        <div style={{ display:'flex', gap:'6px', marginBottom:'28px', flexWrap:'wrap', alignItems:'center' }}>
          <span style={{ fontFamily:MONO, fontSize:'9px', color:'#2a2a2a' }}>TRY:</span>
          {EXAMPLES.map(ex => (
            <button key={ex.player+ex.opp} onClick={()=>useExample(ex)} style={{
              padding:'4px 10px', background:'none', border:'1px solid #111',
              borderRadius:'3px', cursor:'pointer', fontFamily:MONO, fontSize:'9px',
              color:'#333', letterSpacing:'0.04em',
              transition:'color 0.15s, border-color 0.15s',
            }}
            onMouseEnter={e=>{e.currentTarget.style.color='#e0e0e0';e.currentTarget.style.borderColor='#333'}}
            onMouseLeave={e=>{e.currentTarget.style.color='#333';e.currentTarget.style.borderColor='#111'}}>
              {ex.player} vs {ex.opp}
            </button>
          ))}
        </div>

        {error && (
          <div style={{ fontFamily:MONO, fontSize:'11px', color:'#f87171',
            padding:'12px 16px', background:'#0a0a0a', border:'1px solid #1a1a1a',
            borderRadius:'4px', marginBottom:'20px' }}>{error}</div>
        )}

        {!result && !loading && !error && (
          <div style={{ padding:'60px', textAlign:'center', border:'1px solid #0f0f0f',
            borderRadius:'6px' }}>
            <div style={{ fontFamily:MONO, fontSize:'12px', color:'#2a2a2a', marginBottom:'8px' }}>
              Enter a player and opponent team to see matchup difficulty
            </div>
            <div style={{ fontFamily:MONO, fontSize:'10px', color:'#1a1a1a' }}>
              Uses positional defensive profiles + this season's head-to-head game logs
            </div>
          </div>
        )}

        {result && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>

            {/* Stat breakdown */}
            <div style={{ background:'#0a0a0a', border:'1px solid #111', borderRadius:'4px', overflow:'hidden' }}>
              {/* Header */}
              <div style={{ padding:'16px 20px', borderBottom:'1px solid #111',
                display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ fontFamily:MONO, fontSize:'15px', fontWeight:700, color:'#e0e0e0' }}>
                    {result.player_name}
                  </div>
                  <div style={{ fontFamily:MONO, fontSize:'9px', color:'#333', marginTop:'3px' }}>
                    {result.team} · {result.position} · vs {result.opponent}
                  </div>
                </div>
                <div style={{ textAlign:'right' }}>
                  <div style={{ fontFamily:MONO, fontSize:'9px', color:'#2a2a2a',
                    letterSpacing:'0.1em', marginBottom:'4px' }}>OVERALL</div>
                  <div style={{ fontFamily:MONO, fontSize:'16px', fontWeight:700,
                    color:overallColor, letterSpacing:'0.08em' }}>
                    {result.overall.toUpperCase()}
                  </div>
                  <div style={{ fontFamily:MONO, fontSize:'8px', color:'#2a2a2a', marginTop:'2px' }}>
                    ratio: {result.avg_def_ratio.toFixed(3)}x
                  </div>
                </div>
              </div>

              {/* Column headers */}
              <div style={{ display:'grid', gridTemplateColumns:'60px 65px 75px 65px 90px',
                padding:'6px 20px', fontFamily:MONO, fontSize:'8px', color:'#2a2a2a',
                letterSpacing:'0.1em', borderBottom:'1px solid #0f0f0f' }}>
                <span>STAT</span><span>AVG</span><span>PROJECTED</span>
                <span>RATIO</span><span>DIFFICULTY</span>
              </div>

              {STATS.map(s => {
                const sr = result.stats[s]
                if (!sr) return null
                const dc = diffColor(sr.difficulty)
                const better = sr.adj_expected > sr.player_avg
                return (
                  <div key={s} style={{ display:'grid', gridTemplateColumns:'60px 65px 75px 65px 90px',
                    padding:'11px 20px', borderBottom:'1px solid #0d0d0d', alignItems:'center' }}>
                    <span style={{ fontFamily:MONO, fontSize:'10px', color:'#444',
                      letterSpacing:'0.08em' }}>{STAT_LABEL[s]}</span>
                    <span style={{ fontFamily:MONO, fontSize:'13px', color:'#666' }}>{sr.player_avg}</span>
                    <div>
                      <span style={{ fontFamily:MONO, fontSize:'15px', fontWeight:700, color:dc }}>
                        {sr.adj_expected}
                      </span>
                      <span style={{ fontFamily:MONO, fontSize:'9px', marginLeft:'4px',
                        color:better?'#4ade80':'#f87171' }}>
                        {better?'↑':'↓'}
                      </span>
                    </div>
                    <span style={{ fontFamily:MONO, fontSize:'10px', color:'#444' }}>
                      {sr.def_ratio.toFixed(2)}x
                    </span>
                    <span style={{ fontFamily:MONO, fontSize:'10px', color:dc,
                      letterSpacing:'0.06em' }}>{sr.difficulty.toUpperCase()}</span>
                  </div>
                )
              })}

              <div style={{ padding:'10px 20px', fontFamily:MONO, fontSize:'8px', color:'#1a1a1a',
                borderTop:'1px solid #0f0f0f' }}>
                ratio {'>'} 1.10 = easy · {'<'} 0.92 = tough · projected = avg × def_ratio
              </div>
            </div>

            {/* Historical vs opponent */}
            <div style={{ background:'#0a0a0a', border:'1px solid #111', borderRadius:'4px', overflow:'hidden' }}>
              <div style={{ padding:'16px 20px', borderBottom:'1px solid #111',
                fontFamily:MONO, fontSize:'10px', color:'#444', letterSpacing:'0.1em' }}>
                {result.player_name.split(' ')[0].toUpperCase()} vs {result.opponent} THIS SEASON · {result.vs_games.length} GAMES
              </div>

              {result.vs_games.length === 0 ? (
                <div style={{ padding:'32px 20px', fontFamily:MONO, fontSize:'11px', color:'#2a2a2a',
                  textAlign:'center' }}>
                  No games vs {result.opponent} this season
                </div>
              ) : (
                <>
                  <div style={{ display:'grid', gridTemplateColumns:'80px 55px 55px 55px 55px',
                    padding:'6px 20px', fontFamily:MONO, fontSize:'8px', color:'#2a2a2a',
                    letterSpacing:'0.1em', borderBottom:'1px solid #0f0f0f' }}>
                    <span>DATE</span><span>PTS</span><span>REB</span><span>AST</span><span>MIN</span>
                  </div>
                  {result.vs_games.map((g,i) => (
                    <div key={i} style={{ display:'grid', gridTemplateColumns:'80px 55px 55px 55px 55px',
                      padding:'9px 20px', borderBottom:'1px solid #0d0d0d',
                      background:i%2===0?'transparent':'#080808' }}>
                      <span style={{ fontFamily:MONO, fontSize:'9px', color:'#333' }}>
                        {String(g.game_date).slice(5)}
                      </span>
                      <span style={{ fontFamily:MONO, fontSize:'13px', fontWeight:600, color:'#e0e0e0' }}>{g.pts}</span>
                      <span style={{ fontFamily:MONO, fontSize:'12px', color:'#888' }}>{g.reb}</span>
                      <span style={{ fontFamily:MONO, fontSize:'12px', color:'#888' }}>{g.ast}</span>
                      <span style={{ fontFamily:MONO, fontSize:'11px', color:'#555' }}>{Math.round(g.minutes)}</span>
                    </div>
                  ))}
                  {/* Season avg row */}
                  {(() => {
                    const n = result.vs_games.length
                    const avg = (k: keyof typeof result.vs_games[0]) =>
                      (result.vs_games.reduce((s,g) => s+(Number(g[k])||0), 0)/n).toFixed(1)
                    return (
                      <div style={{ display:'grid', gridTemplateColumns:'80px 55px 55px 55px 55px',
                        padding:'9px 20px', borderTop:'1px solid #1a1a1a', background:'#0d0d0d' }}>
                        <span style={{ fontFamily:MONO, fontSize:'8px', color:'#2a2a2a',
                          letterSpacing:'0.08em' }}>AVG</span>
                        <span style={{ fontFamily:MONO, fontSize:'13px', fontWeight:700, color:'#4ade80' }}>{avg('pts')}</span>
                        <span style={{ fontFamily:MONO, fontSize:'12px', color:'#4ade80' }}>{avg('reb')}</span>
                        <span style={{ fontFamily:MONO, fontSize:'12px', color:'#4ade80' }}>{avg('ast')}</span>
                        <span style={{ fontFamily:MONO, fontSize:'11px', color:'#555' }}>{avg('minutes')}</span>
                      </div>
                    )
                  })()}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
