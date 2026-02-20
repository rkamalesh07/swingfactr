"""
SwingFactr ETL Orchestrator — ESPN Edition

Modes:
  python -m src.etl.run_pipeline --season 2024-25 --limit 10   # dev test
  python -m src.etl.run_pipeline --season 2024-25              # full season
  python -m src.etl.run_pipeline --season 2023-24              # historical
"""

import argparse
import logging
import sys
import time
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from src.etl.db import init_pool, execute_sql_file, get_conn
from src.etl.games import seed_teams, seed_season, fetch_season_games
from src.etl.pbp import store_game_pbp
from src.etl.lineups import store_game_stints
from src.etl.schedule import build_schedule_features

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("swingfactr.etl")

CURRENT_SEASON = "2024-25"


def run_season(season: str, limit: int = 0) -> None:
    """ETL one full season. Safe to re-run — skips already-loaded plays."""
    logger.info(f"--- Season: {season} ---")
    seed_season(season)
    build_schedule_features(season)

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT game_id, home_team_id, away_team_id
                FROM games WHERE season_id = %s
                ORDER BY game_date
            """, (season,))
            games = cur.fetchall()

    if limit:
        games = games[:limit]

    logger.info(f"Processing PBP + lineups for {len(games)} games...")
    failed = []
    for i, (gid, home_tid, away_tid) in enumerate(games):
        try:
            store_game_pbp(gid, home_tid, away_tid)
            store_game_stints(gid, home_tid, away_tid)
            if (i + 1) % 5 == 0:
                logger.info(f"  {i+1}/{len(games)} games done")
            time.sleep(0.3)  # be polite to ESPN
        except Exception as e:
            logger.error(f"  Failed {gid}: {e}")
            failed.append(gid)

    logger.info(f"Season {season}: {len(games)-len(failed)}/{len(games)} OK, {len(failed)} failed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SwingFactr ETL Pipeline")
    parser.add_argument("--season", default=CURRENT_SEASON,
                        help="Season to load e.g. 2024-25")
    parser.add_argument("--limit", type=int, default=0,
                        help="Max games to process (0=all, use 10 for quick test)")
    args = parser.parse_args()

    init_pool()
    schema_path = Path(__file__).parent.parent.parent / "sql" / "schema.sql"
    if schema_path.exists():
        execute_sql_file(str(schema_path))

    seed_teams()
    run_season(args.season, limit=args.limit)
