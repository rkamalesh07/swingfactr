"""
1. Add position column to player_game_logs
2. Populate from ESPN roster data (already fetched in injury engine)
3. Drop and recreate defensive_profiles with correct schema
4. Build profiles from game logs
"""
import sys, asyncio, logging, httpx
sys.path.insert(0, '.')
from src.etl.db import get_conn, init_pool
from collections import defaultdict

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")
logger = logging.getLogger("fix_positions")

HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
ESPN_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{team}/roster"
ESPN_TEAMS = [
    "ATL","BOS","BKN","CHA","CHI","CLE","DAL","DEN","DET","GSW",
    "HOU","IND","LAC","LAL","MEM","MIA","MIL","MIN","NO","NYK",
    "OKC","ORL","PHI","PHX","POR","SAC","SA","TOR","UTAH","WAS",
]

async def fetch_all_positions():
    """Fetch position for every player from ESPN rosters."""
    name_to_pos = {}
    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=15) as client:
        tasks = [client.get(ESPN_URL.format(team=t.lower())) for t in ESPN_TEAMS]
        results = await asyncio.gather(*tasks, return_exceptions=True)
    
    for r in results:
        if isinstance(r, Exception) or r.status_code != 200:
            continue
        for athlete in r.json().get("athletes", []):
            name = athlete.get("displayName", "")
            pos  = athlete.get("position", {})
            abbr = pos.get("abbreviation", "") if isinstance(pos, dict) else ""
            if name and abbr:
                name_to_pos[name] = abbr
    
    logger.info(f"Fetched positions for {len(name_to_pos)} players from ESPN")
    return name_to_pos

def setup_and_populate(name_to_pos):
    with get_conn() as conn:
        with conn.cursor() as cur:
            # 1. Add position column to player_game_logs if not exists
            cur.execute("""
                ALTER TABLE player_game_logs 
                ADD COLUMN IF NOT EXISTS position VARCHAR(5)
            """)
            logger.info("Added position column to player_game_logs")

            # 2. Populate positions
            updated = 0
            for name, pos in name_to_pos.items():
                cur.execute("""
                    UPDATE player_game_logs SET position = %s
                    WHERE player_name = %s AND position IS NULL
                """, (pos, name))
                updated += cur.rowcount
            logger.info(f"Updated {updated} game log rows with positions")

            # 3. Check coverage
            cur.execute("""
                SELECT 
                    COUNT(*) as total,
                    COUNT(position) as with_pos,
                    COUNT(*) - COUNT(position) as missing
                FROM player_game_logs WHERE season_id = '2025-26' AND minutes >= 15
            """)
            r = cur.fetchone()
            logger.info(f"Coverage: {r[1]}/{r[0]} rows have position ({r[2]} missing)")

            # 4. Drop and recreate defensive_profiles with correct schema
            cur.execute("DROP TABLE IF EXISTS defensive_profiles CASCADE")
            cur.execute("""
                CREATE TABLE defensive_profiles (
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
            cur.execute("""
                CREATE INDEX idx_defprof_lookup 
                ON defensive_profiles(season_id, team_abbr, position, stat)
            """)
            logger.info("Recreated defensive_profiles table")

            # 5. Build profiles
            STATS     = ["pts", "reb", "ast", "fg3m", "stl", "blk"]
            MIN_SAMPLE = 20
            SHRINK_N   = 40

            cur.execute(f"""
                SELECT opponent_abbr, position, pts, reb, ast, fg3m, stl, blk
                FROM player_game_logs
                WHERE season_id = '2025-26'
                  AND minutes >= 15
                  AND position IS NOT NULL
                  AND opponent_abbr IS NOT NULL
            """)
            rows = cur.fetchall()
            logger.info(f"Building profiles from {len(rows)} qualified game rows")

            pos_stat_vals = defaultdict(list)
            team_pos_stat = defaultdict(list)

            for def_team, pos, *vals in rows:
                if not pos: continue
                for stat, val in zip(STATS, vals):
                    if val is not None:
                        pos_stat_vals[(pos, stat)].append(val)
                        team_pos_stat[(def_team, pos, stat)].append(val)

            league_avg = {k: sum(v)/len(v) for k, v in pos_stat_vals.items() if v}

            profiles = []
            for (def_team, pos, stat), vals in team_pos_stat.items():
                n = len(vals)
                if n < MIN_SAMPLE: continue
                lg = league_avg.get((pos, stat))
                if not lg or lg == 0: continue

                team_allowed = sum(vals) / n
                raw_ratio    = team_allowed / lg
                weight       = min(1.0, n / SHRINK_N)
                adj_ratio    = 1.0 + (raw_ratio - 1.0) * weight
                profiles.append(("2025-26", def_team, pos, stat,
                                  round(lg, 3), round(team_allowed, 3),
                                  round(adj_ratio, 4), n))

            for p in profiles:
                cur.execute("""
                    INSERT INTO defensive_profiles
                        (season_id, team_abbr, position, stat,
                         league_avg, team_allowed, def_ratio, sample_size)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (season_id, team_abbr, position, stat) DO UPDATE SET
                        league_avg=EXCLUDED.league_avg, team_allowed=EXCLUDED.team_allowed,
                        def_ratio=EXCLUDED.def_ratio, sample_size=EXCLUDED.sample_size,
                        updated_at=NOW()
                """, p)
            logger.info(f"Wrote {len(profiles)} defensive profiles")

            # Sanity check
            cur.execute("""
                SELECT team_abbr, position, stat, ROUND(def_ratio::numeric,3), sample_size
                FROM defensive_profiles WHERE season_id='2025-26'
                ORDER BY def_ratio DESC LIMIT 8
            """)
            print("\n=== Easiest matchups ===")
            for r in cur.fetchall(): print(f"  vs {r[0]} {r[1]} {r[2]}: {r[3]}x (n={r[4]})")

            cur.execute("""
                SELECT team_abbr, position, stat, ROUND(def_ratio::numeric,3), sample_size
                FROM defensive_profiles WHERE season_id='2025-26'
                ORDER BY def_ratio ASC LIMIT 8
            """)
            print("\n=== Toughest matchups ===")
            for r in cur.fetchall(): print(f"  vs {r[0]} {r[1]} {r[2]}: {r[3]}x (n={r[4]})")

async def main():
    init_pool()
    name_to_pos = await fetch_all_positions()
    setup_and_populate(name_to_pos)

asyncio.run(main())
