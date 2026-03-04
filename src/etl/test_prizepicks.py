"""
Test PrizePicks undocumented API.
Run: python -m src.etl.test_prizepicks
"""
import asyncio
import httpx

PP_URL = "https://api.prizepicks.com/projections"

async def run():
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/json",
        "Referer": "https://app.prizepicks.com/",
        "Origin": "https://app.prizepicks.com",
    }
    params = {
        "league_id": 7,       # NBA
        "per_page": 250,
        "single_stat": "true",
    }

    async with httpx.AsyncClient(headers=headers, timeout=15, follow_redirects=True) as client:
        print("Hitting PrizePicks API...")
        r = await client.get(PP_URL, params=params)
        print(f"Status: {r.status_code}")
        print(f"Content-Type: {r.headers.get('content-type', '?')}")

        if r.status_code != 200:
            print(f"Response: {r.text[:500]}")
            return

        data = r.json()
        projections = data.get("data", [])
        included = {i["id"]: i for i in data.get("included", [])}

        print(f"\nTotal projections: {len(projections)}")
        print("\nFirst 10 props:")
        count = 0
        for proj in projections:
            attrs = proj.get("attributes", {})
            stat = attrs.get("stat_type", "")
            line = attrs.get("line_score", "")
            
            # Player name is in included
            player_id = proj.get("relationships", {}).get("new_player", {}).get("data", {}).get("id")
            player = included.get(player_id, {})
            player_name = player.get("attributes", {}).get("display_name", "?")
            team = player.get("attributes", {}).get("team", "?")

            print(f"  {player_name} ({team}) | {stat} | line={line}")
            count += 1
            if count >= 10:
                break

        # Show unique stat types
        stats = set(p.get("attributes", {}).get("stat_type", "") for p in projections)
        print(f"\nStat types available: {sorted(stats)}")

asyncio.run(run())
