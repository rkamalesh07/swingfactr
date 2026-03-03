"""
Props Board ETL — runs at scheduled times to pre-compute tonight's prop scores.

Cron schedule (PST = UTC-8):
  5am PST  = 13:00 UTC
  8am PST  = 16:00 UTC
  12pm PST = 20:00 UTC
  3pm PST  = 23:00 UTC
  7pm PST  = 03:00 UTC next day

Usage:
  python -m src.etl.props_board

This script:
  1. Fetches all NBA player props from Odds API (1 request)
  2. For each player with a prop, fetches last 20 ESPN box scores
  3. Computes composite score
  4. Writes to prop_board table (upsert)
"""

import asyncio
import httpx
import logging
import math
import os
import sys
from collections import defaultdict
from datetime import date, datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from src.etl.db import get_conn, init_pool

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")
logger = logging.getLogger("props_board")

ODDS_API_KEY = os.environ.get("ODDS_API_KEY", "9ef42e6c03d4f69902fb02f8318e028a")
ODDS_BASE = "https://api.the-odds-api.com/v4"
ESPN_SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary"
HEADERS = {"User-Agent": "Mozilla/5.0"}

ABBR_NORMALIZE = {
    "SA": "SAS", "NO": "NOP", "GS": "GSW", "NY": "NYK", "WSH": "WAS",
}

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

def normalize(abbr):
    return ABBR_NORMALIZE.get(abbr, abbr)

def implied_prob(american_odds):
    if not american_odds:
        return 50.0
    if american_odds > 0:
        return round(100 / (american_odds + 100) * 100, 1)
    return round(abs(american_odds) / (abs(american_odds) + 100) * 100, 1)

def ensure_table():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS prop_board (
                    prop_id         SERIAL PRIMARY KEY,
                    player_name     VARCHAR(100) NOT NULL,
                    team            VARCHAR(5),
                    opponent        VARCHAR(5),
                    is_home         BOOLEAN,
                    stat            VARCHAR(20) NOT NULL,
                    line            FLOAT NOT NULL,
                    over_odds       INTEGER,
                    under_odds      INTEGER,
                    implied_prob_over FLOAT,
                    bookmaker       VARCHAR(30),
                    avg_season      FLOAT,
                    avg_last5       FLOAT,
                    avg_last10      FLOAT,
                    avg_last20      FLOAT,
                    home_avg        FLOAT,
                    away_avg        FLOAT,
                    hit_rate_season FLOAT,
                    hit_rate_last5  FLOAT,
                    hit_rate_last10 FLOAT,
                    composite_score FLOAT,
                    score_label     VARCHAR(30),
                    score_color     VARCHAR(10),
                    factors         JSONB,
                    game_log        JSONB,
                    is_b2b          BOOLEAN DEFAULT FALSE,
                    rest_days       INTEGER,
                    opp_def_label   VARCHAR(20),
                    opp_def_margin  FLOAT,
                    computed_at     TIMESTAMPTZ DEFAULT NOW(),
                    game_date       DATE NOT NULL,
                    UNIQUE (player_name, stat, game_date)
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_prop_board_date ON prop_board(game_date)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_prop_board_score ON prop_board(composite_score DESC)")

async def fetch_all_props(client):
    """
    Fetch all NBA player props by:
    1. Getting today's event IDs (1 request)
    2. Fetching props per event (1 request per game)
    Player props only available on per-event endpoint, not sport-level.
    """
    markets = "player_points,player_rebounds,player_assists,player_threes,player_steals,player_blocks"

    # Step 1: get event IDs
    try:
        r = await client.get(
            f"{ODDS_BASE}/sports/basketball_nba/events",
            params={"apiKey": ODDS_API_KEY},
            timeout=15,
        )
        remaining = r.headers.get("x-requests-remaining", "?")
        logger.info(f"Odds API requests remaining after events fetch: {remaining}")
        events = r.json()
        if not isinstance(events, list):
            logger.error(f"Bad events response: {events}")
            return []
    except Exception as e:
        logger.error(f"Failed to fetch events: {e}")
        return []

    # Filter to only today's games (within next 24 hours) to avoid wasting requests
    from datetime import timezone as tz
    now = datetime.now(tz.utc)
    cutoff = now + timedelta(hours=24)
    todays_events = []
    for event in events:
        commence = event.get("commence_time", "")
        try:
            commence_dt = datetime.fromisoformat(commence.replace("Z", "+00:00"))
            if now <= commence_dt <= cutoff:
                todays_events.append(event)
        except Exception:
            continue

    logger.info(f"Found {len(todays_events)} NBA events today (filtered from {len(events)} total)")

    # Skip entirely if no games today — preserves monthly request quota
    if not todays_events:
        logger.info("No NBA games today — skipping props fetch to preserve API quota")
        return []

    # Step 2: fetch props per event
    all_events = []
    for event in todays_events:
        event_id = event.get("id")
        home = ODDS_TEAM_MAP.get(event.get("home_team", ""), "")
        away = ODDS_TEAM_MAP.get(event.get("away_team", ""), "")
        if not event_id or not home or not away:
            continue
        try:
            r2 = await client.get(
                f"{ODDS_BASE}/sports/basketball_nba/events/{event_id}/odds",
                params={
                    "apiKey": ODDS_API_KEY,
                    "regions": "us",
                    "markets": markets,
                    "oddsFormat": "american",
                    "bookmakers": "draftkings,fanduel,betmgm",
                },
                timeout=15,
            )
            remaining = r2.headers.get("x-requests-remaining", "?")
            data = r2.json()
            if isinstance(data, dict) and data.get("bookmakers") is not None:
                data["home_team"] = event.get("home_team")
                data["away_team"] = event.get("away_team")
                all_events.append(data)
                logger.info(f"Fetched props for {away} @ {home} · {remaining} requests remaining")
            else:
                logger.warning(f"No bookmaker data for {away} @ {home}: {str(data)[:100]}")
        except Exception as e:
            logger.warning(f"Failed props for event {event_id}: {e}")
            continue

    return all_events

async def fetch_player_logs(client, player_name, team_abbr, n_games=20):
    """Fetch last N box scores for a player from ESPN."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT g.game_id, g.game_date,
                    th.abbreviation, ta.abbreviation
                FROM games g
                JOIN teams th ON th.team_id = g.home_team_id
                JOIN teams ta ON ta.team_id = g.away_team_id
                WHERE g.season_id = '2025-26' AND g.home_score IS NOT NULL
                AND (th.abbreviation = %s OR ta.abbreviation = %s)
                ORDER BY g.game_date DESC LIMIT %s
            """, (team_abbr, team_abbr, n_games))
            games = cur.fetchall()

    results = []
    for game_id, game_date, home_abbr, away_abbr in games:
        espn_id = game_id.replace("espn_", "")
        try:
            r = await client.get(ESPN_SUMMARY, params={"event": espn_id}, timeout=8)
            data = r.json()
        except Exception:
            continue

        is_home = (home_abbr == team_abbr)
        opp = away_abbr if is_home else home_abbr

        for boxscore in data.get("boxscore", {}).get("players", []):
            t_abbr = normalize(boxscore.get("team", {}).get("abbreviation", ""))
            if t_abbr != team_abbr:
                continue
            for stat_group in boxscore.get("statistics", []):
                for athlete in stat_group.get("athletes", []):
                    info = athlete.get("athlete", {})
                    name = info.get("displayName", "")
                    if player_name.lower() not in name.lower() and name.lower() not in player_name.lower():
                        continue
                    stats = athlete.get("stats", [])
                    if not stats or stats[0] == "DNP":
                        continue
                    try:
                        fg3 = stats[2].split("-") if len(stats) > 2 else ["0", "0"]
                        results.append({
                            "date": str(game_date),
                            "opp": opp,
                            "is_home": is_home,
                            "min": float(stats[0]) if stats[0] else 0,
                            "pts": int(stats[13]) if len(stats) > 13 else 0,
                            "reb": int(stats[6]) if len(stats) > 6 else 0,
                            "ast": int(stats[7]) if len(stats) > 7 else 0,
                            "stl": int(stats[8]) if len(stats) > 8 else 0,
                            "blk": int(stats[9]) if len(stats) > 9 else 0,
                            "fg3m": int(fg3[0]) if fg3[0].isdigit() else 0,
                        })
                    except Exception:
                        continue
    return results

def compute_stats(logs, stat, line):
    vals = [g[stat] for g in logs if g.get("min", 0) >= 10]
    if not vals:
        return None

    def avg(arr): return round(sum(arr) / len(arr), 1) if arr else None
    def hr(arr): return round(sum(1 for v in arr if v > line) / len(arr) * 100, 1) if arr else None

    home = [g[stat] for g in logs if g.get("is_home") and g.get("min", 0) >= 10]
    away = [g[stat] for g in logs if not g.get("is_home") and g.get("min", 0) >= 10]

    return {
        "avg_season": avg(vals),
        "avg_last5": avg(vals[:5]),
        "avg_last10": avg(vals[:10]),
        "avg_last20": avg(vals[:20]),
        "home_avg": avg(home),
        "away_avg": avg(away),
        "hit_rate_season": hr(vals),
        "hit_rate_last5": hr(vals[:5]),
        "hit_rate_last10": hr(vals[:10]),
        "game_log": [{"date": g["date"], "opp": g["opp"], "home": g["is_home"], "val": g[stat], "min": g["min"]} for g in logs[:20]],
    }

def compute_score(stats, opp_def_margin, is_b2b, is_home, line):
    score = 50.0
    factors = []

    if stats.get("hit_rate_last5") is not None:
        delta = stats["hit_rate_last5"] - 50
        score += delta * 0.35
        factors.append({"label": "Last 5 hit rate", "value": f"{stats['hit_rate_last5']}%", "impact": "positive" if delta > 0 else "negative"})

    if stats.get("hit_rate_season") is not None:
        delta = stats["hit_rate_season"] - 50
        score += delta * 0.20
        factors.append({"label": "Season hit rate", "value": f"{stats['hit_rate_season']}%", "impact": "positive" if delta > 0 else "negative"})

    if stats.get("avg_last10") is not None:
        margin = stats["avg_last10"] - line
        score += margin * 2.5
        factors.append({"label": "L10 avg vs line", "value": f"{'+' if margin >= 0 else ''}{margin:.1f}", "impact": "positive" if margin > 0 else "negative"})

    if opp_def_margin is not None:
        score -= opp_def_margin * 1.5
        label = "good" if opp_def_margin < -2 else "poor" if opp_def_margin > 2 else "average"
        factors.append({"label": "Opp defense", "value": label, "impact": "negative" if opp_def_margin < -1 else "positive" if opp_def_margin > 1 else "neutral"})

    if is_b2b:
        score -= 5
        factors.append({"label": "Back-to-back", "value": "yes", "impact": "negative"})

    if is_home:
        score += 1.5
        factors.append({"label": "Home game", "value": "yes", "impact": "positive"})

    score = max(5, min(95, score))
    label = "Strong Over" if score >= 65 else "Lean Over" if score >= 55 else "Strong Under" if score <= 35 else "Lean Under" if score <= 45 else "Toss-up"
    color = "#4ade80" if score >= 65 else "#86efac" if score >= 55 else "#fbbf24" if score > 45 else "#f87171"
    return round(score, 1), label, color, factors

def get_opp_defense(opp_abbr):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT ROUND(AVG(
                        CASE WHEN g.home_team_id = t.team_id THEN g.away_score - g.home_score
                             ELSE g.home_score - g.away_score END
                    )::numeric, 1)
                    FROM teams t
                    JOIN games g ON (g.home_team_id = t.team_id OR g.away_team_id = t.team_id)
                    WHERE t.abbreviation = %s AND g.season_id = '2025-26' AND g.home_score IS NOT NULL
                """, (opp_abbr,))
                row = cur.fetchone()
                return float(row[0]) if row and row[0] else 0.0
    except Exception:
        return 0.0

def get_rest_info(team_abbr):
    try:
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
                if row:
                    is_home = row[4] == team_abbr
                    return {
                        "is_home": is_home,
                        "is_b2b": bool(row[0] if is_home else row[1]),
                        "rest_days": row[2] if is_home else row[3],
                        "opponent": row[5] if is_home else row[4],
                    }
    except Exception:
        pass
    return {}

async def run():
    init_pool()
    ensure_table()
    today = date.today()

    async with httpx.AsyncClient(headers=HEADERS) as client:
        logger.info("Fetching all NBA props from Odds API...")
        events_data = await fetch_all_props(client)

        if not events_data or isinstance(events_data, dict):
            logger.error(f"Bad response from Odds API: {events_data}")
            return

        # Parse all props from response
        # Structure: [{id, home_team, away_team, bookmakers: [{markets: [{key, outcomes}]}]}]
        all_props = defaultdict(dict)  # player_lower -> {stat -> prop_info}
        game_lookup = {}  # player_lower -> {home, away}

        for event in events_data:
            home = ODDS_TEAM_MAP.get(event.get("home_team", ""), "")
            away = ODDS_TEAM_MAP.get(event.get("away_team", ""), "")
            if not home or not away:
                continue

            for bookmaker in event.get("bookmakers", []):
                bk_key = bookmaker.get("key", "")
                for market in bookmaker.get("markets", []):
                    stat = MARKET_TO_STAT.get(market.get("key", ""))
                    if not stat:
                        continue
                    # Group by player name (in "description" field) and Over/Under (in "name" field)
                    # ESPN format: {"name": "Over", "description": "Anthony Davis", "price": -105, "point": 23.5}
                    player_outcomes = defaultdict(dict)
                    for outcome in market.get("outcomes", []):
                        side = outcome.get("name", "")        # "Over" or "Under"
                        pname = outcome.get("description", "") # player name
                        if not pname or side not in ("Over", "Under"):
                            continue
                        player_outcomes[pname][side] = {
                            "odds": outcome.get("price", 0),
                            "line": outcome.get("point", 0),
                        }
                    for pname, sides in player_outcomes.items():
                        over = sides.get("Over", {})
                        under = sides.get("Under", {})
                        line = over.get("line") or under.get("line")
                        if not line:
                            continue
                        pkey = pname.lower()
                        existing = all_props[pkey].get(stat)
                        if not existing or bk_key == "draftkings":
                            all_props[pkey][stat] = {
                                "player_name": pname,
                                "line": line,
                                "over_odds": over.get("odds"),
                                "under_odds": under.get("odds"),
                                "implied_prob_over": implied_prob(over.get("odds", 0)),
                                "bookmaker": bk_key,
                                "home": home,
                                "away": away,
                            }
                            game_lookup[pkey] = {"home": home, "away": away}

        logger.info(f"Found {len(all_props)} players with props across {len(events_data)} games")

        # For each player, determine team and fetch box scores
        rows_written = 0
        for pkey, stat_props in all_props.items():
            game_info = game_lookup.get(pkey, {})
            home_team = game_info.get("home", "")
            away_team = game_info.get("away", "")

            # Try to determine player's team by checking which team has their game logs
            # We'll try both home and away
            player_name = list(stat_props.values())[0]["player_name"]

            # Get rest info for both teams and pick the one that finds game logs
            rest_home = get_rest_info(home_team) if home_team else {}
            rest_away = get_rest_info(away_team) if away_team else {}

            for stat, prop_info in stat_props.items():
                line = prop_info["line"]

                # Try home team first, then away
                logs = []
                team_found = ""
                is_home_player = False

                for try_team, try_is_home in [(home_team, True), (away_team, False)]:
                    if not try_team:
                        continue
                    logs = await fetch_player_logs(client, player_name, try_team)
                    if logs:
                        team_found = try_team
                        is_home_player = try_is_home
                        break

                opp = away_team if is_home_player else home_team
                opp_def = get_opp_defense(opp) if opp else 0.0
                opp_def_label = "good" if opp_def < -2 else "poor" if opp_def > 2 else "average"

                rest = rest_home if is_home_player else rest_away
                is_b2b = rest.get("is_b2b", False)
                rest_days = rest.get("rest_days", 1)

                if logs:
                    stats = compute_stats(logs, stat, line)
                else:
                    stats = None

                if stats:
                    comp_score, score_label, score_color, factors = compute_score(
                        stats, opp_def, is_b2b, is_home_player, line
                    )
                else:
                    # Fall back to implied probability only
                    imp = prop_info.get("implied_prob_over", 50)
                    comp_score = imp
                    score_label = "Implied only"
                    score_color = "#888"
                    factors = [{"label": "Implied prob", "value": f"{imp}%", "impact": "neutral"}]

                import json
                with get_conn() as conn:
                    with conn.cursor() as cur:
                        cur.execute("""
                            INSERT INTO prop_board (
                                player_name, team, opponent, is_home, stat, line,
                                over_odds, under_odds, implied_prob_over, bookmaker,
                                avg_season, avg_last5, avg_last10, avg_last20,
                                home_avg, away_avg, hit_rate_season, hit_rate_last5, hit_rate_last10,
                                composite_score, score_label, score_color, factors, game_log,
                                is_b2b, rest_days, opp_def_label, opp_def_margin, game_date
                            ) VALUES (
                                %s, %s, %s, %s, %s, %s,
                                %s, %s, %s, %s,
                                %s, %s, %s, %s,
                                %s, %s, %s, %s, %s,
                                %s, %s, %s, %s, %s,
                                %s, %s, %s, %s, %s
                            )
                            ON CONFLICT (player_name, stat, game_date)
                            DO UPDATE SET
                                composite_score = EXCLUDED.composite_score,
                                score_label = EXCLUDED.score_label,
                                score_color = EXCLUDED.score_color,
                                line = EXCLUDED.line,
                                over_odds = EXCLUDED.over_odds,
                                under_odds = EXCLUDED.under_odds,
                                implied_prob_over = EXCLUDED.implied_prob_over,
                                avg_last5 = EXCLUDED.avg_last5,
                                avg_last10 = EXCLUDED.avg_last10,
                                hit_rate_last5 = EXCLUDED.hit_rate_last5,
                                hit_rate_last10 = EXCLUDED.hit_rate_last10,
                                factors = EXCLUDED.factors,
                                game_log = EXCLUDED.game_log,
                                computed_at = NOW()
                        """, (
                            player_name, team_found or None, opp or None, is_home_player, stat, line,
                            prop_info.get("over_odds"), prop_info.get("under_odds"),
                            prop_info.get("implied_prob_over"), prop_info.get("bookmaker"),
                            stats.get("avg_season") if stats else None,
                            stats.get("avg_last5") if stats else None,
                            stats.get("avg_last10") if stats else None,
                            stats.get("avg_last20") if stats else None,
                            stats.get("home_avg") if stats else None,
                            stats.get("away_avg") if stats else None,
                            stats.get("hit_rate_season") if stats else None,
                            stats.get("hit_rate_last5") if stats else None,
                            stats.get("hit_rate_last10") if stats else None,
                            comp_score, score_label, score_color,
                            json.dumps(factors),
                            json.dumps(stats.get("game_log", []) if stats else []),
                            is_b2b, rest_days,
                            opp_def_label, opp_def,
                            today,
                        ))
                rows_written += 1

        logger.info(f"Written {rows_written} props to prop_board for {today}")

if __name__ == "__main__":
    asyncio.run(run())
