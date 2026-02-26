'use client'

import Link from 'next/link'

const MODULES = [
  {
    href: '/games',
    label: 'Game Win Curves',
    tag: 'Random Walk · Per-play',
    desc: 'Per-play win probability curves for every completed game. Pre-game projections for upcoming matchups based on team ratings.',
    stat: '870',
    statLabel: 'games this season',
  },
  {
    href: '/teams',
    label: 'Team Rankings',
    tag: 'Net Rating · 5-man Stints',
    desc: 'All 30 teams ranked by net rating. Best and worst 5-man lineups by net points per 100 possessions.',
    stat: '30',
    statLabel: 'teams ranked',
  },
  {
    href: '/rapm',
    label: 'RAPM',
    tag: 'Ridge Regression · α=2000',
    desc: 'Regularized Adjusted Plus-Minus — points added per 100 possessions controlling for teammates and opponents.',
    stat: '534',
    statLabel: 'players rated',
  },
  {
    href: '/players',
    label: 'Player Ratings',
    tag: 'Net Rating · On/Off',
    desc: 'On-court net rating for every player with 50+ minutes. Sortable by offense, defense, and net impact.',
    stat: '410K',
    statLabel: 'plays analyzed',
  },
  {
    href: '/clutch',
    label: 'Clutch Performance',
    tag: 'Last 5 min · ±5 pts',
    desc: 'Net ratings in clutch situations only — Q4 within 5 points. Separates closers from aggregate noise.',
    stat: 'Q4',
    statLabel: 'crunch time',
  },
  {
    href: '/fatigue',
    label: 'Fatigue & Travel',
    tag: 'OLS Regression · R²=0.029',
    desc: 'Quantified effect of back-to-backs, travel distance, altitude, and timezone changes on scoring margin.',
    stat: '8',
    statLabel: 'fatigue factors',
  },
  {
    href: '/lineups',
    label: 'Lineup Explorer',
    tag: 'Play-by-play · 5-man units',
    desc: 'Browse every 5-man lineup with net rating, possessions, and minutes. Filter by team.',
    stat: '23K',
    statLabel: 'stints tracked',
  },
  {
    href: '/teams',
    label: 'Team Form & Trends',
    tag: 'Exponential Decay · λ=0.015',
    desc: 'Which teams are trending up or down right now. Weighted recent performance vs full season average.',
    stat: '🔥',
    statLabel: 'hot/cold streaks',
  },
]

export default function Home() {
  return (
    <div>
      <style>{`
        .module-card { background: #0a0a0a; padding: 28px 32px; transition: background 0.15s; display: block; text-decoration: none; }
        .module-card:hover { background: #131313; }
        .live-banner { background: #0a0a0a; transition: background 0.15s; }
        .live-banner:hover { background: #131313; }
      `}</style>

      <div style={{ marginBottom: '48px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#333', letterSpacing: '0.12em', marginBottom: '12px' }}>
          NBA ANALYTICS · 2025–26 SEASON · LIVE
        </div>
        <h1 style={{ fontSize: '32px', fontWeight: 300, color: '#f0f0f0', letterSpacing: '-0.02em', marginBottom: '12px', lineHeight: 1.1 }}>
          Game intelligence.<br />Not player props.
        </h1>
        <p style={{ color: '#555', fontSize: '14px', maxWidth: '520px', lineHeight: 1.6 }}>
          SwingFactr models lineup chemistry, live win probability, and schedule fatigue
          using play-by-play data from every 2025–26 NBA game — updated daily.
        </p>
      </div>

      {/* Live banner */}
      <Link href="/live" style={{ textDecoration: 'none', display: 'block', marginBottom: '1px' }}>
        <div className="live-banner" style={{
          border: '1px solid #1a1a1a', borderBottom: 'none',
          padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ color: '#ef4444', fontSize: '10px' }}>●</span>
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#ef4444', letterSpacing: '0.1em' }}>
              LIVE WIN PROBABILITY
            </span>
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#333' }}>
              Today's games · auto-refresh 30s
            </span>
          </div>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#333' }}>View →</span>
        </div>
      </Link>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', background: '#1a1a1a', border: '1px solid #1a1a1a' }}>
        {MODULES.map((m) => (
          <Link key={m.href} href={m.href} className="module-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div>
                <div style={{ fontSize: '17px', fontWeight: 500, color: '#f0f0f0', marginBottom: '4px' }}>{m.label}</div>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#444', letterSpacing: '0.08em' }}>{m.tag}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '22px', fontWeight: 600, color: '#e8e8e8' }}>{m.stat}</div>
                <div style={{ fontSize: '10px', color: '#444' }}>{m.statLabel}</div>
              </div>
            </div>
            <p style={{ color: '#555', fontSize: '13px', lineHeight: 1.6, marginBottom: '20px' }}>{m.desc}</p>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#2a2a2a' }}>View data →</div>
          </Link>
        ))}
      </div>

      <div style={{ marginTop: '48px', paddingTop: '24px', borderTop: '1px solid #1a1a1a', display: 'flex', flexWrap: 'wrap', gap: '32px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#2a2a2a' }}>
        <span>870 games · 2025-26</span>
        <span>Random Walk Win Prob</span>
        <span>Ridge RAPM · α=2000</span>
        <span>23K stints · 534 players</span>
        <span>ESPN API · daily ETL</span>
      </div>
    </div>
  )
}
