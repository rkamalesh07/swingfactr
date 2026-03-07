"""Check opponent data and find position source."""
import sys; sys.path.insert(0, '.')
from src.etl.db import get_conn, init_pool
init_pool()

with get_conn() as conn:
    with conn.cursor() as cur:
        # Sample actual data
        cur.execute("""
            SELECT player_name, team_abbr, opponent_abbr, pts, reb, ast, minutes
            FROM player_game_logs
            WHERE season_id = '2025-26' AND minutes >= 20
            LIMIT 5
        """)
        print("=== Sample rows ===")
        for r in cur.fetchall(): print(f"  {r}")

        # Check other tables for position data
        cur.execute("""
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' ORDER BY table_name
        """)
        print("\n=== All tables ===")
        for r in cur.fetchall(): print(f"  {r[0]}")

        # Check if player_availability has position from RotoWire
        cur.execute("""
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'player_availability'
        """)
        print("\n=== player_availability columns ===")
        for r in cur.fetchall(): print(f"  {r[0]}")

        # Can we build positional defense without position column?
        # Check: does each player consistently play one position across games?
        # Use PrizePicks position if available in prop_board
        cur.execute("""
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'prop_board'
        """)
        print("\n=== prop_board columns ===")
        for r in cur.fetchall(): print(f"  {r[0]}")
