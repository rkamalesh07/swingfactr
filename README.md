# SwingFactr

**Live NBA analytics platform — real data, real models, updated every day.**

🔗 **[swingfactr.vercel.app](https://swingfactr.vercel.app)**

---

## What it does

SwingFactr ingests every NBA play-by-play event from the ESPN API, stores it in PostgreSQL, and runs a set of statistical models on top of it to answer questions that box scores can't:

- Which players actually make their team better when they're on the court?
- What are each team's real playoff odds right now, given their remaining schedule?
- How does win probability shift across a live game in real time?
- Which teams are trending up or down relative to their season average?

Everything updates automatically every morning via a GitHub Actions cron job.

---

## Stack

| Layer | Tech |
|---|---|
| Data ingestion | Python, ESPN REST API |
| Storage | PostgreSQL (Railway) |
| Backend | FastAPI |
| Frontend | Next.js, TypeScript |
| Deployment | Railway (API) + Vercel (frontend) |
| Scheduling | GitHub Actions (daily cron) |

---

## Features

### Live Win Probability
Every scoring play in a game maps to a win probability using a random walk model calibrated to NBA pace. Watch it update in real time during live games. Pre-game projections use exponentially weighted team ratings so the tipoff probability already reflects team quality — not just 50/50.

### RAPM (Regularized Adjusted Plus/Minus)
Ridge regression over 23,000+ lineup stints to isolate each player's individual impact on scoring margin, controlling for teammate and opponent quality. Alpha tuned to 2000 to handle small sample sizes.

### Playoff Simulator
Monte Carlo simulation — runs the rest of the regular season thousands of times, seeds both conferences, runs the play-in tournament, then simulates the full 4-round playoff bracket. Every game uses the actual opponent's rating so schedule strength is baked in. Shows each team's probability of making the playoffs, reaching the Finals, and winning the championship.

### Strength of Schedule
For each team's remaining games: average opponent net rating adjusted for home/away (+2.5 for road games). Surfaces which teams have an easy or brutal path to the playoffs.

### Exponential Decay Team Ratings
Instead of a fixed rolling window, each game's weight decays exponentially with age (λ=0.015, half-life ~46 days). A team's hot streak in January naturally dominates over their bad October without any arbitrary cutoff.

### Team Form & Trends
Shows each team's momentum — weighted recent margin minus full season average. Positive = trending up, negative = trending down.

### Pipeline Health Dashboard
Observability page tracking ETL run history, data freshness, play-by-play coverage per game, and per-team ingestion completeness. Built to surface data quality issues before they affect model outputs.

---

## Data scale (2025–26 season)

| Metric | Count |
|---|---|
| Games ingested | 870+ |
| Play-by-play events | 410,000+ |
| Lineup stints | 23,000+ |
| Players tracked | 534 |
| Teams | 30 |

---

## Architecture

```
ESPN API
   │
   ▼
Daily ETL (GitHub Actions cron, 8AM UTC)
   │  fetch_games → store_pbp → reconstruct_stints
   ▼
PostgreSQL
   │  games, plays, stints, lineup_players, teams, players, etl_runs
   ▼
FastAPI (Railway)
   │  /rapm  /winprob  /live  /playoffs  /teams  /health
   ▼
Next.js (Vercel)
   └─ Live · Games · Teams · RAPM · Players · Clutch · Fatigue · Playoffs · Health
```

---

## Models

**Win Probability**
```
P(home wins) = Φ(adj_diff / σ)
σ = 11.5 × √(time_remaining / 2880)
adj_diff = score_diff + home_court + expected_diff × (time_remaining / 2880)
```
Random walk model (Stern 1994). Team quality fades as the actual score develops.

**RAPM**
Ridge regression on stint-level data. Design matrix: +1 for home players, -1 for away players. Target: net points per 100 possessions. Alpha=2000.

**Playoff Simulation**
```
for each sim:
  simulate remaining regular season games using win_prob(home_rtg - away_rtg)
  seed conferences by wins
  run play-in (7v8, 9v10, loser vs winner)
  simulate best-of-7 brackets (2-2-1-1-1 format)
  simulate Finals at neutral court
aggregate champion counts / n_sims
```

---

## Running locally

Requires PostgreSQL and the ESPN API (public, no key needed).

```bash
git clone https://github.com/rkamalesh07/swingfactr
cd swingfactr
pip install -r requirements.txt

# Set DATABASE_URL in .env
python -m src.etl.incremental --season 2025-26

# Start API
uvicorn src.api.main:app --reload

# Start frontend
cd src/app && npm install && npm run dev
```
