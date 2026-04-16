'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

// ─── Dot Grid Background ──────────────────────────────────────────────────────

function DotGrid() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef  = useRef({ x: -999, y: -999 })
  const frameRef  = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const DOT_SPACING = 28
    const DOT_R = 1.2
    const GLOW_RADIUS = 120
    let W = 0, H = 0, dots: {x:number;y:number}[] = []

    const resize = () => {
      W = canvas.width  = canvas.offsetWidth
      H = canvas.height = canvas.offsetHeight
      dots = []
      for (let x = DOT_SPACING/2; x < W; x += DOT_SPACING)
        for (let y = DOT_SPACING/2; y < H; y += DOT_SPACING)
          dots.push({x, y})
    }
    resize()
    window.addEventListener('resize', resize)

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('mouseleave', () => { mouseRef.current = {x:-999,y:-999} })

    const draw = () => {
      ctx.clearRect(0, 0, W, H)
      const mx = mouseRef.current.x, my = mouseRef.current.y
      for (const d of dots) {
        const dx = d.x - mx, dy = d.y - my
        const dist = Math.sqrt(dx*dx + dy*dy)
        const t = Math.max(0, 1 - dist/GLOW_RADIUS)
        const alpha = 0.12 + t * 0.65
        const r = DOT_R + t * 1.8
        ctx.beginPath()
        ctx.arc(d.x, d.y, r, 0, Math.PI*2)
        ctx.fillStyle = t > 0.1
          ? `rgba(200,241,53,${alpha})`
          : `rgba(120,118,114,${alpha})`
        ctx.fill()
      }
      frameRef.current = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      cancelAnimationFrame(frameRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas ref={canvasRef} style={{
      position: 'absolute', inset: 0, width: '100%', height: '100%',
      pointerEvents: 'auto',
    }} />
  )
}

// ─── Decrypted text reveal ────────────────────────────────────────────────────

function DecryptText({ text, delay = 0, className = '' }: { text: string; delay?: number; className?: string }) {
  const [displayed, setDisplayed] = useState('')
  const [done, setDone] = useState(false)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

  useEffect(() => {
    let t0 = setTimeout(() => {
      let iteration = 0
      const interval = setInterval(() => {
        setDisplayed(
          text.split('').map((c, i) => {
            if (c === ' ') return ' '
            if (i < iteration) return text[i]
            return chars[Math.floor(Math.random() * chars.length)]
          }).join('')
        )
        if (iteration >= text.length) { clearInterval(interval); setDone(true) }
        iteration += 0.4
      }, 40)
    }, delay)
    return () => clearTimeout(t0)
  }, [text, delay])

  return <span className={className}>{done ? text : (displayed || text)}</span>
}

// ─── Count Up ────────────────────────────────────────────────────────────────

function CountUp({ end, suffix = '', duration = 1800 }: { end: number; suffix?: string; duration?: number }) {
  const [val, setVal] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  const started = useRef(false)

  useEffect(() => {
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !started.current) {
        started.current = true
        const start = performance.now()
        const tick = (now: number) => {
          const p = Math.min((now - start) / duration, 1)
          const eased = 1 - Math.pow(1 - p, 3)
          setVal(Math.round(eased * end))
          if (p < 1) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }
    }, { threshold: 0.5 })
    if (ref.current) obs.observe(ref.current)
    return () => obs.disconnect()
  }, [end, duration])

  return <span ref={ref}>{val.toLocaleString()}{suffix}</span>
}

// ─── Fade in on scroll ────────────────────────────────────────────────────────

function FadeIn({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [vis, setVis] = useState(false)

  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setVis(true); obs.disconnect() }
    }, { threshold: 0.15 })
    if (ref.current) obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])

  return (
    <div ref={ref} style={{
      opacity: vis ? 1 : 0,
      transform: vis ? 'translateY(0)' : 'translateY(20px)',
      transition: `opacity 0.7s ease ${delay}ms, transform 0.7s ease ${delay}ms`,
    }}>
      {children}
    </div>
  )
}

// ─── Scrolling ticker ─────────────────────────────────────────────────────────

function ScrollTicker({ items }: { items: string[] }) {
  const rep = [...items, ...items, ...items]
  return (
    <div style={{ overflow: 'hidden', borderTop: '1px solid #1f1f24',
      borderBottom: '1px solid #1f1f24', padding: '10px 0', background: '#0e0e12' }}>
      <div style={{ display: 'flex', gap: '48px', whiteSpace: 'nowrap',
        animation: 'ticker 25s linear infinite' }}>
        {rep.map((item, i) => (
          <span key={i} style={{ fontFamily: 'DM Mono, monospace', fontSize: '10px',
            color: '#55534f', letterSpacing: '0.12em', flexShrink: 0 }}>
            {i % items.length === 0
              ? <span style={{ color: '#c8f135', marginRight: '12px' }}>◆</span>
              : null}
            {item.toUpperCase()}
          </span>
        ))}
      </div>
      <style>{`
        @keyframes ticker { 0%{transform:translateX(0)} 100%{transform:translateX(-33.33%)} }
      `}</style>
    </div>
  )
}

// ─── Story types ──────────────────────────────────────────────────────────────

interface Story {
  tag: string; headline: string; context: string
  link: string; cta: string; accent: string
}

function buildStories(overall: any, breakout: any, standings: any): Story[] {
  const stories: Story[] = []
  const dimWord: Record<string,string> = {
    scoring:'has been scoring at will', playmaking:'is facilitating at a new level',
    rebounding:'is dominating the glass', defense:'is locking opponents down',
    efficiency:'is playing his most efficient basketball', minutes:'is getting major run',
  }

  const hot = (overall?.hot||[]).find((p:any) => p.composite_z >= 1.2)
  if (hot) stories.push({
    tag:'Hot streak', accent:'#f97316',
    headline:`${hot.player_name} ${dimWord[hot.best_stat]||'is on a tear'}.`,
    context:'Production has trended sharply upward over the past two weeks.',
    link:'/insights', cta:'See all streaks',
  })

  const cold = (overall?.cold||[]).find((p:any) => p.composite_z <= -1.2)
  if (cold) stories.push({
    tag:'Cold streak', accent:'#5b8ef0',
    headline:`${cold.player_name} has gone quiet.`,
    context:'Output has dipped from his season baseline over recent games.',
    link:'/insights', cta:'See breakdown',
  })

  const top = breakout?.results?.[0]
  if (top) {
    const dimLabel: Record<string,string> = {
      efficiency:'overall efficiency', playmaking:'playmaking', rebounding:'rebounding',
      defense:'defensive impact', scoring:'scoring efficiency', minutes:'role expansion',
    }
    stories.push({
      tag:'Breakout watch', accent:'#c8f135',
      headline:`${top.player_name} is trending in the right direction.`,
      context:`Our model flags a meaningful jump in ${dimLabel[top.lead_dimension]||'efficiency'} over the last 10 games.`,
      link:'/insights', cta:'See breakout players',
    })
  }

  stories.push({
    tag:'Playoffs', accent:'#c8f135',
    headline:"The race for the Larry O'Brien is wide open.",
    context:'Simulate the full postseason from current standings. Up to 1 million scenarios.',
    link:'/playoffs', cta:'Open simulator',
  })

  if (standings) {
    const all = [...(standings.east||[]), ...(standings.west||[])]
    const t = all.filter((t:any) => t.seed>=5 && t.net_rtg>3).sort((a:any,b:any)=>b.net_rtg-a.net_rtg)[0]
    if (t) stories.push({
      tag:'Playoff picture', accent:'#f97316',
      headline:`${t.team} are playing above their seed.`,
      context:'Efficiency metrics point to a team that could be dangerous come April.',
      link:'/playoffs', cta:'See standings',
    })
  }

  return stories
}

// ─── Feed Carousel ────────────────────────────────────────────────────────────

function Carousel({ stories }: { stories: Story[] }) {
  const [idx, setIdx] = useState(0)
  const pausedRef = useRef(false)

  useEffect(() => {
    if (stories.length < 2) return
    const id = setInterval(() => {
      if (!pausedRef.current) setIdx(i => (i+1)%stories.length)
    }, 7000)
    return () => clearInterval(id)
  }, [stories.length])

  if (!stories.length) return (
    <div style={{ height:'260px', display:'flex', alignItems:'center',
      justifyContent:'center', background:'#141418', borderRadius:'8px',
      border:'1px solid #1f1f24' }}>
      <span style={{ fontFamily:'DM Mono, monospace', fontSize:'11px', color:'#55534f' }}>
        Loading...
      </span>
    </div>
  )

  const s = stories[idx]

  return (
    <div onMouseEnter={()=>{pausedRef.current=true}} onMouseLeave={()=>{pausedRef.current=false}}>
      <div style={{ position:'relative', height:'260px', background:'#141418',
        border:'1px solid #1f1f24', borderRadius:'8px', overflow:'hidden',
        transition:'border-color 0.3s' }}>
        <div style={{ position:'absolute', left:0, top:'24px', bottom:'24px',
          width:'2px', background:s.accent, transition:'background 0.5s', borderRadius:'1px' }} />
        <div style={{ padding:'32px 40px', height:'100%',
          display:'flex', flexDirection:'column', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
            <div style={{ width:'6px', height:'6px', borderRadius:'50%', background:s.accent }} />
            <span style={{ fontFamily:'DM Mono, monospace', fontSize:'10px',
              color:s.accent, letterSpacing:'0.14em', textTransform:'uppercase' as const }}>
              {s.tag}
            </span>
          </div>
          <div>
            <h2 style={{ fontFamily:'Inter, sans-serif', fontSize:'22px', fontWeight:600,
              color:'#f2f0eb', lineHeight:1.3, marginBottom:'10px',
              letterSpacing:'-0.02em', maxWidth:'500px' }}>
              {s.headline}
            </h2>
            <p style={{ fontFamily:'Inter, sans-serif', fontSize:'13px',
              color:'#8c8a85', lineHeight:1.6, maxWidth:'420px' }}>
              {s.context}
            </p>
          </div>
          <Link href={s.link} style={{ display:'inline-flex', alignItems:'center',
            gap:'6px', fontFamily:'DM Mono, monospace', fontSize:'11px',
            color:s.accent, letterSpacing:'0.1em', textTransform:'uppercase' as const }}>
            {s.cta} →
          </Link>
        </div>
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:'10px', marginTop:'12px' }}>
        {(['←','→'] as const).map((a,di) => (
          <button key={a} onClick={()=>setIdx(i=>di===0?(i-1+stories.length)%stories.length:(i+1)%stories.length)}
            style={{ background:'none', border:'1px solid #1f1f24', borderRadius:'4px',
              padding:'4px 10px', cursor:'pointer', color:'#787672',
              fontFamily:'DM Mono, monospace', fontSize:'12px', transition:'all 0.15s' }}
            onMouseEnter={e=>{e.currentTarget.style.color='#f2f0eb';e.currentTarget.style.borderColor='#787672'}}
            onMouseLeave={e=>{e.currentTarget.style.color='#787672';e.currentTarget.style.borderColor='#1f1f24'}}>
            {a}
          </button>
        ))}
        <div style={{ display:'flex', gap:'5px', flex:1 }}>
          {stories.map((st,i) => (
            <button key={i} onClick={()=>setIdx(i)} style={{
              height:'3px', width:i===idx?'20px':'4px',
              background:i===idx?st.accent:'#2a2a32', border:'none',
              borderRadius:'2px', cursor:'pointer', padding:0,
              transition:'width 0.3s, background 0.3s' }} />
          ))}
        </div>
        <span style={{ fontFamily:'DM Mono, monospace', fontSize:'10px', color:'#55534f' }}>
          {String(idx+1).padStart(2,'0')}/{String(stories.length).padStart(2,'0')}
        </span>
      </div>
    </div>
  )
}

// ─── Feature cards ────────────────────────────────────────────────────────────

const MODULES = [
  { label:'Insights',       desc:'Hot/cold streaks via composite z-scores. Breakout probability using PER-based multi-dimensional efficiency.',  stat:'574 players', href:'/insights', accent:'#c8f135', icon:'↑' },
  { label:'Playoff Sim',    desc:'Monte Carlo from current standings. Lock completed series, simulate forward from any point in the season.',    stat:'Up to 1M runs', href:'/playoffs', accent:'#f97316', icon:'◎' },
  { label:'Matchup Diff',   desc:'Positional defensive profiles for every team. See projected output per stat for any player vs any opponent.',  stat:'540 profiles', href:'/matchup', accent:'#5b8ef0', icon:'⊕' },
  { label:'Head-to-Head',  desc:'Side-by-side comparison of any two players. Season averages, L10 splits, consistency ratings, stat edges.',    stat:'Any two players', href:'/compare', accent:'#a78bfa', icon:'↔' },
  { label:'Profiles',       desc:'Radar chart + game log for every player. Sortable by PTS, REB, AST, FG%, eFG%, 3P%, and more.',               stat:'574 players', href:'/profiles', accent:'#34d399', icon:'◉' },
  { label:'Clutch',         desc:'Net ratings in Q4 within 5 points only. Separates closers from aggregate noise. Which teams show up.',        stat:'Q4 ±5 pts', href:'/clutch', accent:'#fbbf24', icon:'★' },
]

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [stories, setStories] = useState<Story[]>([])
  const [hoveredModule, setHoveredModule] = useState<string|null>(null)

  useEffect(() => {
    const load = async () => {
      const [overallRes, breakoutRes, standingsRes] = await Promise.allSettled([
        fetch(`${API}/insights/streaks/overall?min_gp=10&limit=10`).then(r=>r.json()),
        fetch(`${API}/insights/breakout?limit=5`).then(r=>r.json()),
        fetch(`${API}/playoffs/standings`).then(r=>r.json()),
      ])
      setStories(buildStories(
        overallRes.status==='fulfilled' ? overallRes.value : null,
        breakoutRes.status==='fulfilled' ? breakoutRes.value : null,
        standingsRes.status==='fulfilled' ? standingsRes.value : null,
      ))
    }
    load()
  }, [])

  return (
    <div>
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section style={{ position:'relative', minHeight:'520px', overflow:'hidden' }}>
        {/* Dot grid bg */}
        <div style={{ position:'absolute', inset:0, zIndex:0 }}>
          <DotGrid />
        </div>

        {/* Fade overlay at bottom */}
        <div style={{ position:'absolute', bottom:0, left:0, right:0, height:'160px',
          background:'linear-gradient(transparent, #0c0c0e)', zIndex:1, pointerEvents:'none' }} />

        {/* Content */}
        <div style={{ position:'relative', zIndex:2, maxWidth:'1100px',
          margin:'0 auto', padding:'80px 28px 60px' }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 300px', gap:'40px', alignItems:'start' }}>
            <div>
              {/* Date line */}
              <div style={{ display:'flex', alignItems:'center', gap:'14px', marginBottom:'36px' }}>
                <span style={{ fontFamily:'DM Mono, monospace', fontSize:'11px',
                  color:'#787672', letterSpacing:'0.1em', textTransform:'uppercase' as const }}>
                  {new Date().toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric'})}
                </span>
                <div style={{ flex:1, height:'1px', background:'#1f1f24' }} />
                <span style={{ fontFamily:'DM Mono, monospace', fontSize:'10px', color:'#55534f' }}>
                  2025–26 NBA
                </span>
              </div>

              {/* Hero headline */}
              <h1 style={{ fontFamily:'Inter, sans-serif', fontWeight:300,
                fontSize:'48px', lineHeight:1.1, letterSpacing:'-0.03em',
                color:'#f2f0eb', marginBottom:'20px' }}>
                <DecryptText text="NBA intelligence," delay={200} />
                <br />
                <span style={{ color:'#c8f135', fontWeight:600 }}>
                  <DecryptText text="updated daily." delay={600} />
                </span>
              </h1>

              <p style={{ fontFamily:'Inter, sans-serif', fontSize:'15px',
                color:'#8c8a85', lineHeight:1.7, maxWidth:'440px', marginBottom:'36px' }}>
                Streaks, breakouts, playoff odds, matchup difficulty —
                built on play-by-play data and refreshed three times a day.
              </p>

              {/* Feed label + carousel */}
              <div style={{ marginBottom:'8px', display:'flex',
                justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ fontFamily:'DM Mono, monospace', fontSize:'10px',
                  color:'#55534f', letterSpacing:'0.14em', textTransform:'uppercase' as const }}>
                  Today's intelligence
                </span>
                <Link href="/insights" style={{ fontFamily:'DM Mono, monospace', fontSize:'10px',
                  color:'#55534f', letterSpacing:'0.1em', transition:'color 0.15s' }}
                  onMouseEnter={e=>(e.currentTarget.style.color='#c8f135')}
                  onMouseLeave={e=>(e.currentTarget.style.color='#55534f')}>
                  All insights →
                </Link>
              </div>
              <Carousel stories={stories} />
            </div>

            {/* Right — platform stats */}
            <div style={{ paddingTop:'80px' }}>
              <div style={{ background:'rgba(20,20,24,0.8)', backdropFilter:'blur(12px)',
                border:'1px solid #1f1f24', borderRadius:'8px', overflow:'hidden' }}>
                <div style={{ padding:'14px 18px', borderBottom:'1px solid #1f1f24' }}>
                  <span style={{ fontFamily:'DM Mono, monospace', fontSize:'10px',
                    color:'#787672', letterSpacing:'0.12em', textTransform:'uppercase' as const }}>
                    Platform
                  </span>
                </div>
                {[
                  { end:574,   suffix:'',   label:'Players tracked' },
                  { end:3,     suffix:'×',  label:'Daily ETL updates' },
                  { end:23000, suffix:'+',  label:'Game logs this season' },
                  { end:540,   suffix:'',   label:'Defensive profiles' },
                  { end:1000000, suffix:'', label:'Max playoff simulations' },
                ].map((item, i, arr) => (
                  <div key={item.label} style={{ display:'flex',
                    justifyContent:'space-between', alignItems:'center',
                    padding:'13px 18px', background:'transparent',
                    borderBottom:i<arr.length-1?'1px solid #1a1a20':'none' }}>
                    <span style={{ fontFamily:'Inter, sans-serif',
                      fontSize:'13px', color:'#8c8a85' }}>{item.label}</span>
                    <span style={{ fontFamily:'DM Mono, monospace', fontSize:'14px',
                      fontWeight:500, color:'#f2f0eb' }}>
                      <CountUp end={item.end} suffix={item.suffix} />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Ticker ────────────────────────────────────────────────────────── */}
      <ScrollTicker items={[
        '574 players tracked','3× daily ETL','Model v14','Bayesian shrinkage',
        'Positional defense profiles','Normal CDF scoring','Play-in simulator',
        '1M playoff simulations','Hot/cold streak detection','PER-based breakout analysis',
      ]} />

      {/* ── Features ──────────────────────────────────────────────────────── */}
      <section style={{ maxWidth:'1100px', margin:'0 auto', padding:'72px 28px' }}>
        <FadeIn>
          <div style={{ marginBottom:'48px' }}>
            <span style={{ fontFamily:'DM Mono, monospace', fontSize:'10px',
              color:'#787672', letterSpacing:'0.14em', textTransform:'uppercase' as const }}>
              What's inside
            </span>
            <h2 style={{ fontFamily:'Inter, sans-serif', fontSize:'32px', fontWeight:300,
              color:'#f2f0eb', marginTop:'10px', letterSpacing:'-0.02em', lineHeight:1.2 }}>
              Six ways to read<br />the NBA differently.
            </h2>
          </div>
        </FadeIn>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)',
          gap:'1px', background:'#1f1f24', border:'1px solid #1f1f24',
          borderRadius:'8px', overflow:'hidden' }}>
          {MODULES.map(m => (
            <Link key={m.href} href={m.href} style={{ display:'block', textDecoration:'none' }}>
              <FadeIn delay={MODULES.indexOf(m) * 60}>
                <div style={{ padding:'28px 24px', background:'#0c0c0e', height:'100%',
                  transition:'background 0.2s', cursor:'pointer',
                  borderBottom:'none' }}
                  onMouseEnter={e=>{
                    e.currentTarget.style.background='#141418'
                    setHoveredModule(m.label)
                  }}
                  onMouseLeave={e=>{
                    e.currentTarget.style.background='#0c0c0e'
                    setHoveredModule(null)
                  }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'14px' }}>
                    <span style={{ fontFamily:'DM Mono, monospace', fontSize:'18px',
                      color:m.accent, lineHeight:1, transition:'transform 0.2s',
                      display:'inline-block',
                      transform:hoveredModule===m.label?'scale(1.3)':'scale(1)' }}>
                      {m.icon}
                    </span>
                    <span style={{ fontFamily:'Inter, sans-serif', fontSize:'14px',
                      fontWeight:600, color:'#f2f0eb' }}>{m.label}</span>
                  </div>
                  <p style={{ fontFamily:'Inter, sans-serif', fontSize:'13px',
                    color:'#8c8a85', lineHeight:1.65, marginBottom:'20px' }}>
                    {m.desc}
                  </p>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <span style={{ fontFamily:'DM Mono, monospace', fontSize:'10px',
                      color:'#55534f', letterSpacing:'0.06em' }}>{m.stat}</span>
                    <span style={{ fontFamily:'DM Mono, monospace', fontSize:'11px',
                      color:m.accent, transition:'transform 0.2s', display:'inline-block',
                      transform:hoveredModule===m.label?'translateX(4px)':'translateX(0)' }}>→</span>
                  </div>
                </div>
              </FadeIn>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Stats section ─────────────────────────────────────────────────── */}
      <section style={{ borderTop:'1px solid #1f1f24', borderBottom:'1px solid #1f1f24',
        background:'#0e0e12' }}>
        <div style={{ maxWidth:'1100px', margin:'0 auto', padding:'64px 28px' }}>
          <FadeIn>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1px',
              background:'#1f1f24', border:'1px solid #1f1f24', borderRadius:'8px',
              overflow:'hidden' }}>
              {[
                { end:574,   suffix:'',  label:'Players tracked',       sub:'2025–26 season' },
                { end:23000, suffix:'+', label:'Game logs',             sub:'Updated daily' },
                { end:540,   suffix:'',  label:'Defensive profiles',    sub:'By position' },
                { end:1000000, suffix:'',label:'Playoff simulations',   sub:'Monte Carlo' },
              ].map((item, i) => (
                <div key={item.label} style={{ padding:'32px 24px', background:'#0e0e12',
                  textAlign:'center' }}>
                  <div style={{ fontFamily:'DM Mono, monospace', fontSize:'32px',
                    fontWeight:500, color:'#c8f135', marginBottom:'8px' }}>
                    <CountUp end={item.end} suffix={item.suffix} />
                  </div>
                  <div style={{ fontFamily:'Inter, sans-serif', fontSize:'14px',
                    fontWeight:500, color:'#f2f0eb', marginBottom:'4px' }}>
                    {item.label}
                  </div>
                  <div style={{ fontFamily:'DM Mono, monospace', fontSize:'10px',
                    color:'#787672', letterSpacing:'0.08em' }}>{item.sub}</div>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── Methodology section ────────────────────────────────────────────── */}
      <section style={{ maxWidth:'1100px', margin:'0 auto', padding:'72px 28px' }}>
        <FadeIn>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'60px', alignItems:'start' }}>
            <div>
              <span style={{ fontFamily:'DM Mono, monospace', fontSize:'10px',
                color:'#787672', letterSpacing:'0.14em', textTransform:'uppercase' as const }}>
                How it works
              </span>
              <h2 style={{ fontFamily:'Inter, sans-serif', fontSize:'28px', fontWeight:300,
                color:'#f2f0eb', marginTop:'10px', letterSpacing:'-0.02em', lineHeight:1.3 }}>
                Built on the math,<br />not the narrative.
              </h2>
              <p style={{ fontFamily:'Inter, sans-serif', fontSize:'14px', color:'#8c8a85',
                lineHeight:1.7, marginTop:'16px' }}>
                Every prediction runs through a pipeline of statistical models.
                Exponentially-weighted ratings, distribution-based prediction,
                and position-adjusted defense profiles.
              </p>
              <Link href="/about" style={{ display:'inline-flex', alignItems:'center',
                gap:'6px', marginTop:'20px', fontFamily:'DM Mono, monospace', fontSize:'11px',
                color:'#c8f135', letterSpacing:'0.1em', textTransform:'uppercase' as const,
                transition:'opacity 0.15s' }}
                onMouseEnter={e=>(e.currentTarget.style.opacity='0.7')}
                onMouseLeave={e=>(e.currentTarget.style.opacity='1')}>
                Read the methodology →
              </Link>
            </div>

            <div style={{ display:'flex', flexDirection:'column', gap:'0' }}>
              {[
                { label:'Bayesian shrinkage',       desc:'Regresses small samples toward position averages.' },
                { label:'Positional defense',        desc:'Each team\'s allowed stats by G/F/C position bucket.' },
                { label:'Normal CDF scoring',        desc:'Models each line as a probability using predicted mean + variance.' },
                { label:'Usage redistribution',      desc:'Absent teammate possessions reallocated to active players.' },
                { label:'Exponential decay ratings', desc:'Recent games weighted more heavily than October results.' },
                { label:'Monte Carlo playoff sim',   desc:'Win probability via logistic model, run N times from any state.' },
              ].map((p, i, arr) => (
                <FadeIn key={p.label} delay={i*80}>
                  <div style={{ padding:'16px 0',
                    borderBottom:i<arr.length-1?'1px solid #1a1a20':'none' }}>
                    <div style={{ fontFamily:'Inter, sans-serif', fontSize:'13px',
                      fontWeight:500, color:'#f2f0eb', marginBottom:'4px' }}>
                      {p.label}
                    </div>
                    <div style={{ fontFamily:'Inter, sans-serif', fontSize:'13px',
                      color:'#8c8a85' }}>{p.desc}</div>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </FadeIn>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div style={{ borderTop:'1px solid #1f1f24', maxWidth:'1100px',
        margin:'0 auto', padding:'32px 28px',
        display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontFamily:'DM Mono, monospace', fontSize:'12px',
          color:'#c8f135', fontWeight:500, letterSpacing:'0.12em' }}>SWINGFACTR</span>
        <span style={{ fontFamily:'DM Mono, monospace', fontSize:'11px',
          color:'#55534f', letterSpacing:'0.08em' }}>
          2025–26 · Updated 3× daily
        </span>
      </div>
    </div>
  )
}
