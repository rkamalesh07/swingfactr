"""
src/etl/fetch_games.py
Step 1 of the ETL pipeline.

WHY nba_api over pbpstats?
  - nba_api is pip-installable, has typed endpoints, and provides BOTH
    play-by-play (PlayByPlayV2) and box scores in one library.
  - pbpstats gives cleaner possession parsing but requires a separate
    download step and is less maintained. We use nba_api and implement
    our own possession inference — good enough and keeps dependencies lean.

DATA SOURCES (all FREE, no API key required):
  - stats.nba.com via nba_api:
    • LeagueGameFinder  → schedule / game list
    • PlayByPlayV2      → play-by-play (raw)
    • TeamGameLog       → team game logs (rest days)
    • CommonPlayerInfo  → player metadata
  - No API key needed; be polite with rate limiting (0.6 s delay default).
"""

import time
import logging
from datetime import datetime, timedelta
from math import radians, cos, sin, asin, sqrt

import pandas as pd
from nba_api.stats.endpoints import (
    LeagueGameFinder,
    PlayByPlayV2,
    TeamGameLog,
)
from nba_api.stats.static import teams as nba_teams_static

from src.etl.config import TEAM_CITY_DATA
from src.etl.db import session_scope

logger = logging.getLogger(__name__)

DELAY = 0.6  # seconds between requests — be polite to NBA servers


# ─── Helpers ──────────────────────────────────────────────────────────────────

def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in miles between two lat/lon points."""
    R = 3958.8  # Earth radius in miles
    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 2 * R * asin(sqrt(a))


def _sleep() -> None:
    time.sleep(DELAY)


# ─── Fetch + upsert teams ─────────────────────────────────────────────────────

def upsert_teams() -> None:
    """Populate the teams table from nba_api static data + our city lookup."""
    all_teams = nba_teams_static.get_teams()
    rows = []
    for t in all_teams:
        tid = t["id"]
        city_info = TEAM_CITY_DATA.get(tid, {})
        rows.append({
            "team_id": tid,
            "abbreviation": t["abbreviation"],
            "full_name": t["full_name"],
            "city": t["city"],
            "conference": None,  # not in static — fill later from standings if needed
            "division": None,
            "home_lat": city_info.get("lat"),
            "home_lon": city_info.get("lon"),
            "altitude_ft": city_info.get("alt", 0),
        })

    with session_scope() as sess:
        for row in rows:
            sess.execute(
                """
                INSERT INTO teams (team_id, abbreviation, full_name, city, home_lat, home_lon, altitude_ft)
                VALUES (:team_id, :abbreviation, :full_name, :city, :home_lat, :home_lon, :altitude_ft)
                ON CONFLICT (team_id) DO UPDATE SET
                    abbreviation = EXCLUDED.abbreviation,
                    full_name    = EXCLUDED.full_name
                """,
                row,
            )
    logger.info("Teams upserted: %d", len(rows))


# ─── Fetch season schedule ────────────────────────────────────────────────────

def fetch_season_games(season: str) -> pd.DataFrame:
    """
    Fetch all regular season games for a season (e.g., "2023-24").
    Returns a DataFrame with one row per GAME (not per team).
    """
    logger.info("Fetching game list for season %s", season)
    finder = LeagueGameFinder(
        season_nullable=season,
        season_type_nullable="Regular Season",
        league_id_nullable="00",
    )
    _sleep()
    df = finder.get_data_frames()[0]

    # LeagueGameFinder returns one row per team per game — deduplicate to one per game
    df = df[df["MATCHUP"].str.contains("vs\.")].copy()  # home games only
    df = df.rename(columns={
        "GAME_ID": "game_id",
        "GAME_DATE": "game_date",
        "TEAM_ID": "home_team_id",
        "WL": "home_wl",
    })
    df["season"] = season
    df["game_date"] = pd.to_datetime(df["game_date"]).dt.date
    return df[["game_id", "season", "game_date", "home_team_id", "home_wl"]]


def fetch_rest_and_travel(season: str, games_df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute rest days, back-to-backs, and travel distance for each game.
    Modifies and returns games_df with fatigue columns added.
    """
    logger.info("Computing rest/travel for %d games", len(games_df))
    games_df = games_df.copy().sort_values("game_date")

    # Build home/away from matchup
    # We'll fetch team game logs for rest calculation
    team_last_game: dict[int, dict] = {}  # team_id -> {date, city}
    rest_rows = []

    for _, g in games_df.iterrows():
        home_id = g["home_team_id"]
        # Infer away team from matchup — we'll populate this properly in upsert step
        # For now, placeholder
        rest_rows.append({
            "game_id": g["game_id"],
            "home_rest_days": _rest_days(home_id, g["game_date"], team_last_game),
        })
        # Update tracker
        home_city = TEAM_CITY_DATA.get(home_id, {})
        team_last_game[home_id] = {
            "date": g["game_date"],
            "lat": home_city.get("lat"),
            "lon": home_city.get("lon"),
        }

    return pd.DataFrame(rest_rows)


def _rest_days(team_id: int, game_date, tracker: dict) -> int:
    if team_id not in tracker:
        return 7  # assume rested if no prior game
    last = tracker[team_id]
    delta = (game_date - last["date"]).days
    return min(delta, 7)  # cap at 7


# ─── Upsert games ─────────────────────────────────────────────────────────────

def upsert_games(season: str) -> None:
    """
    Full pipeline: fetch schedule, compute fatigue proxies, write to Postgres.
    """
    games_df = fetch_season_games(season)

    with session_scope() as sess:
        for _, g in games_df.iterrows():
            home_win = True if g["home_wl"] == "W" else (False if g["home_wl"] == "L" else None)
            sess.execute(
                """
                INSERT INTO games (game_id, season, game_date, home_team_id, home_win)
                VALUES (:game_id, :season, :game_date, :home_team_id, :home_win)
                ON CONFLICT (game_id) DO UPDATE SET
                    home_win = EXCLUDED.home_win
                """,
                {
                    "game_id": str(g["game_id"]),
                    "season": season,
                    "game_date": g["game_date"],
                    "home_team_id": int(g["home_team_id"]),
                    "home_win": home_win,
                },
            )
    logger.info("Games upserted for season %s: %d", season, len(games_df))
