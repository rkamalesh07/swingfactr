"""
Check PrizePicks API for multiplier/payout fields on demon/goblin projections.
Run: python -m src.etl.test_pp_multipliers
"""
import asyncio, httpx, json

PP_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "application/json",
    "Referer": "https://app.prizepicks.com/",
    "Origin": "https://app.prizepicks.com",
}

async def run():
    async with httpx.AsyncClient(headers=PP_HEADERS, timeout=15, follow_redirects=True) as client:
        r = await client.get("https://api.prizepicks.com/projections",
            params={"league_id": 7, "per_page": 500, "single_stat": "true"})
        data = r.json()
        projections = data.get("data", [])
        included = {i["id"]: i for i in data.get("included", [])}

        print("=== DEMON examples (full attributes) ===")
        demon_count = 0
        for proj in projections:
            attrs = proj.get("attributes", {})
            if attrs.get("odds_type") != "demon":
                continue
            if attrs.get("stat_type") not in ("Points", "Rebounds", "Assists"):
                continue
            player_id = proj.get("relationships", {}).get("new_player", {}).get("data", {}).get("id")
            name = included.get(player_id, {}).get("attributes", {}).get("display_name", "?")
            print(f"\n{name} {attrs.get('stat_type')} line={attrs.get('line_score')}")
            # Print all numeric/relevant fields
            for k, v in attrs.items():
                if v not in (None, "", False, True, []):
                    print(f"  {k}: {v}")
            demon_count += 1
            if demon_count >= 3:
                break

        print("\n\n=== GOBLIN examples (full attributes) ===")
        goblin_count = 0
        for proj in projections:
            attrs = proj.get("attributes", {})
            if attrs.get("odds_type") != "goblin":
                continue
            if attrs.get("stat_type") not in ("Points", "Rebounds", "Assists"):
                continue
            player_id = proj.get("relationships", {}).get("new_player", {}).get("data", {}).get("id")
            name = included.get(player_id, {}).get("attributes", {}).get("display_name", "?")
            print(f"\n{name} {attrs.get('stat_type')} line={attrs.get('line_score')}")
            for k, v in attrs.items():
                if v not in (None, "", False, True, []):
                    print(f"  {k}: {v}")
            goblin_count += 1
            if goblin_count >= 3:
                break

        # Also check adjusted_odds field specifically across all tiers
        print("\n\n=== adjusted_odds values by tier ===")
        by_tier = {"standard": set(), "demon": set(), "goblin": set()}
        for proj in projections:
            attrs = proj.get("attributes", {})
            tier = attrs.get("odds_type", "standard")
            adj = attrs.get("adjusted_odds")
            if adj and tier in by_tier:
                by_tier[tier].add(str(adj))
        for tier, vals in by_tier.items():
            print(f"  {tier}: {sorted(vals)[:10]}")

asyncio.run(run())
