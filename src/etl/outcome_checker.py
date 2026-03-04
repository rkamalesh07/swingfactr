"""
Outcome Checker ETL — runs nightly at 10pm PST after all NBA games finish.

For each prop in yesterday's prop_board, fetches the actual stat from ESPN
and records whether it hit (over the line) or missed.

Cron: 10pm PST = 06:00 UTC next day

Usage:
  python -m src.etl.outcome_checker
  python -m src.etl.outcome_checker --date 2026-03-03  # backfill specific date
"""

import asyncio
import httpx
import json
import logging
import sys
import argparse
from datetime import datetime, timezone, timedelta, date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from src.etl.db import get_conn, init_pool

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")
logger = logging.getLogger("outcome_checker")

ESPN_SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary"
HEADERS      = {"User-Agent": "Mozilla/5.0"}

ABBR_NORMALIZE = {
    "SA":"SAS","NO":"NOP","GS":"GSW","NY":"NYK","WSH":"WAS","UTAH":"UTA","PHO":"PHX",
}

def normalize(abbr):
    return ABBR_NORMALIZE.get(abbr, abbr)

# ---------------------------------------------------------------------------
# DB setup
# ---------------------------------------------------------------------------

def ensure_table():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS prop_results (
                    result_id       SERIAL PRIMARY KEY,
                    game_date       DATE NOT NULL,
                    player_name     VARCHAR(100) NOT NULL,
                    team            VARCHAR(5),
                    opponent        VARCHAR(5),
                    stat            VARCHAR(20) NOT NULL,
                    odds_type       VARCHAR(10) NOT NULL DEFAULT 'standard',
                    line            FLOAT NOT NULL,
                    actual_value    FLOAT,
                    hit             BOOLEAN,           -- actual > line
                    composite_score FLOAT,
                    score_label     VARCHAR(30),
                    edge            FLOAT,             -- composite_score - 57.7
                    pick_side       VARCHAR(5),        -- over / under
                    correct         BOOLEAN,           -- did the pick match outcome?
                    checked_at      TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE (player_name, stat, odds_type, game_date)
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_results_date  ON prop_results(game_date)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_results_score ON prop_results(composite_score)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_results_label ON prop_results(score_label)")

# ---------------------------------------------------------------------------
# Fetch actual stat from ESPN
# ---------------------------------------------------------------------------

async def get_actual_stat(client, player_name, team_abbr, game_date, stat):
    """Look up a player's actual stat value from ESPN box score on game_date."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT g.game_id, th.abbreviation, ta.abbreviation
                FROM games g
                JOIN teams th ON th.team_id = g.home_team_id
                JOIN teams ta ON ta.team_id = g.away_team_id
                WHERE g.season_id = '2025-26'
                AND g.game_date = %s
                AND (th.abbreviation = %s OR ta.abbreviation = %s)
                LIMIT 1
            """, (game_date, team_abbr, team_abbr))
            row = cur.fetchone()

    if not row:
        return None

    game_id, home_abbr, away_abbr = row
    espn_id = game_id.replace("espn_", "")

    try:
        r    = await client.get(ESPN_SUMMARY, params={"event": espn_id}, timeout=10)
        data = r.json()
    except Exception as e:
        logger.warning(f"ESPN fetch failed for {espn_id}: {e}")
        return None

    ESPN_STAT = {
        "pts": "PTS", "reb": "REB", "ast": "AST",
        "fg3m": "3PT", "stl": "STL", "blk": "BLK",
    }
    espn_label = ESPN_STAT.get(stat)
    if not espn_label:
        return None

    for boxscore in data.get("boxscore", {}).get("players", []):
        t_abbr = normalize(boxscore.get("team", {}).get("abbreviation", ""))
        if t_abbr != team_abbr:
            continue
        for stat_group in boxscore.get("statistics", []):
            labels = stat_group.get("labels", [])
            if espn_label not in labels:
                continue
            idx = labels.index(espn_label)
            for athlete in stat_group.get("athletes", []):
                name = athlete.get("athlete", {}).get("displayName", "")
                if not all(tok in name.lower() for tok in player_name.lower().split()):
                    continue
                stats = athlete.get("stats", [])
                if not stats or stats[0] == "DNP":
                    return None
                val = stats[idx] if idx < len(stats) else None
                if val is None or val in ("", "DNP"):
                    return None
                # Handle "made-attempted" format for 3PT
                if "-" in str(val) and espn_label in ("FG", "3PT", "FT"):
                    return float(str(val).split("-")[0])
                try:
                    return float(val)
                except (ValueError, TypeError):
                    return None
    return None

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def run(target_date: date):
    init_pool()
    ensure_table()

    logger.info(f"Checking outcomes for {target_date}")

    # Fetch all props from that date
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT player_name, team, opponent, stat, odds_type, line,
                       composite_score, score_label
                FROM prop_board
                WHERE game_date = %s
                ORDER BY player_name, stat
            """, (target_date,))
            props = cur.fetchall()

    if not props:
        logger.info(f"No props found for {target_date}")
        return

    logger.info(f"Found {len(props)} props to check")
    PP_IMPLIED = 57.7

    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=15) as client:
        checked = 0
        hits    = 0
        correct = 0

        for player_name, team, opponent, stat, odds_type, line, comp_score, score_label in props:
            actual = await get_actual_stat(client, player_name, team or opponent, target_date, stat)

            if actual is None:
                logger.debug(f"  No result for {player_name} {stat}")
                continue

            hit  = actual > line
            edge = round((comp_score or PP_IMPLIED) - PP_IMPLIED, 1)

            # pick_side: demon/goblin = always over, standard = model direction
            if odds_type in ("demon", "goblin"):
                pick_side = "over"
            else:
                pick_side = "over" if edge > 0 else "under"

            # correct = did our pick match the actual outcome?
            if pick_side == "over":
                is_correct = hit
            else:
                is_correct = not hit

            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO prop_results (
                            game_date, player_name, team, opponent,
                            stat, odds_type, line, actual_value,
                            hit, composite_score, score_label, edge,
                            pick_side, correct
                        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        ON CONFLICT (player_name, stat, odds_type, game_date)
                        DO UPDATE SET
                            actual_value = EXCLUDED.actual_value,
                            hit          = EXCLUDED.hit,
                            correct      = EXCLUDED.correct,
                            checked_at   = NOW()
                    """, (
                        target_date, player_name, team, opponent,
                        stat, odds_type, line, actual,
                        hit, comp_score, score_label, edge,
                        pick_side, is_correct,
                    ))

            checked += 1
            if hit:       hits    += 1
            if is_correct: correct += 1

            logger.debug(f"  {player_name} {stat} {line}: actual={actual} hit={hit} correct={is_correct}")

    if checked > 0:
        logger.info(f"Checked {checked} props — hit rate: {hits/checked*100:.1f}% — pick accuracy: {correct/checked*100:.1f}%")
    else:
        logger.info("No results found — games may not be complete yet")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", type=str, help="Date to check (YYYY-MM-DD). Defaults to yesterday PST.")
    args = parser.parse_args()

    if args.date:
        target = date.fromisoformat(args.date)
    else:
        pst     = timezone(timedelta(hours=-8))
        target  = (datetime.now(pst) - timedelta(days=1)).date()

    asyncio.run(run(target))
