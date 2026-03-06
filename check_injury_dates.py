"""Show all OUT players with their injury dates to see what's actually recent."""
import sys
sys.path.insert(0, '.')
from src.etl.db import get_conn, init_pool
from datetime import date, timedelta

init_pool()

with get_conn() as conn:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT player_name, team_abbr, status, injury_since
            FROM player_availability
            WHERE fetch_date = CURRENT_DATE
              AND status IN ('Out', 'GTD')
            ORDER BY injury_since DESC NULLS LAST
        """)
        rows = cur.fetchall()

cutoff_10 = date.today() - timedelta(days=10)
cutoff_30 = date.today() - timedelta(days=30)

print(f"Today: {date.today()}")
print(f"10-day cutoff: {cutoff_10}")
print(f"30-day cutoff: {cutoff_30}")
print()

print("=== RECENT (last 10 days) ===")
for name, team, status, since in rows:
    if since and since >= cutoff_10:
        print(f"  {name} ({team}) {status} since {since}")

print("\n=== 10-30 days ago ===")
for name, team, status, since in rows:
    if since and cutoff_30 <= since < cutoff_10:
        print(f"  {name} ({team}) {status} since {since}")

print("\n=== Older than 30 days / unknown ===")
for name, team, status, since in rows:
    if not since or since < cutoff_30:
        print(f"  {name} ({team}) {status} since {since}")
