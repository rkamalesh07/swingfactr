"""
Backfill player_game_logs table from ESPN box scores.

Fetches every completed game in the 2025-26 season and caches
per-player per-game stats. After this runs once (~927 games),
the ETL only fetches NEW games incrementally.

Run: python -m src.etl.backfill_player_logs

Takes ~20-40 min for full season backfill. Skips already-fetched games.
"""

import asyncio, httpx, json, logging, sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from src.etl.db import get_conn, init_pool

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")
logger = logging.getLogger("backfill")

ESPN_SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary"
HEADERS      = {"User-Agent": "Mozilla/5.0"}

ABBR_NORMALIZE = {
    "SA":"SAS","NO":"NOP","GS":"GSW","NY":"NYK","WSH":"WAS",
    "UTAH":"UTA","PHO":"PHX","UTH":"UTA",
}

def normalize(abbr):
    return ABBR_NORMALIZE.get(abbr, abbr)

def ensure_table():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS player_game_logs (
                    log_id        BIGSERIAL PRIMARY KEY,
                    game_id       VARCHAR(30) NOT NULL,
                    game_date     DATE NOT NULL,
                    season_id     VARCHAR(10) NOT NULL DEFAULT '2025-26',
                    player_name   VARCHAR(100) NOT NULL,
                    team_abbr     VARCHAR(5) NOT NULL,
                    opponent_abbr VARCHAR(5) NOT NULL,
                    is_home       BOOLEAN NOT NULL,
                    minutes       FLOAT,
                    pts           INTEGER,
                    reb           INTEGER,
                    ast           INTEGER,
                    stl           INTEGER,
                    blk           INTEGER,
                    fg3m          INTEGER,
                    fga           INTEGER,
                    fta           INTEGER,
                    tov           INTEGER,
                    fg_made       INTEGER,
                    ft_made       INTEGER,
                    is_b2b        BOOLEAN DEFAULT FALSE,
                    rest_days     INTEGER,
                    opp_def_margin FLOAT,
                    fetched_at    TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE (game_id, player_name)
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_pgl_player_date ON player_game_logs(player_name, game_date DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_pgl_team_date   ON player_game_logs(team_abbr, game_date DESC)")

def get_already_fetched():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT game_id FROM player_game_logs")
            return {r[0] for r in cur.fetchall()}

def get_all_games():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT g.game_id, g.game_date,
                       th.abbreviation, ta.abbreviation,
                       g.home_b2b, g.away_b2b,
                       g.home_rest_days, g.away_rest_days
                FROM games g
                JOIN teams th ON th.team_id = g.home_team_id
                JOIN teams ta ON ta.team_id = g.away_team_id
                WHERE g.season_id = '2025-26'
                  AND g.home_score IS NOT NULL
                ORDER BY g.game_date ASC
            """)
            return cur.fetchall()

def get_opp_defense_cache():
    """Pre-compute opponent defense margin for all teams."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT t.abbreviation,
                    ROUND(AVG(
                        CASE WHEN g.home_team_id = t.team_id
                             THEN g.away_score - g.home_score
                             ELSE g.home_score - g.away_score END
                    )::numeric, 1) as def_margin
                FROM teams t
                JOIN games g ON (g.home_team_id = t.team_id OR g.away_team_id = t.team_id)
                WHERE g.season_id = '2025-26' AND g.home_score IS NOT NULL
                GROUP BY t.abbreviation
            """)
            return {r[0]: float(r[1]) if r[1] else 0.0 for r in cur.fetchall()}

async def fetch_and_store_game(client, game_id, game_date, home_abbr, away_abbr,
                                home_b2b, away_b2b, home_rest, away_rest, def_cache):
    espn_id = game_id.replace("espn_", "")
    try:
        r    = await client.get(ESPN_SUMMARY, params={"event": espn_id}, timeout=10)
        data = r.json()
    except Exception as e:
        logger.warning(f"  Failed {espn_id}: {e}")
        return 0

    rows_written = 0
    for boxscore in data.get("boxscore", {}).get("players", []):
        t_raw  = boxscore.get("team", {}).get("abbreviation", "")
        t_abbr = normalize(t_raw)
        is_home = (t_abbr == home_abbr)
        opp     = away_abbr if is_home else home_abbr
        b2b     = home_b2b if is_home else away_b2b
        rest    = home_rest if is_home else away_rest
        opp_def = def_cache.get(opp, 0.0)

        for stat_group in boxscore.get("statistics", []):
            labels = stat_group.get("labels", [])

            for athlete in stat_group.get("athletes", []):
                name  = athlete.get("athlete", {}).get("displayName", "")
                stats = athlete.get("stats", [])
                if not stats or stats[0] == "DNP" or not name:
                    continue

                def gs(label, default=None):
                    if label not in labels: return default
                    idx = labels.index(label)
                    val = stats[idx] if idx < len(stats) else None
                    if val is None or val in ("", "DNP"): return default
                    # Handle "made-att" format
                    if "-" in str(val) and label in ("FG", "3PT", "FT"):
                        parts = str(val).split("-")
                        return (int(parts[0]), int(parts[1]))
                    try: return float(val)
                    except: return default

                minutes = gs("MIN")
                if not minutes or float(minutes) < 1:
                    continue

                fg_raw  = gs("FG")
                ft_raw  = gs("FT")
                fg3_raw = gs("3PT")

                fg_made = fg_raw[0]  if isinstance(fg_raw, tuple)  else 0
                fga     = fg_raw[1]  if isinstance(fg_raw, tuple)  else 0
                ft_made = ft_raw[0]  if isinstance(ft_raw, tuple)  else 0
                fta     = ft_raw[1]  if isinstance(ft_raw, tuple)  else 0
                fg3m    = fg3_raw[0] if isinstance(fg3_raw, tuple) else 0

                try:
                    with get_conn() as conn:
                        with conn.cursor() as cur:
                            cur.execute("""
                                INSERT INTO player_game_logs (
                                    game_id, game_date, season_id,
                                    player_name, team_abbr, opponent_abbr, is_home,
                                    minutes, pts, reb, ast, stl, blk,
                                    fg3m, fga, fta, tov, fg_made, ft_made,
                                    is_b2b, rest_days, opp_def_margin
                                ) VALUES (
                                    %s,%s,'2025-26',
                                    %s,%s,%s,%s,
                                    %s,%s,%s,%s,%s,%s,
                                    %s,%s,%s,%s,%s,%s,
                                    %s,%s,%s
                                )
                                ON CONFLICT (game_id, player_name) DO NOTHING
                            """, (
                                game_id, game_date,
                                name, t_abbr, opp, is_home,
                                float(minutes),
                                int(gs("PTS") or 0),
                                int(gs("REB") or 0),
                                int(gs("AST") or 0),
                                int(gs("STL") or 0),
                                int(gs("BLK") or 0),
                                int(fg3m),
                                int(fga), int(fta),
                                int(gs("TO") or 0),
                                int(fg_made), int(ft_made),
                                bool(b2b), int(rest or 1), float(opp_def),
                            ))
                    rows_written += 1
                except Exception as e:
                    logger.debug(f"Insert failed for {name}: {e}")

    return rows_written

async def run():
    init_pool()
    ensure_table()

    already_fetched = get_already_fetched()
    all_games       = get_all_games()
    def_cache       = get_opp_defense_cache()

    to_fetch = [g for g in all_games if g[0] not in already_fetched]
    logger.info(f"Total games: {len(all_games)} | Already cached: {len(already_fetched)} | To fetch: {len(to_fetch)}")

    if not to_fetch:
        logger.info("All games already cached.")
        return

    total_rows = 0
    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True) as client:
        # Process in batches of 10 concurrent requests
        BATCH = 10
        for i in range(0, len(to_fetch), BATCH):
            batch = to_fetch[i:i+BATCH]
            tasks = [
                fetch_and_store_game(
                    client, g[0], g[1], g[2], g[3],
                    g[4], g[5], g[6], g[7], def_cache
                )
                for g in batch
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            batch_rows = sum(r for r in results if isinstance(r, int))
            total_rows += batch_rows

            done = min(i + BATCH, len(to_fetch))
            if done % 50 == 0 or done == len(to_fetch):
                logger.info(f"  Progress: {done}/{len(to_fetch)} games | {total_rows} player-game rows written")

            # Small delay to avoid hammering ESPN
            await asyncio.sleep(0.3)

    logger.info(f"Backfill complete. {total_rows} total player-game rows written.")

    # Summary stats
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT COUNT(*), COUNT(DISTINCT player_name),
                       MIN(game_date), MAX(game_date)
                FROM player_game_logs
                WHERE season_id = '2025-26'
            """)
            row = cur.fetchone()
            logger.info(f"player_game_logs: {row[0]} rows, {row[1]} players, {row[2]} to {row[3]}")

if __name__ == "__main__":
    asyncio.run(run())
