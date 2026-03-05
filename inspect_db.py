"""
Run this locally to inspect what data is available for the new model.
python inspect_db.py
"""
import sys
sys.path.insert(0, '.')
from src.etl.db import get_conn, init_pool
import json

init_pool()
_conn_ctx = get_conn()
conn = _conn_ctx.__enter__()
cur  = conn.cursor()

print("=" * 60)
print("DB INSPECTION FOR NEW STAT MODEL")
print("=" * 60)

# 1. All tables
cur.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
print("\nTABLES:", [r[0] for r in cur.fetchall()])

# 2. Games table
cur.execute("""SELECT column_name, data_type 
               FROM information_schema.columns 
               WHERE table_name='games' ORDER BY ordinal_position""")
print("\nGAMES COLUMNS:")
for r in cur.fetchall(): print(f"  {r[0]}: {r[1]}")

cur.execute("SELECT COUNT(*), MIN(game_date), MAX(game_date) FROM games WHERE season_id='2025-26'")
print("\nGAMES 2025-26:", cur.fetchone())

cur.execute("SELECT * FROM games WHERE season_id='2025-26' AND home_score IS NOT NULL LIMIT 1")
cols = [d[0] for d in cur.description]
row  = cur.fetchone()
if row: print("\nSAMPLE GAME:", json.dumps(dict(zip(cols, [str(v) for v in row])), indent=2))

# 3. Teams table
cur.execute("""SELECT column_name FROM information_schema.columns 
               WHERE table_name='teams' ORDER BY ordinal_position""")
print("\nTEAMS COLUMNS:", [r[0] for r in cur.fetchall()])

# 4. prop_board columns
cur.execute("""SELECT column_name, data_type FROM information_schema.columns 
               WHERE table_name='prop_board' ORDER BY ordinal_position""")
print("\nPROP_BOARD COLUMNS:")
for r in cur.fetchall(): print(f"  {r[0]}: {r[1]}")

# 5. prop_results columns  
cur.execute("""SELECT column_name, data_type FROM information_schema.columns 
               WHERE table_name='prop_results' ORDER BY ordinal_position""")
print("\nPROP_RESULTS COLUMNS:")
for r in cur.fetchall(): print(f"  {r[0]}: {r[1]}")

# 6. Check if we have any player-level tables
cur.execute("""SELECT tablename FROM pg_tables 
               WHERE schemaname='public' 
               AND tablename LIKE '%player%'""")
print("\nPLAYER TABLES:", [r[0] for r in cur.fetchall()])

# 7. Check a sample ESPN summary to understand what box score data we pull
# (We fetch this dynamically but check if anything is cached)
cur.execute("""SELECT tablename FROM pg_tables 
               WHERE schemaname='public' 
               AND tablename IN ('player_logs','box_scores','player_stats')""")
print("CACHED BOX SCORE TABLES:", [r[0] for r in cur.fetchall()])

# 8. Check games table for pace/spread columns
cur.execute("""SELECT column_name FROM information_schema.columns 
               WHERE table_name='games'""")
game_cols = [r[0] for r in cur.fetchall()]
pace_cols  = [c for c in game_cols if any(k in c.lower() for k in ['pace','spread','total','odds','possession'])]
print("\nGAME PACE/SPREAD COLUMNS:", pace_cols)

# 9. Sample prop_results to see what composite_score range looks like
cur.execute("""SELECT 
    stat,
    COUNT(*) as n,
    ROUND(AVG(composite_score)::numeric,1) as avg_score,
    ROUND(MIN(composite_score)::numeric,1) as min_score,
    ROUND(MAX(composite_score)::numeric,1) as max_score,
    ROUND(AVG(CASE WHEN correct THEN 1.0 ELSE 0 END)::numeric,3) as accuracy
FROM prop_results
WHERE composite_score IS NOT NULL AND correct IS NOT NULL
GROUP BY stat ORDER BY accuracy DESC""")
print("\nPROP RESULTS BY STAT (score range + accuracy):")
for r in cur.fetchall():
    print(f"  {r[0]}: n={r[1]} avg={r[2]} range=[{r[3]},{r[4]}] accuracy={r[5]}")

# 10. Check if home_b2b / rest columns exist in games
for col in ['home_b2b','away_b2b','home_rest_days','away_rest_days','spread','over_under']:
    cur.execute(f"SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='games' AND column_name='{col}')")
    exists = cur.fetchone()[0]
    print(f"  games.{col}: {'EXISTS' if exists else 'MISSING'}")

_conn_ctx.__exit__(None,None,None)
print("\nDone.")
