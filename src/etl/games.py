"""Fetch and store NBA game metadata for a season using ESPN API.

ESPN's public API requires no key and is not blocked like stats.nba.com.
"""

import logging
import time
from typing import Optional

from src.etl.db import upsert_many, get_conn
from src.etl.espn import fetch_teams, fetch_games_for_daterange, SEASON_DATES

logger = logging.getLogger(__name__)

# Geo data keyed by ESPN team abbreviation
TEAM_GEO = {
    "ATL": ("Atlanta",      33.748,  -84.388,  1050),
    "BOS": ("Boston",       42.361,  -71.057,   141),
    "BKN": ("Brooklyn",     40.682,  -73.975,    33),
    "CHA": ("Charlotte",    35.227,  -80.843,   751),
    "CHI": ("Chicago",      41.883,  -87.632,   594),
    "CLE": ("Cleveland",    41.499,  -81.695,   653),
    "DAL": ("Dallas",       32.790,  -96.810,   430),
    "DEN": ("Denver",       39.748, -104.994,  5280),
    "DET": ("Detroit",      42.341,  -83.048,   600),
    "GSW": ("San Francisco",37.768, -122.388,    52),
    "HOU": ("Houston",      29.753,  -95.362,    43),
    "IND": ("Indiana",      39.764,  -86.156,   715),
    "LAC": ("Los Angeles",  34.043, -118.267,   233),
    "LAL": ("Los Angeles",  34.043, -118.267,   233),
    "MEM": ("Memphis",      35.138,  -90.050,   337),
    "MIA": ("Miami",        25.781,  -80.188,    10),
    "MIL": ("Milwaukee",    43.043,  -87.917,   617),
    "MIN": ("Minnesota",    44.979,  -93.276,   830),
    "NOP": ("New Orleans",  29.949,  -90.082,     6),
    "NYK": ("New York",     40.751,  -73.994,    33),
    "OKC": ("Oklahoma City",35.463,  -97.515,  1201),
    "ORL": ("Orlando",      28.539,  -81.383,    96),
    "PHI": ("Philadelphia", 39.901,  -75.172,    39),
    "PHX": ("Phoenix",      33.445, -112.071,  1086),
    "POR": ("Portland",     45.531, -122.667,    50),
    "SAC": ("Sacramento",   38.580, -121.499,    30),
    "SAS": ("San Antonio",  29.427,  -98.437,   650),
    "TOR": ("Toronto",      43.643,  -79.379,    76),
    "UTA": ("Utah",         40.768, -111.901,  4226),
    "WAS": ("Washington",   38.898,  -77.021,    25),
}


def seed_teams() -> None:
    """Fetch all NBA teams from ESPN and upsert into DB."""
    espn_teams = fetch_teams()
    rows = []
    for t in espn_teams:
        abbr = t["abbreviation"]
        geo = TEAM_GEO.get(abbr, (t["city"], 0.0, 0.0, 0))
        rows.append({
            "team_id": t["espn_id"],
            "abbreviation": abbr,
            "city": geo[0],
            "name": t["name"],
            "conference": None,
            "division": None,
            "home_lat": geo[1],
            "home_lon": geo[2],
            "altitude_ft": geo[3],
        })
    upsert_many("teams", rows, ["team_id"])
    logger.info(f"Seeded {len(rows)} teams")


def fetch_season_games(season: str = "2024-25") -> list[dict]:
    """
    Fetch all regular season games for a given season from ESPN.
    Season format: '2024-25'
    """
    logger.info(f"Fetching games for season {season} from ESPN")

    if season not in SEASON_DATES:
        logger.error(f"Unknown season: {season}. Known: {list(SEASON_DATES.keys())}")
        return []

    start, end = SEASON_DATES[season]
    games = fetch_games_for_daterange(start, end)
    logger.info(f"Got {len(games)} total events from ESPN for {season}")

    # Build team abbr -> id mapping from DB
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT team_id, abbreviation FROM teams")
            abbr_to_id = {row[1]: row[0] for row in cur.fetchall()}

    rows = []
    for g in games:
        if not g["completed"]:
            continue
        home_id = abbr_to_id.get(g["home_team_abbr"])
        away_id = abbr_to_id.get(g["away_team_abbr"])
        if not home_id or not away_id:
            continue
        rows.append({
            "game_id": g["game_id"],
            "season_id": season,
            "game_date": g["game_date"],
            "home_team_id": home_id,
            "away_team_id": away_id,
            "home_score": g["home_score"],
            "away_score": g["away_score"],
            "home_win": g["home_win"],
        })

    upsert_many("games", rows, ["game_id"])
    logger.info(f"Upserted {len(rows)} completed games for {season}")
    return rows


def seed_season(season: str = "2024-25") -> None:
    """Seed season record then fetch all games."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO seasons (season_id) VALUES (%s) ON CONFLICT DO NOTHING",
                (season,)
            )
    fetch_season_games(season)
