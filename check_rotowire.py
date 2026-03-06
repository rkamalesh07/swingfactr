"""Check RotoWire NBA lineups page structure."""
import httpx, asyncio
from bs4 import BeautifulSoup

async def check():
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Referer": "https://www.rotowire.com/",
    }
    async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=15) as client:
        r = await client.get("https://www.rotowire.com/basketball/nba-lineups.php")
        print(f"Status: {r.status_code}")
        print(f"Content length: {len(r.text)}")
        
        soup = BeautifulSoup(r.text, 'html.parser')
        
        # Look for lineup containers
        print("\n=== Looking for lineup sections ===")
        
        # Try common RotoWire class patterns
        for cls in ['lineup', 'lineup__team', 'lineup-card', 'player', 'is-pct-play']:
            elements = soup.find_all(class_=lambda c: c and cls in c.lower() if c else False)
            if elements:
                print(f"Class containing '{cls}': {len(elements)} elements")
                if elements:
                    print(f"  Sample: {str(elements[0])[:200]}")
        
        # Look for OUT/GTD indicators
        print("\n=== Injury status indicators ===")
        for status in ['out', 'gtd', 'dtd', 'questionable', 'injured']:
            elements = soup.find_all(string=lambda t: t and status.upper() in t.upper() if t else False)
            if elements:
                print(f"'{status.upper()}' found {len(elements)} times")
                print(f"  Sample: {str(elements[0])[:100]}")
        
        # Print a chunk of raw HTML to understand structure
        print("\n=== Raw HTML sample (first lineup section) ===")
        lineup_div = soup.find('div', class_=lambda c: c and 'lineup' in c.lower() if c else False)
        if lineup_div:
            print(str(lineup_div)[:2000])
        else:
            # Just print body structure
            print("No lineup div found. Body classes:")
            for tag in soup.find_all(class_=True)[:20]:
                print(f"  {tag.name}: {tag.get('class')}")

asyncio.run(check())
