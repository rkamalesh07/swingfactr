"""
Deep inspection of player/lineup/stints tables for new model.
"""
import sys
sys.path.insert(0, '.')
from src.etl.db import get_conn, init_pool
import json

init_pool()
ctx  = get_conn()
conn = ctx.__enter__()
cur  = conn.cursor()

print("=" * 60)
print("DEEP INSPECTION — PLAYERS + LINEUPS + STINTS")
print("=" * 60)

# 1. Players table
cur.execute("""SELECT column_name, data_type FROM information_schema.columns 
               WHERE table_name='players' ORDER BY ordinal_position""")
print("\nPLAYERS COLUMNS:")
for r in cur.fetchall(): print(f"  {r[0]}: {r[1]}")

cur.execute("SELECT COUNT(*) FROM players")
print(f"PLAYERS COUNT: {cur.fetchone()[0]}")

cur.execute("SELECT * FROM players LIMIT 3")
cols = [d[0] for d in cur.description]
for row in cur.fetchall():
    print("SAMPLE PLAYER:", json.dumps(dict(zip(cols, [str(v) for v in row])), indent=2))

# 2. Stints table — this likely has per-game player stats
cur.execute("""SELECT column_name, data_type FROM information_schema.columns 
               WHERE table_name='stints' ORDER BY ordinal_position""")
print("\nSTINTS COLUMNS:")
for r in cur.fetchall(): print(f"  {r[0]}: {r[1]}")

cur.execute("SELECT COUNT(*) FROM stints")
print(f"STINTS COUNT: {cur.fetchone()[0]}")

cur.execute("SELECT * FROM stints LIMIT 2")
cols = [d[0] for d in cur.description]
for row in cur.fetchall():
    print("SAMPLE STINT:", json.dumps(dict(zip(cols, [str(v) for v in row])), indent=2))

# 3. Lineup_stats table
cur.execute("""SELECT column_name, data_type FROM information_schema.columns 
               WHERE table_name='lineup_stats' ORDER BY ordinal_position""")
print("\nLINEUP_STATS COLUMNS:")
for r in cur.fetchall(): print(f"  {r[0]}: {r[1]}")

cur.execute("SELECT COUNT(*) FROM lineup_stats")
print(f"LINEUP_STATS COUNT: {cur.fetchone()[0]}")

cur.execute("SELECT * FROM lineup_stats LIMIT 2")
cols = [d[0] for d in cur.description]
for row in cur.fetchall():
    print("SAMPLE LINEUP_STAT:", json.dumps(dict(zip(cols, [str(v) for v in row])), indent=2))

# 4. Lineup_players
cur.execute("""SELECT column_name, data_type FROM information_schema.columns 
               WHERE table_name='lineup_players' ORDER BY ordinal_position""")
print("\nLINEUP_PLAYERS COLUMNS:")
for r in cur.fetchall(): print(f"  {r[0]}: {r[1]}")

cur.execute("SELECT COUNT(*) FROM lineup_players")
print(f"LINEUP_PLAYERS COUNT: {cur.fetchone()[0]}")

cur.execute("SELECT * FROM lineup_players LIMIT 2")
cols = [d[0] for d in cur.description]
for row in cur.fetchall():
    print("SAMPLE:", json.dumps(dict(zip(cols, [str(v) for v in row])), indent=2))

# 5. Defensive profiles
cur.execute("""SELECT column_name, data_type FROM information_schema.columns 
               WHERE table_name='defensive_profiles' ORDER BY ordinal_position""")
print("\nDEFENSIVE_PROFILES COLUMNS:")
for r in cur.fetchall(): print(f"  {r[0]}: {r[1]}")

cur.execute("SELECT COUNT(*) FROM defensive_profiles")
print(f"DEFENSIVE_PROFILES COUNT: {cur.fetchone()[0]}")

cur.execute("SELECT * FROM defensive_profiles LIMIT 2")
cols = [d[0] for d in cur.description]
for row in cur.fetchall():
    print("SAMPLE:", json.dumps(dict(zip(cols, [str(v) for v in row])), indent=2))

# 6. Clutch segments
cur.execute("""SELECT column_name, data_type FROM information_schema.columns 
               WHERE table_name='clutch_segments' ORDER BY ordinal_position""")
print("\nCLUTCH_SEGMENTS COLUMNS:")
for r in cur.fetchall(): print(f"  {r[0]}: {r[1]}")

# 7. Try to find a real player and trace their data
print("\n--- PLAYER MAPPING TEST ---")
# Pick a known player from prop_results
cur.execute("SELECT DISTINCT player_name FROM prop_results LIMIT 5")
names = [r[0] for r in cur.fetchall()]
print(f"Sample prop players: {names}")

# Try to find them in players table
for name in names[:2]:
    parts = name.lower().split()
    cur.execute("SELECT * FROM players WHERE LOWER(display_name) LIKE %s OR LOWER(full_name) LIKE %s LIMIT 3",
                (f"%{parts[-1]}%", f"%{parts[-1]}%"))
    rows = cur.fetchall()
    cols = [d[0] for d in cur.description]
    print(f"\n'{name}' in players table:")
    for r in rows:
        print(" ", dict(zip(cols, [str(v) for v in r])))

# 8. Check stints for a known player_id if we found one
cur.execute("SELECT player_id, display_name FROM players LIMIT 5")
print("\nFIRST 5 PLAYERS:", cur.fetchall())

# Check stints has what we need
cur.execute("""
    SELECT s.*, p.display_name 
    FROM stints s 
    JOIN players p ON p.player_id = s.player_id
    LIMIT 3
""")
cols = [d[0] for d in cur.description]
for row in cur.fetchall():
    print("STINT+PLAYER:", json.dumps(dict(zip(cols, [str(v) for v in row])), indent=2))

ctx.__exit__(None, None, None)
print("\nDone.")
