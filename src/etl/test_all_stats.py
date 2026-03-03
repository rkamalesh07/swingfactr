"""
Verify ALL stats are correct for known players.
Run: python -m src.etl.test_all_stats
"""
import asyncio, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from src.etl.db import init_pool
from src.etl.props_board import fetch_player_logs

init_pool()

# Players with known recent stats to cross-check
TESTS = [
    ("Tyrese Maxey", "PHI"),
    ("Chet Holmgren", "OKC"),
    ("Matas Buzelis", "CHI"),
    ("Nikola Jokic", "DEN"),   # known for big AST/REB/STL
    ("Kawhi Leonard", "LAC"),  # known for STL
]

import httpx

async def run():
    async with httpx.AsyncClient(headers={"User-Agent": "Mozilla/5.0"}, timeout=15) as client:
        for name, team in TESTS:
            logs = await fetch_player_logs(client, name, team, n_games=3)
            if not logs:
                print(f"\n{name} ({team}): NO LOGS FOUND")
                continue
            print(f"\n{name} ({team}):")
            print(f"  {'DATE':<12} {'OPP':<5} {'MIN':<5} {'PTS':<5} {'REB':<5} {'AST':<5} {'3PM':<5} {'STL':<5} {'BLK':<5}")
            for g in logs:
                print(f"  {g['date']:<12} {g['opp']:<5} {g['min']:<5} {g['pts']:<5} {g['reb']:<5} {g['ast']:<5} {g['fg3m']:<5} {g['stl']:<5} {g['blk']:<5}")

asyncio.run(run())
