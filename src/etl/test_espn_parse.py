"""
Verify the fixed parser reads correct stats for Chet.
Run: python -m src.etl.test_espn_parse
"""
import asyncio, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
import httpx

ESPN_SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary"
HEADERS = {"User-Agent": "Mozilla/5.0"}

async def run():
    async with httpx.AsyncClient(headers=HEADERS, timeout=15) as client:
        r = await client.get("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/25/schedule?season=2026")
        recent_games = []
        for event in reversed(r.json().get("events", [])):
            if event.get("competitions", [{}])[0].get("status", {}).get("type", {}).get("completed"):
                recent_games.append(event["id"])
            if len(recent_games) >= 3:
                break

        print(f"Testing last {len(recent_games)} OKC games\n")
        for game_id in recent_games:
            r2 = await client.get(ESPN_SUMMARY, params={"event": game_id})
            data = r2.json()
            for team_box in data.get("boxscore", {}).get("players", []):
                for stat_group in team_box.get("statistics", []):
                    labels = stat_group.get("labels", [])
                    for athlete in stat_group.get("athletes", []):
                        name = athlete.get("athlete", {}).get("displayName", "")
                        if "Holmgren" not in name:
                            continue
                        stats = athlete.get("stats", [])
                        if not stats or stats[0] == "DNP":
                            continue
                        def get_stat(label):
                            if label in labels:
                                idx = labels.index(label)
                                val = stats[idx] if idx < len(stats) else None
                                if val is None or val == "": return 0
                                if "-" in str(val) and label in ("FG","3PT","FT"):
                                    return int(str(val).split("-")[0])
                                try: return float(val)
                                except: return 0
                            return 0
                        print(f"Game {game_id}: MIN={get_stat('MIN')} PTS={int(get_stat('PTS'))} REB={int(get_stat('REB'))} AST={int(get_stat('AST'))} 3PM={int(get_stat('3PT'))} STL={int(get_stat('STL'))} BLK={int(get_stat('BLK'))}")

asyncio.run(run())
