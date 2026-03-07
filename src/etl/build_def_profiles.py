"""
Build positional defensive profiles.

For each team × position × stat, compute:
  - league_avg: average stat per game at that position league-wide
  - team_allowed: average stat allowed by this team to that position
  - def_ratio: team_allowed / league_avg  (1.0 = average, 1.15 = 15% easier)
  - sample_size: number of games in sample

Stored in defensive_profiles table, used by props_board to adjust
predicted_mean before distribution scoring.

Logic:
  - Use player_game_logs joined with players.position
  - Group by opponent_abbr (defending team) × position × stat
  - Compare to league average at same position
  - Minimum 20 game sample before applying adjustment
  - Shrink toward 1.0 for small samples: adjusted = 1.0 + (raw-1.0) * min(1, n/40)
"""

import sys, logging
sys.path.insert(0, '.')
from src.etl.db import get_conn, init_pool

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")
logger = logging.getLogger("def_profiles")

STATS   = ["pts", "reb", "ast", "fg3m", "stl", "blk"]
MIN_SAMPLE = 20   # minimum player-games before using the ratio
SHRINK_N   = 40   # full weight at this many games

def ensure_table():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS defensive_profiles (
                    profile_id   SERIAL PRIMARY KEY,
                    season_id    VARCHAR(10) NOT NULL,
                    team_abbr    VARCHAR(5)  NOT NULL,
                    position     VARCHAR(5)  NOT NULL,
                    stat         VARCHAR(10) NOT NULL,
                    league_avg   FLOAT       NOT NULL,
                    team_allowed FLOAT       NOT NULL,
                    def_ratio    FLOAT       NOT NULL,
                    sample_size  INT         NOT NULL,
                    updated_at   TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE (season_id, team_abbr, position, stat)
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_defprof_lookup ON defensive_profiles(season_id, team_abbr, position, stat)")

def build_profiles(season_id="2025-26"):
    with get_conn() as conn:
        with conn.cursor() as cur:

            # Step 1: join game logs with player positions
            # Use players table for position; fall back to NULL (skip those rows)
            cur.execute(f"""
                SELECT
                    pgl.opponent_abbr  AS def_team,
                    pl.position,
                    pgl.pts, pgl.reb, pgl.ast, pgl.fg3m, pgl.stl, pgl.blk,
                    COUNT(*) OVER (PARTITION BY pgl.opponent_abbr, pl.position) AS sample
                FROM player_game_logs pgl
                JOIN players pl ON LOWER(pl.full_name) = LOWER(pgl.player_name)
                WHERE pgl.season_id   = %s
                  AND pgl.minutes     >= 15
                  AND pl.position     IS NOT NULL
                  AND pl.position     != ''
                  AND pgl.opponent_abbr IS NOT NULL
            """, (season_id,))
            rows = cur.fetchall()
            logger.info(f"Loaded {len(rows)} player-game rows with position data")

            if not rows:
                logger.error("No rows — positions not yet populated. Run injury_engine first.")
                return 0

            # Step 2: compute league avg per position per stat
            from collections import defaultdict
            pos_stat_vals  = defaultdict(list)   # (position, stat) → [values]
            team_pos_stat  = defaultdict(list)   # (def_team, position, stat) → [values]

            for row in rows:
                def_team, pos = row[0], row[1]
                if not pos: continue
                stat_vals = dict(zip(STATS, row[2:8]))
                for stat, val in stat_vals.items():
                    if val is not None:
                        pos_stat_vals[(pos, stat)].append(val)
                        team_pos_stat[(def_team, pos, stat)].append(val)

            # League averages
            league_avg = {}
            for (pos, stat), vals in pos_stat_vals.items():
                league_avg[(pos, stat)] = sum(vals) / len(vals) if vals else None

            # Step 3: compute def_ratio per team × position × stat
            profiles = []
            for (def_team, pos, stat), vals in team_pos_stat.items():
                n = len(vals)
                if n < MIN_SAMPLE:
                    continue
                lg_avg = league_avg.get((pos, stat))
                if not lg_avg or lg_avg == 0:
                    continue

                team_allowed = sum(vals) / n
                raw_ratio    = team_allowed / lg_avg

                # Shrink toward 1.0 for small samples
                weight       = min(1.0, n / SHRINK_N)
                adj_ratio    = 1.0 + (raw_ratio - 1.0) * weight

                profiles.append((season_id, def_team, pos, stat,
                                 round(lg_avg, 3), round(team_allowed, 3),
                                 round(adj_ratio, 4), n))

            logger.info(f"Writing {len(profiles)} defensive profiles")

            # Step 4: upsert
            for p in profiles:
                cur.execute("""
                    INSERT INTO defensive_profiles
                        (season_id, team_abbr, position, stat,
                         league_avg, team_allowed, def_ratio, sample_size)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (season_id, team_abbr, position, stat) DO UPDATE SET
                        league_avg   = EXCLUDED.league_avg,
                        team_allowed = EXCLUDED.team_allowed,
                        def_ratio    = EXCLUDED.def_ratio,
                        sample_size  = EXCLUDED.sample_size,
                        updated_at   = NOW()
                """, p)

            # Quick sanity check
            cur.execute("""
                SELECT team_abbr, position, stat,
                       ROUND(def_ratio::numeric,3) as ratio,
                       sample_size
                FROM defensive_profiles
                WHERE season_id = %s
                ORDER BY def_ratio DESC
                LIMIT 10
            """, (season_id,))
            print("\n=== Top 10 easiest matchups ===")
            for r in cur.fetchall():
                print(f"  vs {r[0]} {r[1]} {r[2]}: ratio={r[3]} (n={r[4]})")

            cur.execute("""
                SELECT team_abbr, position, stat,
                       ROUND(def_ratio::numeric,3) as ratio,
                       sample_size
                FROM defensive_profiles
                WHERE season_id = %s
                ORDER BY def_ratio ASC
                LIMIT 10
            """, (season_id,))
            print("\n=== Top 10 toughest matchups ===")
            for r in cur.fetchall():
                print(f"  vs {r[0]} {r[1]} {r[2]}: ratio={r[3]} (n={r[4]})")

            return len(profiles)

if __name__ == "__main__":
    init_pool()
    ensure_table()
    n = build_profiles()
    logger.info(f"Done: {n} profiles written")
