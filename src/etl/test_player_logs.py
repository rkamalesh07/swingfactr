"""
Verify fetch_player_logs returns correct stats for known players.
Run: python -m src.etl.test_player_logs
"""
import asyncio, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from src.etl.db import init_pool
from src.etl.props_board import fetch_player_logs
import httpx, os

os.environ.setdefault("DATABASE_URL", "")
init_pool()

TESTS = [
    ("Tyrese Maxey", "PHI"),
    ("Chet Holmgren", "OKC"),
    ("Matas Buzelis", "CHI"),
]

async def run():
    async with httpx.AsyncClient(headers={"User-Agent": "Mozilla/5.0"}, timeout=15) as client:
        for name, team in TESTS:
            logs = await fetch_player_logs(client, name, team, n_games=5)
            if not logs:
                print(f"{name} ({team}): NO LOGS FOUND")
                continue
            print(f"\n{name} ({team}) — last {len(logs)} games:")
            for g in logs[:5]:
                print(f"  {g['date']} vs {g['opp']}: PTS={g['pts']} REB={g['reb']} AST={g['ast']} 3PM={g['fg3m']}")

asyncio.run(run())
