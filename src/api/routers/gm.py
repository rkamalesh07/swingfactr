"""
SwingFactr GM Mode — FastAPI Router
src/api/routers/gm.py

Add to main.py:
    from src.api.routers.gm import router as gm_router
    app.include_router(gm_router)
"""

import uuid
import math
import random
import json
from datetime import datetime, date
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from src.etl.db import get_conn

router = APIRouter(prefix="/gm", tags=["gm"])

# ─── Constants ────────────────────────────────────────────────────────────────

SALARY_CAP       = 140_000_000
LUXURY_TAX       = 170_000_000
MID_LEVEL        = 12_400_000
VET_MIN          = 1_200_000
PLAYOFFS_START   = "2026-04-18"

NBA_TEAMS = [
    "ATL","BOS","BKN","CHA","CHI","CLE","DAL","DEN","DET","GS",
    "HOU","IND","LAC","LAL","MEM","MIA","MIL","MIN","NO","NY",
    "OKC","ORL","PHI","PHX","POR","SA","SAC","TOR","UTAH","WSH"
]

TEAM_FULL_NAMES = {
    "ATL":"Atlanta Hawks","BOS":"Boston Celtics","BKN":"Brooklyn Nets",
    "CHA":"Charlotte Hornets","CHI":"Chicago Bulls","CLE":"Cleveland Cavaliers",
    "DAL":"Dallas Mavericks","DEN":"Denver Nuggets","DET":"Detroit Pistons",
    "GS":"Golden State Warriors","HOU":"Houston Rockets","IND":"Indiana Pacers",
    "LAC":"LA Clippers","LAL":"LA Lakers","MEM":"Memphis Grizzlies",
    "MIA":"Miami Heat","MIL":"Milwaukee Bucks","MIN":"Minnesota Timberwolves",
    "NO":"New Orleans Pelicans","NY":"New York Knicks","OKC":"Oklahoma City Thunder",
    "ORL":"Orlando Magic","PHI":"Philadelphia 76ers","PHX":"Phoenix Suns",
    "POR":"Portland Trail Blazers","SA":"San Antonio Spurs","SAC":"Sacramento Kings",
    "TOR":"Toronto Raptors","UTAH":"Utah Jazz","WSH":"Washington Wizards"
}

CONFERENCE = {
    "ATL":"East","BOS":"East","BKN":"East","CHA":"East","CHI":"East",
    "CLE":"East","DET":"East","IND":"East","MIA":"East","MIL":"East",
    "NY":"East","ORL":"East","PHI":"East","TOR":"East","WSH":"East",
    "DAL":"West","DEN":"West","GS":"West","HOU":"West","LAC":"West",
    "LAL":"West","MEM":"West","MIN":"West","NO":"West","OKC":"West",
    "PHX":"West","POR":"West","SA":"West","SAC":"West","UTAH":"West"
}

# ─── Attribute Derivation ─────────────────────────────────────────────────────

def safe_div(a, b, default=0.0):
    try:
        a, b = float(a), float(b)
    except (TypeError, ValueError):
        return default
    return a / b if b > 0 else default

def clamp(v, lo=0, hi=100):
    return max(lo, min(hi, v))

def normalize_to_100(val, lo, hi):
    if hi == lo:
        return 50
    return clamp((val - lo) / (hi - lo) * 100)

def derive_attributes(row: dict) -> dict:
    """
    Derive 6 player attributes (0-100) from real game log aggregates.
    row must have: ppg, rpg, apg, spg, bpg, fg3m, tov, mpg, gp,
                   fg_pct, efg_pct, fg3_pct_est
    """
    mpg  = float(row.get("mpg") or 1)
    ppg  = float(row.get("ppg") or 0)
    rpg  = float(row.get("rpg") or 0)
    apg  = float(row.get("apg") or 0)
    spg  = float(row.get("spg") or 0)
    bpg  = float(row.get("bpg") or 0)
    tov  = float(row.get("tov") or 0)
    fg3m = float(row.get("fg3m") or 0)
    efg  = float(row.get("efg_pct") or 0)
    gp   = float(row.get("gp") or 1)
    efg  = row.get("efg_pct") or 0
    gp   = row.get("gp") or 1

    # Per-36 rates
    pts36 = safe_div(ppg, mpg) * 36
    ast36 = safe_div(apg, mpg) * 36
    reb36 = safe_div(rpg, mpg) * 36
    def36 = safe_div(spg + bpg, mpg) * 36
    tov36 = safe_div(tov, mpg) * 36

    # Scoring (pts per 36, scaled 0-40 → 0-100)
    scoring = clamp(normalize_to_100(pts36, 0, 40))

    # Efficiency (eFG%, scaled 40-70 → 0-100)
    efficiency = clamp(normalize_to_100(efg, 40, 70))

    # Playmaking (ast per 36, penalised by TOV, scaled 0-15)
    pm_raw = ast36 - tov36 * 0.5
    playmaking = clamp(normalize_to_100(pm_raw, -2, 15))

    # Rebounding (reb per 36, scaled 0-18)
    rebounding = clamp(normalize_to_100(reb36, 0, 18))

    # Defense (spg+blk per 36, scaled 0-6)
    defense = clamp(normalize_to_100(def36, 0, 6))

    # Composure: inverse of scoring variance — we approximate with games played
    # More games + higher scoring = more reliable (proxy only)
    composure = clamp(normalize_to_100(gp, 5, 82))

    # Overall (weighted)
    overall = clamp(
        0.25 * scoring +
        0.20 * efficiency +
        0.15 * playmaking +
        0.15 * rebounding +
        0.15 * defense +
        0.10 * composure
    )

    # Archetype
    ast_rate = safe_div(apg, mpg)
    fg3_rate = row.get("fg3_pct_est") or 0
    archetype = "Two-Way Wing"
    if ast_rate > 0.35 and fg3_rate < 25:        archetype = "Floor General"
    elif fg3_rate > 40 and spg > 1.0:            archetype = "3-and-D"
    elif rpg > 8 and bpg > 1.5:                  archetype = "Rim Protector"
    elif fg3_rate > 35 and rpg > 6:              archetype = "Stretch Four"
    elif ast_rate > 0.25 and rpg > 6:            archetype = "Playmaking Big"
    elif ppg > 20 and fg3_rate > 30:             archetype = "Wing Scorer"
    elif safe_div(apg, mpg) < 0.15 and rpg < 5: archetype = "Slasher"

    return {
        "scoring":     round(scoring),
        "efficiency":  round(efficiency),
        "playmaking":  round(playmaking),
        "rebounding":  round(rebounding),
        "defense":     round(defense),
        "composure":   round(composure),
        "overall":     round(overall),
        "archetype":   archetype,
    }

def estimate_salary(overall: int, age: int) -> int:
    """Estimate contract salary from overall rating and age."""
    base = (overall / 100) ** 2 * SALARY_CAP * 0.35
    age_mult = (
        0.85 if age <= 22 else
        1.00 if age <= 25 else
        1.10 if age <= 28 else
        0.90 if age <= 30 else
        0.75 if age <= 33 else
        0.55
    )
    salary = int(base * age_mult)
    return max(VET_MIN, min(int(SALARY_CAP * 0.35), salary))

def contract_years(overall: int, age: int) -> int:
    if overall >= 75: return random.choice([3, 4, 4, 5])
    if overall >= 55: return random.choice([2, 3, 3])
    return random.choice([1, 2])

# ─── DB Helpers ───────────────────────────────────────────────────────────────

def fetch_all_players(conn) -> list[dict]:
    """Fetch 574 players with derived stats from real game logs."""
    cur = conn.cursor()
    cur.execute("""
        SELECT
            p.full_name,
            p.position,
            COALESCE(pa.age, 26) AS age,
            gl.team_abbr,
            COUNT(*)                         AS gp,
            AVG(gl.pts)                      AS ppg,
            AVG(gl.reb)                      AS rpg,
            AVG(gl.ast)                      AS apg,
            AVG(gl.stl)                      AS spg,
            AVG(gl.blk)                      AS bpg,
            AVG(gl.fg3m)                     AS fg3m,
            AVG(gl.tov)                      AS tov,
            AVG(gl.minutes)                  AS mpg,
            AVG(CASE WHEN gl.fga > 0
                THEN gl.fg_made::float / gl.fga * 100 END) AS fg_pct,
            AVG(CASE WHEN gl.fga > 0
                THEN (gl.fg_made + 0.5*gl.fg3m)::float / gl.fga * 100 END) AS efg_pct,
            AVG(CASE WHEN gl.fga > 0
                THEN gl.fg3m::float / (gl.fga * 0.38) * 100 END) AS fg3_pct_est
        FROM player_game_logs gl
        JOIN players p ON p.full_name = gl.player_name
        LEFT JOIN player_ages pa ON pa.full_name = gl.player_name
        WHERE gl.season_id = '2025-26'
          AND gl.minutes >= 5
        GROUP BY p.full_name, p.position, pa.age, gl.team_abbr
        HAVING COUNT(*) >= 5
        ORDER BY AVG(gl.pts) DESC
    """)
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    cur.close()
    return rows

def get_save(conn, save_id: str) -> dict:
    cur = conn.cursor()
    cur.execute("SELECT state FROM gm_saves WHERE save_id = %s", (save_id,))
    row = cur.fetchone()
    cur.close()
    if not row:
        raise HTTPException(404, f"Save not found: {save_id}")
    val = row[0]
    return val if isinstance(val, dict) else json.loads(val)

def put_save(conn, save_id: str, state: dict):
    cur = conn.cursor()
    cur.execute("""
        UPDATE gm_saves SET state = %s, updated_at = NOW()
        WHERE save_id = %s
    """, (json.dumps(state), save_id))
    cur.close()

# ─── League Initialisation ────────────────────────────────────────────────────

def build_league(players: list[dict]) -> dict:
    """
    Distribute real players across 30 teams.
    Each player gets derived attributes + estimated contract.
    Returns league dict: {team_abbr: {roster, cap_used, wins, losses}}
    """
    # Enrich every player
    enriched = []
    for p in players:
        attrs = derive_attributes(p)
        sal = estimate_salary(attrs["overall"], int(p.get("age") or 26))
        yrs = contract_years(attrs["overall"], int(p.get("age") or 26))
        enriched.append({
            "id":          str(uuid.uuid4())[:8],
            "name":        p["full_name"],
            "position":    p.get("position") or "G",
            "age":         int(p.get("age") or 26),
            "team":        p.get("team_abbr") or "FA",
            "ppg":         round(float(p.get("ppg") or 0), 1),
            "rpg":         round(float(p.get("rpg") or 0), 1),
            "apg":         round(float(p.get("apg") or 0), 1),
            "mpg":         round(float(p.get("mpg") or 0), 1),
            "gp":          int(p.get("gp") or 0),
            **attrs,
            "salary":      sal,
            "years_left":  yrs,
        })

    # Build team rosters from real team assignments
    teams = {}
    for abbr in NBA_TEAMS:
        teams[abbr] = {
            "abbr":     abbr,
            "name":     TEAM_FULL_NAMES[abbr],
            "conf":     CONFERENCE[abbr],
            "roster":   [],
            "cap_used": 0,
            "wins":     0,
            "losses":   0,
            "gm_team":  False,
        }

    fa_pool = []
    for p in enriched:
        abbr = p["team"]
        if abbr in teams:
            teams[abbr]["roster"].append(p)
            teams[abbr]["cap_used"] += p["salary"]
        else:
            fa_pool.append(p)

    # Trim rosters > 15 (move extras to FA)
    for abbr, team in teams.items():
        roster = sorted(team["roster"], key=lambda x: -x["overall"])
        if len(roster) > 15:
            fa_pool.extend(roster[15:])
            team["roster"] = roster[:15]
        team["roster"] = roster
        team["cap_used"] = sum(p["salary"] for p in team["roster"])

    return {"teams": teams, "fa_pool": fa_pool, "season": 1, "day": 0, "games_simmed": 0}

# ─── Season Simulation ────────────────────────────────────────────────────────

def team_strength(team: dict) -> float:
    """Simple team strength from avg overall of top 8 players."""
    roster = sorted(team["roster"], key=lambda x: -x["overall"])[:8]
    if not roster:
        return 50.0
    return sum(p["overall"] for p in roster) / len(roster)

def sim_game(home: dict, away: dict) -> tuple[str, str]:
    """Simulate one game. Returns (winner_abbr, loser_abbr)."""
    home_str = team_strength(home) + 3.0  # home court
    away_str = team_strength(away)
    diff = home_str - away_str
    prob = 1 / (1 + math.exp(-diff * 0.12))
    if random.random() < prob:
        return home["abbr"], away["abbr"]
    return away["abbr"], home["abbr"]

def simulate_days(league: dict, n_days: int) -> dict:
    """Simulate n_days of games across all 30 teams."""
    teams = league["teams"]
    team_list = list(teams.values())

    for _ in range(n_days):
        random.shuffle(team_list)
        # ~15 games per day (all 30 teams play)
        played = set()
        for i in range(0, len(team_list) - 1, 2):
            h = team_list[i]
            a = team_list[i + 1]
            if h["abbr"] in played or a["abbr"] in played:
                continue
            winner, loser = sim_game(h, a)
            teams[winner]["wins"]   += 1
            teams[loser]["losses"]  += 1
            played.add(h["abbr"])
            played.add(a["abbr"])

        league["day"] += 1
        league["games_simmed"] += 15

    return league

# ─── Standings Helper ─────────────────────────────────────────────────────────

def standings_sorted(teams: dict) -> dict:
    east, west = [], []
    for t in teams.values():
        entry = {
            "abbr":   t["abbr"],
            "name":   t["name"],
            "wins":   t["wins"],
            "losses": t["losses"],
            "pct":    round(safe_div(t["wins"], t["wins"] + t["losses"]), 3),
            "gm_team": t.get("gm_team", False),
        }
        if t["conf"] == "East":
            east.append(entry)
        else:
            west.append(entry)
    east.sort(key=lambda x: -x["pct"])
    west.sort(key=lambda x: -x["pct"])
    return {"east": east, "west": west}

# ─── DB Schema Init ───────────────────────────────────────────────────────────

@router.post("/init-db")
def init_db():
    """Create GM tables. Run once."""
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS gm_saves (
                save_id    TEXT PRIMARY KEY,
                team_abbr  TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                state      JSONB NOT NULL
            );
        """)
        cur.close()
    return {"ok": True, "message": "gm_saves table ready"}

# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/teams")
def list_teams():
    """Return all 30 teams with name + conference for franchise select."""
    return [
        {"abbr": abbr, "name": TEAM_FULL_NAMES[abbr], "conf": CONFERENCE[abbr]}
        for abbr in NBA_TEAMS
    ]

class NewGameBody(BaseModel):
    team_abbr: str

@router.post("/new-game")
def new_game(body: NewGameBody):
    """
    Initialise a new GM save.
    Pulls real player data, derives attributes, distributes across 30 teams.
    Returns save_id (UUID) for all subsequent calls.
    """
    abbr = body.team_abbr.upper()
    if abbr not in NBA_TEAMS:
        raise HTTPException(400, f"Unknown team: {abbr}")

    save_id = str(uuid.uuid4())
    with get_conn() as conn:
        players = fetch_all_players(conn)
        league  = build_league(players)
        league["teams"][abbr]["gm_team"] = True
        league["gm_team"] = abbr
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO gm_saves (save_id, team_abbr, state)
            VALUES (%s, %s, %s)
        """, (save_id, abbr, json.dumps(league)))
        cur.close()

    team = league["teams"][abbr]
    return {
        "save_id":   save_id,
        "team":      abbr,
        "team_name": TEAM_FULL_NAMES[abbr],
        "roster_count": len(team["roster"]),
        "cap_used":  team["cap_used"],
        "cap_space": SALARY_CAP - team["cap_used"],
        "message":   f"GM save created for {TEAM_FULL_NAMES[abbr]}",
    }

@router.get("/state/{save_id}")
def get_state(save_id: str):
    """Return top-level league state (day, season, standings summary)."""
    with get_conn() as conn:
        league = get_save(conn, save_id)

    abbr  = league["gm_team"]
    team  = league["teams"][abbr]
    stnd  = standings_sorted(league["teams"])

    # Find your position in standings
    conf  = CONFERENCE[abbr]
    conf_standings = stnd["east"] if conf == "East" else stnd["west"]
    rank  = next((i+1 for i, t in enumerate(conf_standings) if t["abbr"] == abbr), "?")

    return {
        "save_id":     save_id,
        "season":      league["season"],
        "day":         league["day"],
        "gm_team":     abbr,
        "team_name":   TEAM_FULL_NAMES[abbr],
        "wins":        team["wins"],
        "losses":      team["losses"],
        "cap_used":    team["cap_used"],
        "cap_space":   SALARY_CAP - team["cap_used"],
        "luxury_tax":  LUXURY_TAX,
        "conf_rank":   rank,
        "conference":  conf,
        "games_simmed": league.get("games_simmed", 0),
    }

@router.get("/roster/{save_id}")
def get_roster(save_id: str):
    """Return your team's roster with all attributes."""
    with get_conn() as conn:
        league = get_save(conn, save_id)

    abbr   = league["gm_team"]
    team   = league["teams"][abbr]
    roster = sorted(team["roster"], key=lambda x: -x["overall"])

    return {
        "team":      abbr,
        "team_name": TEAM_FULL_NAMES[abbr],
        "cap_used":  team["cap_used"],
        "cap_space": SALARY_CAP - team["cap_used"],
        "salary_cap": SALARY_CAP,
        "luxury_tax": LUXURY_TAX,
        "roster":    roster,
        "count":     len(roster),
    }

@router.get("/standings/{save_id}")
def get_standings(save_id: str):
    """Return East/West standings."""
    with get_conn() as conn:
        league = get_save(conn, save_id)
    return {
        "day":      league["day"],
        "season":   league["season"],
        "gm_team":  league["gm_team"],
        **standings_sorted(league["teams"])
    }

@router.get("/free-agents/{save_id}")
def get_free_agents(save_id: str, limit: int = Query(50)):
    """Return FA pool sorted by overall."""
    with get_conn() as conn:
        league = get_save(conn, save_id)

    fa = sorted(league["fa_pool"], key=lambda x: -x["overall"])[:limit]
    return {"free_agents": fa, "total": len(league["fa_pool"])}

class SimBody(BaseModel):
    days: int = 7

@router.post("/simulate/{save_id}")
def simulate(save_id: str, body: SimBody):
    """Simulate N days of games. Updates standings in save."""
    days = max(1, min(body.days, 30))
    conn = get_conn()
    league = get_save(conn, save_id)
    league = simulate_days(league, days)
    with get_conn() as conn:
        put_save(conn, save_id, league)

    abbr = league["gm_team"]
    team = league["teams"][abbr]
    return {
        "days_simmed": days,
        "total_day":   league["day"],
        "your_record": f"{team['wins']}-{team['losses']}",
        "standings":   standings_sorted(league["teams"]),
    }

class SignBody(BaseModel):
    player_id: str

@router.post("/sign/{save_id}")
def sign_player(save_id: str, body: SignBody):
    """Sign a free agent to your roster."""
    conn = get_conn()
    league = get_save(conn, save_id)

    abbr = league["gm_team"]
    team = league["teams"][abbr]

    if len(team["roster"]) >= 15:
        raise HTTPException(400, "Roster full (15/15). Release a player first.")

    fa_pool = league["fa_pool"]
    player  = next((p for p in fa_pool if p["id"] == body.player_id), None)
    if not player:
        raise HTTPException(404, "Player not in FA pool")

    new_cap = team["cap_used"] + player["salary"]
    if new_cap > LUXURY_TAX:
        raise HTTPException(400, f"Signing would push you over luxury tax (${LUXURY_TAX:,})")

    team["roster"].append({**player, "team": abbr})
    team["cap_used"] = new_cap
    league["fa_pool"] = [p for p in fa_pool if p["id"] != body.player_id]

    with get_conn() as conn:
        put_save(conn, save_id, league)

    return {
        "signed":    player["name"],
        "salary":    player["salary"],
        "cap_used":  new_cap,
        "cap_space": SALARY_CAP - new_cap,
        "roster_count": len(team["roster"]),
    }

class ReleaseBody(BaseModel):
    player_id: str

@router.post("/release/{save_id}")
def release_player(save_id: str, body: ReleaseBody):
    """Release a player from your roster to the FA pool."""
    conn = get_conn()
    league = get_save(conn, save_id)

    abbr   = league["gm_team"]
    team   = league["teams"][abbr]
    roster = team["roster"]

    player = next((p for p in roster if p["id"] == body.player_id), None)
    if not player:
        raise HTTPException(404, "Player not on your roster")

    team["roster"]   = [p for p in roster if p["id"] != body.player_id]
    team["cap_used"] -= player["salary"]
    league["fa_pool"].append({**player, "team": "FA"})

    with get_conn() as conn:
        put_save(conn, save_id, league)

    return {
        "released":  player["name"],
        "cap_freed": player["salary"],
        "cap_used":  team["cap_used"],
        "cap_space": SALARY_CAP - team["cap_used"],
    }
