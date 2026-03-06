"""Verify we can parse full lineup + out data from RotoWire data attributes."""
import httpx, asyncio, re
from bs4 import BeautifulSoup

async def check():
    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
    async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=15) as client:
        r = await client.get("https://www.rotowire.com/basketball/nba-lineups.php")
        html = r.text
    soup = BeautifulSoup(html, 'html.parser')

    # Build player ID → name map from all player links on the page
    id_to_name = {}
    for a in soup.find_all('a', href=re.compile(r'/basketball/player/')):
        href  = a.get('href', '')
        title = a.get('title', '') or a.text.strip()
        m = re.search(r'-(\d+)$', href)
        if m and title:
            id_to_name[m.group(1)] = title
    print(f"Player ID → name map: {len(id_to_name)} entries")
    print("Sample:", list(id_to_name.items())[:5])

    # Parse all team blocks
    print("\n=== Tonight's lineups ===")
    team_divs = soup.find_all(attrs={"data-lineup": True})
    
    games = {}
    for div in team_divs:
        team      = div.get('data-team', '')
        is_home   = div.get('data-home', '0') == '1'
        lineup_ids= [x for x in div.get('data-lineup','').split(',') if x]
        out_ids   = [x for x in div.get('data-out','').split(',') if x]
        
        lineup_names = [id_to_name.get(i, f"ID:{i}") for i in lineup_ids]
        out_names    = [id_to_name.get(i, f"ID:{i}") for i in out_ids]
        
        print(f"\n{team} ({'home' if is_home else 'away'})")
        print(f"  Starters: {lineup_names}")
        print(f"  OUT:      {out_names}")
        
        games[team] = {
            "team": team, "is_home": is_home,
            "starters": lineup_names, "out": out_names,
            "starter_ids": lineup_ids, "out_ids": out_ids,
        }
    
    # Check for GTD — look for any other status fields
    print("\n=== Other data attributes on team divs ===")
    for div in team_divs[:2]:
        print(f"  {div.attrs}")

asyncio.run(check())
