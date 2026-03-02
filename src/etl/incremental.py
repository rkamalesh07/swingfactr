"""
Incremental ETL — only processes new games since last DB update.

Run daily via cron or Railway cron job:
  python -m src.etl.incremental --season 2025-26

Takes ~5 minutes instead of 12 hours.
"""

import argparse
import logging
import sys
import time
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from src.etl.db import init_pool, get_conn, upsert_many
from src.etl.espn import fetch_games_for_date, fetch_games_for_daterange
from src.etl.games import seed_teams
from src.etl.pbp import store_game_pbp
from src.etl.lineups import store_game_stints
from src.etl.schedule import build_schedule_features

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("swingfactr.incremental")


def get_latest_game_date(season: str) -> date:
    """Return the most recent game_date already in DB for this season."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT MAX(game_date) FROM games
                WHERE season_id = %s AND home_score IS NOT NULL
            """, (season,))
            row = cur.fetchone()
            if row and row[0]:
                return row[0] if hasattr(row[0], 'year') else date.fromisoformat(str(row[0]))
    # Default: start of season
    return date(2025, 10, 22) if season == "2025-26" else date(2024, 10, 22)


def get_new_games(season: str, since: date) -> list[dict]:
    """Fetch completed games from ESPN between since and today."""
    today = date.today()
    if since >= today:
        logger.info("Already up to date.")
        return []

    # Fetch day by day from since+1 to yesterday (today's games not complete yet)
    start_str = (since + timedelta(days=1)).strftime("%Y%m%d")
    end_str = (today - timedelta(days=1)).strftime("%Y%m%d")

    if start_str > end_str:
        logger.info("No new completed games to process.")
        return []

    logger.info(f"Fetching games from {start_str} to {end_str}...")
    games = fetch_games_for_daterange(start_str, end_str)
    completed = [g for g in games if g.get("completed")]
    logger.info(f"Found {len(completed)} new completed games")
    return completed


def store_new_games(games: list[dict], season: str) -> list[tuple]:
    """Upsert new games into DB, return list of (game_id, home_team_id, away_team_id)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT team_id, abbreviation FROM teams")
            abbr_to_id = {row[1]: row[0] for row in cur.fetchall()}

    rows = []
    for g in games:
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

    if rows:
        upsert_many("games", rows, ["game_id"])
        logger.info(f"Upserted {len(rows)} games into DB")

    return [(r["game_id"], r["home_team_id"], r["away_team_id"]) for r in rows]


def run_incremental(season: str = "2025-26", dry_run: bool = False) -> None:
    """Main incremental ETL entry point."""
    logger.info(f"=== Incremental ETL: {season} ===")

    # Step 1: Find latest game already in DB
    latest = get_latest_game_date(season)
    logger.info(f"Latest game in DB: {latest}")

    # Step 2: Fetch new games from ESPN
    new_games = get_new_games(season, latest)
    if not new_games:
        logger.info("Nothing to do. Exiting.")
        return

    if dry_run:
        logger.info(f"DRY RUN — would process {len(new_games)} games:")
        for g in new_games:
            logger.info(f"  {g['game_date']} {g['away_team_abbr']} @ {g['home_team_abbr']}")
        return

    # Step 3: Store game metadata
    game_tuples = store_new_games(new_games, season)

    # Step 4: PBP + stints for each new game
    failed = []
    for i, (gid, home_tid, away_tid) in enumerate(game_tuples):
        try:
            logger.info(f"  [{i+1}/{len(game_tuples)}] Processing {gid}...")
            store_game_pbp(gid, home_tid, away_tid)
            store_game_stints(gid, home_tid, away_tid)
            time.sleep(0.5)  # be polite to ESPN
        except Exception as e:
            logger.error(f"  Failed {gid}: {e}")
            failed.append(gid)

    # Step 5: Rebuild schedule features for affected dates
    logger.info("Rebuilding schedule features...")
    build_schedule_features(season)

    logger.info(f"=== Done: {len(game_tuples) - len(failed)}/{len(game_tuples)} games OK ===")
    if failed:
        logger.warning(f"Failed: {failed}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SwingFactr Incremental ETL")
    parser.add_argument("--season", default="2025-26")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be processed without doing it")
    args = parser.parse_args()

    init_pool()
    seed_teams()
    run_incremental(season=args.season, dry_run=args.dry_run)


def log_etl_run(payload: dict):
    """Write ETL run metadata to etl_runs table."""
    try:
        from src.etl.db import get_conn
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS etl_runs (
                        run_id SERIAL PRIMARY KEY,
                        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        finished_at TIMESTAMPTZ,
                        season_id VARCHAR(10) NOT NULL,
                        status VARCHAR(20) NOT NULL DEFAULT 'running',
                        games_processed INTEGER DEFAULT 0,
                        plays_processed INTEGER DEFAULT 0,
                        stints_processed INTEGER DEFAULT 0,
                        errors INTEGER DEFAULT 0,
                        error_details TEXT,
                        duration_seconds FLOAT,
                        latest_game_date DATE
                    )
                """)
                cur.execute("""
                    INSERT INTO etl_runs (
                        started_at, finished_at, season_id, status,
                        games_processed, plays_processed, stints_processed,
                        errors, error_details, duration_seconds, latest_game_date
                    ) VALUES (
                        %(started_at)s, %(finished_at)s, %(season_id)s, %(status)s,
                        %(games_processed)s, %(plays_processed)s, %(stints_processed)s,
                        %(errors)s, %(error_details)s, %(duration_seconds)s, %(latest_game_date)s
                    )
                """, payload)
    except Exception as e:
        logger.warning(f"Could not log ETL run: {e}")
