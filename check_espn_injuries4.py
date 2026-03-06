"""Try to resolve injury IDs to player names via ESPN athlete endpoint."""
import httpx, asyncio, json

async def check():
    async with httpx.AsyncClient(timeout=10) as client:
        
        # The injury IDs from previous output: -40157, 521850, 521849
        # Try hitting athlete endpoint directly with these IDs
        test_ids = ["521850", "521849", "40157"]
        
        for aid in test_ids:
            r = await client.get(
                f"https://sports.core.api.espn.com/v2/sports/basketball/nba/athletes/{aid}"
            )
            print(f"Athlete {aid}: status={r.status_code}")
            if r.status_code == 200:
                d = r.json()
                print(f"  name={d.get('displayName')} team={d.get('team',{}).get('abbreviation','?')}")
                print(f"  position={d.get('position',{}).get('abbreviation','?')}")
        
        # Also try the full injuries endpoint with athlete info embedded
        print("\n=== Try v2 athletes with injury status ===")
        r = await client.get(
            "https://sports.core.api.espn.com/v2/sports/basketball/nba/athletes?limit=1000&active=true"
        )
        print(f"Athletes endpoint: {r.status_code}")
        if r.status_code == 200:
            d = r.json()
            print(f"Count: {d.get('count')} items: {len(d.get('items',[]))}")
            # Check if items have injury info
            items = d.get('items', [])
            if items:
                print("Sample item keys:", list(items[0].keys()))
                print("Sample:", json.dumps(items[0], indent=2)[:300])
        
        # Try the team roster endpoint which usually has injury flags
        print("\n=== Team roster with injuries ===")
        r = await client.get(
            "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/dal/roster"
        )
        print(f"DAL roster: {r.status_code}")
        if r.status_code == 200:
            d = r.json()
            print("Keys:", list(d.keys()))
            athletes = d.get("athletes", [])
            print(f"Athletes: {len(athletes)}")
            if athletes:
                # Look for injury field
                for group in athletes:
                    items = group.get("items", [group]) if isinstance(group, dict) else [group]
                    for p in items[:2]:
                        status = p.get("status", {})
                        injuries = p.get("injuries", [])
                        print(f"  {p.get('displayName','?')}: status={status} injuries={injuries}")

asyncio.run(check())
