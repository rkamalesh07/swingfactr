"""Check if v12 model_details are in DB and how many player_game_logs we have."""
import sys
sys.path.insert(0, '.')
from src.etl.db import get_conn, init_pool
import json

init_pool()
ctx = get_conn(); conn = ctx.__enter__(); cur = conn.cursor()

# 1. How many player_game_logs?
cur.execute("SELECT COUNT(*), COUNT(DISTINCT player_name), MIN(game_date), MAX(game_date) FROM player_game_logs")
row = cur.fetchone()
print(f"player_game_logs: {row[0]} rows, {row[1]} players, {row[2]} to {row[3]}")

# 2. Sample names in player_game_logs
cur.execute("SELECT DISTINCT player_name FROM player_game_logs ORDER BY player_name LIMIT 20")
print("Sample ESPN names:", [r[0] for r in cur.fetchall()])

# 3. Sample names from prop_board (today)
cur.execute("SELECT DISTINCT player_name FROM prop_board WHERE game_date = CURRENT_DATE LIMIT 20")
print("Sample PP names:", [r[0] for r in cur.fetchall()])

# 4. Check if model_details got written
cur.execute("SELECT player_name, stat, composite_score, model_details FROM prop_board WHERE game_date = CURRENT_DATE AND model_details IS NOT NULL LIMIT 5")
rows = cur.fetchall()
print(f"\nProps WITH model_details: {len(rows)}")
for r in rows:
    print(f"  {r[0]} {r[1]}: score={r[2]}, details={r[3]}")

cur.execute("SELECT COUNT(*) FROM prop_board WHERE game_date = CURRENT_DATE AND model_details IS NULL")
print(f"Props WITHOUT model_details: {cur.fetchone()[0]}")

# 5. Check composite_score range today
cur.execute("""SELECT MIN(composite_score), MAX(composite_score), AVG(composite_score)
               FROM prop_board WHERE game_date = CURRENT_DATE""")
row = cur.fetchone()
print(f"\nScore range today: min={row[0]:.1f} max={row[1]:.1f} avg={row[2]:.1f}")

# 6. Name match test — does 'Devin Booker' exist in player_game_logs?
for name in ['Devin Booker', 'LeBron James', 'Stephen Curry', 'Nikola Jokic']:
    cur.execute("SELECT COUNT(*) FROM player_game_logs WHERE player_name = %s", (name,))
    count = cur.fetchone()[0]
    print(f"  '{name}' in player_game_logs: {count} games")

ctx.__exit__(None,None,None)
