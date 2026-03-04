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
            params={"league_id": 7, "per_page": 50, "single_stat": "true"})
        data = r.json()
        projections = data.get("data", [])
        included = {i["id"]: i for i in data.get("included", [])}

        # Print ALL attribute keys from first projection to see what fields exist
        if projections:
            print("=== All attribute keys on a projection ===")
            print(json.dumps(list(projections[0].get("attributes", {}).keys()), indent=2))
            print()

        # Find examples of each tier
        tiers_seen = {}
        for proj in projections:
            attrs = proj.get("attributes", {})
            stat = attrs.get("stat_type", "")
            if stat not in ("Points", "Rebounds", "Assists", "3-PT Made"):
                continue

            # Look for tier-related fields
            odds_type = attrs.get("odds_type", "")
            line_type = attrs.get("line_type", "")
            projection_type = attrs.get("projection_type", "")
            is_promo = attrs.get("is_promo", "")
            flash_sale = attrs.get("flash_sale_line_score", "")

            player_id = proj.get("relationships", {}).get("new_player", {}).get("data", {}).get("id")
            player = included.get(player_id, {}).get("attributes", {})
            name = player.get("display_name", "?")
            line = attrs.get("line_score", "")

            tier_key = f"{odds_type}|{line_type}|{projection_type}"
            if tier_key not in tiers_seen:
                tiers_seen[tier_key] = []
            tiers_seen[tier_key].append(f"{name} {stat} {line}")

        print("=== Tier combinations found (odds_type|line_type|projection_type) ===")
        for k, examples in list(tiers_seen.items())[:10]:
            print(f"\n  {k}:")
            for ex in examples[:3]:
                print(f"    {ex}")

asyncio.run(run())
