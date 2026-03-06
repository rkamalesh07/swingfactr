"""
Check what ESPN scoreboard returns for injury data.
"""
import sys, json
sys.path.insert(0, '.')
import httpx, asyncio

async def check():
    async with httpx.AsyncClient() as client:
        # Scoreboard
        r = await client.get(
            "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
            timeout=10
        )
        data = r.json()
        
        events = data.get("events", [])
        print(f"Games tonight: {len(events)}")
        
        if not events:
            print("No games tonight — checking a recent game instead")
            return
            
        # Check first game for injury data
        event = events[0]
        comp  = event.get("competitions", [{}])[0]
        
        print(f"\nGame: {event.get('name')}")
        print(f"Status: {event.get('status',{}).get('type',{}).get('description')}")
        
        # Check injuries field
        injuries = comp.get("injuries", [])
        print(f"\nInjuries in competitions[0].injuries: {len(injuries)}")
        if injuries:
            print("Sample injury:", json.dumps(injuries[0], indent=2)[:500])
        
        # Check roster field
        roster = comp.get("roster", [])
        print(f"Roster entries: {len(roster)}")
        
        # Check competitors for injury info
        for c in comp.get("competitors", []):
            team = c.get("team", {}).get("abbreviation")
            print(f"\nTeam: {team}")
            
            # injuries on competitor level
            c_injuries = c.get("injuries", [])
            print(f"  competitor.injuries: {len(c_injuries)}")
            if c_injuries:
                print("  Sample:", json.dumps(c_injuries[0], indent=2)[:300])
            
            # roster
            c_roster = c.get("roster", [])
            print(f"  competitor.roster: {len(c_roster)}")
            if c_roster:
                sample = c_roster[0]
                print("  Sample roster entry keys:", list(sample.keys()))
                print("  Sample:", json.dumps(sample, indent=2)[:400])
        
        # Also check top-level keys
        print(f"\nTop-level competition keys: {list(comp.keys())}")

asyncio.run(check())
