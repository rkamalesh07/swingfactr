'use client'

import Link from 'next/link'

const ACCENT = '#4ade80'

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ marginBottom: '64px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '28px' }}>
        <div style={{ width: '3px', height: '24px', background: ACCENT, borderRadius: '2px', flexShrink: 0 }} />
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#e0e0e0',
          fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '-0.01em' }}>{title}</h2>
      </div>
      {children}
    </section>
  )
}

function Formula({ label, expr }: { label: string; expr: string }) {
  return (
    <div style={{ margin: '16px 0', padding: '14px 18px',
      background: '#141418', border: '1px solid #1a1a1a', borderRadius: '4px',
      borderLeft: `3px solid ${ACCENT}` }}>
      <div style={{ fontSize: '9px', color: '#909090', letterSpacing: '0.12em',
        marginBottom: '8px', fontFamily: 'IBM Plex Mono, monospace' }}>{label}</div>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px',
        color: '#c8e6c9', letterSpacing: '0.02em', lineHeight: 1.6 }}>{expr}</div>
    </div>
  )
}

function Callout({ color = '#4ade80', children }: { color?: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '14px 18px', background: `${color}08`,
      border: `1px solid ${color}20`, borderRadius: '4px', marginBottom: '16px' }}>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px',
        color: '#888', lineHeight: 1.7 }}>{children}</div>
    </div>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px',
      background: '#111', border: '1px solid #222', borderRadius: '3px',
      fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: '#b0aea8',
      margin: '2px' }}>{children}</span>
  )
}

const TOC = [
  { id: 'overview',     label: '01 — Overview' },
  { id: 'data',         label: '02 — Data Pipeline' },
  { id: 'model',        label: '03 — Prediction Model' },
  { id: 'injury',       label: '04 — Injury Engine' },
  { id: 'defense',      label: '05 — Positional Defense' },
  { id: 'edge',         label: '06 — Edge Framework' },
  { id: 'calibration',  label: '07 — Calibration' },
  { id: 'limitations',  label: '08 — Limitations' },
]

export default function AboutPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#0e0e12', color: '#888' }}>

      {/* Nav */}
      <div style={{ borderBottom: '1px solid #1f1f24', padding: '12px 24px',
        display: 'flex', alignItems: 'center', gap: '16px' }}>
        <Link href="/props" style={{ color: '#909090', textDecoration: 'none',
          fontSize: '11px', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0.05em' }}>
          ← PROPS
        </Link>
        <span style={{ color: '#787672' }}>·</span>
        <span style={{ color: '#909090', fontSize: '11px',
          fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0.1em' }}>METHODOLOGY</span>
      </div>

      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '56px 24px',
        display: 'grid', gridTemplateColumns: '200px 1fr', gap: '64px', alignItems: 'start' }}>

        {/* Sidebar TOC */}
        <div style={{ position: 'sticky', top: '32px' }}>
          <div style={{ fontSize: '9px', color: '#787672', letterSpacing: '0.15em',
            fontFamily: 'IBM Plex Mono, monospace', marginBottom: '16px' }}>CONTENTS</div>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {TOC.map(t => (
              <a key={t.id} href={`#${t.id}`} style={{
                fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
                color: '#787672', textDecoration: 'none', padding: '5px 0',
                borderLeft: '2px solid transparent', paddingLeft: '12px',
                transition: 'color 0.15s, border-color 0.15s',
              }}
              onMouseEnter={e => {
                const el = e.currentTarget
                el.style.color = ACCENT
                el.style.borderLeftColor = ACCENT
              }}
              onMouseLeave={e => {
                const el = e.currentTarget
                el.style.color = '#2a2a2a'
                el.style.borderLeftColor = 'transparent'
              }}>
                {t.label}
              </a>
            ))}
          </nav>
        </div>

        {/* Main content */}
        <div>
          <div style={{ marginBottom: '56px' }}>
            <div style={{ fontSize: '11px', color: '#787672', letterSpacing: '0.15em',
              fontFamily: 'IBM Plex Mono, monospace', marginBottom: '12px' }}>
              SWINGFACTR · MODEL DOCUMENTATION
            </div>
            <h1 style={{ fontSize: '32px', fontWeight: 700, color: '#e0e0e0', margin: '0 0 16px',
              fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
              How the Model Works
            </h1>
            <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px',
              lineHeight: 1.8, color: '#909090', margin: 0 }}>
              SwingFactr is a statistical NBA player prop prediction system. This document
              explains every step from raw data to the edge scores shown on the props board.
            </p>
          </div>

          <Section id="overview" title="Overview">
            <Callout>
              The model computes P(player stat {'>'} PrizePicks line) for each prop using a
              player-specific normal distribution, then compares that probability to the
              PrizePicks break-even rate. Picks with sufficient edge are surfaced on the board.
            </Callout>
            <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px',
              lineHeight: 1.9, color: '#909090' }}>
              The system runs an automated ETL pipeline 3× daily (6:30am, 12pm, 3:30pm PST)
              that fetches live PrizePicks props, checks injury reports, computes distribution-based
              predictions for every player, and writes results to the board. All computation
              happens in Python against a PostgreSQL database on Railway.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '16px' }}>
              {['FastAPI','PostgreSQL','Next.js','GitHub Actions','Railway','Vercel',
                'ESPN API','RotoWire','PrizePicks API'].map(t => <Tag key={t}>{t}</Tag>)}
            </div>
          </Section>

          <Section id="data" title="Data Pipeline">
            <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px',
              lineHeight: 1.9, color: '#909090', marginBottom: '20px' }}>
              Every ETL run executes these steps in order:
            </p>
            {[
              ['1. RotoWire Lineup Scrape', 'Parse confirmed starters and OUT players from RotoWire\'s nba-lineups.php page using data-lineup and data-out HTML attributes. No JavaScript rendering needed — one HTTP request resolves ~100 player statuses per game day.'],
              ['2. ESPN Roster Fetch', 'Fetch all 30 team rosters in parallel from the ESPN API to capture GTD statuses and player positions (G/F/C). RotoWire data takes priority; ESPN fills gaps only for players not already covered.'],
              ['3. PrizePicks Props Fetch', 'Hit the PrizePicks projections API for all NBA single-stat props. Filter out "demon" lines. Parse player names, stat types, lines, and tier (standard/goblin).'],
              ['4. Game Context', 'For each game, fetch the ESPN scoreboard to determine home/away, rest days, and back-to-back status. Fetch implied team total as a pace proxy.'],
              ['5. Prop Computation', 'For each player-stat-tier combination, run the distribution model and write results to the prop_board table with full ON CONFLICT logic to preserve opening lines.'],
            ].map(([title, body]) => (
              <div key={title as string} style={{ marginBottom: '20px', paddingLeft: '16px',
                borderLeft: '1px solid #222228' }}>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
                  color: ACCENT, marginBottom: '6px', letterSpacing: '0.05em' }}>{title}</div>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px',
                  color: '#909090', lineHeight: 1.8 }}>{body}</div>
              </div>
            ))}
          </Section>

          <Section id="model" title="Prediction Model (v14)">
            <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px',
              lineHeight: 1.9, color: '#909090', marginBottom: '20px' }}>
              The core model computes a player-specific normal distribution for each stat
              and evaluates P(Y {'>'} line) using a continuity-corrected normal CDF.
            </p>

            <Formula label="STEP 1 — PER-MINUTE STAT RATE"
              expr={`season_rate  = avg(stat / minutes)  [all qualified games]\nrecent_rate  = avg(stat / minutes)  [last 10 games]`} />

            <Formula label="STEP 2 — BAYESIAN SHRINKAGE TOWARD SEASON RATE"
              expr={`shrunk_rate = season_rate × 0.65 + recent_rate × 0.35\n\n// Weight toward season for stability, recent for role changes\n// Shrinkage prevents overfitting on hot/cold streaks`} />

            <Formula label="STEP 3 — MINUTES PROJECTION"
              expr={`projected_min = avg(recent 5 games minutes)\n             × starter_bonus  (1.05 if confirmed starter)\n             × b2b_penalty    (0.92 if back-to-back)\n             × fatigue_factor (based on rest_days)`} />

            <Formula label="STEP 4 — PREDICTED MEAN"
              expr={`predicted_mean = shrunk_rate\n              × projected_min\n              × pace_factor\n              × pos_def_ratio\n              × usage_boost_mult`} />

            <Formula label="STEP 5 — PREDICTED STD"
              expr={`predicted_std = std(last 20 game values)\n\n// Fallback CVs if insufficient history:\n// PTS: 30%  REB: 55%  AST: 45%\n// 3PM: 55%  STL: 70%  BLK: 70%`} />

            <Formula label="STEP 6 — PROBABILITY (CONTINUITY CORRECTED)"
              expr={`P(Y > line) = 1 - Φ((line + 0.5 − μ) / σ)\n\n// +0.5 continuity correction for discrete integer stats\n// Φ = standard normal CDF`} />

            <Callout color="#60a5fa">
              Why normal distribution? NBA per-game stats are approximately normally
              distributed for players with sufficient sample sizes. The continuity correction
              accounts for the discrete nature of counting stats (you can't score 24.3 points).
              Future versions will use zero-inflated Poisson for low-frequency stats like BLK/STL.
            </Callout>
          </Section>

          <Section id="injury" title="Injury Engine">
            <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px',
              lineHeight: 1.9, color: '#909090', marginBottom: '20px' }}>
              Two-source injury detection with RotoWire as primary truth and ESPN as fallback.
            </p>

            <div style={{ marginBottom: '20px', padding: '14px 18px',
              background: '#141418', border: '1px solid #1a1a1a', borderRadius: '4px' }}>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
                color: '#b0aea8', lineHeight: 1.9 }}>
                <div style={{ color: ACCENT, marginBottom: '8px', fontSize: '10px',
                  letterSpacing: '0.1em' }}>WHY ROTOWIRE OVER ESPN</div>
                ESPN's injury_since date reflects the last status change, not the first game
                missed. A player injured in November and re-evaluated in February shows a
                February date — making games-missed calculations completely unreliable.
                RotoWire's data-attributes give ground truth starters and OUT players
                directly from lineup construction, updated 2–3 hours before tip-off.
              </div>
            </div>

            <Formula label="USAGE BOOST — TEAMMATE OUT LOGIC"
              expr={`// Triggers only when ALL conditions met:\n1. Teammate status = "Out" (not GTD)\n2. Teammate missed 1–4 team games (not 0, not 5+)\n3. Teammate avg ≥ 8 possessions/game\n\nboost_mult = min(1.15, 1.0 + (missing_usage × 0.60 × 0.20))\n\n// Capped at 1.15× — prevents overcorrection\n// Cached per (player, team) to avoid redundant DB queries`} />
          </Section>

          <Section id="defense" title="Positional Opponent Defense">
            <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px',
              lineHeight: 1.9, color: '#909090', marginBottom: '20px' }}>
              Instead of a generic team defensive rating, the model uses position-specific
              opponent defense ratios computed from this season's game logs.
            </p>

            <Formula label="DEFENSIVE RATIO"
              expr={`def_ratio = team_allowed_per_pos / league_avg_per_pos\n\n// > 1.0 = easy matchup (team allows more than average)\n// < 1.0 = tough matchup\n\n// Shrinkage toward 1.0 for small samples:\nadj_ratio = 1.0 + (raw_ratio - 1.0) × min(1.0, n / 40)\n// Full weight at 40+ games, requires minimum 20`} />

            <Callout color="#a78bfa">
              ESPN uses broad position buckets (G/F/C rather than PG/SG/SF/PF) intentionally.
              Finer buckets reduce sample size per cell below statistical reliability.
              A guard defending point guards vs shooting guards is less meaningful than
              guard vs center when evaluating rebounding or block props.
            </Callout>
          </Section>

          <Section id="edge" title="Edge Framework">
            <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px',
              lineHeight: 1.9, color: '#909090', marginBottom: '20px' }}>
              Edge is computed as model probability minus the PrizePicks break-even probability.
              Break-even is computed dynamically based on the power play payout.
            </p>

            <Formula label="BREAK-EVEN PROBABILITY (DYNAMIC)"
              expr={`pp_break_even(n_legs) = (1 / payout[n_legs]) ^ (1 / n_legs)\n\n// Payouts: 2→3×  3→5×  4→10×  5→20×  6→25×\n// Break-evens:\n//   2-pick: 57.74%\n//   3-pick: 58.48%\n//   4-pick: 56.23%\n//   5-pick: 54.93%\n//   6-pick: 58.48%`} />

            <Formula label="EDGE"
              expr={`raw_edge_vs_pp = model_prob - pp_break_even_prob\n\n// Example: model says 68% P(over), break-even 57.7%\n// edge = 68 - 57.7 = +10.3 → "Strong Over"`} />

            <div style={{ marginBottom: '20px', padding: '14px 18px',
              background: '#141418', border: '1px solid #1a1a1a', borderRadius: '4px' }}>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px',
                color: '#909090', letterSpacing: '0.1em', marginBottom: '12px' }}>TOSS-UP FILTERS (ASYMMETRIC)</div>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px',
                color: '#909090', lineHeight: 1.9 }}>
                Overs filtered if |edge| ≤ 5.5 (standard picks only)
                <br />
                Unders filtered if |edge| ≤ 8.0 — stricter because NBA stats are
                right-skewed; normal distributions systematically overestimate P(under).
                Under picks also require L10 under hit rate ≥ 60% as confirmation.
              </div>
            </div>
          </Section>

          <Section id="calibration" title="Calibration">
            <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px',
              lineHeight: 1.9, color: '#909090', marginBottom: '20px' }}>
              Platt scaling (logistic calibration) is fit per stat using historical prop
              outcomes stored in the prop_outcomes table. Runs nightly via GitHub Actions.
            </p>

            <Formula label="PLATT SCALING"
              expr={`calibrated_prob = sigmoid(A × raw_prob + B)\n\n// A, B fit by maximum likelihood on past outcomes\n// One sigmoid per stat: pts, reb, ast, fg3m, stl, blk\n// Separate 'all' fallback for uncovered stats`} />

            <Callout color="#fbbf24">
              The v12+ model outputs true probabilities directly from the normal CDF
              rather than heuristic scores. Platt coefficients from v11 are not applied
              until enough v12 outcomes accumulate to refit them properly.
              Under bias correction applies a 20% edge shrinkage toward break-even
              to partially offset right-skew overestimation before fitting new coefficients.
            </Callout>
          </Section>

          <Section id="limitations" title="Known Limitations">
            {[
              ['Normal Distribution Assumption', 'NBA stats are not perfectly normal — they are right-skewed (players can spike to 40+ points but cannot score negative). This causes the model to slightly overestimate P(under) for most players. The asymmetric toss-up filter and under shrinkage partially correct for this, but a zero-inflated Poisson or empirical bootstrap distribution would be more accurate.'],
              ['No Intra-Game Correlation Model', 'Props for the same player are treated as independent. In reality, if a player scores a lot, they probably also have more assist opportunities. The parlay builder does not currently penalize correlated picks.'],
              ['Minutes Projection Is Simplified', 'Projected minutes uses a weighted recent average with adjustments for starter status, B2B, and rest. It does not account for blowout risk (players sit in garbage time) or foul trouble. A proper minutes model would use Vegas team spreads as a blowout proxy.'],
              ['Market Comparison Is Missing', 'The edge is computed against PrizePicks break-even, not a sharp sportsbook consensus. PrizePicks lines are not always efficient — but the model cannot currently distinguish a -10 edge because the line is wrong vs because the model is wrong.'],
              ['Calibration Lag', 'Calibration parameters are fit on the current season\'s outcomes. Early in the season, or after a significant rule/pace change, calibration will drift until enough new outcomes accumulate.'],
            ].map(([title, body]) => (
              <div key={title as string} style={{ marginBottom: '24px', paddingLeft: '16px',
                borderLeft: '2px solid #f87171' }}>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px',
                  color: '#f87171', marginBottom: '6px', letterSpacing: '0.05em' }}>{title}</div>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px',
                  color: '#909090', lineHeight: 1.8 }}>{body}</div>
              </div>
            ))}
          </Section>

          <div style={{ borderTop: '1px solid #0f0f0f', paddingTop: '32px',
            fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#787672' }}>
            SwingFactr is not financial advice. Props are for analytical purposes only.
            <span style={{ marginLeft: '16px' }}>
              <Link href="/props" style={{ color: '#909090', textDecoration: 'none' }}>
                View Props Board →
              </Link>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
