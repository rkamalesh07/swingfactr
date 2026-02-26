"""
Playoff Simulator — simulates remaining regular season + full playoffs 10,000 times.

Pipeline:
1. Fetch remaining schedule from ESPN
2. Get each team's exponentially weighted net rating from DB
3. For each simulation:
   a. Simulate remaining regular season games using win prob from ratings
   b. Compute final standings per conference
   c. Apply NBA play-in (7-10 seeds) to set playoff bracket
   d. Simulate best-of-7 series through all 4 rounds
4. Aggregate: playoff odds, finals odds, champion odds per team
"""

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from src.etl.db import get_conn
import httpx
import math
import random
from datetime import date, datetime, timezone, timedelta
from collections import defaultdict

router = APIRouter()

ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
HEADERS = {"User-Agent": "Mozilla/5.0"}
N_SIMS = 10000

# NBA conference alignment
EASTERN = {"BOS","NYK","MIL","CLE","IND","MIA","PHI","CHI","ATL","BKN","CHA","WSH","ORL","DET","TOR"}
WESTERN = {"OKC","HOU","LAL","LAC","DEN","MIN","SAC","GSW","PHX","MEM","DAL","UTA","POR","NOR","SAS"}

def exp_weight(game_date, today=None):
    if today is None:
        today = date.today()
    if isinstance(game_date, str):
        game_date = date.fromisoformat(game_date[:10])
    days_ago = (today - game_date).days
    return math.exp(-0.015 * max(0, days_ago))

def win_prob_from_rating_diff(rating_diff: float, home_advantage: float = 2.5) -> float:
    """Convert net rating differential to win probability using logistic model."""
    adj = rating_diff + home_advantage
    # NBA: ~3 pts per game std from rating diff perspective
    z = adj / 12.0
    p = 0.5 * (1 + math.erf(z / math.sqrt(2)))
    return max(0.05, min(0.95, p))

def simulate_series(home_rtg: float, away_rtg: float, n_games: int = 7) -> bool:
    """Simulate a best-of-N series. Returns True if home team wins."""
    home_wins = 0
    away_wins = 0
    needed = (n_games // 2) + 1
    game_num = 0
    # Playoff format: 2-2-1-1-1 home games for higher seed
    home_games = {1,2,5,7}  # games where higher seed is home

    while home_wins < needed and away_wins < needed:
        game_num += 1
        is_home = game_num in home_games
        rtg_diff = (home_rtg - away_rtg) if is_home else (away_rtg - home_rtg)
        p_home_seed_wins = win_prob_from_rating_diff(rtg_diff if is_home else -rtg_diff)
        if random.random() < p_home_seed_wins:
            home_wins += 1
        else:
            away_wins += 1

    return home_wins >= needed


async def fetch_remaining_schedule():
    """Fetch all unplayed NBA games remaining this season from ESPN."""
    remaining = []
    est = timezone(timedelta(hours=-5))
    today = datetime.now(est).strftime("%Y%m%d")

    # ESPN calendar endpoint — fetch month by month through June
    async with httpx.AsyncClient(headers=HEADERS, timeout=15) as client:
        # Get schedule for rest of season: Feb-June 2026
        months = ["202602", "202603", "202604", "202605", "202606"]
        for month in months:
            try:
                r = await client.get(
                    f"{ESPN_BASE}/scoreboard",
                    params={"dates": month, "limit": 50}
                )
                data = r.json()
                for event in data.get("events", []):
                    comp = event.get("competitions", [{}])[0]
                    status = comp.get("status", {})
                    state = status.get("type", {}).get("state", "pre")
                    if state != "pre":
                        continue  # already played

                    game_date = event["date"][:10]
                    if game_date < datetime.now(est).strftime("%Y-%m-%d"):
                        continue

                    teams = {t["homeAway"]: t for t in comp.get("competitors", [])}
                    home_abbr = teams.get("home", {}).get("team", {}).get("abbreviation", "?")
                    away_abbr = teams.get("away", {}).get("team", {}).get("abbreviation", "?")

                    if home_abbr == "?" or away_abbr == "?":
                        continue

                    remaining.append({
                        "date": game_date,
                        "home": home_abbr,
                        "away": away_abbr,
                    })
            except Exception:
                continue

    return remaining


def get_team_ratings_and_standings():
    """Get exponentially weighted net ratings + current W-L from DB."""
    today = date.today()
    with get_conn() as conn:
        with conn.cursor() as cur:
            # Per-game margins with dates for weighting
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
                ORDER BY g.game_date
            """)
            rows = cur.fetchall()

    team_data = defaultdict(lambda: {"margins": [], "wins": 0, "losses": 0})
    for abbr, margin, gdate, won in rows:
        team_data[abbr]["margins"].append((margin, gdate))
        if won:
            team_data[abbr]["wins"] += 1
        else:
            team_data[abbr]["losses"] += 1

    ratings = {}
    standings = {}
    for abbr, data in team_data.items():
        total_w = total_wm = 0
        for margin, gdate in data["margins"]:
            w = exp_weight(gdate, today)
            total_w += w
            total_wm += w * margin
        ratings[abbr] = total_wm / total_w if total_w > 0 else 0.0
        standings[abbr] = {"wins": data["wins"], "losses": data["losses"]}

    return ratings, standings


def apply_playin(conf_standings: list, ratings: dict) -> list:
    """
    Apply NBA play-in tournament for seeds 7-10.
    Returns ordered list of 8 playoff teams (seeds 1-8).
    7 vs 8: winner = 7 seed, loser plays on
    9 vs 10: loser eliminated, winner plays loser of 7v8
    That winner = 8 seed
    """
    seeds = [t for t, _ in conf_standings]
    if len(seeds) < 10:
        return seeds[:8]

    s7, s8, s9, s10 = seeds[6], seeds[7], seeds[8], seeds[9]

    # Game 1: 7 vs 8
    r7 = ratings.get(s7, 0)
    r8 = ratings.get(s8, 0)
    p7_wins = win_prob_from_rating_diff(r7 - r8)
    game1_winner = s7 if random.random() < p7_wins else s8
    game1_loser = s8 if game1_winner == s7 else s7

    # Game 2: 9 vs 10
    r9 = ratings.get(s9, 0)
    r10 = ratings.get(s10, 0)
    p9_wins = win_prob_from_rating_diff(r9 - r10)
    game2_winner = s9 if random.random() < p9_wins else s10

    # Game 3: loser of 7v8 vs winner of 9v10
    rl = ratings.get(game1_loser, 0)
    rw = ratings.get(game2_winner, 0)
    p_loser_wins = win_prob_from_rating_diff(rl - rw)
    eighth_seed = game1_loser if random.random() < p_loser_wins else game2_winner

    return seeds[:6] + [game1_winner, eighth_seed]


def simulate_playoffs(bracket_east: list, bracket_west: list, ratings: dict) -> str:
    """
    Simulate full NBA playoffs. Returns champion abbreviation.
    Bracket: [1,8,4,5,3,6,2,7] matchup format
    """
    def run_conference(seeds: list) -> str:
        # Round 1: 1v8, 2v7, 3v6, 4v5
        matchups = [(seeds[0], seeds[7]), (seeds[1], seeds[6]),
                    (seeds[2], seeds[5]), (seeds[3], seeds[4])]
        r2 = []
        for h, a in matchups:
            winner = h if simulate_series(ratings.get(h, 0), ratings.get(a, 0)) else a
            r2.append(winner)

        # Round 2: (1/8 winner vs 4/5 winner), (2/7 winner vs 3/6 winner)
        r3 = []
        for h, a in [(r2[0], r2[3]), (r2[1], r2[2])]:
            winner = h if simulate_series(ratings.get(h, 0), ratings.get(a, 0)) else a
            r3.append(winner)

        # Conference finals
        h, a = r3[0], r3[1]
        return h if simulate_series(ratings.get(h, 0), ratings.get(a, 0)) else a

    east_champ = run_conference(bracket_east)
    west_champ = run_conference(bracket_west)

    # NBA Finals — neutral court (no home advantage)
    re = ratings.get(east_champ, 0)
    rw = ratings.get(west_champ, 0)
    p_east = win_prob_from_rating_diff(re - rw, home_advantage=0)
    return east_champ if random.random() < p_east else west_champ


@router.get("/simulate")
async def run_playoff_simulation(n_sims: int = Query(N_SIMS, le=10000)):
    """
    Run full season + playoff simulation n_sims times.
    Returns champion odds, finals odds, playoff odds per team.
    """
    # 1. Get team ratings and current standings
    ratings, standings = get_team_ratings_and_standings()

    # 2. Fetch remaining schedule
    remaining_games = await fetch_remaining_schedule()

    # 3. Determine which teams are in each conference
    all_teams = set(standings.keys())
    east_teams = all_teams & EASTERN
    west_teams = all_teams & WESTERN

    # Counters
    champion_counts = defaultdict(int)
    finals_counts = defaultdict(int)
    conf_finals_counts = defaultdict(int)
    playoff_counts = defaultdict(int)
    win_totals = defaultdict(list)  # list of final win counts per sim

    random.seed(42)  # reproducible aggregate (but varied per sim via loop)

    for sim_i in range(n_sims):
        # --- Simulate remaining regular season ---
        sim_wins = {t: standings[t]["wins"] for t in standings}
        sim_losses = {t: standings[t]["losses"] for t in standings}

        for game in remaining_games:
            home, away = game["home"], game["away"]
            if home not in ratings or away not in ratings:
                continue
            p_home = win_prob_from_rating_diff(ratings[home] - ratings[away])
            if random.random() < p_home:
                sim_wins[home] = sim_wins.get(home, 0) + 1
                sim_losses[away] = sim_losses.get(away, 0) + 1
            else:
                sim_wins[away] = sim_wins.get(away, 0) + 1
                sim_losses[home] = sim_losses.get(home, 0) + 1

        for t in sim_wins:
            win_totals[t].append(sim_wins.get(t, 0))

        # --- Build conference standings ---
        def conf_standings(teams):
            return sorted(
                [(t, sim_wins.get(t, 0)) for t in teams if t in sim_wins],
                key=lambda x: (-x[1], -ratings.get(x[0], 0))  # tiebreak by rating
            )

        east_std = conf_standings(east_teams)
        west_std = conf_standings(west_teams)

        # --- Play-in tournament (seeds 7-10) ---
        east_playoff = apply_playin(east_std, ratings)
        west_playoff = apply_playin(west_std, ratings)

        if len(east_playoff) < 8 or len(west_playoff) < 8:
            continue

        for t in east_playoff:
            playoff_counts[t] += 1
        for t in west_playoff:
            playoff_counts[t] += 1

        # --- Simulate playoffs ---
        # Track conference finals participants
        def run_conf_with_tracking(seeds):
            matchups = [(seeds[0], seeds[7]), (seeds[1], seeds[6]),
                       (seeds[2], seeds[5]), (seeds[3], seeds[4])]
            r2 = []
            for h, a in matchups:
                winner = h if simulate_series(ratings.get(h, 0), ratings.get(a, 0)) else a
                r2.append(winner)
            r3 = []
            for h, a in [(r2[0], r2[3]), (r2[1], r2[2])]:
                winner = h if simulate_series(ratings.get(h, 0), ratings.get(a, 0)) else a
                r3.append(winner)
            for t in r3:
                conf_finals_counts[t] += 1
            h, a = r3[0], r3[1]
            champ = h if simulate_series(ratings.get(h, 0), ratings.get(a, 0)) else a
            return champ

        east_champ = run_conf_with_tracking(east_playoff)
        west_champ = run_conf_with_tracking(west_playoff)

        finals_counts[east_champ] += 1
        finals_counts[west_champ] += 1

        # NBA Finals
        re = ratings.get(east_champ, 0)
        rw = ratings.get(west_champ, 0)
        p_east = win_prob_from_rating_diff(re - rw, home_advantage=0)
        champion = east_champ if random.random() < p_east else west_champ
        champion_counts[champion] += 1

    # --- Build results ---
    results = []
    for team in sorted(standings.keys()):
        w = standings[team]["wins"]
        l = standings[team]["losses"]
        projected_wins = round(sum(win_totals[team]) / len(win_totals[team])) if win_totals[team] else w
        conf = "East" if team in EASTERN else "West"

        results.append({
            "team": team,
            "conference": conf,
            "current_wins": w,
            "current_losses": l,
            "projected_wins": projected_wins,
            "net_rtg": round(ratings.get(team, 0), 1),
            "playoff_pct": round(playoff_counts[team] / n_sims * 100, 1),
            "conf_finals_pct": round(conf_finals_counts[team] / n_sims * 100, 1),
            "finals_pct": round(finals_counts[team] / n_sims * 100, 1),
            "champion_pct": round(champion_counts[team] / n_sims * 100, 1),
        })

    # Sort by champion odds
    results.sort(key=lambda x: -x["champion_pct"])

    # Top 3 most likely champions
    top3 = [r for r in results if r["champion_pct"] > 0][:3]

    return JSONResponse({
        "n_sims": n_sims,
        "remaining_games": len(remaining_games),
        "as_of": date.today().isoformat(),
        "top_champions": [{"team": r["team"], "pct": r["champion_pct"]} for r in top3],
        "results": results,
    })


@router.get("/standings-projection")
async def standings_projection():
    """Quick endpoint — just projects final standings without full playoff sim."""
    ratings, standings = get_team_ratings_and_standings()
    remaining = await fetch_remaining_schedule()

    # Run 1000 quick sims for standings only
    win_totals = defaultdict(list)
    random.seed(42)

    for _ in range(1000):
        sim_wins = {t: standings[t]["wins"] for t in standings}
        for game in remaining:
            home, away = game["home"], game["away"]
            if home not in ratings or away not in ratings:
                continue
            p = win_prob_from_rating_diff(ratings[home] - ratings[away])
            if random.random() < p:
                sim_wins[home] = sim_wins.get(home, 0) + 1
            else:
                sim_wins[away] = sim_wins.get(away, 0) + 1
        for t, w in sim_wins.items():
            win_totals[t].append(w)

    results = []
    for team, data in standings.items():
        wins_list = win_totals[team]
        results.append({
            "team": team,
            "conference": "East" if team in EASTERN else "West",
            "current_wins": data["wins"],
            "current_losses": data["losses"],
            "projected_wins": round(sum(wins_list) / len(wins_list)) if wins_list else data["wins"],
            "projected_wins_p10": sorted(wins_list)[int(len(wins_list)*0.1)] if wins_list else 0,
            "projected_wins_p90": sorted(wins_list)[int(len(wins_list)*0.9)] if wins_list else 0,
            "net_rtg": round(ratings.get(team, 0), 1),
        })

    results.sort(key=lambda x: -x["projected_wins"])
    return JSONResponse({"results": results, "remaining_games": len(remaining)})
