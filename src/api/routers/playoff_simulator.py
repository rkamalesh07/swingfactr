"""
Playoff Simulator — simulates remaining regular season + full playoffs N times.
"""
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from src.etl.db import get_conn
import httpx, math, random
from datetime import date, datetime, timezone, timedelta
from collections import defaultdict

router = APIRouter()
ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
HEADERS = {"User-Agent": "Mozilla/5.0"}

# All known ESPN abbreviation variants → canonical
# ESPN uses SA, NO, GS, NY, etc. — NOT SAS, NOP, GSW, NYK
ABBR_NORMALIZE = {
    "SA": "SAS", "NO": "NOP", "GS": "GSW", "NY": "NYK", "UTAH": "UTA",
    "WSH": "WAS", "WAS": "WAS", "NOP": "NOP", "SAS": "SAS", "GSW": "GSW",
    "NYK": "NYK", "UTA": "UTA",
}

# Conference membership — use canonical abbreviations
EASTERN = {"BOS","NYK","MIL","CLE","IND","MIA","PHI","CHI","ATL","BKN","CHA","WAS","ORL","DET","TOR"}
WESTERN = {"OKC","HOU","LAL","LAC","DEN","MIN","SAC","GSW","PHX","MEM","DAL","UTA","POR","NOP","SAS"}

def normalize(abbr: str) -> str:
    return ABBR_NORMALIZE.get(abbr, abbr)

def exp_weight(game_date, today=None):
    if today is None:
        today = date.today()
    if isinstance(game_date, str):
        game_date = date.fromisoformat(game_date[:10])
    return math.exp(-0.015 * max(0, (today - game_date).days))

def win_prob(rtg_diff: float, home_adv: float = 2.5) -> float:
    z = (rtg_diff + home_adv) / 12.0
    p = 0.5 * (1 + math.erf(z / math.sqrt(2)))
    return max(0.05, min(0.95, p))

def simulate_series(rtg_home: float, rtg_away: float) -> bool:
    """Best-of-7, 2-2-1-1-1. Returns True if home (higher) seed wins."""
    hw = aw = 0
    home_games = {1,2,5,7}
    game = 0
    while hw < 4 and aw < 4:
        game += 1
        is_home = game in home_games
        diff = rtg_home - rtg_away if is_home else rtg_away - rtg_home
        if random.random() < win_prob(diff if is_home else -diff):
            hw += 1
        else:
            aw += 1
    return hw >= 4

def apply_playin(seeds: list, ratings: dict) -> list:
    """NBA play-in: seeds 7-10 compete for 7th and 8th playoff spots."""
    if len(seeds) < 10:
        return seeds[:8]
    s7,s8,s9,s10 = seeds[6],seeds[7],seeds[8],seeds[9]
    # 7v8: winner gets 7 seed
    p7 = win_prob(ratings.get(s7,0) - ratings.get(s8,0), home_adv=0)
    w78 = s7 if random.random() < p7 else s8
    l78 = s8 if w78==s7 else s7
    # 9v10: loser eliminated
    p9 = win_prob(ratings.get(s9,0) - ratings.get(s10,0), home_adv=0)
    w910 = s9 if random.random() < p9 else s10
    # loser of 7v8 vs winner of 9v10: winner gets 8 seed
    pl = win_prob(ratings.get(l78,0) - ratings.get(w910,0), home_adv=0)
    s8_team = l78 if random.random() < pl else w910
    return seeds[:6] + [w78, s8_team]

def run_conference(seeds: list, ratings: dict) -> tuple:
    """Run conference bracket. Returns (champion, conf_finals_participants)."""
    r1 = []
    for h,a in [(seeds[0],seeds[7]),(seeds[1],seeds[6]),(seeds[2],seeds[5]),(seeds[3],seeds[4])]:
        r1.append(h if simulate_series(ratings.get(h,0), ratings.get(a,0)) else a)
    r2 = []
    cf = []
    for h,a in [(r1[0],r1[3]),(r1[1],r1[2])]:
        w = h if simulate_series(ratings.get(h,0), ratings.get(a,0)) else a
        r2.append(w)
        cf.extend([h, a])
    champ = r2[0] if simulate_series(ratings.get(r2[0],0), ratings.get(r2[1],0)) else r2[1]
    return champ, cf

async def fetch_remaining_schedule():
    remaining = []
    est = timezone(timedelta(hours=-5))
    today_str = datetime.now(est).strftime("%Y-%m-%d")
    async with httpx.AsyncClient(headers=HEADERS, timeout=20) as client:
        for month in ["202602","202603","202604"]:
            try:
                r = await client.get(f"{ESPN_BASE}/scoreboard", params={"dates": month, "limit": 100})
                data = r.json()
                for event in data.get("events", []):
                    comp = event.get("competitions",[{}])[0]
                    state = comp.get("status",{}).get("type",{}).get("state","pre")
                    if state != "pre":
                        continue
                    gdate = event["date"][:10]
                    if gdate < today_str:
                        continue
                    teams = {t["homeAway"]: t for t in comp.get("competitors",[])}
                    home = normalize(teams.get("home",{}).get("team",{}).get("abbreviation","?"))
                    away = normalize(teams.get("away",{}).get("team",{}).get("abbreviation","?"))
                    if "?" not in (home, away):
                        remaining.append({"date": gdate, "home": home, "away": away})
            except:
                continue
    return remaining

def get_ratings_and_standings():
    today = date.today()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT t.abbreviation,
                    CASE WHEN g.home_team_id = t.team_id THEN g.home_score - g.away_score
                         ELSE g.away_score - g.home_score END as margin,
                    g.game_date,
                    CASE WHEN (g.home_win AND g.home_team_id = t.team_id)
                              OR (NOT g.home_win AND g.away_team_id = t.team_id)
                         THEN 1 ELSE 0 END as won
                FROM teams t
                JOIN games g ON (g.home_team_id = t.team_id OR g.away_team_id = t.team_id)
                WHERE g.season_id = '2025-26' AND g.home_score IS NOT NULL
            """)
            rows = cur.fetchall()

    data = defaultdict(lambda: {"games": [], "wins": 0, "losses": 0})
    for abbr, margin, gdate, won in rows:
        abbr = normalize(abbr)
        data[abbr]["games"].append((margin, gdate))
        if won: data[abbr]["wins"] += 1
        else: data[abbr]["losses"] += 1

    ratings, standings = {}, {}
    for abbr, d in data.items():
        tw = twm = 0
        for margin, gdate in d["games"]:
            w = exp_weight(gdate, today)
            tw += w; twm += w * margin
        ratings[abbr] = twm / tw if tw > 0 else 0.0
        standings[abbr] = {"wins": d["wins"], "losses": d["losses"]}

    # Ensure all 30 teams present even if no games
    for t in EASTERN | WESTERN:
        if t not in ratings: ratings[t] = 0.0
        if t not in standings: standings[t] = {"wins": 0, "losses": 0}

    return ratings, standings

@router.get("/simulate")
async def run_simulation(n_sims: int = Query(10000, le=1000000)):
    ratings, standings = get_ratings_and_standings()
    remaining = await fetch_remaining_schedule()

    champ_counts = defaultdict(int)
    finals_counts = defaultdict(int)
    cf_counts = defaultdict(int)
    playoff_counts = defaultdict(int)
    win_totals = defaultdict(list)

    # Validate all remaining game teams are known
    known = set(ratings.keys())
    remaining = [g for g in remaining if g["home"] in known and g["away"] in known]

    random.seed(42)
    for _ in range(n_sims):
        sim_wins = {t: standings[t]["wins"] for t in standings}
        sim_losses = {t: standings[t]["losses"] for t in standings}

        for g in remaining:
            h, a = g["home"], g["away"]
            p = win_prob(ratings[h] - ratings[a])
            if random.random() < p:
                sim_wins[h] = sim_wins.get(h,0) + 1
                sim_losses[a] = sim_losses.get(a,0) + 1
            else:
                sim_wins[a] = sim_wins.get(a,0) + 1
                sim_losses[h] = sim_losses.get(h,0) + 1

        for t in sim_wins:
            win_totals[t].append(sim_wins.get(t,0))

        def conf_seed(teams):
            return sorted(
                [(t, sim_wins.get(t,0)) for t in teams if t in sim_wins],
                key=lambda x: (-x[1], -ratings.get(x[0],0))
            )

        e_std = conf_seed(EASTERN)
        w_std = conf_seed(WESTERN)

        e_seeds = [t for t,_ in e_std]
        w_seeds = [t for t,_ in w_std]

        e_playoff = apply_playin(e_seeds, ratings)
        w_playoff = apply_playin(w_seeds, ratings)

        if len(e_playoff) < 8 or len(w_playoff) < 8:
            continue

        for t in e_playoff + w_playoff:
            playoff_counts[t] += 1

        e_champ, e_cf = run_conference(e_playoff, ratings)
        w_champ, w_cf = run_conference(w_playoff, ratings)

        for t in e_cf + w_cf:
            cf_counts[t] += 1
        finals_counts[e_champ] += 1
        finals_counts[w_champ] += 1

        # Finals — neutral court
        p_east = win_prob(ratings.get(e_champ,0) - ratings.get(w_champ,0), home_adv=0)
        champion = e_champ if random.random() < p_east else w_champ
        champ_counts[champion] += 1

    results = []
    for team in sorted(standings.keys()):
        wl = standings[team]
        wins_list = win_totals.get(team, [wl["wins"]])
        conf = "East" if team in EASTERN else "West"
        results.append({
            "team": team,
            "conference": conf,
            "current_wins": wl["wins"],
            "current_losses": wl["losses"],
            "projected_wins": round(sum(wins_list)/len(wins_list)) if wins_list else wl["wins"],
            "net_rtg": round(ratings.get(team,0), 1),
            "playoff_pct": round(playoff_counts[team]/n_sims*100, 1),
            "conf_finals_pct": round(cf_counts[team]/n_sims*100, 1),
            "finals_pct": round(finals_counts[team]/n_sims*100, 1),
            "champion_pct": round(champ_counts[team]/n_sims*100, 1),
        })

    results.sort(key=lambda x: -x["champion_pct"])
    top3 = [{"team": r["team"], "pct": r["champion_pct"]} for r in results[:3] if r["champion_pct"] > 0]

    # Conference breakdown
    east_results = sorted([r for r in results if r["conference"]=="East"], key=lambda x: -x["projected_wins"])
    west_results = sorted([r for r in results if r["conference"]=="West"], key=lambda x: -x["projected_wins"])

    return JSONResponse({
        "n_sims": n_sims,
        "remaining_games": len(remaining),
        "as_of": date.today().isoformat(),
        "top_champions": top3,
        "results": results,
        "east_standings": east_results,
        "west_standings": west_results,
    })
