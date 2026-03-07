"""Check what data we have to build positional opponent defense profiles."""
import sys; sys.path.insert(0, '.')
from src.etl.db import get_conn, init_pool
init_pool()

with get_conn() as conn:
    with conn.cursor() as cur:
        # Check columns in player_game_logs
        cur.execute("""
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'player_game_logs'
            ORDER BY ordinal_position
        """)
        cols = cur.fetchall()
        print("=== player_game_logs columns ===")
        for c in cols:
            print(f"  {c[0]}: {c[1]}")

        # Check if we have opponent and position data
        cur.execute("""
            SELECT player_name, team_abbr, opp_abbr, position, pts, reb, ast, minutes
            FROM player_game_logs
            WHERE season_id = '2025-26'
            LIMIT 5
        """)
        print("\n=== Sample rows ===")
        for r in cur.fetchall():
            print(f"  {r}")

        # Check position distribution
        cur.execute("""
            SELECT position, COUNT(DISTINCT player_name) as players, COUNT(*) as games
            FROM player_game_logs
            WHERE season_id = '2025-26' AND position IS NOT NULL
            GROUP BY position ORDER BY games DESC
        """)
        print("\n=== Position distribution ===")
        for r in cur.fetchall():
            print(f"  {r[0]}: {r[1]} players, {r[2]} games")
