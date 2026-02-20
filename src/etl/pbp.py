"""Fetch and parse NBA play-by-play data using ESPN API.

ESPN provides play-by-play data through their public summary endpoint.
No API key required.
"""

import logging
from typing import Optional

from src.etl.db import upsert_many, get_conn
from src.etl.espn import fetch_game_pbp, fetch_game_summary

logger = logging.getLogger(__name__)


def store_game_pbp(game_id: str, home_team_id: int, away_team_id: int) -> int:
    """
    Fetch ESPN play-by-play for a game and store in DB.
    game_id format: 'espn_401705123'
    Returns number of plays stored.
    """
    # Extract ESPN event ID from our game_id format
    espn_id = game_id.replace("espn_", "")

    plays = fetch_game_pbp(espn_id)
    if not plays:
        logger.warning(f"No plays found for {game_id}")
        return 0

    rows = []
    for i, p in enumerate(plays):
        # Determine possession team_id
        poss_espn_id = p.get("possession_espn_team_id")
        possession_team_id = None
        if poss_espn_id:
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT team_id FROM teams WHERE team_id = %s",
                        (int(poss_espn_id),)
                    )
                    row = cur.fetchone()
                    if row:
                        possession_team_id = row[0]

        is_home_possession = None
        if possession_team_id is not None:
            is_home_possession = possession_team_id == home_team_id

        # Calculate time remaining
        period = p.get("period", 1)
        game_seconds = p.get("game_seconds_elapsed", 0)
        period_duration = 720 if period <= 4 else 300
        total_regulation = 2880
        time_remaining = max(0, total_regulation - game_seconds)

        rows.append({
            "game_id": game_id,
            "play_num": i,
            "period": period,
            "clock_seconds": p.get("clock_seconds", 0),
            "game_seconds_elapsed": game_seconds,
            "time_remaining_seconds": time_remaining,
            "description": p.get("description", "")[:500],
            "home_score": p.get("home_score", 0),
            "away_score": p.get("away_score", 0),
            "score_diff": p.get("score_diff", 0),
            "possession_team_id": possession_team_id,
            "is_home_possession": is_home_possession,
            "is_fg_attempt": p.get("is_fg_attempt", False),
            "is_fg_made": p.get("is_fg_made", False),
            "is_3pt": p.get("is_3pt", False),
            "shot_distance": p.get("shot_distance"),
            "is_rim_attempt": p.get("is_rim_attempt", False),
            "is_turnover": p.get("is_turnover", False),
            "is_foul": p.get("is_foul", False),
            "is_timeout": p.get("is_timeout", False),
            "play_type": p.get("play_type", "")[:100],
        })

    upsert_many("plays", rows, ["game_id", "play_num"])
    logger.info(f"Stored {len(rows)} plays for {game_id}")
    return len(rows)
