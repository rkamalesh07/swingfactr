import sys; sys.path.insert(0, '.')
from src.etl.db import get_conn, init_pool
init_pool()

with get_conn() as conn:
    with conn.cursor() as cur:
        # Check existing defensive_profiles schema
        cur.execute("""
            SELECT column_name, data_type FROM information_schema.columns
            WHERE table_name = 'defensive_profiles' ORDER BY ordinal_position
        """)
        print("=== defensive_profiles columns ===")
        for r in cur.fetchall(): print(f"  {r[0]}: {r[1]}")

        # Check players table name format
        cur.execute("SELECT full_name FROM players LIMIT 10")
        print("\n=== players.full_name sample ===")
        for r in cur.fetchall(): print(f"  '{r[0]}'")

        # Check how player_game_logs stores names
        cur.execute("SELECT DISTINCT player_name FROM player_game_logs WHERE season_id='2025-26' LIMIT 10")
        print("\n=== player_game_logs.player_name sample ===")
        for r in cur.fetchall(): print(f"  '{r[0]}'")
