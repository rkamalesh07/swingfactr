"""
Check multiple ESPN endpoints for injury data.
"""
import httpx, asyncio, json

async def check():
    async with httpx.AsyncClient(timeout=10) as client:
        
        # 1. ESPN injuries endpoint
        print("=== 1. ESPN injuries endpoint ===")
        r = await client.get(
            "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries"
        )
        print(f"Status: {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            print("Keys:", list(data.keys()))
            items = data.get("items", [])
            print(f"Items: {len(items)}")
            if items:
                print("Sample:", json.dumps(items[0], indent=2)[:800])
        
        # 2. Try team-specific roster with injuries
        print("\n=== 2. DAL roster endpoint ===")
        r = await client.get(
            "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/dal/injuries"
        )
        print(f"Status: {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            print(json.dumps(data, indent=2)[:1000])

        # 3. Try news/transactions 
        print("\n=== 3. v3 injuries ===")
        r = await client.get(
            "https://sports.core.api.espn.com/v3/sports/basketball/nba/injuries?limit=50"
        )
        print(f"Status: {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            print("Keys:", list(data.keys()))
            items = data.get("items", [])
            print(f"Items: {len(items)}")
            if items:
                print("Sample:", json.dumps(items[0], indent=2)[:600])

        # 4. v2 core injuries
        print("\n=== 4. v2 core injuries ===")
        r = await client.get(
            "https://sports.core.api.espn.com/v2/sports/basketball/nba/injuries?limit=50"
        )
        print(f"Status: {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            print("Keys:", list(data.keys()))
            items = data.get("items", [])
            print(f"Items: {len(items)}")
            if items:
                print("Sample item keys:", list(items[0].keys()))
                print("Sample:", json.dumps(items[0], indent=2)[:800])

        # 5. Try NBA.com injury report via rotowire on ESPN
        print("\n=== 5. ESPN news (injury tags) ===")
        r = await client.get(
            "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news?limit=50&tags=injuries"
        )
        print(f"Status: {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            articles = data.get("articles", [])
            print(f"Articles: {len(articles)}")
            if articles:
                print("Sample:", json.dumps(articles[0], indent=2)[:500])

asyncio.run(check())
