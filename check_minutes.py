"""Check minutes distribution for OUT players to calibrate threshold."""
import sys; sys.path.insert(0, '.')
from src.etl.db import get_conn, init_pool
init_pool()

with get_conn() as conn:
    with conn.cursor() as cur:
        # For each player currently getting a boost, check the OUT teammate's avg minutes
        cur.execute("""
            SELECT 
                p.player_name,
                p.team_abbr,
                ROUND(AVG(p.minutes)::numeric, 1) as avg_min,
                COUNT(*) as games,
                ROUND(AVG(p.fga + 0.44*p.fta + p.tov)::numeric, 2) as avg_possessions
            FROM player_game_logs p
            WHERE season_id = '2025-26'
              AND player_name IN (
                'Jabari Smith Jr.', 'Spencer Jones', 'Dru Smith', 
                'Andrew Wiggins', 'Tidjane Salaun', 'Norman Powell',
                'Simone Fontecchio', 'Nikola Jovic'
              )
              AND minutes >= 1
            GROUP BY p.player_name, p.team_abbr
            ORDER BY avg_min DESC
        """)
        print("=== OUT players: avg minutes this season ===")
        for r in cur.fetchall():
            print(f"  {r[0]} ({r[1]}): {r[2]} mpg over {r[3]} games, {r[4]} poss/g")

        # Also check what games_missed looks like for Spencer Jones
        cur.execute("""
            SELECT MAX(game_date) FROM player_game_logs
            WHERE player_name = 'Spencer Jones' AND season_id = '2025-26'
        """)
        print(f"\nSpencer Jones last game: {cur.fetchone()[0]}")
        
        cur.execute("""
            SELECT COUNT(DISTINCT game_id) FROM player_game_logs
            WHERE team_abbr = 'DEN' AND game_date > (
                SELECT MAX(game_date) FROM player_game_logs
                WHERE player_name = 'Spencer Jones' AND season_id = '2025-26'
            ) AND season_id = '2025-26'
        """)
        print(f"DEN games since Spencer Jones last played: {cur.fetchone()[0]}")
