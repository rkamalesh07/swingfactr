# SwingFactr

NBA analytics platform modeling lineup impact, in-game win probability, clutch performance, and fatigue effects. Built on play-by-play data from the ESPN public API — no paid data sources required.

---

## What it does

- **Win Probability** — per-play win probability curves for every game, powered by a calibrated XGBoost model trained on 2024-25 play-by-play data
- **Lineup Impact** — RAPM-style ridge regression rankings for every 5-man unit, with bootstrap confidence intervals
- **Clutch Performance** — team net ratings in late-game, close situations (last 5 min, margin within 5)
- **Fatigue & Travel** — OLS regression estimates of how back-to-backs, travel distance, altitude, and timezone changes affect score margin

---

## Stack

- **Data** — ESPN public API (no key required)
- **Backend** — Python, FastAPI, PostgreSQL, XGBoost, scikit-learn, statsmodels
- **Frontend** — Next.js 14, Recharts
- **Deployment** — Railway (API + DB), Vercel (frontend)

---

## Setup

### Prerequisites
- Python 3.11+
- PostgreSQL running locally
- Node.js 18+

### Install

```bash
git clone https://github.com/rkamalesh07/swingfactr
cd swingfactr
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
createdb swingfactr
```

### Run ETL

```bash
export DATABASE_URL=postgresql://localhost:5432/swingfactr
python -m src.etl.run_pipeline --season 2024-25
```

### Train models

```bash
python -m src.models.train_all --quick
```

### Start API

```bash
python -m uvicorn src.api.main:app --port 8000
```

### Start frontend

```bash
cd src/app
npm install
npm run dev
```

---

## API

| Endpoint | Description |
|----------|-------------|
| `GET /games?season=2025-26` | List games with scores |
| `GET /game/{id}/winprob` | Win probability curve for a game |
| `GET /team/{id}/lineup_rankings` | Lineup RAPM rankings for a team |
| `GET /clutch` | Clutch net ratings by team |
| `GET /fatigue` | Fatigue and travel effect estimates |
| `GET /docs` | Swagger UI |

---

## Project structure

```
swingfactr/
├── src/
│   ├── etl/          # ESPN API client, play-by-play parsing, schedule features
│   ├── features/     # Win prob features, RAPM design matrix, defensive clustering
│   ├── models/       # XGBoost win prob, ridge RAPM, OLS fatigue
│   ├── api/          # FastAPI app and routers
│   └── app/          # Next.js frontend
├── sql/schema.sql
├── requirements.txt
└── docker-compose.yml
```
