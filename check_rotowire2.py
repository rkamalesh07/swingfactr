"""Deep dive RotoWire lineup structure — find OUT/GTD player format."""
import httpx, asyncio, re
from bs4 import BeautifulSoup

async def check():
    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
    async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=15) as client:
        r = await client.get("https://www.rotowire.com/basketball/nba-lineups.php")
        soup = BeautifulSoup(r.text, 'html.parser')

    # Find all lineup__player elements and print their class + title + name
    players = soup.find_all('li', class_=lambda c: c and 'lineup__player' in ' '.join(c) if c else False)
    print(f"Total player entries: {len(players)}")
    
    # Group by pct-play value
    from collections import defaultdict
    by_pct = defaultdict(list)
    
    for p in players:
        classes = ' '.join(p.get('class', []))
        title   = p.get('title', '')
        name_tag = p.find('a')
        name    = name_tag.text.strip() if name_tag else '?'
        pos_tag  = p.find('div', class_='lineup__pos')
        pos     = pos_tag.text.strip() if pos_tag else '?'
        
        # Extract pct from class like is-pct-play-75
        pct_match = re.search(r'is-pct-play-(\d+)', classes)
        pct = int(pct_match.group(1)) if pct_match else -1
        
        by_pct[pct].append({"name": name, "pos": pos, "title": title, "classes": classes})
    
    print("\n=== Players by play probability ===")
    for pct in sorted(by_pct.keys()):
        players_at_pct = by_pct[pct]
        sample = players_at_pct[:3]
        print(f"\npct={pct} ({len(players_at_pct)} players):")
        for p in sample:
            print(f"  {p['pos']} {p['name']} | title='{p['title']}' | classes='{p['classes']}'")
    
    # Print one full game block to see full structure
    print("\n=== Full first game block ===")
    first_lineup = soup.find('div', class_=lambda c: c and 'lineup ' in ' '.join(c)+' ' if c else False)
    if first_lineup:
        # Find both teams
        teams = first_lineup.find_all('div', class_=lambda c: c and 'lineup__abbr' in ' '.join(c) if c else False)
        print(f"Teams: {[t.text for t in teams]}")
        
        # Find all players in this game
        game_players = first_lineup.find_all('li', class_=lambda c: c and 'lineup__player' in ' '.join(c) if c else False)
        print(f"Players in first game: {len(game_players)}")
        for p in game_players:
            classes = ' '.join(p.get('class',[]))
            pct_match = re.search(r'is-pct-play-(\d+)', classes)
            pct = pct_match.group(1) if pct_match else '?'
            name = p.find('a')
            pos  = p.find('div', class_='lineup__pos')
            injury = p.find('span', class_=lambda c: c and 'injury' in ' '.join(c).lower() if c else False)
            print(f"  {pos.text if pos else '?'} {name.text if name else '?'} pct={pct}% | {p.get('title','')} | injury={injury}")

asyncio.run(check())
