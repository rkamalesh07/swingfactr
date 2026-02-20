"""
src/etl/pipeline.py
Main ETL runner. Run via:
  python -m src.etl.pipeline --seasons 2023-24 --games 50

Arguments:
  --seasons   Comma-separated list of seasons (e.g., "2022-23,2023-24")
  --games     Max games per season to fetch (use 0 for all)
  --skip-pbp  Only fetch schedule, skip play-by-play (faster for testing)
"""

import argparse
import logging
import sys
from tqdm import tqdm

from src.etl.fetch_games import upsert_teams, upsert_games, fetch_season_games
from src.etl.fetch_pbp import fetch_and_store_pbp
from src.etl.db import execute_sql

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("pipeline")


def run(seasons: list[str], max_games: int = 0, skip_pbp: bool = False) -> None:
    logger.info("=== SwingFactr ETL Pipeline START ===")

    # Step 0: Teams
    logger.info("Step 0 — Upserting teams...")
    upsert_teams()

    for season in seasons:
        logger.info("=== Season: %s ===", season)

        # Step 1: Schedule
        logger.info("Step 1 — Fetching game schedule...")
        upsert_games(season)

        if skip_pbp:
            logger.info("--skip-pbp set, skipping PBP fetch.")
            continue

        # Step 2: Play-by-play
        game_rows = execute_sql(
            "SELECT game_id FROM games WHERE season = :s ORDER BY game_date",
            {"s": season},
        )
        game_ids = [r["game_id"] for r in game_rows]

        if max_games > 0:
            game_ids = game_ids[:max_games]

        logger.info("Step 2 — Fetching PBP for %d games...", len(game_ids))
        for gid in tqdm(game_ids, desc=f"PBP {season}"):
            fetch_and_store_pbp(gid)

    logger.info("=== SwingFactr ETL Pipeline DONE ===")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SwingFactr ETL Pipeline")
    parser.add_argument("--seasons", default="2023-24", help="Comma-separated seasons")
    parser.add_argument("--games", type=int, default=50, help="Max games per season (0=all)")
    parser.add_argument("--skip-pbp", action="store_true")
    args = parser.parse_args()

    seasons = [s.strip() for s in args.seasons.split(",")]
    run(seasons=seasons, max_games=args.games, skip_pbp=args.skip_pbp)
