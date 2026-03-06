"""Fully resolve ESPN v3 injuries — follow $ref links to get player names."""
import httpx, asyncio, json

async def check():
    async with httpx.AsyncClient(timeout=10) as client:
        
        # Get all injuries with higher limit
        r = await client.get(
            "https://sports.core.api.espn.com/v3/sports/basketball/nba/injuries?limit=200"
        )
        data = r.json()
        items = data.get("items", [])
        print(f"Total injuries: {len(items)}")
        print(f"Page info: count={data.get('count')} pageSize={data.get('pageSize')}")
        
        # Print first 5 full items to see all fields
        print("\nFull items (first 3):")
        for item in items[:3]:
            print(json.dumps(item, indent=2))
            print("---")
        
        # Check if there's an athlete/$ref field
        print("\nAll keys across all items:")
        all_keys = set()
        for item in items:
            all_keys.update(item.keys())
        print(all_keys)
        
        # Try following a $ref if present
        sample = items[0] if items else {}
        athlete_ref = sample.get("athlete", {}).get("$ref") or sample.get("$ref")
        if athlete_ref:
            print(f"\nFollowing athlete ref: {athlete_ref}")
            r2 = await client.get(athlete_ref)
            print(f"Status: {r2.status_code}")
            if r2.status_code == 200:
                athlete = r2.json()
                print("Athlete keys:", list(athlete.keys()))
                print("Name:", athlete.get("displayName") or athlete.get("fullName"))
                print("Team:", athlete.get("team", {}).get("abbreviation"))
        
        # Try a team-specific injury endpoint
        print("\n=== Team injuries for specific team ===")
        for team_id in ["6", "1", "13"]:  # some NBA team IDs
            r = await client.get(
                f"https://sports.core.api.espn.com/v3/sports/basketball/nba/teams/{team_id}/injuries"
            )
            print(f"Team {team_id}: status={r.status_code}")
            if r.status_code == 200:
                d = r.json()
                print(f"  keys: {list(d.keys())}")
                items2 = d.get("items", [])
                print(f"  items: {len(items2)}")
                if items2:
                    print("  sample:", json.dumps(items2[0], indent=2)[:400])
                break

asyncio.run(check())
