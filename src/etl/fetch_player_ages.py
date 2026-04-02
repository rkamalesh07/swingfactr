"""
fetch_player_ages.py — Pull player ages from ESPN roster API for all 30 teams.
Stores age (and birth date) in the players table.

Run once to backfill, then add to GitHub Actions workflow.
Usage: python -m src.etl.fetch_player_ages
"""
import sys, asyncio, logging
sys.path.insert(0, '.')
import httpx
from src.etl.db import get_conn, init_pool

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")
logger = logging.getLogger("fetch_ages")

# ESPN team IDs for all 30 NBA teams
ESPN_TEAM_IDS = [
    1,2,3,4,5,6,7,8,9,10,
    11,12,13,14,15,16,17,18,19,20,
    21,22,23,24,25,26,27,28,29,30
]

HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}

async def fetch_team_roster(client: httpx.AsyncClient, team_id: int) -> list:
    """Fetch roster for one team, return list of {full_name, age, date_of_birth}."""
    url = f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{team_id}/roster"
    try:
        r = await client.get(url, timeout=10)
        data = r.json()
        players = []
        for p in data.get("athletes", []):
            full_name = p.get("fullName", "").strip()
            age = p.get("age")
            dob = p.get("dateOfBirth", "")[:10] if p.get("dateOfBirth") else None
            if full_name and age:
                players.append({
                    "full_name": full_name,
                    "age":       int(age),
                    "dob":       dob,
                    "espn_id":   str(p.get("id", "")),
                })
        return players
    except Exception as e:
        logger.warning(f"Team {team_id} failed: {e}")
        return []

async def run():
    init_pool()

    # Add columns if they don't exist
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                ALTER TABLE players
                ADD COLUMN IF NOT EXISTS age INT,
                ADD COLUMN IF NOT EXISTS date_of_birth DATE,
                ADD COLUMN IF NOT EXISTS espn_id_str VARCHAR(20)
            """)
        conn.commit()
    logger.info("Columns ensured")

    # Fetch all rosters
    all_players = []
    async with httpx.AsyncClient(headers=HEADERS) as client:
        for team_id in ESPN_TEAM_IDS:
            players = await fetch_team_roster(client, team_id)
            all_players.extend(players)
            logger.info(f"Team {team_id}: {len(players)} players")
            await asyncio.sleep(0.3)

    logger.info(f"Total players fetched: {len(all_players)}")

    # Update players table by matching on full_name (case-insensitive)
    updated = 0
    not_found = []
    with get_conn() as conn:
        with conn.cursor() as cur:
            for p in all_players:
                cur.execute("""
                    UPDATE players
                    SET age = %s,
                        date_of_birth = %s,
                        full_name = %s,
                        espn_id_str = %s
                    WHERE LOWER(first_name || ' ' || last_name) = LOWER(%s)
                """, (p["age"], p["dob"], p["full_name"], p["espn_id"], p["full_name"]))
                if cur.rowcount > 0:
                    updated += 1
                else:
                    not_found.append(p["full_name"])
        conn.commit()

    logger.info(f"Updated {updated} players")
    if not_found[:10]:
        logger.info(f"Not matched (first 10): {not_found[:10]}")

    # Also store ages in a simple lookup table for insights queries
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS player_ages (
                    full_name      VARCHAR(100) PRIMARY KEY,
                    age            INT,
                    date_of_birth  DATE,
                    updated_at     TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            for p in all_players:
                cur.execute("""
                    INSERT INTO player_ages (full_name, age, date_of_birth)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (full_name) DO UPDATE
                    SET age = EXCLUDED.age,
                        date_of_birth = EXCLUDED.date_of_birth,
                        updated_at = NOW()
                """, (p["full_name"], p["age"], p["dob"]))
        conn.commit()

    logger.info("player_ages table updated")

    # Show sample
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT full_name, age FROM player_ages ORDER BY age LIMIT 10")
            rows = cur.fetchall()
            logger.info(f"Youngest players: {rows}")
            cur.execute("SELECT COUNT(*) FROM player_ages")
            logger.info(f"Total in player_ages: {cur.fetchone()[0]}")

if __name__ == "__main__":
    asyncio.run(run())
