"""
SwingFactr ETL — Basketball Reference Advanced Metrics Scraper
src/etl/fetch_advanced_metrics.py

Scrapes BPM, VORP, WS, WS/48, TS% from Basketball Reference.
Stores in player_advanced_metrics table.
Run via GitHub Actions nightly.

Usage:
    python3 src/etl/fetch_advanced_metrics.py
"""

import time
import re
import unicodedata
import requests
from bs4 import BeautifulSoup
from src.etl.db import get_conn

SEASON_YEAR = 2026   # BBRef uses ending year (2025-26 → 2026)
URL = f"https://www.basketball-reference.com/leagues/NBA_{SEASON_YEAR}_advanced.html"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": "https://www.basketball-reference.com/",
}

# BBRef team abbreviation → ESPN abbreviation (for matching with our DB)
BREF_TO_ESPN = {
    "GSW": "GS", "SAS": "SA", "NOP": "NO", "NYK": "NY",
    "UTA": "UTAH", "WAS": "WSH", "PHO": "PHX", "TOT": "TOT",
}

def safe_float(val: str, default=None):
    try:
        return float(val.strip()) if val and val.strip() not in ("", "—", "N/A") else default
    except (ValueError, TypeError):
        return default

def scrape_advanced() -> list[dict]:
    """Scrape advanced stats table from Basketball Reference."""
    print(f"Fetching: {URL}")
    time.sleep(2)   # be polite

    resp = requests.get(URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    print(f"Status: {resp.status_code}, size: {len(resp.content)} bytes")

    soup = BeautifulSoup(resp.content, "html.parser")

    # BBRef advanced table id
    table = soup.find("table", {"id": "advanced"})
    if not table:
        # Sometimes it's wrapped in a comment
        comments = soup.find_all(string=lambda t: isinstance(t, type(soup.find(string="").__class__) or True))
        for c in soup.find_all(string=True):
            if 'id="advanced"' in str(c):
                inner = BeautifulSoup(str(c), "html.parser")
                table = inner.find("table", {"id": "advanced"})
                if table:
                    break

    if not table:
        raise RuntimeError("Could not find advanced stats table on BBRef page")

    rows = table.find("tbody").find_all("tr")
    players = []

    for row in rows:
        # Skip header rows
        if row.get("class") and "thead" in row.get("class", []):
            continue
        if row.find("th", {"scope": "row"}) is None:
            continue

        def cell(stat):
            td = row.find("td", {"data-stat": stat})
            return td.get_text(strip=True) if td else ""

        # BBRef puts player name in <th> not <td>
        name_th = row.find("td", {"data-stat": "name_display"})
        if not name_th:
            continue

        name = name_th.get_text(strip=True)
        if not name or name == "Player":
            continue

        name = name.replace("*", "").strip()
        # Normalize unicode accents to ASCII (Jokić → Jokic, Dončić → Doncic)
        name = unicodedata.normalize("NFKD", name)
        name = "".join(c for c in name if not unicodedata.combining(c))

        team = BREF_TO_ESPN.get(cell("team_name_abbr"), cell("team_name_abbr"))
        g    = safe_float(cell("games"))
        mp   = safe_float(cell("mp"))

        # Core advanced metrics
        ts_pct  = safe_float(cell("ts_pct"))
        ws      = safe_float(cell("ws"))
        ws48    = safe_float(cell("ws_per_48"))
        bpm     = safe_float(cell("bpm"))
        obpm    = safe_float(cell("obpm"))
        dbpm    = safe_float(cell("dbpm"))
        vorp    = safe_float(cell("vorp"))
        per     = safe_float(cell("per"))

        # Only include players with meaningful minutes
        if not g or not mp or mp < 100:
            continue

        players.append({
            "player_name": name,
            "team":        team,
            "season_id":   "2025-26",
            "g":           g,
            "mp":          mp,
            "ts_pct":      ts_pct,
            "ws":          ws,
            "ws_per_48":   ws48,
            "bpm":         bpm,
            "obpm":        obpm,
            "dbpm":        dbpm,
            "vorp":        vorp,
            "per":         per,
        })

    # Handle traded players (TOT rows): keep the TOT row, drop team-specific dupes
    seen = {}
    deduped = []
    for p in players:
        name = p["player_name"]
        if name not in seen:
            seen[name] = p
            deduped.append(p)
        else:
            # If we already have a TOT row keep it; otherwise replace with TOT
            if p["team"] == "TOT":
                idx = deduped.index(seen[name])
                deduped[idx] = p
                seen[name] = p

    print(f"Scraped {len(deduped)} players")
    return deduped

def init_table(conn):
    """Create player_advanced_metrics table if not exists."""
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS player_advanced_metrics (
            player_name  VARCHAR NOT NULL,
            season_id    VARCHAR NOT NULL,
            team         VARCHAR,
            g            FLOAT,
            mp           FLOAT,
            ts_pct       FLOAT,
            ws           FLOAT,
            ws_per_48    FLOAT,
            bpm          FLOAT,
            obpm         FLOAT,
            dbpm         FLOAT,
            vorp         FLOAT,
            per          FLOAT,
            updated_at   TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (player_name, season_id)
        );
    """)
    cur.close()

def upsert_metrics(conn, players: list[dict]):
    """Upsert scraped metrics into DB."""
    cur = conn.cursor()
    upserted = 0
    for p in players:
        cur.execute("""
            INSERT INTO player_advanced_metrics
                (player_name, season_id, team, g, mp, ts_pct, ws, ws_per_48,
                 bpm, obpm, dbpm, vorp, per, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, NOW())
            ON CONFLICT (player_name, season_id) DO UPDATE SET
                team       = EXCLUDED.team,
                g          = EXCLUDED.g,
                mp         = EXCLUDED.mp,
                ts_pct     = EXCLUDED.ts_pct,
                ws         = EXCLUDED.ws,
                ws_per_48  = EXCLUDED.ws_per_48,
                bpm        = EXCLUDED.bpm,
                obpm       = EXCLUDED.obpm,
                dbpm       = EXCLUDED.dbpm,
                vorp       = EXCLUDED.vorp,
                per        = EXCLUDED.per,
                updated_at = NOW()
        """, (
            p["player_name"], p["season_id"], p["team"],
            p["g"], p["mp"], p["ts_pct"], p["ws"], p["ws_per_48"],
            p["bpm"], p["obpm"], p["dbpm"], p["vorp"], p["per"],
        ))
        upserted += 1
    conn.commit()
    cur.close()
    print(f"Upserted {upserted} players into player_advanced_metrics")

def main():
    players = scrape_advanced()
    if not players:
        print("No players scraped -- aborting")
        return

    with get_conn() as conn:
        init_table(conn)
        upsert_metrics(conn, players)

    # Print top 10 by BPM as sanity check
    top = sorted([p for p in players if p["bpm"] is not None], key=lambda x: -x["bpm"])[:10]
    print("\nTop 10 by BPM:")
    for p in top:
        print(f"  {p['player_name']:<25} BPM:{p['bpm']:>6}  VORP:{p['vorp']:>5}  WS:{p['ws']:>5}  TS%:{p['ts_pct']}")

if __name__ == "__main__":
    main()
