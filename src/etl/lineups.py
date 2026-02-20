"""Reconstruct lineup stints from ESPN boxscore data.

ESPN provides starter and player data through the summary endpoint.
We infer stints based on boxscore participation since ESPN PBP
doesn't always have substitution events.
"""

import hashlib
import logging
from typing import Optional

from src.etl.db import get_conn, upsert_many
from src.etl.espn import fetch_game_summary, fetch_boxscore

logger = logging.getLogger(__name__)


def lineup_id(player_ids: list[int]) -> str:
    """Generate a stable lineup ID from a sorted list of player IDs."""
    key = "_".join(str(p) for p in sorted(player_ids))
    return hashlib.md5(key.encode()).hexdigest()[:16]


def store_game_stints(game_id: str, home_team_id: int, away_team_id: int) -> int:
    """
    Build stint records for a game from ESPN boxscore.
    Since ESPN PBP doesn't always have sub events, we create one
    aggregate stint per game per team using the players who played.
    Returns number of stints stored.
    """
    espn_id = game_id.replace("espn_", "")

    try:
        boxscore = fetch_boxscore(espn_id)
    except Exception as e:
        logger.warning(f"Could not fetch boxscore for {game_id}: {e}")
        return 0

    # Get game score info
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT home_score, away_score FROM games WHERE game_id = %s",
                (game_id,)
            )
            row = cur.fetchone()
            if not row:
                return 0
            home_score, away_score = row

    stints = []
    for side, team_id in [("home", home_team_id), ("away", away_team_id)]:
        players = boxscore.get(side, [])
        if not players:
            continue

        # Seed players into DB
        seed_players(players, team_id)

        player_ids = []
        for p in players:
            pid_str = p["player_id"].replace("espn_", "")
            try:
                player_ids.append(int(pid_str))
            except ValueError:
                pass

        if not player_ids:
            continue

        lid = lineup_id(player_ids)

        # One aggregate stint per game per team
        score_diff = (home_score or 0) - (away_score or 0)
        team_score = home_score if side == "home" else away_score
        opp_score = away_score if side == "home" else home_score

        stint = {
            "game_id": game_id,
            "team_id": team_id,
            "lineup_id": lid,
            "period": 1,
            "start_game_seconds": 0,
            "end_game_seconds": 2880,
            "duration_seconds": 2880,
            "start_score_diff": 0,
            "end_score_diff": score_diff if side == "home" else -score_diff,
            "possessions": 100,  # placeholder
            "is_clutch": False,
        }
        stints.append(stint)

        # Upsert lineup_players
        lineup_rows = [
            {"lineup_id": lid, "player_id": pid, "team_id": team_id}
            for pid in player_ids
        ]
        upsert_many("lineup_players", lineup_rows, ["lineup_id", "player_id"])

    if stints:
        upsert_many("stints", stints, ["game_id", "team_id", "lineup_id", "period"])

    logger.info(f"Stored {len(stints)} stints for {game_id}")
    return len(stints)


def seed_players(players: list[dict], team_id: int) -> None:
    """Insert player records into DB if they don't exist."""
    rows = []
    for p in players:
        pid_str = p["player_id"].replace("espn_", "")
        try:
            pid = int(pid_str)
        except ValueError:
            continue
        name_parts = p["name"].split(" ", 1)
        rows.append({
            "player_id": pid,
            "first_name": name_parts[0] if name_parts else "",
            "last_name": name_parts[1] if len(name_parts) > 1 else "",
            "team_id": team_id,
        })
    if rows:
        upsert_many("players", rows, ["player_id"])
