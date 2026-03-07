"""
Injury Engine v2 — RotoWire lineup scraper + ESPN cross-reference.

Primary source: RotoWire nba-lineups.php
  - Confirmed starters per team (data-lineup attribute)
  - OUT players per team (data-out attribute)
  - Parsed from static HTML, no JS rendering needed
  - Updated ~2-3 hours before tip-off

Cross-reference: ESPN team roster (secondary)
  - Catches players RotoWire hasn't updated yet
  - GTD players not yet resolved to in/out

Creates: player_availability table with:
  - status: 'Starter' | 'Active' | 'Out' | 'GTD'
  - confirmed_starter: boolean
  - source: 'rotowire' | 'espn'

Used by props_board to:
  1. Skip props for OUT players
  2. Apply usage boost for recently-absent players (games_missed < 5)
  3. Show starter/GTD badges on frontend
"""

import asyncio, httpx, re, logging, sys
from datetime import date, timedelta
from pathlib import Path
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from src.etl.db import get_conn, init_pool

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")
logger = logging.getLogger("injury_engine")

RW_URL   = "https://www.rotowire.com/basketball/nba-lineups.php"
ESPN_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{team}/roster"
HEADERS  = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}

ESPN_TEAMS = [
    "ATL","BOS","BKN","CHA","CHI","CLE","DAL","DEN","DET","GSW",
    "HOU","IND","LAC","LAL","MEM","MIA","MIL","MIN","NOP","NYK",
    "OKC","ORL","PHI","PHX","POR","SAC","SAS","TOR","UTA","WAS",
]
# ESPN uses different abbreviations for some teams
ESPN_ABBR_MAP = {
    "NOP": "no", "UTA": "utah", "SAS": "sa",
}

MAX_GAMES_MISSED_FOR_BOOST = 5

# ---------------------------------------------------------------------------
# DB
# ---------------------------------------------------------------------------

def ensure_table():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS player_availability (
                    avail_id           SERIAL PRIMARY KEY,
                    fetch_date         DATE NOT NULL DEFAULT CURRENT_DATE,
                    player_name        VARCHAR(100) NOT NULL,
                    team_abbr          VARCHAR(5)   NOT NULL,
                    status             VARCHAR(20)  NOT NULL,
                    confirmed_starter  BOOLEAN      DEFAULT FALSE,
                    injury_type        VARCHAR(50),
                    source             VARCHAR(20)  DEFAULT 'espn',
                    fetched_at         TIMESTAMPTZ  DEFAULT NOW(),
                    UNIQUE (fetch_date, player_name, team_abbr)
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_avail_date_team   ON player_availability(fetch_date, team_abbr)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_avail_date_player ON player_availability(fetch_date, player_name)")

# ---------------------------------------------------------------------------
# RotoWire scraper
# ---------------------------------------------------------------------------

async def fetch_rotowire(client):
    """
    Parse RotoWire lineup page.
    Returns dict: team_abbr → {starters: [...], out: [...]}
    """
    try:
        r = await client.get(RW_URL, headers=HEADERS, timeout=15)
        if r.status_code != 200:
            logger.warning(f"RotoWire returned {r.status_code}")
            return {}
    except Exception as e:
        logger.warning(f"RotoWire fetch failed: {e}")
        return {}

    soup = BeautifulSoup(r.text, 'html.parser')

    # Build RotoWire player ID → name from all player links
    id_to_name = {}
    for a in soup.find_all('a', href=re.compile(r'/basketball/player/')):
        href  = a.get('href', '')
        title = (a.get('title') or a.text or '').strip()
        m = re.search(r'-(\d+)$', href)
        if m and title:
            id_to_name[m.group(1)] = title

    # Parse team blocks
    lineups = {}
    for div in soup.find_all(attrs={"data-lineup": True}):
        team     = div.get('data-team', '').upper()
        is_home  = div.get('data-home', '0') == '1'
        s_ids    = [x for x in div.get('data-lineup', '').split(',') if x]
        out_ids  = [x for x in div.get('data-out', '').split(',') if x]

        starters = [id_to_name[i] for i in s_ids if i in id_to_name]
        out      = [id_to_name[i] for i in out_ids if i in id_to_name]

        # Unknown IDs — mark for ESPN cross-check
        unknown_s   = [i for i in s_ids   if i not in id_to_name]
        unknown_out = [i for i in out_ids if i not in id_to_name]
        if unknown_s or unknown_out:
            logger.debug(f"  {team}: unknown IDs starters={unknown_s} out={unknown_out}")

        lineups[team] = {
            "starters": starters,
            "out":      out,
            "is_home":  is_home,
        }

    logger.info(f"RotoWire: {len(lineups)} teams parsed, {len(id_to_name)} player IDs resolved")
    return lineups

# ---------------------------------------------------------------------------
# ESPN cross-reference (catch GTD / late scratches)
# ---------------------------------------------------------------------------

async def fetch_espn_team(client, team_abbr):
    espn_abbr = ESPN_ABBR_MAP.get(team_abbr, team_abbr.lower())
    try:
        r = await client.get(ESPN_URL.format(team=espn_abbr), headers=HEADERS, timeout=10)
        if r.status_code != 200:
            return []
        data = r.json()
    except Exception:
        return []

    results = []
    for athlete in data.get("athletes", []):
        name     = athlete.get("displayName", "")
        injuries = athlete.get("injuries", [])
        pos_data = athlete.get("position", {})
        position = pos_data.get("abbreviation", "") if isinstance(pos_data, dict) else ""
        if not name: continue

        if injuries:
            raw = injuries[0].get("status", "Out")
            status_map = {
                "Out": "Out", "Day-To-Day": "GTD",
                "Questionable": "GTD", "Doubtful": "Out", "Probable": "Active",
            }
            status = status_map.get(raw, raw)
        else:
            status = "Active"

        results.append({
            "player_name": name, "team_abbr": team_abbr,
            "status": status, "position": position,
        })
    return results

# ---------------------------------------------------------------------------
# Merge and store
# ---------------------------------------------------------------------------

def store_availability(rows):
    if not rows: return 0
    written = 0
    with get_conn() as conn:
        with conn.cursor() as cur:
            for r in rows:
                cur.execute("""
                    INSERT INTO player_availability
                        (player_name, team_abbr, status, confirmed_starter, source)
                    VALUES (%s,%s,%s,%s,%s)
                    ON CONFLICT (fetch_date, player_name, team_abbr) DO UPDATE SET
                        status            = EXCLUDED.status,
                        confirmed_starter = EXCLUDED.confirmed_starter,
                        source            = EXCLUDED.source,
                        fetched_at        = NOW()
                """, (
                    r["player_name"], r["team_abbr"],
                    r["status"], r.get("confirmed_starter", False),
                    r.get("source", "espn"),
                ))
                written += 1
    return written

# ---------------------------------------------------------------------------
# Query helpers (used by props_board)
# ---------------------------------------------------------------------------

_AVAIL_CACHE = {}

def load_availability_cache():
    global _AVAIL_CACHE
    if _AVAIL_CACHE: return _AVAIL_CACHE

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT player_name, team_abbr, status, confirmed_starter, source
                FROM player_availability
                WHERE fetch_date = CURRENT_DATE
            """)
            rows = cur.fetchall()

    for player_name, team_abbr, status, confirmed_starter, source in rows:
        _AVAIL_CACHE[player_name.lower()] = {
            "player_name":       player_name,
            "team_abbr":         team_abbr,
            "status":            status,
            "confirmed_starter": bool(confirmed_starter),
            "source":            source,
            "is_out":            status == "Out",
            "is_gtd":            status == "GTD",
            "is_starter":        bool(confirmed_starter),
        }

    out   = sum(1 for v in _AVAIL_CACHE.values() if v["is_out"])
    gtd   = sum(1 for v in _AVAIL_CACHE.values() if v["is_gtd"])
    start = sum(1 for v in _AVAIL_CACHE.values() if v["is_starter"])
    logger.info(f"Availability: {len(_AVAIL_CACHE)} players | OUT:{out} GTD:{gtd} Starters:{start}")
    return _AVAIL_CACHE

def get_player_status(player_name):
    cache = load_availability_cache()
    return cache.get(player_name.lower())

def get_team_injured_players(team_abbr):
    cache = load_availability_cache()
    return [v for v in cache.values()
            if v["team_abbr"] == team_abbr and v["status"] in ("Out", "GTD")]

_BOOST_CACHE = {}

def reset_boost_cache():
    global _BOOST_CACHE
    _BOOST_CACHE = {}

def compute_usage_boost(player_name, team_abbr, stat):
    """
    Apply usage boost only when a teammate's absence is genuinely new
    (< MAX_GAMES_MISSED_FOR_BOOST team games without them).
    Uses player_game_logs to count actual games missed — immune to ESPN
    date manipulation (status changes don't reset the clock).
    """
    if stat not in ("pts", "reb", "ast", "fg3m"):
        return 1.0, []

    # Cache per (player, team) — boost multiplier is identical across all stats for same player
    cache_key = (player_name.lower(), team_abbr)
    if cache_key in _BOOST_CACHE:
        return _BOOST_CACHE[cache_key]

    # Only consider players who are genuinely OUT (not GTD or Active)
    all_injured = [p for p in get_team_injured_players(team_abbr)
                   if p["status"] == "Out"]
    if not all_injured:
        _BOOST_CACHE[cache_key] = (1.0, [])
        return 1.0, []

    injured = []
    with get_conn() as conn:
        with conn.cursor() as cur:
            for inj in all_injured:
                if inj["player_name"].lower() == player_name.lower():
                    continue

                # Last game this player appeared in
                cur.execute("""
                    SELECT MAX(game_date) FROM player_game_logs
                    WHERE player_name = %s AND season_id = '2025-26'
                """, (inj["player_name"],))
                row = cur.fetchone()
                last_game = row[0] if row and row[0] else None

                if not last_game:
                    continue  # Never played — skip

                # Team games played since that date
                cur.execute("""
                    SELECT COUNT(DISTINCT game_id)
                    FROM player_game_logs
                    WHERE team_abbr = %s
                      AND game_date > %s
                      AND season_id = '2025-26'
                """, (team_abbr, last_game))
                row = cur.fetchone()
                games_missed = int(row[0]) if row and row[0] else 0

                if 1 <= games_missed < MAX_GAMES_MISSED_FOR_BOOST:
                    injured.append(inj)
                    logger.info(f"  Boost: {inj['player_name']} missed {games_missed} games → {player_name} gets usage bump")

    if not injured:
        _BOOST_CACHE[cache_key] = (1.0, [])
        return 1.0, []

    # Estimate missing usage and redistribute.
    # Only count teammates who are genuine usage contributors:
    #   - avg possessions (fga + 0.44*fta + tov) >= MIN_POSSESSIONS_FOR_BOOST
    # This filters out spot-up shooters and defensive specialists whose
    # absence doesn't meaningfully free up offensive possessions.
    MIN_POSSESSIONS_FOR_BOOST = 8.0  # ~10+ mpg of real offensive involvement

    total_missing = 0.0
    meaningful_injured = []
    with get_conn() as conn:
        with conn.cursor() as cur:
            for inj in injured:
                cur.execute("""
                    SELECT
                        AVG((fga + 0.44*fta + tov)::float / NULLIF(minutes,0)) as rate,
                        AVG(fga + 0.44*fta + tov) as avg_poss
                    FROM player_game_logs
                    WHERE player_name = %s AND season_id = '2025-26' AND minutes >= 10
                """, (inj["player_name"],))
                row = cur.fetchone()
                rate     = float(row[0]) if row and row[0] else None
                avg_poss = float(row[1]) if row and row[1] else 0.0

                if avg_poss < MIN_POSSESSIONS_FOR_BOOST:
                    logger.debug(f"  Skip boost: {inj['player_name']} only {avg_poss:.1f} poss/g (below threshold)")
                    continue

                meaningful_injured.append(inj)
                if rate:
                    total_missing += rate * 5 * 100
                else:
                    total_missing += 18.0  # fallback ~18% usage

    if not meaningful_injured:
        _BOOST_CACHE[cache_key] = (1.0, [])
        return 1.0, []

    redistributed    = total_missing * 0.60
    player_share     = 0.20
    boost_pct        = redistributed * player_share / 100.0
    boost_multiplier = min(1.15, 1.0 + boost_pct)

    context = [i["player_name"] for i in meaningful_injured]
    logger.info(f"  {player_name} usage boost: {boost_multiplier:.3f}x from {context}")
    _BOOST_CACHE[cache_key] = (boost_multiplier, context)
    return boost_multiplier, context

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def run():
    init_pool()
    ensure_table()

    all_rows = []

    async with httpx.AsyncClient(follow_redirects=True) as client:
        # 1. RotoWire — primary source
        rw_lineups = await fetch_rotowire(client)

        # Build rows from RotoWire
        for team, data in rw_lineups.items():
            for name in data["starters"]:
                all_rows.append({
                    "player_name": name, "team_abbr": team,
                    "status": "Active", "confirmed_starter": True, "source": "rotowire",
                })
            for name in data["out"]:
                all_rows.append({
                    "player_name": name, "team_abbr": team,
                    "status": "Out", "confirmed_starter": False, "source": "rotowire",
                })

        # 2. ESPN cross-reference — catch teams not on RotoWire tonight + GTD
        rw_teams = set(rw_lineups.keys())
        tasks = [fetch_espn_team(client, t) for t in ESPN_TEAMS]
        espn_results = await asyncio.gather(*tasks, return_exceptions=True)

        rw_player_names = {r["player_name"].lower() for r in all_rows}
        position_map = {}  # player_name → position from ESPN

        for team_rows in espn_results:
            if isinstance(team_rows, Exception): continue
            for r in team_rows:
                pname = r["player_name"].lower()
                if r.get("position"):
                    position_map[pname] = r["position"]
                # Only add ESPN data if RotoWire didn't already cover this player
                if pname not in rw_player_names:
                    all_rows.append({**r, "confirmed_starter": False, "source": "espn"})

        # Backfill position into players table
        if position_map:
            with get_conn() as conn:
                with conn.cursor() as cur:
                    updated = 0
                    for pname_lower, pos in position_map.items():
                        cur.execute("""
                            UPDATE players SET position = %s
                            WHERE LOWER(full_name) = %s AND (position IS NULL OR position = '')
                        """, (pos, pname_lower))
                        updated += cur.rowcount
                    logger.info(f"Updated positions for {updated} players")

    written = store_availability(all_rows)

    out_players   = [r for r in all_rows if r["status"] == "Out"]
    gtd_players   = [r for r in all_rows if r["status"] == "GTD"]
    starters      = [r for r in all_rows if r.get("confirmed_starter")]

    logger.info(f"Stored {written} player statuses")
    logger.info(f"Confirmed starters: {len(starters)}")
    logger.info(f"OUT ({len(out_players)}): {[r['player_name'] for r in out_players[:20]]}")
    logger.info(f"GTD ({len(gtd_players)}): {[r['player_name'] for r in gtd_players[:10]]}")

if __name__ == "__main__":
    asyncio.run(run())
