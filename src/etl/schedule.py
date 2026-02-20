"""Build schedule + travel + fatigue features for each team-game.

Travel distance is approximated using great-circle distance between
city lat/lon coordinates (no external API needed beyond geopy).
Time zone differences are looked up from a static city→timezone map.
"""

import logging
from datetime import date, timedelta
from math import radians, cos, sin, asin, sqrt
from typing import Optional

import pandas as pd

from src.etl.db import get_conn, upsert_many

logger = logging.getLogger(__name__)

# City timezone offsets from UTC (standard time; we ignore DST for simplicity)
CITY_TZ_OFFSET = {
    "Atlanta": -5, "Boston": -5, "Brooklyn": -5, "Charlotte": -5,
    "Chicago": -6, "Cleveland": -5, "Dallas": -6, "Denver": -7,
    "Detroit": -5, "Golden State": -8, "Houston": -6, "Indiana": -5,
    "Los Angeles": -8, "Memphis": -6, "Miami": -5, "Milwaukee": -6,
    "Minnesota": -6, "New Orleans": -6, "New York": -5, "Oklahoma City": -6,
    "Orlando": -5, "Philadelphia": -5, "Phoenix": -7, "Portland": -8,
    "Sacramento": -8, "San Antonio": -6, "Toronto": -5, "Utah": -7,
    "Washington": -5,
}


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in miles between two lat/lon points."""
    R = 3958.8  # Earth radius in miles
    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 2 * R * asin(sqrt(a))


def build_schedule_features(season_id: str) -> None:
    """
    Compute and store schedule/travel features for all games in a season.
    
    For each team-game pair, computes:
    - rest_days: days since last game
    - b2b: back-to-back flag
    - third_in_four: 3 games in 4 days
    - road_trip_game: which game in current consecutive road trip
    - travel_miles: great-circle distance from last game city (away trips)
    - tz_change: time zone hours difference
    - altitude_ft: destination altitude
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT g.game_id, g.game_date, g.home_team_id, g.away_team_id,
                       ht.city AS home_city, ht.home_lat AS hlat, ht.home_lon AS hlon,
                       at.city AS away_city, at.home_lat AS alat, at.home_lon AS alon,
                       ht.altitude_ft AS home_alt, at.altitude_ft AS away_alt
                FROM games g
                JOIN teams ht ON ht.team_id = g.home_team_id
                JOIN teams at ON at.team_id = g.away_team_id
                WHERE g.season_id = %s
                ORDER BY g.game_date
            """, (season_id,))
            cols = [d[0] for d in cur.description]
            games = [dict(zip(cols, r)) for r in cur.fetchall()]

    if not games:
        logger.warning(f"No games found for season {season_id}")
        return

    # Build per-team sorted game list
    from collections import defaultdict
    team_games: dict[int, list[dict]] = defaultdict(list)
    game_lookup: dict[str, dict] = {}

    for row in games:
        g = dict(row)
        game_lookup[g["game_id"]] = g
        team_games[g["home_team_id"]].append({"game_id": g["game_id"], "date": g["game_date"], "is_home": True, "city": g["home_city"], "lat": g["hlat"], "lon": g["hlon"]})
        team_games[g["away_team_id"]].append({"game_id": g["game_id"], "date": g["game_date"], "is_home": False, "city": g["home_city"], "lat": g["hlat"], "lon": g["hlon"]})

    schedule_rows = []
    game_update_rows: list[tuple] = []

    for team_id, tgames in team_games.items():
        tgames.sort(key=lambda x: x["date"])
        prev_game: Optional[dict] = None
        road_trip_len = 0

        for i, tg in enumerate(tgames):
            game_date = tg["date"]
            is_home = tg["is_home"]
            is_home_game = game_lookup[tg["game_id"]]["home_team_id"] == team_id

            # Rest days
            rest_days = None
            if prev_game:
                prev_date = prev_game["date"]
                if isinstance(game_date, str):
                    game_date_obj = date.fromisoformat(game_date)
                else:
                    game_date_obj = game_date
                if isinstance(prev_date, str):
                    prev_date_obj = date.fromisoformat(prev_date)
                else:
                    prev_date_obj = prev_date
                rest_days = (game_date_obj - prev_date_obj).days - 1
            
            rest_days = rest_days if rest_days is not None else 3  # assume 3 for first game

            b2b = rest_days == 0
            # 3-in-4: look back 2 previous games
            third_in_four = False
            if i >= 2:
                d0 = tgames[i]["date"]
                d2 = tgames[i - 2]["date"]
                if isinstance(d0, str):
                    d0 = date.fromisoformat(d0)
                if isinstance(d2, str):
                    d2 = date.fromisoformat(d2)
                third_in_four = (d0 - d2).days <= 3

            # Road trip
            if not is_home:
                road_trip_len += 1
            else:
                road_trip_len = 0

            # Travel distance
            travel_miles = 0.0
            tz_change = 0
            if prev_game and not is_home:
                # Away game: traveling FROM last city TO this game's arena city
                from_city = prev_game.get("city", "")
                to_city = tg.get("city", "")
                travel_miles = haversine_miles(
                    prev_game.get("lat") or 0, prev_game.get("lon") or 0,
                    tg.get("lat") or 0, tg.get("lon") or 0
                )
                from_tz = CITY_TZ_OFFSET.get(from_city, -6)
                to_tz = CITY_TZ_OFFSET.get(to_city, -6)
                tz_change = abs(to_tz - from_tz)

            altitude_ft = game_lookup[tg["game_id"]].get("home_alt", 0) or 0
            g = game_lookup[tg["game_id"]]

            row = {
                "team_id": team_id,
                "game_id": tg["game_id"],
                "game_date": tg["date"],
                "is_home": is_home,
                "opponent_id": g["away_team_id"] if is_home_game else g["home_team_id"],
                "rest_days": rest_days,
                "b2b": b2b,
                "third_in_four": third_in_four,
                "road_trip_game": road_trip_len,
                "travel_from_city": prev_game.get("city", "") if prev_game else "",
                "travel_miles": travel_miles,
                "tz_change": tz_change,
                "altitude_ft": altitude_ft if not is_home else 0,
            }
            schedule_rows.append(row)
            prev_game = tg

    # Remove existing and re-insert
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                DELETE FROM schedule WHERE game_id IN (
                    SELECT game_id FROM games WHERE season_id = %s
                )
            """, (season_id,))

    upsert_many("schedule", schedule_rows, ["team_id", "game_id"])

    # Backfill games table with rest/b2b for easy querying
    with get_conn() as conn:
        with conn.cursor() as cur:
            for row in schedule_rows:
                if row["is_home"]:
                    cur.execute("""
                        UPDATE games SET home_rest_days=%s, home_b2b=%s, home_3in4=%s
                        WHERE game_id=%s
                    """, (row["rest_days"], row["b2b"], row["third_in_four"], row["game_id"]))
                else:
                    cur.execute("""
                        UPDATE games SET away_rest_days=%s, away_b2b=%s, away_3in4=%s,
                        travel_miles=%s, tz_change=%s, away_road_trip_game=%s
                        WHERE game_id=%s
                    """, (row["rest_days"], row["b2b"], row["third_in_four"],
                          row["travel_miles"], row["tz_change"], row["road_trip_game"],
                          row["game_id"]))

    logger.info(f"Built schedule features for {len(schedule_rows)} team-games in {season_id}")
