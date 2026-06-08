"""
SwingFactr ETL — Basketball Reference Contract Scraper
Uses pandas.read_html which handles BBRef's JS-rendered tables.
"""
import time
import unicodedata
import requests
import pandas as pd
from io import StringIO
from src.etl.db import get_conn

URL = "https://www.basketball-reference.com/contracts/players.html"
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}

BREF_TO_ESPN = {
    "GSW":"GS","SAS":"SA","NOP":"NO","NYK":"NY",
    "UTA":"UTAH","WAS":"WSH","PHO":"PHX","CHO":"CHA","BRK":"BKN",
}

def normalize(name):
    name = unicodedata.normalize("NFKD", str(name))
    return "".join(c for c in name if not unicodedata.combining(c)).strip()

def parse_salary(val):
    try:
        return int(str(val).replace("$","").replace(",","").strip())
    except:
        return None

def scrape_contracts():
    print(f"Fetching {URL}")
    time.sleep(2)
    resp = requests.get(URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    print(f"Status: {resp.status_code}, size: {len(resp.content)}")

    resp.encoding = "utf-8"
    resp.encoding = "utf-8"
    tables = pd.read_html(StringIO(resp.text))
    df = tables[0]

    # Flatten multi-level columns
    df.columns = [
        f"{a}_{b}" if not b.startswith("Unnamed") else b
        for a,b in df.columns
    ]

    # Rename key columns
    col_map = {}
    for c in df.columns:
        if "Player" in c: col_map[c] = "player"
        elif "Tm" in c:   col_map[c] = "team"
        elif "2025-26" in c: col_map[c] = "s2526"
        elif "2026-27" in c: col_map[c] = "s2627"
        elif "2027-28" in c: col_map[c] = "s2728"
        elif "2028-29" in c: col_map[c] = "s2829"
        elif "2029-30" in c: col_map[c] = "s2930"
        elif "Guaranteed" in c: col_map[c] = "guaranteed"
    df = df.rename(columns=col_map)

    players = []
    seen = set()

    for _, row in df.iterrows():
        raw_name = normalize(row.get("player",""))
        # Strip accents so names match game log names (Jokic not Jokic with accent)
        import unicodedata as _ud
        name = "".join(c for c in _ud.normalize("NFKD", raw_name) if not _ud.combining(c))
        if not name or name == "Player" or name == "nan":
            continue
        if name in seen:
            continue
        seen.add(name)

        team_raw = str(row.get("team","")).upper()
        team = BREF_TO_ESPN.get(team_raw, team_raw)

        s2526 = parse_salary(row.get("s2526"))
        if not s2526:
            continue

        players.append({
            "player_name":   name,
            "team":          team,
            "salary_2526":   s2526,
            "salary_2627":   parse_salary(row.get("s2627")),
            "salary_2728":   parse_salary(row.get("s2728")),
            "salary_2829":   parse_salary(row.get("s2829")),
            "salary_2930":   parse_salary(row.get("s2930")),
            "guaranteed":    parse_salary(row.get("guaranteed")),
            "contract_type": "guaranteed",  # BBRef color requires JS; default to guaranteed
        })

    print(f"Scraped {len(players)} contracts")
    return players

def init_table(conn):
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS player_contracts (
            player_name   VARCHAR PRIMARY KEY,
            team          VARCHAR,
            salary_2526   BIGINT,
            salary_2627   BIGINT,
            salary_2728   BIGINT,
            salary_2829   BIGINT,
            salary_2930   BIGINT,
            guaranteed    BIGINT,
            contract_type VARCHAR DEFAULT 'guaranteed',
            updated_at    TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    conn.commit()
    cur.close()

def upsert_contracts(conn, players):
    cur = conn.cursor()
    for p in players:
        cur.execute("""
            INSERT INTO player_contracts
                (player_name,team,salary_2526,salary_2627,salary_2728,
                 salary_2829,salary_2930,guaranteed,contract_type,updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW())
            ON CONFLICT (player_name) DO UPDATE SET
                team=EXCLUDED.team, salary_2526=EXCLUDED.salary_2526,
                salary_2627=EXCLUDED.salary_2627, salary_2728=EXCLUDED.salary_2728,
                salary_2829=EXCLUDED.salary_2829, salary_2930=EXCLUDED.salary_2930,
                guaranteed=EXCLUDED.guaranteed, updated_at=NOW()
        """, (p["player_name"],p["team"],p["salary_2526"],p["salary_2627"],
              p["salary_2728"],p["salary_2829"],p["salary_2930"],
              p["guaranteed"],p["contract_type"]))
    conn.commit()
    cur.close()
    print(f"Upserted {len(players)} contracts")

def main():
    players = scrape_contracts()
    if not players:
        print("No contracts scraped"); return
    with get_conn() as conn:
        init_table(conn)
        upsert_contracts(conn, players)
    top = sorted([p for p in players if p["salary_2526"]], key=lambda x:-x["salary_2526"])[:10]
    print("\nTop 10 by salary:")
    for p in top:
        print(f"  {p['player_name']:<28} ${p['salary_2526']:>12,}  {p['team']}")

if __name__ == "__main__":
    main()
