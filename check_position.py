"""Check players table for positions and RotoWire pos data."""
import sys; sys.path.insert(0, '.')
from src.etl.db import get_conn, init_pool
import httpx, asyncio, re
from bs4 import BeautifulSoup
init_pool()

with get_conn() as conn:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'players' ORDER BY ordinal_position
        """)
        print("=== players table columns ===")
        for r in cur.fetchall(): print(f"  {r[0]}")

        cur.execute("SELECT * FROM players LIMIT 5")
        print("\n=== players sample ===")
        for r in cur.fetchall(): print(f"  {r}")

        cur.execute("""
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'lineup_players' ORDER BY ordinal_position
        """)
        print("\n=== lineup_players columns ===")
        for r in cur.fetchall(): print(f"  {r[0]}")

        cur.execute("SELECT * FROM lineup_players LIMIT 3")
        print("\n=== lineup_players sample ===")
        for r in cur.fetchall(): print(f"  {r}")

async def check_rw_positions():
    """RotoWire lineup page has pos (PG/SG/SF/PF/C) per player in data-lineup li elements."""
    headers = {"User-Agent": "Mozilla/5.0"}
    async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
        r = await client.get("https://www.rotowire.com/basketball/nba-lineups.php", headers=headers)
    soup = BeautifulSoup(r.text, 'html.parser')

    # Player links with positions — check the actual rendered li items via data
    # Since players are JS rendered, check the raw HTML for pos patterns
    pos_pattern = re.findall(r'"pos"\s*:\s*"([A-Z]+)".*?"name"\s*:\s*"([^"]+)"', r.text)
    print(f"\n=== RotoWire pos patterns in HTML: {len(pos_pattern)} ===")
    for p in pos_pattern[:10]: print(f"  {p}")

    # Also check ESPN roster endpoint for positions
    r2 = await httpx.AsyncClient().get(
        "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/lal/roster"
    )
    data = r2.json()
    print("\n=== ESPN roster athlete fields ===")
    if data.get('athletes'):
        sample = data['athletes'][0]
        print(f"  Keys: {list(sample.keys())}")
        print(f"  position field: {sample.get('position', 'MISSING')}")

asyncio.run(check_rw_positions())
