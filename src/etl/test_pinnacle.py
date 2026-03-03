"""
Quick test script to check what Pinnacle returns for NBA props.
Run this locally BEFORE integrating into props_board.py.

Usage:
  python -m src.etl.test_pinnacle
"""
import asyncio
import httpx
import json

PINNACLE_BASE = "https://guest.api.pinnacle.com"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "application/json",
    "Referer": "https://www.pinnacle.com/",
}

async def run():
    async with httpx.AsyncClient(headers=HEADERS, timeout=15) as client:

        # Step 1: find NBA league ID
        print("=== Fetching NBA leagues ===")
        r = await client.get(f"{PINNACLE_BASE}/v2/leagues", params={"sportId": 4})
        print(f"Status: {r.status_code}")
        if r.status_code == 200:
            leagues = r.json()
            # Look for NBA
            nba = [l for l in leagues.get("leagues", leagues if isinstance(leagues, list) else [])
                   if "NBA" in str(l.get("name", "")).upper() or "basketball" in str(l.get("name","")).lower()]
            print(f"NBA-related leagues: {json.dumps(nba[:3], indent=2)}")
        else:
            print(f"Response: {r.text[:300]}")

        # Step 2: try known NBA league ID (487 is commonly cited)
        print("\n=== Fetching fixtures for league 487 ===")
        r2 = await client.get(f"{PINNACLE_BASE}/v1/fixtures", params={"sportId": 4, "leagueIds": 487})
        print(f"Status: {r2.status_code}")
        if r2.status_code == 200:
            data = r2.json()
            fixtures = data.get("league", [{}])[0].get("events", []) if isinstance(data.get("league"), list) else []
            print(f"Fixtures found: {len(fixtures)}")
            if fixtures:
                print(f"First fixture: {json.dumps(fixtures[0], indent=2)[:400]}")
        else:
            print(f"Response: {r2.text[:300]}")

        # Step 3: check if props endpoint exists
        print("\n=== Checking props/specials endpoint ===")
        r3 = await client.get(f"{PINNACLE_BASE}/v1/fixtures/special", params={"sportId": 4, "leagueIds": 487})
        print(f"Status: {r3.status_code}")
        print(f"Response: {r3.text[:500]}")

        # Step 4: try matchups with player props
        print("\n=== Checking matchups ===")
        r4 = await client.get(f"{PINNACLE_BASE}/v1/odds", params={"sportId": 4, "leagueIds": 487, "oddsFormat": "American"})
        print(f"Status: {r4.status_code}")
        if r4.status_code == 200:
            data = r4.json()
            print(f"Keys: {list(data.keys())}")
            print(f"Sample: {json.dumps(data, indent=2)[:600]}")
        else:
            print(f"Response: {r4.text[:300]}")

asyncio.run(run())
