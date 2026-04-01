'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const MONO = 'IBM Plex Mono, monospace'

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoryCard {
  type:     'hot' | 'cold' | 'breakout' | 'promo' | 'clutch' | 'playoffs' | 'trending'
  headline: string
  subline:  string
  value:    string
  valueLabel: string
  delta?:   string
  tag:      string
  tagColor: string
  link:     string
  cta:      string
}

interface BoardStats {
  total: number; strong_overs: number; strong_unders: number; players: number
}

// ─── Story builders ───────────────────────────────────────────────────────────

function buildStreakStories(pts: any, reb: any, ast: any): StoryCard[] {
  const stories: StoryCard[] = []
  const LABEL: Record<string,string> = {pts:'PPG',reb:'RPG',ast:'APG',fg3m:'3PM',stl:'SPG',blk:'BPG'}

  // Pick the single most surprising HOT streak across all stats
  const hotCandidates: any[] = []
  for (const [data, stat] of [[pts,'pts'],[reb,'reb'],[ast,'ast']] as [any,string][]) {
    const hot = (data?.hot || []).filter((p: any) => p.z_score >= 1.5)
    for (const p of hot) hotCandidates.push({...p, stat})
  }
  hotCandidates.sort((a,b) => b.z_score - a.z_score)

  if (hotCandidates.length > 0) {
    const p = hotCandidates[0]
    const label = LABEL[p.stat]
    const pct = Math.abs(p.pct_change).toFixed(0)
    stories.push({
      type: 'hot',
      headline: `${p.player_name} is on a tear right now`,
      subline:  `Averaging ${p.l5_avg} ${label} over his last 5 games — ${pct}% above his season average of ${p.season_avg}. That's ${p.z_score.toFixed(1)} standard deviations above his mean.`,
      value:    String(p.l5_avg),
      valueLabel: `${label} LAST 5`,
      delta:    `+${pct}%`,
      tag:      'HOT STREAK',
      tagColor: '#f97316',
      link:     '/insights',
      cta:      'SEE ALL STREAKS',
    })
  }

  // Pick the single most surprising COLD streak
  const coldCandidates: any[] = []
  for (const [data, stat] of [[pts,'pts'],[reb,'reb'],[ast,'ast']] as [any,string][]) {
    const cold = (data?.cold || []).filter((p: any) => p.z_score <= -1.5)
    for (const p of cold) coldCandidates.push({...p, stat})
  }
  coldCandidates.sort((a,b) => a.z_score - b.z_score)

  if (coldCandidates.length > 0) {
    const p = coldCandidates[0]
    const label = LABEL[p.stat]
    const pct = Math.abs(p.pct_change).toFixed(0)
    stories.push({
      type: 'cold',
      headline: `${p.player_name} has gone quiet — and it's not a small sample fluke`,
      subline:  `Just ${p.l5_avg} ${label} over his last 5 games, down ${pct}% from his ${p.season_avg} season average. Z-score of ${p.z_score.toFixed(1)} — statistically significant.`,
      value:    String(p.l5_avg),
      valueLabel: `${label} LAST 5`,
      delta:    `-${pct}%`,
      tag:      'COLD STREAK',
      tagColor: '#60a5fa',
      link:     '/insights',
      cta:      'SEE ALL STREAKS',
    })
  }

  return stories
}

function buildBreakoutStories(data: any): StoryCard[] {
  if (!data?.results?.length) return []
  const p = data.results[0]
  const diff = (p.pts_l5 - p.pts_season).toFixed(1)
  const minDiff = (p.min_l10 - p.min_season).toFixed(1)
  const positive = parseFloat(diff) > 0

  return [{
    type: 'breakout',
    headline: `${p.player_name} is getting more run — and taking full advantage`,
    subline:  `${p.pts_l5} PPG over his last 5 (${positive?'+':''}${diff} vs season avg), with ${parseFloat(minDiff)>0?'+':''}${minDiff} more minutes per game recently. Usage is trending up.`,
    value:    String(p.pts_l5),
    valueLabel: 'PPG LAST 5',
    delta:    `${positive?'+':''}${diff} pts`,
    tag:      'BREAKOUT ALERT',
    tagColor: '#a78bfa',
    link:     '/insights',
    cta:      'SEE ALL BREAKOUTS',
  }]
}

function buildClutchStory(data: any): StoryCard[] {
  if (!data?.results?.length) return []
  // Top clutch team by net rating
  const best = data.results.slice(0,3)
  if (!best.length) return []
  const t = best[0]
  return [{
    type: 'clutch',
    headline: `${t.team_name || t.team} are the best team when it matters most`,
    subline:  `Top clutch net rating in the NBA — the final 5 minutes of close games, where championships are decided.`,
    value:    t.net_rtg !== undefined ? `${t.net_rtg > 0 ? '+' : ''}${parseFloat(t.net_rtg).toFixed(1)}` : '—',
    valueLabel: 'CLUTCH NET RTG',
    tag:      'CLUTCH',
    tagColor: '#fbbf24',
    link:     '/clutch',
    cta:      'SEE CLUTCH RANKINGS',
  }]
}

function buildPlayoffsStory(): StoryCard[] {
  return [{
    type: 'playoffs',
    headline: `Who takes home the Larry O'Brien? Run the numbers yourself`,
    subline:  `Our Monte Carlo simulator runs up to 1 million seasons from the current standings. Lock in completed series, simulate what's left — from any point in the season.`,
    value:    '1M',
    valueLabel: 'SIMULATIONS',
    tag:      'PLAYOFF SIMULATOR',
    tagColor: '#4ade80',
    link:     '/playoffs',
    cta:      'OPEN SIMULATOR',
  }]
}

function buildTrendingStory(standings: any): StoryCard[] {
  if (!standings?.east?.length) return []
  // Find team with biggest positive net_rtg relative to their seed (overperforming)
  const all = [...(standings.east||[]), ...(standings.west||[])]
  const surprising = all
    .filter((t: any) => t.seed >= 4 && t.net_rtg > 3)
    .sort((a: any, b: any) => b.net_rtg - a.net_rtg)
  if (!surprising.length) return []
  const t = surprising[0]
  return [{
    type: 'trending',
    headline: `${t.team} are playing better than their record suggests`,
    subline:  `Seeded ${t.seed} in their conference at ${t.wins}-${t.losses}, but their net rating tells a different story. They could be a dangerous postseason team.`,
    value:    `+${parseFloat(t.net_rtg).toFixed(1)}`,
    valueLabel: 'NET RATING',
    tag:      'TRENDING UP',
    tagColor: '#34d399',
    link:     '/playoffs',
    cta:      'SEE STANDINGS',
  }]
}

function buildPromoStory(): StoryCard[] {
  return [{
    type: 'promo',
    headline: `Curious what our model says about tonight's player performances?`,
    subline:  `We run distribution-based predictions using Bayesian shrinkage, positional opponent defense, and injury-adjusted usage boosts — updated 3x daily before tip-off.`,
    value:    'v14',
    valueLabel: 'MODEL VERSION',
    tag:      'PROPS MODEL',
    tagColor: '#4ade80',
    link:     '/props',
    cta:      'SEE THE PROPS BOARD',
  }]
}

// ─── Carousel ─────────────────────────────────────────────────────────────────

function Card({ card, visible }: { card: StoryCard; visible: boolean }) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(10px)',
      transition: 'opacity 0.6s ease, transform 0.6s ease',
      pointerEvents: visible ? 'auto' : 'none',
      padding: '32px 40px',
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    }}>
      {/* Tag row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{
          fontFamily: MONO, fontSize: '9px', letterSpacing: '0.18em',
          color: card.tagColor, padding: '4px 10px',
          border: `1px solid ${card.tagColor}50`,
          borderRadius: '2px', background: `${card.tagColor}12`,
        }}>{card.tag}</span>
      </div>

      {/* Middle */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', marginBottom: '16px' }}>
          <span style={{
            fontFamily: MONO, fontSize: '60px', fontWeight: 700,
            color: card.tagColor, lineHeight: 1, letterSpacing: '-0.03em',
          }}>{card.value}</span>
          <div>
            {card.delta && (
              <div style={{ fontFamily: MONO, fontSize: '14px', fontWeight: 600,
                color: card.type === 'cold' ? '#93c5fd' : '#4ade80', marginBottom: '2px' }}>
                {card.delta}
              </div>
            )}
            <div style={{ fontFamily: MONO, fontSize: '8px', color: '#2a2a2a',
              letterSpacing: '0.12em' }}>{card.valueLabel}</div>
          </div>
        </div>
        <div style={{ fontFamily: MONO, fontSize: '20px', fontWeight: 700, color: '#e0e0e0',
          lineHeight: 1.3, marginBottom: '10px', maxWidth: '580px', letterSpacing: '-0.01em' }}>
          {card.headline}
        </div>
        <div style={{ fontFamily: MONO, fontSize: '11px', color: '#3a3a3a',
          lineHeight: 1.7, maxWidth: '520px' }}>
          {card.subline}
        </div>
      </div>

      {/* CTA */}
      <Link href={card.link} style={{
        display: 'inline-flex', alignItems: 'center', gap: '8px',
        fontFamily: MONO, fontSize: '10px', color: card.tagColor,
        textDecoration: 'none', letterSpacing: '0.12em',
        borderBottom: `1px solid ${card.tagColor}40`, paddingBottom: '2px',
        width: 'fit-content',
      }}>
        {card.cta} →
      </Link>
    </div>
  )
}

function Carousel({ stories }: { stories: StoryCard[] }) {
  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pausedRef = useRef(false)

  // Keep pausedRef in sync
  useEffect(() => { pausedRef.current = paused }, [paused])

  // Auto-advance — simple stable interval
  useEffect(() => {
    if (stories.length < 2) return
    intervalRef.current = setInterval(() => {
      if (!pausedRef.current) {
        setIdx(i => (i + 1) % stories.length)
      }
    }, 7000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [stories.length]) // only re-run if story count changes

  if (!stories.length) return (
    <div style={{ height: '300px', background: '#0a0a0a', border: '1px solid #111',
      borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: MONO, fontSize: '10px', color: '#1a1a1a' }}>
      Generating stories...
    </div>
  )

  const card = stories[idx]

  return (
    <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {/* Card */}
      <div style={{ position: 'relative', height: '300px', background: '#0a0a0a',
        border: '1px solid #111', borderRadius: '6px', overflow: 'hidden' }}>
        {/* Glow */}
        <div style={{
          position: 'absolute', top: 0, right: 0, width: '260px', height: '100%',
          background: `radial-gradient(ellipse at top right, ${card.tagColor}0a 0%, transparent 65%)`,
          pointerEvents: 'none', transition: 'background 0.6s',
        }} />
        {/* Left accent */}
        <div style={{
          position: 'absolute', left: 0, top: '24px', bottom: '24px', width: '2px',
          background: card.tagColor, opacity: 0.5, borderRadius: '1px',
          transition: 'background 0.6s',
        }} />
        {stories.map((s, i) => <Card key={i} card={s} visible={i === idx} />)}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '14px', padding: '0 2px' }}>
        <button onClick={() => setIdx(i => (i - 1 + stories.length) % stories.length)}
          style={{ background:'none', border:'1px solid #111', borderRadius:'3px',
            padding:'4px 10px', cursor:'pointer', fontFamily:MONO, fontSize:'11px', color:'#333' }}>
          ←
        </button>
        <button onClick={() => setIdx(i => (i + 1) % stories.length)}
          style={{ background:'none', border:'1px solid #111', borderRadius:'3px',
            padding:'4px 10px', cursor:'pointer', fontFamily:MONO, fontSize:'11px', color:'#333' }}>
          →
        </button>

        {/* Progress dots */}
        <div style={{ display:'flex', gap:'5px', flex:1 }}>
          {stories.map((s, i) => (
            <button key={i} onClick={() => setIdx(i)} style={{
              height: '5px', width: i === idx ? '20px' : '5px',
              background: i === idx ? s.tagColor : '#1a1a1a',
              border: 'none', borderRadius: '3px', cursor: 'pointer', padding: 0,
              transition: 'width 0.35s ease, background 0.35s ease',
            }} />
          ))}
        </div>

        <span style={{ fontFamily:MONO, fontSize:'9px', color:'#1a1a1a' }}>
          {String(idx+1).padStart(2,'0')} / {String(stories.length).padStart(2,'0')}
        </span>

        {/* Live dot */}
        <div style={{ display:'flex', alignItems:'center', gap:'4px' }}>
          <div style={{
            width:'5px', height:'5px', borderRadius:'50%',
            background: paused ? '#222' : '#4ade80',
            boxShadow: paused ? 'none' : '0 0 5px #4ade80',
            transition: 'all 0.3s',
          }} />
          <span style={{ fontFamily:MONO, fontSize:'8px', color:'#1a1a1a' }}>
            {paused ? 'PAUSED' : 'AUTO'}
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Live ticker ──────────────────────────────────────────────────────────────

function Ticker({ stats }: { stats: BoardStats | null }) {
  const items = [
    stats ? `${stats.total} props today` : 'Props updated 3x daily',
    '2025–26 NBA season',
    'Model v14 · Bayesian shrinkage',
    stats ? `${stats.players} players tracked` : 'All 30 teams',
    'Playoff simulator · up to 1M sims',
    'Hot/cold streaks · breakout detection',
    'Positional opponent defense profiles',
  ]
  const rep = [...items,...items,...items]
  return (
    <div style={{ overflow:'hidden', borderTop:'1px solid #0f0f0f',
      borderBottom:'1px solid #0f0f0f', padding:'8px 0', background:'#080808' }}>
      <div style={{ display:'flex', gap:'48px', whiteSpace:'nowrap',
        animation:'ticker-scroll 28s linear infinite' }}>
        {rep.map((item,i) => (
          <span key={i} style={{ fontFamily:MONO, fontSize:'9px', color:'#222',
            letterSpacing:'0.12em', flexShrink:0 }}>
            {i % items.length === 0 && <span style={{ color:'#4ade80', marginRight:'16px' }}>●</span>}
            {item.toUpperCase()}
          </span>
        ))}
      </div>
      <style>{`@keyframes ticker-scroll{0%{transform:translateX(0)}100%{transform:translateX(-33.33%)}}`}</style>
    </div>
  )
}

// ─── Quick nav ────────────────────────────────────────────────────────────────

const NAV = [
  { label:'Props Board',    sub:'Model predictions',  href:'/props',     color:'#4ade80' },
  { label:'Insights',       sub:'Streaks · Breakouts', href:'/insights',  color:'#a78bfa' },
  { label:'Playoffs',       sub:'Simulate the race',  href:'/playoffs',  color:'#fbbf24' },
  { label:'Head-to-Head',   sub:'Player comparisons', href:'/compare',   color:'#60a5fa' },
  { label:'Matchups',       sub:'Difficulty ratings', href:'/matchup',   color:'#f97316' },
  { label:'Player Profiles',sub:'574 players',        href:'/profiles',  color:'#888'    },
]

function QuickNav() {
  const [hov, setHov] = useState<number|null>(null)
  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px' }}>
      {NAV.map((m,i) => (
        <Link key={m.href} href={m.href} style={{ textDecoration:'none' }}>
          <div onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)}
            style={{ padding:'13px 16px',
              background: hov===i?'#0d0d0d':'#0a0a0a',
              border:`1px solid ${hov===i?m.color+'25':'#111'}`,
              borderRadius:'4px', cursor:'pointer', transition:'all 0.15s' }}>
            <div style={{ fontFamily:MONO, fontSize:'11px', fontWeight:700,
              color: hov===i?m.color:'#666', marginBottom:'3px', transition:'color 0.15s' }}>
              {m.label}
            </div>
            <div style={{ fontFamily:MONO, fontSize:'9px', color:'#2a2a2a' }}>{m.sub}</div>
          </div>
        </Link>
      ))}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [stories,    setStories]    = useState<StoryCard[]>([])
  const [boardStats, setBoardStats] = useState<BoardStats|null>(null)
  const today = new Date().toLocaleDateString('en-US',
    {weekday:'long', month:'long', day:'numeric'})

  useEffect(() => {
    fetch(`${API}/props/board/stats`).then(r=>r.json()).then(setBoardStats).catch(()=>{})

    const load = async () => {
      const [ptsDat, rebDat, astDat, breakoutDat, clutchDat, standingsDat] =
        await Promise.allSettled([
          fetch(`${API}/insights/streaks?stat=pts&min_gp=10&limit=16`).then(r=>r.json()),
          fetch(`${API}/insights/streaks?stat=reb&min_gp=10&limit=8`).then(r=>r.json()),
          fetch(`${API}/insights/streaks?stat=ast&min_gp=10&limit=8`).then(r=>r.json()),
          fetch(`${API}/insights/breakout?limit=5`).then(r=>r.json()),
          fetch(`${API}/clutch`).then(r=>r.json()),
          fetch(`${API}/playoffs/standings`).then(r=>r.json()),
        ])

      const pts      = ptsDat.status      === 'fulfilled' ? ptsDat.value      : null
      const reb      = rebDat.status      === 'fulfilled' ? rebDat.value      : null
      const ast      = astDat.status      === 'fulfilled' ? astDat.value      : null
      const breakout = breakoutDat.status === 'fulfilled' ? breakoutDat.value : null
      const clutch   = clutchDat.status   === 'fulfilled' ? clutchDat.value   : null
      const standings= standingsDat.status=== 'fulfilled' ? standingsDat.value: null

      const built: StoryCard[] = [
        // 1. Surprising hot streak
        ...buildStreakStories(pts, reb, ast).filter(s => s.type === 'hot').slice(0,1),
        // 2. Surprising cold streak
        ...buildStreakStories(pts, reb, ast).filter(s => s.type === 'cold').slice(0,1),
        // 3. Breakout
        ...buildBreakoutStories(breakout),
        // 4. Playoffs promo
        ...buildPlayoffsStory(),
        // 5. Clutch teams
        ...buildClutchStory(clutch),
        // 6. Trending team
        ...buildTrendingStory(standings),
        // 7. Props promo — always last
        ...buildPromoStory(),
      ]

      setStories(built)
    }

    load()
  }, [])

  return (
    <div style={{ minHeight:'100vh', background:'#080808', color:'#888' }}>
      <Ticker stats={boardStats} />

      <div style={{ maxWidth:'1100px', margin:'0 auto', padding:'40px 28px' }}>
        {/* Header */}
        <div style={{ marginBottom:'36px' }}>
          <div style={{ fontFamily:MONO, fontSize:'9px', color:'#222',
            letterSpacing:'0.18em', marginBottom:'12px' }}>
            {today.toUpperCase()} · NBA · 2025–26
          </div>
          <h1 style={{ fontSize:'34px', fontWeight:700, color:'#e0e0e0',
            margin:'0 0 8px', fontFamily:MONO, letterSpacing:'-0.02em', lineHeight:1.15 }}>
            What's happening<br />
            <span style={{ color:'#4ade80' }}>in the NBA right now.</span>
          </h1>
          <div style={{ fontFamily:MONO, fontSize:'11px', color:'#333', marginTop:'10px' }}>
            Daily intelligence on streaks, breakouts, matchups, and playoff odds.
          </div>
        </div>

        {/* Two columns */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 320px', gap:'24px', alignItems:'start' }}>

          {/* Left: carousel */}
          <div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
              marginBottom:'12px' }}>
              <span style={{ fontFamily:MONO, fontSize:'9px', color:'#2a2a2a', letterSpacing:'0.15em' }}>
                TODAY'S STORIES
              </span>
              <Link href="/insights" style={{ fontFamily:MONO, fontSize:'9px', color:'#2a2a2a',
                textDecoration:'none', letterSpacing:'0.1em',
                borderBottom:'1px solid #1a1a1a', paddingBottom:'1px' }}>
                ALL INSIGHTS →
              </Link>
            </div>
            <Carousel stories={stories} />
          </div>

          {/* Right column */}
          <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
            {/* Board stats */}
            {boardStats && (
              <div style={{ background:'#0a0a0a', border:'1px solid #111',
                borderRadius:'4px', padding:'16px 18px' }}>
                <div style={{ fontFamily:MONO, fontSize:'9px', color:'#2a2a2a',
                  letterSpacing:'0.15em', marginBottom:'14px' }}>PROPS · TODAY</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
                  {[
                    {label:'Total Props',   val:boardStats.total,         color:'#e0e0e0'},
                    {label:'Strong Overs',  val:boardStats.strong_overs,  color:'#4ade80'},
                    {label:'Strong Unders', val:boardStats.strong_unders, color:'#f87171'},
                    {label:'Players',       val:boardStats.players,       color:'#555'},
                  ].map(x => (
                    <div key={x.label}>
                      <div style={{ fontFamily:MONO, fontSize:'22px', fontWeight:700,
                        color:x.color, lineHeight:1 }}>{x.val}</div>
                      <div style={{ fontFamily:MONO, fontSize:'8px', color:'#2a2a2a',
                        letterSpacing:'0.1em', marginTop:'3px' }}>{x.label.toUpperCase()}</div>
                    </div>
                  ))}
                </div>
                <Link href="/props" style={{ display:'block', marginTop:'14px',
                  fontFamily:MONO, fontSize:'9px', color:'#4ade80', textDecoration:'none',
                  letterSpacing:'0.1em', borderTop:'1px solid #111', paddingTop:'10px' }}>
                  VIEW PROPS BOARD →
                </Link>
              </div>
            )}

            {/* Quick nav */}
            <div>
              <div style={{ fontFamily:MONO, fontSize:'9px', color:'#2a2a2a',
                letterSpacing:'0.15em', marginBottom:'10px' }}>EXPLORE</div>
              <QuickNav />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
