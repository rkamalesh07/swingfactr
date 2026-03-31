"""
Playoff Simulator — simulates remaining regular season + full playoffs N times.

Win probability per game:
  P(home wins) = logistic((home_rtg - away_rtg + home_adv) / spread)
  where home_adv = 2.5 pts base + 0 (already in rating diff)

Strength of schedule = average opponent net rating for remaining games (weighted by home/away).
SOS is computed BEFORE simulation and used to annotate results — the simulation already
implicitly accounts for SOS because every game uses the actual opponent's rating.
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

# ESPN abbreviation → canonical (DB uses ESPN abbreviations directly)
ABBR_NORMALIZE = {
    "SA": "SAS", "NO": "NOP", "GS": "GSW", "NY": "NYK",
    "UTAH": "UTA", "WSH": "WAS",
}

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

def win_prob(home_rtg: float, away_rtg: float, home_adv: float = 2.5) -> float:
    """
    P(home team wins) using logistic model.
    spread=12 calibrated to NBA: a 12pt rating diff → ~84% win prob.
    """
    z = (home_rtg - away_rtg + home_adv) / 12.0
    p = 0.5 * (1 + math.erf(z / math.sqrt(2)))
    return max(0.05, min(0.95, p))

def simulate_series(rtg_higher: float, rtg_lower: float) -> bool:
    """Best-of-7 series, 2-2-1-1-1 format. Returns True if higher seed wins."""
    hw = lw = 0
    home_games = {1, 2, 5, 7}
    game = 0
    while hw < 4 and lw < 4:
        game += 1
        if game in home_games:
            p = win_prob(rtg_higher, rtg_lower)
        else:
            p = win_prob(rtg_lower, rtg_higher)  # lower seed at home
            p = 1 - p  # convert to higher seed win prob
        if random.random() < p:
            hw += 1
        else:
            lw += 1
    return hw >= 4

def apply_playin(seeds: list, ratings: dict) -> list:
    if len(seeds) < 8:
        return seeds
    if len(seeds) < 10:
        return seeds[:8]
    s7, s8, s9, s10 = seeds[6], seeds[7], seeds[8], seeds[9]
    # 7v8: winner = 7 seed
    p7 = win_prob(ratings.get(s7, 0), ratings.get(s8, 0), home_adv=0)
    w78 = s7 if random.random() < p7 else s8
    l78 = s8 if w78 == s7 else s7
    # 9v10: loser eliminated
    p9 = win_prob(ratings.get(s9, 0), ratings.get(s10, 0), home_adv=0)
    w910 = s9 if random.random() < p9 else s10
    # l78 vs w910: winner = 8 seed
    pl = win_prob(ratings.get(l78, 0), ratings.get(w910, 0), home_adv=0)
    s8_team = l78 if random.random() < pl else w910
    return seeds[:6] + [w78, s8_team]

def run_conference(seeds: list, ratings: dict) -> tuple:
    """Run conference bracket. Returns (champion, set of conf finals teams)."""
    r1 = []
    for h, a in [(seeds[0],seeds[7]),(seeds[1],seeds[6]),(seeds[2],seeds[5]),(seeds[3],seeds[4])]:
        r1.append(h if simulate_series(ratings.get(h,0), ratings.get(a,0)) else a)
    cf_teams = set()
    r2 = []
    for h, a in [(r1[0],r1[3]),(r1[1],r1[2])]:
        cf_teams.add(h); cf_teams.add(a)
        w = h if simulate_series(ratings.get(h,0), ratings.get(a,0)) else a
        r2.append(w)
    champ = r2[0] if simulate_series(ratings.get(r2[0],0), ratings.get(r2[1],0)) else r2[1]
    return champ, cf_teams

async def fetch_remaining_schedule():
    """Fetch all unplayed games from ESPN. Returns list of {date, home, away}."""
    remaining = []
    est = timezone(timedelta(hours=-5))
    today_str = datetime.now(est).strftime("%Y-%m-%d")

    async with httpx.AsyncClient(headers=HEADERS, timeout=20) as client:
        for month in ["202602", "202603", "202604"]:
            try:
                r = await client.get(
                    f"{ESPN_BASE}/scoreboard",
                    params={"dates": month, "limit": 100}
                )
                data = r.json()
                for event in data.get("events", []):
                    comp = event.get("competitions", [{}])[0]
                    state = comp.get("status", {}).get("type", {}).get("state", "pre")
                    if state != "pre":
                        continue
                    gdate = event["date"][:10]
                    if gdate < today_str:
                        continue
                    teams_data = {t["homeAway"]: t for t in comp.get("competitors", [])}
                    home = normalize(teams_data.get("home", {}).get("team", {}).get("abbreviation", "?"))
                    away = normalize(teams_data.get("away", {}).get("team", {}).get("abbreviation", "?"))
                    if "?" not in (home, away):
                        remaining.append({"date": gdate, "home": home, "away": away})
            except Exception:
                continue

    return remaining

def get_ratings_and_standings():
    """Get exponentially weighted net ratings + current W-L from DB."""
    today = date.today()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT t.abbreviation,
                    CASE WHEN g.home_team_id = t.team_id
                         THEN g.home_score - g.away_score
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
        if won:
            data[abbr]["wins"] += 1
        else:
            data[abbr]["losses"] += 1

    ratings, standings = {}, {}
    for abbr, d in data.items():
        tw = twm = 0
        for margin, gdate in d["games"]:
            w = exp_weight(gdate, today)
            tw += w
            twm += w * margin
        ratings[abbr] = twm / tw if tw > 0 else 0.0
        standings[abbr] = {"wins": d["wins"], "losses": d["losses"]}

    # Ensure all 30 teams exist
    for t in EASTERN | WESTERN:
        if t not in ratings:
            ratings[t] = 0.0
        if t not in standings:
            standings[t] = {"wins": 0, "losses": 0}

    return ratings, standings

def compute_sos(remaining: list, ratings: dict) -> dict:
    """
    Strength of schedule for each team's remaining games.
    Returns dict: team -> {
        sos: float (avg opponent net rating, negative = easier),
        home_games: int,
        away_games: int,
        remaining_games: int,
        hardest_opponents: list of (team, rtg),
        easiest_opponents: list of (team, rtg),
    }
    SOS < 0  = easy remaining schedule (opponents are below average)
    SOS > 0  = hard remaining schedule (opponents are above average)
    Also applies home/away adjustment: home games count as -2.5 (easier),
    away games count as +2.5 (harder) for effective difficulty.
    """
    team_games = defaultdict(list)
    for g in remaining:
        team_games[g["home"]].append({"opp": g["away"], "is_home": True})
        team_games[g["away"]].append({"opp": g["home"], "is_home": False})

    sos_data = {}
    league_avg = sum(ratings.values()) / len(ratings) if ratings else 0

    for team, games in team_games.items():
        opp_rtgs = []
        home_count = away_count = 0
        opp_list = []
        for g in games:
            opp = g["opp"]
            opp_rtg = ratings.get(opp, 0)
            # Effective difficulty: away games are harder (opponent gets home court)
            effective_diff = opp_rtg + (2.5 if not g["is_home"] else -2.5)
            opp_rtgs.append(effective_diff)
            opp_list.append((opp, opp_rtg))
            if g["is_home"]:
                home_count += 1
            else:
                away_count += 1

        avg_sos = sum(opp_rtgs) / len(opp_rtgs) if opp_rtgs else 0
        sorted_opps = sorted(opp_list, key=lambda x: -x[1])

        sos_data[team] = {
            "sos": round(avg_sos, 2),
            "raw_sos": round(sum(r for _, r in opp_list) / len(opp_list) if opp_list else 0, 2),
            "home_games": home_count,
            "away_games": away_count,
            "remaining_games": len(games),
            "hardest_opponents": [(t, round(r, 1)) for t, r in sorted_opps[:3]],
            "easiest_opponents": [(t, round(r, 1)) for t, r in sorted_opps[-3:][::-1]],
        }

    return sos_data

@router.get("/simulate")
async def run_simulation(n_sims: int = Query(10000, le=1000000)):
    ratings, standings = get_ratings_and_standings()
    remaining = await fetch_remaining_schedule()

    # Filter to known teams only
    known = set(ratings.keys())
    remaining = [g for g in remaining if g["home"] in known and g["away"] in known]

    # Compute SOS before simulation
    sos_data = compute_sos(remaining, ratings)

    # Simulation counters
    champ_counts = defaultdict(int)
    finals_counts = defaultdict(int)
    cf_counts = defaultdict(int)
    playoff_counts = defaultdict(int)
    win_totals = defaultdict(list)

    random.seed(42)

    for _ in range(n_sims):
        # Simulate remaining regular season
        sim_wins = {t: standings[t]["wins"] for t in standings}
        sim_losses = {t: standings[t]["losses"] for t in standings}

        for g in remaining:
            h, a = g["home"], g["away"]
            # Uses actual opponent rating — SOS is implicitly baked in
            p = win_prob(ratings[h], ratings[a])
            if random.random() < p:
                sim_wins[h] = sim_wins.get(h, 0) + 1
                sim_losses[a] = sim_losses.get(a, 0) + 1
            else:
                sim_wins[a] = sim_wins.get(a, 0) + 1
                sim_losses[h] = sim_losses.get(h, 0) + 1

        for t in sim_wins:
            win_totals[t].append(sim_wins.get(t, 0))

        # Seed conferences by wins, tiebreak by rating
        def seed_conf(teams):
            return sorted(
                [(t, sim_wins.get(t, 0)) for t in teams if t in sim_wins],
                key=lambda x: (-x[1], -ratings.get(x[0], 0))
            )

        e_seeds = [t for t, _ in seed_conf(EASTERN)]
        w_seeds = [t for t, _ in seed_conf(WESTERN)]

        e_playoff = apply_playin(e_seeds, ratings)
        w_playoff = apply_playin(w_seeds, ratings)

        if len(e_playoff) < 8 or len(w_playoff) < 8:
            continue

        for t in e_playoff + w_playoff:
            playoff_counts[t] += 1

        e_champ, e_cf = run_conference(e_playoff, ratings)
        w_champ, w_cf = run_conference(w_playoff, ratings)

        for t in e_cf | w_cf:
            cf_counts[t] += 1

        finals_counts[e_champ] += 1
        finals_counts[w_champ] += 1

        # Finals — neutral court, no home advantage
        p_east = win_prob(ratings.get(e_champ, 0), ratings.get(w_champ, 0), home_adv=0)
        champion = e_champ if random.random() < p_east else w_champ
        champ_counts[champion] += 1

    # Build results
    results = []
    for team in sorted(standings.keys()):
        wl = standings[team]
        wins_list = win_totals.get(team, [wl["wins"]])
        conf = "East" if team in EASTERN else "West"
        sos = sos_data.get(team, {})

        results.append({
            "team": team,
            "conference": conf,
            "current_wins": wl["wins"],
            "current_losses": wl["losses"],
            "projected_wins": round(sum(wins_list) / len(wins_list)) if wins_list else wl["wins"],
            "projected_wins_low": sorted(wins_list)[int(len(wins_list) * 0.1)] if wins_list else wl["wins"],
            "projected_wins_high": sorted(wins_list)[int(len(wins_list) * 0.9)] if wins_list else wl["wins"],
            "net_rtg": round(ratings.get(team, 0), 1),
            # SOS fields
            "sos": sos.get("sos", 0),           # effective SOS (home/away adjusted)
            "raw_sos": sos.get("raw_sos", 0),   # pure avg opponent rating
            "remaining_games": sos.get("remaining_games", 0),
            "home_games_left": sos.get("home_games", 0),
            "away_games_left": sos.get("away_games", 0),
            "hardest_opponents": sos.get("hardest_opponents", []),
            "easiest_opponents": sos.get("easiest_opponents", []),
            # Odds
            "playoff_pct": round(playoff_counts[team] / n_sims * 100, 1),
            "conf_finals_pct": round(cf_counts[team] / n_sims * 100, 1),
            "finals_pct": round(finals_counts[team] / n_sims * 100, 1),
            "champion_pct": round(champ_counts[team] / n_sims * 100, 1),
        })

    results.sort(key=lambda x: -x["champion_pct"])
    top3 = [
        {"team": r["team"], "pct": r["champion_pct"]}
        for r in results[:3] if r["champion_pct"] > 0
    ]

    east_standings = sorted(
        [r for r in results if r["conference"] == "East"],
        key=lambda x: -x["projected_wins"]
    )
    west_standings = sorted(
        [r for r in results if r["conference"] == "West"],
        key=lambda x: -x["projected_wins"]
    )

    # League-wide SOS stats for context
    all_sos = [r["sos"] for r in results if r["remaining_games"] > 0]
    sos_avg = sum(all_sos) / len(all_sos) if all_sos else 0

    return JSONResponse({
        "n_sims": n_sims,
        "remaining_games": len(remaining),
        "as_of": date.today().isoformat(),
        "top_champions": top3,
        "results": results,
        "east_standings": east_standings,
        "west_standings": west_standings,
        "sos_avg": round(sos_avg, 2),
    })

# ---------------------------------------------------------------------------
# Live standings endpoint
# ---------------------------------------------------------------------------

@router.get("/standings")
async def get_standings():
    """
    Real-time NBA standings from ESPN + our net ratings.
    Returns current W-L, net rating, GB, and play-in/playoff status.
    """
    ratings, standings = get_ratings_and_standings()

    # Fetch real standings from ESPN
    espn_standings = {}
    try:
        async with httpx.AsyncClient(headers=HEADERS, timeout=10) as client:
            r = await client.get(
                f"{ESPN_BASE}/standings",
                params={"season": "2026", "seasontype": "2"}
            )
            data = r.json()
            for conf in data.get("children", []):
                for div in conf.get("children", []):
                    for entry in div.get("standings", {}).get("entries", []):
                        abbr = normalize(entry.get("team", {}).get("abbreviation", ""))
                        stats = {s["name"]: s["value"] for s in entry.get("stats", [])}
                        espn_standings[abbr] = {
                            "wins":   int(stats.get("wins", 0)),
                            "losses": int(stats.get("losses", 0)),
                            "gb":     float(stats.get("gamesBehind", 0)),
                            "pct":    float(stats.get("winPercent", 0)),
                            "streak": stats.get("streak", ""),
                            "l10":    stats.get("Last Ten Games", ""),
                        }
    except Exception:
        pass

    def build_conf(teams):
        result = []
        for t in teams:
            wl = espn_standings.get(t) or standings.get(t, {"wins": 0, "losses": 0})
            wins   = wl.get("wins", 0)
            losses = wl.get("losses", 0)
            result.append({
                "team":    t,
                "wins":    wins,
                "losses":  losses,
                "pct":     round(wins / (wins + losses), 3) if (wins + losses) > 0 else 0,
                "gb":      wl.get("gb", 0),
                "net_rtg": round(ratings.get(t, 0), 1),
                "streak":  wl.get("streak", ""),
                "l10":     wl.get("l10", ""),
            })
        result.sort(key=lambda x: (-x["wins"], x["losses"]))
        # Add seed + playoff status
        for i, r in enumerate(result):
            seed = i + 1
            r["seed"] = seed
            if seed <= 6:
                r["status"] = "playoff"
            elif seed <= 10:
                r["status"] = "playin"
            else:
                r["status"] = "eliminated"
        return result

    return JSONResponse({
        "as_of": date.today().isoformat(),
        "east":  build_conf(list(EASTERN)),
        "west":  build_conf(list(WESTERN)),
    })


# ---------------------------------------------------------------------------
# Live bracket endpoint
# ---------------------------------------------------------------------------

@router.get("/bracket")
async def get_bracket():
    """
    Live playoff bracket from ESPN.
    Returns completed series + in-progress series with game scores.
    """
    bracket = {"east": [], "west": [], "finals": None, "stage": "regular_season"}

    try:
        async with httpx.AsyncClient(headers=HEADERS, timeout=15) as client:
            # Try ESPN bracket endpoint
            r = await client.get(
                f"https://site.api.espn.com/apis/v2/sports/basketball/nba/playoff-schedule",
                params={"season": "2026"}
            )
            data = r.json()

            series_list = []
            for item in data.get("series", data.get("schedule", [])):
                home = normalize(item.get("home", {}).get("abbreviation", ""))
                away = normalize(item.get("away", {}).get("abbreviation", ""))
                home_wins = item.get("home", {}).get("wins", 0)
                away_wins = item.get("away", {}).get("wins", 0)
                winner = ""
                if home_wins == 4:
                    winner = home
                elif away_wins == 4:
                    winner = away
                round_n = item.get("round", 1)
                conf = item.get("conference", "")

                series_list.append({
                    "round":      round_n,
                    "conference": conf,
                    "home":       home,
                    "away":       away,
                    "home_wins":  home_wins,
                    "away_wins":  away_wins,
                    "winner":     winner,
                    "status":     "complete" if winner else "in_progress",
                })

            if series_list:
                bracket["east"]  = [s for s in series_list if s["conference"] == "East"]
                bracket["west"]  = [s for s in series_list if s["conference"] == "West"]
                bracket["finals"]= next((s for s in series_list if s["conference"] == "Finals"), None)
                max_round = max(s["round"] for s in series_list)
                bracket["stage"] = ["first_round", "second_round", "conf_finals", "finals"][min(max_round - 1, 3)]
    except Exception:
        bracket["stage"] = "regular_season"

    return JSONResponse(bracket)


# ---------------------------------------------------------------------------
# Simulate from current state
# ---------------------------------------------------------------------------

@router.get("/simulate-from-now")
async def simulate_from_now(n_sims: int = Query(10000, le=1000000)):
    """
    Simulate remaining playoffs (or full playoffs) from current state.
    - Locks teams already eliminated
    - Locks series results already decided
    - For in-progress series, uses actual game scores as starting point
    - If playoffs haven't started, simulates full playoffs from projected seeds
    """
    ratings, standings = get_ratings_and_standings()

    # Fetch bracket state
    bracket_data = {"east": [], "west": [], "finals": None, "stage": "regular_season"}
    try:
        async with httpx.AsyncClient(headers=HEADERS, timeout=15) as client:
            r = await client.get(
                f"https://site.api.espn.com/apis/v2/sports/basketball/nba/playoff-schedule",
                params={"season": "2026"}
            )
            d = r.json()
            bracket_data = d
    except Exception:
        pass

    stage = bracket_data.get("stage", "regular_season")

    # If playoffs haven't started, simulate remaining regular season first
    if stage == "regular_season":
        remaining = await fetch_remaining_schedule()
        known = set(ratings.keys())
        remaining = [g for g in remaining if g["home"] in known and g["away"] in known]
    else:
        remaining = []

    champ_counts   = defaultdict(int)
    finals_counts  = defaultdict(int)
    cf_counts      = defaultdict(int)
    playoff_counts = defaultdict(int)

    random.seed(None)  # truly random for live sim

    for _ in range(n_sims):
        # Step 1: Simulate remaining regular season if needed
        sim_wins = {t: standings[t]["wins"] for t in standings}
        sim_losses = {t: standings[t]["losses"] for t in standings}

        for g in remaining:
            h, a = g["home"], g["away"]
            p = win_prob(ratings.get(h, 0), ratings.get(a, 0))
            if random.random() < p:
                sim_wins[h] = sim_wins.get(h, 0) + 1
                sim_losses[a] = sim_losses.get(a, 0) + 1
            else:
                sim_wins[a] = sim_wins.get(a, 0) + 1
                sim_losses[h] = sim_losses.get(h, 0) + 1

        # Step 2: Determine playoff seedings
        def seed_conf(teams):
            return sorted(
                [(t, sim_wins.get(t, 0)) for t in teams if t in sim_wins],
                key=lambda x: (-x[1], -ratings.get(x[0], 0))
            )

        e_seeds = [t for t, _ in seed_conf(EASTERN)]
        w_seeds = [t for t, _ in seed_conf(WESTERN)]

        e_playoff = apply_playin(e_seeds, ratings)
        w_playoff = apply_playin(w_seeds, ratings)

        if len(e_playoff) < 8 or len(w_playoff) < 8:
            continue

        for t in e_playoff + w_playoff:
            playoff_counts[t] += 1

        # Step 3: Simulate playoffs — locking completed series
        def sim_series_from_state(team_a: str, team_b: str,
                                   a_wins: int = 0, b_wins: int = 0) -> str:
            """Simulate series with existing wins locked in."""
            if a_wins == 4:
                return team_a
            if b_wins == 4:
                return team_b
            # team_a is higher seed (has home court first two games)
            home_games = {1, 2, 5, 7}
            game = a_wins + b_wins
            while a_wins < 4 and b_wins < 4:
                game += 1
                if game in home_games:
                    p = win_prob(ratings.get(team_a, 0), ratings.get(team_b, 0))
                else:
                    p = win_prob(ratings.get(team_b, 0), ratings.get(team_a, 0))
                    p = 1 - p
                if random.random() < p:
                    a_wins += 1
                else:
                    b_wins += 1
            return team_a if a_wins >= 4 else team_b

        def run_bracket_half(seeds: list, existing_series: list) -> tuple:
            """Run one conference bracket, respecting locked results."""
            # Build lookup of locked series by participants
            locked = {}
            for s in existing_series:
                key = frozenset([s["home"], s["away"]])
                locked[key] = s

            def get_series_state(a, b):
                key = frozenset([a, b])
                s = locked.get(key, {})
                return s.get("home_wins", 0) if s.get("home") == a else s.get("away_wins", 0), \
                       s.get("away_wins", 0) if s.get("home") == a else s.get("home_wins", 0)

            r1_winners = []
            for i in range(0, 8, 2):
                if i + 1 >= len(seeds):
                    break
                a, b = seeds[i], seeds[i + 1]
                aw, bw = get_series_state(a, b)
                winner = sim_series_from_state(a, b, aw, bw)
                r1_winners.append(winner)

            r2_winners = []
            for i in range(0, len(r1_winners), 2):
                if i + 1 >= len(r1_winners):
                    break
                a, b = r1_winners[i], r1_winners[i + 1]
                aw, bw = get_series_state(a, b)
                winner = sim_series_from_state(a, b, aw, bw)
                r2_winners.append(winner)

            conf_finals_teams = set(r1_winners + r2_winners)
            cf_a = r2_winners[0] if len(r2_winners) > 0 else seeds[0]
            cf_b = r2_winners[1] if len(r2_winners) > 1 else seeds[1]
            aw, bw = get_series_state(cf_a, cf_b)
            conf_champ = sim_series_from_state(cf_a, cf_b, aw, bw)
            return conf_champ, conf_finals_teams

        east_series = bracket_data.get("east", [])
        west_series = bracket_data.get("west", [])

        e_champ, e_cf = run_bracket_half(e_playoff, east_series)
        w_champ, w_cf = run_bracket_half(w_playoff, west_series)

        for t in e_cf | w_cf:
            cf_counts[t] += 1
        finals_counts[e_champ] += 1
        finals_counts[w_champ] += 1

        # Finals
        finals = bracket_data.get("finals") or {}
        f_home = normalize(finals.get("home", e_champ))
        f_away = normalize(finals.get("away", w_champ))
        fhw = finals.get("home_wins", 0)
        faw = finals.get("away_wins", 0)
        p_east = win_prob(ratings.get(e_champ, 0), ratings.get(w_champ, 0), home_adv=0)
        champion = e_champ if random.random() < p_east else w_champ
        champ_counts[champion] += 1

    # Build results
    results = []
    for team in sorted(standings.keys()):
        wl = standings[team]
        conf = "East" if team in EASTERN else "West"
        results.append({
            "team":          team,
            "conference":    conf,
            "current_wins":  wl["wins"],
            "current_losses":wl["losses"],
            "net_rtg":       round(ratings.get(team, 0), 1),
            "playoff_pct":   round(playoff_counts[team] / n_sims * 100, 1),
            "conf_finals_pct": round(cf_counts[team] / n_sims * 100, 1),
            "finals_pct":    round(finals_counts[team] / n_sims * 100, 1),
            "champion_pct":  round(champ_counts[team] / n_sims * 100, 1),
        })

    results.sort(key=lambda x: -x["champion_pct"])

    return JSONResponse({
        "n_sims":   n_sims,
        "stage":    stage,
        "as_of":    date.today().isoformat(),
        "results":  results,
        "east":     sorted([r for r in results if r["conference"] == "East"],
                           key=lambda x: -x["champion_pct"]),
        "west":     sorted([r for r in results if r["conference"] == "West"],
                           key=lambda x: -x["champion_pct"]),
        "top_champions": [{"team": r["team"], "pct": r["champion_pct"]}
                         for r in results[:5] if r["champion_pct"] > 0],
    })
