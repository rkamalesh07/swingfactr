"""
Props Context Tool — player prop lines from The Odds API + historical context from ESPN box scores.

Request flow:
  1. /props/tonight     — fetch today's games + all prop lines from Odds API (cached in memory 1hr)
  2. /props/player      — fetch last N ESPN box scores for player, compute averages/hit rates
  3. /props/team        — team scoring context for totals

Odds API usage:
  - 1 request for events list
  - 1 request per game for props (markets batched: points+reb+ast+3pm+stl+blk)
  - Results cached in memory for 1 hour to preserve monthly quota
"""

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from src.etl.db import get_conn
import httpx, os, math
from datetime import date, datetime, timezone, timedelta
from collections import defaultdict

router = APIRouter()

ODDS_API_KEY = os.environ.get("ODDS_API_KEY", "9ef42e6c03d4f69902fb02f8318e028a")
ODDS_BASE = "https://api.the-odds-api.com/v4"
ESPN_SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary"
ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"
HEADERS = {"User-Agent": "Mozilla/5.0"}

ABBR_NORMALIZE = {
    "SA": "SAS", "NO": "NOP", "GS": "GSW", "NY": "NYK", "WSH": "WAS",
}

# Odds API team name → our abbreviation
ODDS_TEAM_MAP = {
    "Atlanta Hawks": "ATL", "Boston Celtics": "BOS", "Brooklyn Nets": "BKN",
    "Charlotte Hornets": "CHA", "Chicago Bulls": "CHI", "Cleveland Cavaliers": "CLE",
    "Dallas Mavericks": "DAL", "Denver Nuggets": "DEN", "Detroit Pistons": "DET",
    "Golden State Warriors": "GSW", "Houston Rockets": "HOU", "Indiana Pacers": "IND",
    "Los Angeles Clippers": "LAC", "Los Angeles Lakers": "LAL", "Memphis Grizzlies": "MEM",
    "Miami Heat": "MIA", "Milwaukee Bucks": "MIL", "Minnesota Timberwolves": "MIN",
    "New Orleans Pelicans": "NOP", "New York Knicks": "NYK", "Oklahoma City Thunder": "OKC",
    "Orlando Magic": "ORL", "Philadelphia 76ers": "PHI", "Phoenix Suns": "PHX",
    "Portland Trail Blazers": "POR", "Sacramento Kings": "SAC", "San Antonio Spurs": "SAS",
    "Toronto Raptors": "TOR", "Utah Jazz": "UTA", "Washington Wizards": "WAS",
}

MARKET_TO_STAT = {
    "player_points": "pts",
    "player_rebounds": "reb",
    "player_assists": "ast",
    "player_threes": "fg3m",
    "player_steals": "stl",
    "player_blocks": "blk",
}

# In-memory cache: {cache_key: (timestamp, data)}
_cache: dict = {}
CACHE_TTL = 3600  # 1 hour

def cache_get(key: str):
    if key in _cache:
        ts, data = _cache[key]
        if (datetime.now().timestamp() - ts) < CACHE_TTL:
            return data
    return None

def cache_set(key: str, data):
    _cache[key] = (datetime.now().timestamp(), data)

def normalize(abbr: str) -> str:
    return ABBR_NORMALIZE.get(abbr, abbr)

def implied_prob(american_odds: int) -> float:
    """Convert American odds to implied probability."""
    if american_odds > 0:
        return round(100 / (american_odds + 100) * 100, 1)
    else:
        return round(abs(american_odds) / (abs(american_odds) + 100) * 100, 1)

async def fetch_todays_props() -> dict:
    """
    Fetch all NBA player props for today's games from Odds API.
    Returns: {player_name: {stat: {line, over_odds, under_odds, implied_prob, bookmaker}}}
    Cached for 1 hour.
    """
    cached = cache_get("todays_props")
    if cached:
        return cached

    markets = "player_points,player_rebounds,player_assists,player_threes,player_steals,player_blocks"
    props_by_player = defaultdict(lambda: defaultdict(dict))
    games_today = []

    async with httpx.AsyncClient(timeout=15) as client:
        # Step 1: get today's event IDs
        try:
            r = await client.get(
                f"{ODDS_BASE}/sports/basketball_nba/events",
                params={"apiKey": ODDS_API_KEY}
            )
            events = r.json()
            if isinstance(events, dict) and events.get("message"):
                return {}  # API error
        except Exception:
            return {}

        # Step 2: fetch props for each event
        for event in events:
            if not isinstance(event, dict):
                continue
            event_id = event.get("id")
            home = ODDS_TEAM_MAP.get(event.get("home_team", ""), event.get("home_team", "?"))
            away = ODDS_TEAM_MAP.get(event.get("away_team", ""), event.get("away_team", "?"))
            commence = event.get("commence_time", "")

            games_today.append({"event_id": event_id, "home": home, "away": away, "time": commence})

            try:
                r2 = await client.get(
                    f"{ODDS_BASE}/events/{event_id}/odds",
                    params={
                        "apiKey": ODDS_API_KEY,
                        "regions": "us",
                        "markets": markets,
                        "oddsFormat": "american",
                        "bookmakers": "draftkings,fanduel,betmgm",
                    }
                )
                event_odds = r2.json()
                if not isinstance(event_odds, dict):
                    continue

                for bookmaker in event_odds.get("bookmakers", []):
                    bk_key = bookmaker.get("key", "")
                    for market in bookmaker.get("markets", []):
                        market_key = market.get("key", "")
                        stat = MARKET_TO_STAT.get(market_key)
                        if not stat:
                            continue
                        outcomes = market.get("outcomes", [])
                        # Group by player name
                        player_outcomes = defaultdict(dict)
                        for outcome in outcomes:
                            pname = outcome.get("name", "")
                            desc = outcome.get("description", "Over")
                            price = outcome.get("price", 0)
                            point = outcome.get("point", 0)
                            player_outcomes[pname][desc] = {"odds": price, "line": point}

                        for pname, sides in player_outcomes.items():
                            over = sides.get("Over", {})
                            under = sides.get("Under", {})
                            line = over.get("line") or under.get("line")
                            if line is None:
                                continue
                            # Only store if we don't have this player/stat yet, or use DraftKings preferentially
                            existing = props_by_player[pname.lower()].get(stat)
                            if not existing or bk_key == "draftkings":
                                props_by_player[pname.lower()][stat] = {
                                    "line": line,
                                    "over_odds": over.get("odds"),
                                    "under_odds": under.get("odds"),
                                    "implied_prob_over": implied_prob(over["odds"]) if over.get("odds") else None,
                                    "bookmaker": bk_key,
                                    "home_team": home,
                                    "away_team": away,
                                }
            except Exception:
                continue

    result = {"props": dict(props_by_player), "games": games_today}
    cache_set("todays_props", result)
    return result

async def fetch_player_game_logs(player_name: str, team_abbr: str, n_games: int = 20) -> list[dict]:
    """Fetch last N game box scores for a player from ESPN."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT g.game_id, g.game_date,
                    th.abbreviation as home_abbr,
                    ta.abbreviation as away_abbr
                FROM games g
                JOIN teams th ON th.team_id = g.home_team_id
                JOIN teams ta ON ta.team_id = g.away_team_id
                WHERE g.season_id = '2025-26'
                AND g.home_score IS NOT NULL
                AND (th.abbreviation = %s OR ta.abbreviation = %s)
                ORDER BY g.game_date DESC
                LIMIT %s
            """, (team_abbr, team_abbr, n_games))
            games = cur.fetchall()

    results = []
    async with httpx.AsyncClient(headers=HEADERS, timeout=10) as client:
        for game_id, game_date, home_abbr, away_abbr in games:
            espn_id = game_id.replace("espn_", "")
            cached = cache_get(f"box_{espn_id}")
            if cached:
                box_data = cached
            else:
                try:
                    r = await client.get(ESPN_SUMMARY, params={"event": espn_id})
                    box_data = r.json()
                    cache_set(f"box_{espn_id}", box_data)
                except Exception:
                    continue

            is_home = (home_abbr == team_abbr)
            opp = away_abbr if is_home else home_abbr

            for boxscore in box_data.get("boxscore", {}).get("players", []):
                t_abbr = normalize(boxscore.get("team", {}).get("abbreviation", ""))
                if t_abbr != team_abbr:
                    continue
                for stat_group in boxscore.get("statistics", []):
                    for athlete in stat_group.get("athletes", []):
                        info = athlete.get("athlete", {})
                        name = info.get("displayName", info.get("shortName", ""))
                        if player_name.lower() not in name.lower() and name.lower() not in player_name.lower():
                            continue
                        stats = athlete.get("stats", [])
                        if not stats or stats[0] == "DNP":
                            continue
                        try:
                            fg = stats[1].split("-") if len(stats) > 1 else ["0", "0"]
                            fg3 = stats[2].split("-") if len(stats) > 2 else ["0", "0"]
                            results.append({
                                "date": str(game_date),
                                "opponent": opp,
                                "is_home": is_home,
                                "min": float(stats[0]) if stats[0] else 0,
                                "pts": int(stats[13]) if len(stats) > 13 else 0,
                                "reb": int(stats[6]) if len(stats) > 6 else 0,
                                "ast": int(stats[7]) if len(stats) > 7 else 0,
                                "stl": int(stats[8]) if len(stats) > 8 else 0,
                                "blk": int(stats[9]) if len(stats) > 9 else 0,
                                "tov": int(stats[10]) if len(stats) > 10 else 0,
                                "fg3m": int(fg3[0]) if fg3[0].isdigit() else 0,
                                "fgm": int(fg[0]) if fg[0].isdigit() else 0,
                                "fga": int(fg[1]) if len(fg) > 1 and fg[1].isdigit() else 0,
                                "full_name": name,
                            })
                        except Exception:
                            continue
    return results

def compute_context(logs: list[dict], stat: str, line: float = None) -> dict:
    vals = [g[stat] for g in logs if g.get("min", 0) >= 10]
    if not vals:
        return {}

    def avg(arr): return round(sum(arr) / len(arr), 1) if arr else None
    def hit_rate(arr, l): return round(sum(1 for v in arr if v > l) / len(arr) * 100, 1) if arr and l is not None else None

    home = [g[stat] for g in logs if g.get("is_home") and g.get("min", 0) >= 10]
    away = [g[stat] for g in logs if not g.get("is_home") and g.get("min", 0) >= 10]

    result = {
        "avg_season": avg(vals),
        "avg_last5": avg(vals[:5]),
        "avg_last10": avg(vals[:10]),
        "avg_last20": avg(vals[:20]),
        "home_avg": avg(home),
        "away_avg": avg(away),
        "max": max(vals),
        "min": min(vals),
        "games_played": len(vals),
        "game_log": [
            {"date": g["date"], "opp": g["opponent"], "home": g["is_home"],
             "val": g[stat], "min": g["min"]}
            for g in logs[:20]
        ],
    }

    if line is not None:
        result["line"] = line
        result["hit_rate_season"] = hit_rate(vals, line)
        result["hit_rate_last10"] = hit_rate(vals[:10], line)
        result["hit_rate_last5"] = hit_rate(vals[:5], line)
        result["over_avg_margin"] = round(
            sum(v - line for v in vals if v > line) / max(1, sum(1 for v in vals if v > line)), 1
        )
        result["under_avg_margin"] = round(
            sum(line - v for v in vals if v <= line) / max(1, sum(1 for v in vals if v <= line)), 1
        )

    return result

def compute_prop_score(context: dict, opp_defense: dict, rest: dict) -> dict:
    """
    Composite score 0-100 for likelihood of going OVER the line.
    Weights: recent form 35%, season 20%, matchup 20%, defense 15%, rest 10%
    Only computed when a line is provided.
    """
    if not context.get("line"):
        return {}

    score = 50.0  # start neutral
    factors = []

    # Recent form (last 5 hit rate vs last 10)
    if context.get("hit_rate_last5") is not None:
        delta = context["hit_rate_last5"] - 50
        score += delta * 0.35
        factors.append({"label": "Last 5 hit rate", "value": f"{context['hit_rate_last5']}%",
                        "impact": "positive" if delta > 0 else "negative"})

    # Season hit rate
    if context.get("hit_rate_season") is not None:
        delta = context["hit_rate_season"] - 50
        score += delta * 0.20
        factors.append({"label": "Season hit rate", "value": f"{context['hit_rate_season']}%",
                        "impact": "positive" if delta > 0 else "negative"})

    # Avg vs line
    if context.get("avg_last10") and context.get("line"):
        margin = context["avg_last10"] - context["line"]
        score += margin * 2.5
        factors.append({"label": "L10 avg vs line", "value": f"{'+' if margin > 0 else ''}{margin:.1f}",
                        "impact": "positive" if margin > 0 else "negative"})

    # Opponent defense
    if opp_defense:
        def_margin = opp_defense.get("def_margin", 0)
        # Negative def_margin = good defense = bad for over
        score -= def_margin * 1.5
        factors.append({"label": "Opp defense", "value": opp_defense.get("def_rating_label", "?"),
                        "impact": "negative" if def_margin < -1 else "positive" if def_margin > 1 else "neutral"})

    # Rest/fatigue
    if rest:
        if rest.get("is_b2b"):
            score -= 5
            factors.append({"label": "Back-to-back", "value": "yes", "impact": "negative"})
        if rest.get("is_home"):
            score += 1.5
            factors.append({"label": "Home game", "value": "yes", "impact": "positive"})

    score = max(5, min(95, score))

    return {
        "score": round(score, 1),
        "label": "Strong Over" if score >= 65 else "Lean Over" if score >= 55 else "Lean Under" if score <= 45 else "Strong Under" if score <= 35 else "Toss-up",
        "color": "#4ade80" if score >= 65 else "#86efac" if score >= 55 else "#fbbf24" if score >= 45 else "#f87171",
        "factors": factors,
    }

def get_opponent_defense(opp_abbr: str) -> dict:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT ROUND(AVG(
                    CASE WHEN g.home_team_id = t.team_id
                         THEN g.away_score - g.home_score
                         ELSE g.home_score - g.away_score END
                )::numeric, 1) as def_margin, COUNT(*) as games
                FROM teams t
                JOIN games g ON (g.home_team_id = t.team_id OR g.away_team_id = t.team_id)
                WHERE t.abbreviation = %s AND g.season_id = '2025-26' AND g.home_score IS NOT NULL
            """, (opp_abbr,))
            row = cur.fetchone()
    def_margin = float(row[0]) if row and row[0] else 0
    return {
        "opp": opp_abbr,
        "def_margin": def_margin,
        "def_rating_label": "good" if def_margin < -2 else "poor" if def_margin > 2 else "average",
    }

def get_rest_info(team_abbr: str) -> dict:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT g.home_b2b, g.away_b2b, g.home_rest_days, g.away_rest_days,
                       th.abbreviation, ta.abbreviation
                FROM games g
                JOIN teams th ON th.team_id = g.home_team_id
                JOIN teams ta ON ta.team_id = g.away_team_id
                WHERE g.season_id = '2025-26' AND g.home_score IS NULL
                AND (th.abbreviation = %s OR ta.abbreviation = %s)
                ORDER BY g.game_date ASC LIMIT 1
            """, (team_abbr, team_abbr))
            row = cur.fetchone()
    if not row:
        return {}
    is_home = row[4] == team_abbr
    return {
        "is_home": is_home,
        "is_b2b": bool(row[0] if is_home else row[1]),
        "rest_days": row[2] if is_home else row[3],
        "opponent": row[5] if is_home else row[4],
    }

# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/tonight")
async def tonight_props():
    """
    All tonight's games + all player prop lines from Odds API.
    Cached 1hr. This is the main data loader for the props page.
    """
    data = await fetch_todays_props()
    games = data.get("games", [])
    props = data.get("props", {})

    # Also get ESPN game context (state, time)
    est = timezone(timedelta(hours=-5))
    today = datetime.now(est).strftime("%Y%m%d")
    espn_games = []
    async with httpx.AsyncClient(headers=HEADERS, timeout=10) as client:
        try:
            r = await client.get(ESPN_SCOREBOARD, params={"dates": today})
            d = r.json()
            for event in d.get("events", []):
                comp = event.get("competitions", [{}])[0]
                teams_data = {t["homeAway"]: t for t in comp.get("competitors", [])}
                home = normalize(teams_data.get("home", {}).get("team", {}).get("abbreviation", "?"))
                away = normalize(teams_data.get("away", {}).get("team", {}).get("abbreviation", "?"))
                state = comp.get("status", {}).get("type", {}).get("state", "pre")
                time_str = comp.get("status", {}).get("type", {}).get("shortDetail", "")
                espn_games.append({"home": home, "away": away, "state": state, "time": time_str})
        except Exception:
            pass

    return JSONResponse({
        "games": espn_games,
        "odds_games": games,
        "total_props": sum(len(v) for v in props.values()),
        "players_with_props": len(props),
        "cached": cache_get("todays_props") is not None,
    })

@router.get("/player")
async def player_context(
    name: str = Query(...),
    team: str = Query(...),
    opponent: str = Query(None),
    stat: str = Query("pts"),
    line: float = Query(None),
    n_games: int = Query(20, le=40),
):
    team = normalize(team.upper())
    if opponent:
        opponent = normalize(opponent.upper())

    # Get prop line from Odds API if not manually provided
    odds_data = await fetch_todays_props()
    props = odds_data.get("props", {})
    name_lower = name.lower()
    auto_line = None
    auto_odds = None

    # Fuzzy match player name in props
    for pname, pstats in props.items():
        if name_lower in pname or any(part in pname for part in name_lower.split()):
            if stat in pstats:
                auto_line = pstats[stat]["line"]
                auto_odds = pstats[stat]
                break

    effective_line = line if line is not None else auto_line

    # Fetch game logs
    logs = await fetch_player_game_logs(name, team, n_games)
    if not logs:
        return JSONResponse({"error": f"No game logs found for '{name}' ({team}). Check name and team."})

    player_name = logs[0].get("full_name", name)
    context = compute_context(logs, stat, effective_line)
    opp_defense = get_opponent_defense(opponent) if opponent else None
    rest = get_rest_info(team)
    prop_score = compute_prop_score(context, opp_defense, rest)

    # vs this opponent specifically
    vs_opp = [g for g in logs if g["opponent"] == opponent] if opponent else []
    vs_opp_data = None
    if vs_opp:
        vals = [g[stat] for g in vs_opp]
        vs_opp_data = {
            "games": len(vals),
            "avg": round(sum(vals) / len(vals), 1),
            "high": max(vals),
            "low": min(vals),
            "hit_rate": round(sum(1 for v in vals if v > effective_line) / len(vals) * 100, 1) if effective_line and vals else None,
        }

    return JSONResponse({
        "player": player_name,
        "team": team,
        "stat": stat,
        "line": effective_line,
        "line_source": "manual" if line is not None else ("odds_api" if auto_line else "none"),
        "odds": auto_odds,
        "prop_score": prop_score,
        "context": context,
        "vs_opponent": vs_opp_data,
        "opponent_defense": opp_defense,
        "rest": rest,
        "disclaimer": "For informational purposes only. Not betting advice.",
    })

@router.get("/board")
async def props_board(
    stat: str = Query("pts"),
    min_score: float = Query(55.0),
):
    """
    All players tonight sorted by composite prop score for a given stat.
    Only works when Odds API has lines for today's games.
    """
    odds_data = await fetch_todays_props()
    props = odds_data.get("props", {})

    results = []
    for pname, pstats in props.items():
        if stat not in pstats:
            continue
        prop_info = pstats[stat]
        line = prop_info["line"]
        home = prop_info.get("home_team", "")
        away = prop_info.get("away_team", "")

        # We don't know which team the player is on without a full roster lookup
        # Use implied prob from odds as base signal
        imp = prop_info.get("implied_prob_over")
        results.append({
            "player": pname,
            "matchup": f"{away} @ {home}",
            "stat": stat,
            "line": line,
            "over_odds": prop_info.get("over_odds"),
            "under_odds": prop_info.get("under_odds"),
            "implied_prob_over": imp,
            "bookmaker": prop_info.get("bookmaker"),
        })

    # Sort by implied probability descending
    results.sort(key=lambda x: x.get("implied_prob_over") or 0, reverse=True)

    return JSONResponse({
        "stat": stat,
        "total": len(results),
        "results": results[:50],
    })
