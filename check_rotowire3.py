"""Find RotoWire's underlying data API by examining the page source for API calls."""
import httpx, asyncio, re

async def check():
    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
    async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=15) as client:
        r = await client.get("https://www.rotowire.com/basketball/nba-lineups.php")
        html = r.text

    # Look for API endpoint patterns in the JS
    print("=== API URL patterns in page source ===")
    patterns = [
        r'api["\s/][^"\'<>\s]{5,80}',
        r'fetch\(["\']([^"\']+)["\']',
        r'axios\.[a-z]+\(["\']([^"\']+)["\']',
        r'/basketball/[a-z\-]+\.php[^"\'<>\s]*',
        r'lineup[^"\'<>\s]{0,50}\.json',
        r'lineup[^"\'<>\s]{0,50}\.php',
        r'data-[a-z]+=["\'][^"\']{5,100}["\']',
    ]
    
    found = set()
    for pattern in patterns:
        matches = re.findall(pattern, html, re.IGNORECASE)
        for m in matches:
            if 'rotowire' in m.lower() or m.startswith('/'):
                found.add(m[:120])
    
    for f in sorted(found)[:30]:
        print(f"  {f}")

    # Look for JSON data embedded in page
    print("\n=== Embedded JSON data ===")
    json_matches = re.findall(r'window\.__[A-Z_]+__\s*=\s*({[^;]{20,500}})', html)
    for m in json_matches[:5]:
        print(f"  {m[:300]}")
    
    # Look for lineup-specific data attributes
    print("\n=== Data attributes with game/player info ===")
    data_attrs = re.findall(r'data-(?:game|player|lineup|team)[^>]{5,150}', html)
    for d in data_attrs[:10]:
        print(f"  {d}")

    # Try the likely API endpoints directly
    print("\n=== Testing likely API endpoints ===")
    async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=10) as client:
        endpoints = [
            "https://www.rotowire.com/basketball/ajax/lineups.php",
            "https://www.rotowire.com/basketball/ajax/nba-lineups.php", 
            "https://www.rotowire.com/api/basketball/lineups",
            "https://www.rotowire.com/basketball/tables/lineups.php",
            "https://www.rotowire.com/basketball/tables/player-status.php",
            "https://www.rotowire.com/basketball/ajax/player-news.php?sport=NBA",
        ]
        for url in endpoints:
            try:
                r = await client.get(url, timeout=5)
                print(f"  {r.status_code} {len(r.text):>8} chars — {url}")
                if r.status_code == 200 and len(r.text) > 100:
                    print(f"    Preview: {r.text[:150]}")
            except Exception as e:
                print(f"  ERR {url}: {e}")

asyncio.run(check())
