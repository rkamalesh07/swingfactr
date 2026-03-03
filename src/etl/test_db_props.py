"""
Check what's actually stored in prop_board for a specific player.
Run: python -m src.etl.test_db_props
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from src.etl.db import get_conn, init_pool
import os, json

init_pool()

with get_conn() as conn:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT player_name, stat, line, avg_season, avg_last5, avg_last10,
                   hit_rate_last5, hit_rate_last10, composite_score, game_log
            FROM prop_board
            WHERE game_date = CURRENT_DATE - 1
               OR game_date = CURRENT_DATE
            AND player_name ILIKE '%maxey%'
            ORDER BY game_date DESC, stat
        """)
        rows = cur.fetchall()
        if not rows:
            print("No Maxey rows found — trying all recent rows")
            cur.execute("""
                SELECT player_name, stat, line, avg_season, avg_last5, avg_last10,
                       hit_rate_last5, hit_rate_last10, composite_score, game_log
                FROM prop_board
                ORDER BY computed_at DESC LIMIT 20
            """)
            rows = cur.fetchall()

        for row in rows:
            name, stat, line, avg_s, avg5, avg10, hr5, hr10, score, game_log = row
            print(f"\n{name} | {stat} | line={line}")
            print(f"  avg_season={avg_s} avg_last5={avg5} avg_last10={avg10}")
            print(f"  hit_rate_last5={hr5} hit_rate_last10={hr10} score={score}")
            if game_log:
                logs = json.loads(game_log) if isinstance(game_log, str) else game_log
                print(f"  last 5 games: {[(g['val']) for g in logs[:5]]}")
