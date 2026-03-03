"""
Test RotoGrinders NBA prop lines scraper.
Run: python -m src.etl.test_rotogrinders
"""
import asyncio
import httpx
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

URLS = [
    "https://rotogrinders.com/projected-stats/nba-player?site=draftkings",
    "https://rotogrinders.com/lineups/nba",
    "https://rotogrinders.com/game-odds/nba-player-props",
]

async def run():
    async with httpx.AsyncClient(headers=HEADERS, timeout=15, follow_redirects=True) as client:
        for url in URLS:
            print(f"\n=== GET {url} ===")
            try:
                r = await client.get(url)
                print(f"Status: {r.status_code}")
                print(f"Content-Type: {r.headers.get('content-type', '?')}")
                print(f"Response length: {len(r.text)}")
                if r.status_code == 200 and "html" in r.headers.get("content-type", ""):
                    soup = BeautifulSoup(r.text, "html.parser")
                    # look for tables or player data
                    tables = soup.find_all("table")
                    print(f"Tables found: {len(tables)}")
                    # look for player names
                    text_sample = r.text[:2000]
                    has_players = any(name in r.text for name in ["LeBron", "Curry", "Durant", "Tatum"])
                    print(f"Contains player names: {has_players}")
                    print(f"First 500 chars of body text: {soup.get_text()[:500]}")
                else:
                    print(f"First 300 chars: {r.text[:300]}")
            except Exception as e:
                print(f"Error: {e}")

asyncio.run(run())
