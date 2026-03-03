"""
Test Odds API player props for today's games.
Run: python -m src.etl.test_odds_props
"""
import asyncio
import httpx

API_KEY = "9ef42e6c03d4f69902fb02f8318e028a"
BASE = "https://api.the-odds-api.com/v4"

async def run():
    async with httpx.AsyncClient(timeout=15) as client:

        # Step 1: get today's events (free, no quota cost)
        print("=== Fetching today's NBA events ===")
        r = await client.get(f"{BASE}/sports/basketball_nba/events", params={"apiKey": API_KEY})
        print(f"Status: {r.status_code}, Remaining: {r.headers.get('x-requests-remaining')}")
        events = r.json()
        print(f"Events found: {len(events)}")
        for e in events:
            print(f"  {e['away_team']} @ {e['home_team']} — id: {e['id']} — time: {e['commence_time']}")

        if not events:
            print("No events found, nothing to test")
            return

        # Step 2: try first event for player props
        event = events[0]
        print(f"\n=== Fetching player_points for: {event['away_team']} @ {event['home_team']} ===")
        r2 = await client.get(
            f"{BASE}/sports/basketball_nba/events/{event['id']}/odds",
            params={
                "apiKey": API_KEY,
                "regions": "us",
                "markets": "player_points",
                "oddsFormat": "american",
                "bookmakers": "draftkings",
            }
        )
        print(f"Status: {r2.status_code}, Remaining: {r2.headers.get('x-requests-remaining')}, Cost: {r2.headers.get('x-requests-last')}")
        
        if r2.status_code == 200:
            data = r2.json()
            bookmakers = data.get("bookmakers", [])
            print(f"Bookmakers with data: {len(bookmakers)}")
            for bk in bookmakers:
                for market in bk.get("markets", []):
                    outcomes = market.get("outcomes", [])
                    print(f"  {bk['key']} — {market['key']} — {len(outcomes)} outcomes")
                    # Show first 4 players
                    players_seen = set()
                    for o in outcomes:
                        desc = o.get("description", o.get("name"))
                        if desc not in players_seen:
                            players_seen.add(desc)
                            print(f"    {desc}: line={o.get('point')} over={o.get('price') if o.get('name')=='Over' else '?'}")
                        if len(players_seen) >= 4:
                            break
        else:
            print(f"Response: {r2.text[:400]}")

asyncio.run(run())
