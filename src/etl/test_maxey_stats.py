"""
Check exactly what ESPN returns for Maxey's stats.
Run: python -m src.etl.test_maxey_stats
"""
import asyncio, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
import httpx

ESPN_SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary"
HEADERS = {"User-Agent": "Mozilla/5.0"}

async def run():
    async with httpx.AsyncClient(headers=HEADERS, timeout=15) as client:
        # Get recent PHI games
        r = await client.get("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/20/schedule?season=2026")
        games = []
        for event in reversed(r.json().get("events", [])):
            if event.get("competitions", [{}])[0].get("status", {}).get("type", {}).get("completed"):
                games.append(event["id"])
            if len(games) >= 3:
                break

        for game_id in games[:2]:
            print(f"\n=== Game {game_id} ===")
            r2 = await client.get(ESPN_SUMMARY, params={"event": game_id})
            data = r2.json()
            for team_box in data.get("boxscore", {}).get("players", []):
                abbr = team_box.get("team", {}).get("abbreviation", "")
                if abbr != "PHI":
                    continue
                for stat_group in team_box.get("statistics", []):
                    labels = stat_group.get("labels", [])
                    print(f"Labels: {labels}")
                    for athlete in stat_group.get("athletes", []):
                        name = athlete.get("athlete", {}).get("displayName", "")
                        if "Maxey" not in name:
                            continue
                        stats = athlete.get("stats", [])
                        print(f"\n{name}: {stats}")
                        for i, (l, v) in enumerate(zip(labels, stats)):
                            print(f"  [{i}] {l} = {v}")

asyncio.run(run())
