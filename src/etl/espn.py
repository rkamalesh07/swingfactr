"""
ESPN API client for SwingFactr.

ESPN has a completely open, no-key-required API that returns rich NBA data.
These endpoints are undocumented but stable and widely used.

Key endpoints:
- Scoreboard (games by date): site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard
- Game summary (boxscore + PBP): site.api.espn.com/apis/site/v2/sports/basketball/nba/summary
- Teams: site.api.espn.com/apis/site/v2/sports/basketball/nba/teams
"""

import logging
import time
from typing import Optional
import requests

logger = logging.getLogger(__name__)

BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "application/json",
}


def get(url: str, params: dict = None, retries: int = 3) -> dict:
    """Make a GET request with retries and rate limiting."""
    for attempt in range(retries):
        try:
            r = requests.get(url, headers=HEADERS, params=params, timeout=30)
            r.raise_for_status()
            return r.json()
        except requests.exceptions.Timeout:
            logger.warning(f"Timeout on attempt {attempt+1}: {url}")
            time.sleep(2 ** attempt)
        except requests.exceptions.HTTPError as e:
            logger.error(f"HTTP error: {e}")
            raise
    raise TimeoutError(f"Failed after {retries} attempts: {url}")


def fetch_teams() -> list[dict]:
    """Fetch all NBA teams from ESPN."""
    data = get(f"{BASE}/teams", params={"limit": 32})
    teams = []
    for sport in data.get("sports", []):
        for league in sport.get("leagues", []):
            for team in league.get("teams", []):
                t = team["team"]
                teams.append({
                    "espn_id": int(t["id"]),
                    "abbreviation": t["abbreviation"],
                    "city": t.get("location", ""),
                    "name": t.get("name", ""),
                    "display_name": t.get("displayName", ""),
                    "color": t.get("color", ""),
                })
    return teams


def fetch_games_for_date(date_str: str) -> list[dict]:
    """
    Fetch all NBA games for a given date.
    date_str format: YYYYMMDD e.g. '20241101'
    """
    data = get(f"{BASE}/scoreboard", params={"dates": date_str, "limit": 20})
    games = []
    for event in data.get("events", []):
        game = parse_game_event(event)
        if game:
            games.append(game)
    return games


def fetch_games_for_daterange(start: str, end: str) -> list[dict]:
    """
    Fetch all games in a date range by chunking into monthly requests.
    ESPN caps at 1000 events per request so we split by month to get all games.
    start/end format: YYYYMMDD
    """
    from datetime import datetime, timedelta

    start_dt = datetime.strptime(start, "%Y%m%d")
    end_dt = datetime.strptime(end, "%Y%m%d")

    all_games = []
    seen_ids = set()

    # Chunk by month to stay under 1000 event limit
    cursor = start_dt
    while cursor <= end_dt:
        # End of chunk = last day of current month or end_dt, whichever is earlier
        if cursor.month == 12:
            chunk_end = datetime(cursor.year + 1, 1, 1) - timedelta(days=1)
        else:
            chunk_end = datetime(cursor.year, cursor.month + 1, 1) - timedelta(days=1)
        chunk_end = min(chunk_end, end_dt)

        chunk_start_str = cursor.strftime("%Y%m%d")
        chunk_end_str = chunk_end.strftime("%Y%m%d")

        data = get(f"{BASE}/scoreboard", params={
            "dates": f"{chunk_start_str}-{chunk_end_str}",
            "limit": 1000
        })
        for event in data.get("events", []):
            game = parse_game_event(event)
            if game and game["game_id"] not in seen_ids:
                seen_ids.add(game["game_id"])
                all_games.append(game)

        cursor = chunk_end + timedelta(days=1)

    return all_games


def parse_game_event(event: dict) -> Optional[dict]:
    """Parse an ESPN scoreboard event into a game dict."""
    try:
        competition = event["competitions"][0]
        competitors = competition["competitors"]

        home = next(c for c in competitors if c["homeAway"] == "home")
        away = next(c for c in competitors if c["homeAway"] == "away")

        status = event["status"]["type"]
        completed = status.get("completed", False)

        home_score = int(home.get("score", 0)) if completed else None
        away_score = int(away.get("score", 0)) if completed else None
        home_win = None
        if completed and home_score is not None and away_score is not None:
            home_win = home_score > away_score

        # Date format from ESPN: 2023-11-01T00:00Z
        game_date = event["date"][:10]  # just YYYY-MM-DD

        return {
            "game_id": f"espn_{event['id']}",
            "espn_id": event["id"],
            "game_date": game_date,
            "home_team_espn_id": int(home["team"]["id"]),
            "away_team_espn_id": int(away["team"]["id"]),
            "home_team_abbr": home["team"]["abbreviation"],
            "away_team_abbr": away["team"]["abbreviation"],
            "home_score": home_score,
            "away_score": away_score,
            "home_win": home_win,
            "completed": completed,
            "status": status.get("description", ""),
        }
    except (KeyError, StopIteration, TypeError) as e:
        logger.debug(f"Could not parse event: {e}")
        return None


def fetch_game_summary(espn_game_id: str) -> dict:
    """
    Fetch full game summary including boxscore and play-by-play.
    Returns dict with 'plays', 'home_lineup', 'away_lineup' etc.
    """
    data = get(f"{BASE}/summary", params={"event": espn_game_id})
    return data


def fetch_game_pbp(espn_game_id: str) -> list[dict]:
    """
    Extract play-by-play from ESPN game summary.
    Uses score carry-forward so every play has a valid score.
    """
    data = fetch_game_summary(espn_game_id)
    plays = []

    last_home, last_away = 0, 0
    for p in data.get("plays", []):
        play = parse_espn_play(p, last_home, last_away)
        if play:
            # Carry forward the last known score
            last_home = play["home_score"]
            last_away = play["away_score"]
            plays.append(play)

    return plays


def parse_espn_play(p: dict, last_home: int = 0, last_away: int = 0) -> Optional[dict]:
    """Parse a single ESPN play object with robust score handling."""
    import re
    try:
        period = p.get("period", {}).get("number", 1)
        clock = p.get("clock", {}).get("displayValue", "12:00")
        clock_seconds = clock_to_seconds(clock)
        period_base = {1: 0, 2: 720, 3: 1440, 4: 2160}.get(period, 2880)
        period_dur = 720 if period <= 4 else 300
        game_seconds = period_base + (period_dur - clock_seconds)

        # Robust score parsing — ESPN pbp format is inconsistent
        home_score, away_score = last_home, last_away
        score = p.get("score", {})
        if score:
            # Standard format
            h = score.get("homeScore") or score.get("home")
            a = score.get("awayScore") or score.get("away")
            if h is not None and a is not None:
                home_score = int(h)
                away_score = int(a)
            else:
                # Try scoreValue/displayValue — often formatted as "away-home"
                sv = score.get("scoreValue") or score.get("displayValue", "")
                if sv and "-" in str(sv):
                    parts = str(sv).split("-")
                    if len(parts) == 2:
                        try:
                            away_score = int(parts[0])
                            home_score = int(parts[1])
                        except ValueError:
                            pass
        else:
            # Some ESPN feeds put scores at top level
            h = p.get("homeScore")
            a = p.get("awayScore")
            if h is not None and a is not None:
                home_score = int(h)
                away_score = int(a)

        text = p.get("text", "").lower()
        play_type = p.get("type", {}).get("text", "").lower()

        is_made = "made" in text or "makes" in text
        is_missed = "missed" in text or "misses" in text
        is_3pt = "three" in text or "3-point" in text or "3pt" in text
        is_turnover = "turnover" in text or play_type == "turnover"
        is_foul = "foul" in text or play_type == "foul"
        is_timeout = "timeout" in text or play_type == "timeout"

        shot_dist = None
        m = re.search(r"(\d+)(?:-foot| foot| ft)", text)
        if m:
            shot_dist = float(m.group(1))
        is_rim = (shot_dist is not None and shot_dist <= 5) or \
                 any(w in text for w in ["dunk", "layup", "lay up", "finger roll"])

        team = p.get("team", {})
        team_id = team.get("id")

        return {
            "espn_play_id": p.get("id"),
            "period": period,
            "clock_seconds": clock_seconds,
            "game_seconds_elapsed": game_seconds,
            "description": p.get("text", "")[:500],
            "home_score": home_score,
            "away_score": away_score,
            "score_diff": home_score - away_score,
            "possession_espn_team_id": team_id,
            "is_fg_attempt": is_made or is_missed,
            "is_fg_made": is_made,
            "is_3pt": is_3pt,
            "shot_distance": shot_dist,
            "is_rim_attempt": is_rim,
            "is_turnover": is_turnover,
            "is_foul": is_foul,
            "is_timeout": is_timeout,
            "play_type": p.get("type", {}).get("text", ""),
        }
    except Exception as e:
        logger.debug(f"Could not parse play: {e}")
        return None


def fetch_boxscore(espn_game_id: str) -> dict:
    """Extract boxscore (player stats) from game summary."""
    data = fetch_game_summary(espn_game_id)
    result = {"home": [], "away": []}

    boxscore = data.get("boxscore", {})
    players_data = boxscore.get("players", [])

    for team_data in players_data:
        home_away = "home" if team_data.get("homeAway") == "home" else "away"
        statistics = team_data.get("statistics", [])
        if not statistics:
            continue
        stat_block = statistics[0]
        athletes = stat_block.get("athletes", [])
        for athlete in athletes:
            a = athlete.get("athlete", {})
            stats = athlete.get("stats", [])
            labels = stat_block.get("labels", [])
            stat_dict = dict(zip(labels, stats))
            result[home_away].append({
                "player_id": f"espn_{a.get('id')}",
                "name": a.get("displayName", ""),
                "starter": athlete.get("starter", False),
                "minutes": stat_dict.get("MIN", "0"),
                "points": stat_dict.get("PTS", "0"),
                "rebounds": stat_dict.get("REB", "0"),
                "assists": stat_dict.get("AST", "0"),
            })

    return result


def clock_to_seconds(clock_str: str) -> int:
    """Convert 'MM:SS' clock string to seconds remaining in period."""
    try:
        if ":" in clock_str:
            parts = clock_str.split(":")
            return int(parts[0]) * 60 + int(float(parts[1]))
    except (ValueError, IndexError):
        pass
    return 0


# Season date ranges for ESPN
SEASON_DATES = {
    "2025-26": ("20251021", "20260220"),  # current season — end date = today, will fetch completed games
    "2024-25": ("20241022", "20250622"),
    "2023-24": ("20231024", "20240623"),
    "2022-23": ("20221018", "20230612"),
    "2021-22": ("20211019", "20220616"),
}
