"""
Test label lookup directly.
Run: python -m src.etl.test_label_lookup
"""
import asyncio, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
import httpx

ESPN_SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary"
HEADERS = {"User-Agent": "Mozilla/5.0"}

async def run():
    async with httpx.AsyncClient(headers=HEADERS, timeout=15) as client:
        r2 = await client.get(ESPN_SUMMARY, params={"event": "401810729"})
        data = r2.json()
        for team_box in data.get("boxscore", {}).get("players", []):
            abbr = team_box.get("team", {}).get("abbreviation", "")
            if abbr != "PHI":
                continue
            for stat_group in team_box.get("statistics", []):
                labels = stat_group.get("labels", [])
                print(f"Labels repr: {repr(labels)}")
                print(f"'3PT' in labels: {'3PT' in labels}")
                print(f"index of 3PT: {labels.index('3PT') if '3PT' in labels else 'NOT FOUND'}")
                
                for athlete in stat_group.get("athletes", []):
                    name = athlete.get("athlete", {}).get("displayName", "")
                    if "Maxey" not in name:
                        continue
                    stats = athlete.get("stats", [])
                    
                    # Simulate exact get_stat logic
                    def get_stat(label, default=0):
                        if label in labels:
                            idx = labels.index(label)
                            val = stats[idx] if idx < len(stats) else None
                            print(f"  get_stat({label!r}): idx={idx}, val={val!r}")
                            if val is None or val == "" or val == "DNP":
                                return default
                            if "-" in str(val) and label in ("FG", "3PT", "FT"):
                                result = int(str(val).split("-")[0])
                                print(f"    -> split result: {result}")
                                return result
                            try:
                                return float(val)
                            except:
                                return default
                        print(f"  get_stat({label!r}): NOT IN LABELS")
                        return default

                    print(f"\n{name}:")
                    print(f"  fg3m (3PT) = {int(get_stat('3PT'))}")
                    print(f"  pts (PTS) = {int(get_stat('PTS'))}")
                    print(f"  reb (REB) = {int(get_stat('REB'))}")

asyncio.run(run())
