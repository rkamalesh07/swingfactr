import Link from 'next/link'

const MODULES = [
  {
    href: '/games',
    label: 'Win Probability',
    tag: 'XGBoost · Calibrated',
    desc: 'Per-play win probability curves for every completed game. Trained on 469K plays from the 2024–25 season.',
    stat: '995',
    statLabel: 'games modeled',
  },
  {
    href: '/lineups',
    label: 'Lineup Impact',
    tag: 'RAPM · Ridge Regression',
    desc: 'Regularized Adjusted Plus-Minus for every 5-man unit. Controls for opponent quality. 90% CI from bootstrap.',
    stat: '572',
    statLabel: 'players tracked',
  },
  {
    href: '/clutch',
    label: 'Clutch Performance',
    tag: 'Last 5 min · ±5 pts',
    desc: 'Team and lineup net ratings in clutch situations only. Separates clutch performers from aggregate noise.',
    stat: 'Q4',
    statLabel: 'crunch time only',
  },
  {
    href: '/fatigue',
    label: 'Fatigue & Travel',
    tag: 'OLS Regression · R²=0.029',
    desc: 'Quantified effect of back-to-backs, travel distance, altitude, and timezone changes on score margin.',
    stat: '8',
    statLabel: 'fatigue factors',
  },
]

export default function Home() {
  return (
    <div>
      <style>{`
        .module-card { background: #0a0a0a; padding: 28px 32px; transition: background 0.15s; display: block; text-decoration: none; }
        .module-card:hover { background: #131313; }
      `}</style>

      <div style={{ marginBottom: '48px' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#333', letterSpacing: '0.12em', marginBottom: '12px' }}>
          NBA ANALYTICS · 2024–25 SEASON
        </div>
        <h1 style={{ fontSize: '32px', fontWeight: 300, color: '#f0f0f0', letterSpacing: '-0.02em', marginBottom: '12px', lineHeight: 1.1 }}>
          Game intelligence.<br />Not player props.
        </h1>
        <p style={{ color: '#555', fontSize: '14px', maxWidth: '520px', lineHeight: 1.6 }}>
          SwingFactr models lineup chemistry, in-game win probability, and schedule fatigue
          using play-by-play data from every 2024–25 NBA game.
        </p>
      </div>

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

      <div style={{ marginTop: '48px', paddingTop: '24px', borderTop: '1px solid #1a1a1a', display: 'flex', gap: '40px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#2a2a2a' }}>
        <span>ESPN API · No auth required</span>
        <span>XGBoost · AUC 0.79</span>
        <span>Ridge RAPM · α=2000</span>
        <span>OLS Fatigue · n=995 games</span>
      </div>
    </div>
  )
}
