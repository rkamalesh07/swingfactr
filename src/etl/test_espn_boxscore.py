"""
Diagnose ESPN box score stat array positions.
Run: python -m src.etl.test_espn_boxscore
"""
import asyncio
import httpx

ESPN_SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary"
HEADERS = {"User-Agent": "Mozilla/5.0"}

async def run():
    # Use a recent OKC game to check Chet's stats
    async with httpx.AsyncClient(headers=HEADERS, timeout=15) as client:
        # Find a recent OKC game
        r = await client.get("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/25/schedule?season=2026")
        games = r.json()
        recent_game_id = None
        for event in reversed(games.get("events", [])):
            if event.get("competitions", [{}])[0].get("status", {}).get("type", {}).get("completed"):
                recent_game_id = event["id"]
                break

        if not recent_game_id:
            print("No completed OKC game found")
            return

        print(f"Fetching game {recent_game_id}")
        r2 = await client.get(ESPN_SUMMARY, params={"event": recent_game_id})
        data = r2.json()

        for team_box in data.get("boxscore", {}).get("players", []):
            team_abbr = team_box.get("team", {}).get("abbreviation", "")
            for stat_group in team_box.get("statistics", []):
                # Print the stat column headers
                labels = stat_group.get("labels", [])
                print(f"\nTeam: {team_abbr}")
                print(f"Labels ({len(labels)}): {labels}")
                
                # Find Chet specifically
                for athlete in stat_group.get("athletes", []):
                    name = athlete.get("athlete", {}).get("displayName", "")
                    if "Holmgren" in name or "Chet" in name:
                        stats = athlete.get("stats", [])
                        print(f"\n{name} raw stats array:")
                        for i, v in enumerate(stats):
                            label = labels[i] if i < len(labels) else f"[{i}]"
                            print(f"  [{i}] {label}: {v}")

asyncio.run(run())
