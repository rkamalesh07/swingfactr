"""
Props Board ETL v10 — data-driven model improvements.

Changes from v9 (based on 1,026-pick outcome analysis):
  - Demons EXCLUDED entirely (16.3% accuracy = garbage)
  - Stat-specific L10 avg weights (STL/BLK boosted, REB reduced)
  - L5 hit rate weight increased (more recent = more predictive)
  - Season hit rate weight decreased
  - Consistency bonus: both L5 and L10 avg above line = +3
  - Toss-ups filtered: standard props with edge -3 to +3 not stored
  - Streak factor: 3+ consecutive games over line = +4 bonus

PrizePicks tiers stored: standard, goblin only (demon skipped)
Implied probability: 57.7% (6-pick flex break-even)
"""

import asyncio, httpx, json, logging, sys
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from src.etl.db import get_conn, init_pool

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")
logger = logging.getLogger("props_board")

ESPN_SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary"
PP_URL       = "https://api.prizepicks.com/projections"
HEADERS      = {"User-Agent": "Mozilla/5.0"}
PP_HEADERS   = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "application/json",
    "Referer": "https://app.prizepicks.com/",
    "Origin": "https://app.prizepicks.com",
}

PP_IMPLIED_PROB  = 57.7
PP_AMERICAN_ODDS = -136

PP_STAT_MAP = {
    "Points":        "pts",
    "Rebounds":      "reb",
    "Assists":       "ast",
    "3-PT Made":     "fg3m",
    "Steals":        "stl",
    "Blocked Shots": "blk",
}

PP_TEAM_MAP = {
    "ATL":"ATL","BOS":"BOS","BKN":"BKN","CHA":"CHA","CHI":"CHI",
    "CLE":"CLE","DAL":"DAL","DEN":"DEN","DET":"DET","GSW":"GSW",
    "HOU":"HOU","IND":"IND","LAC":"LAC","LAL":"LAL","MEM":"MEM",
    "MIA":"MIA","MIL":"MIL","MIN":"MIN","NOP":"NOP","NYK":"NYK",
    "OKC":"OKC","ORL":"ORL","PHI":"PHI","PHX":"PHX","POR":"POR",
    "SAC":"SAC","SAS":"SAS","TOR":"TOR","UTA":"UTA","WAS":"WAS",
}

ABBR_NORMALIZE = {
    "SA":"SAS","NO":"NOP","GS":"GSW","NY":"NYK","WSH":"WAS","UTAH":"UTA","PHO":"PHX",
}

# Stat-specific L10 avg contribution per unit above/below line
# Based on outcome data: STL/BLK/AST are more predictable, REB/PTS less so
STAT_AVG_WEIGHT = {
    "pts":  2.0,   # was 2.5 — less predictable (55.4% accuracy)
    "reb":  1.5,   # was 2.5 — weakest signal (53.6% accuracy)
    "ast":  3.0,   # was 2.5 — solid signal (62.6% accuracy)
    "fg3m": 2.5,   # unchanged (57.7% accuracy = neutral)
    "stl":  3.5,   # was 2.5 — strong signal (68.4% accuracy)
    "blk":  3.5,   # was 2.5 — strong signal (65.4% accuracy)
}

def ensure_table():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS prop_board (
                    prop_id          SERIAL PRIMARY KEY,
                    player_name      VARCHAR(100) NOT NULL,
                    team             VARCHAR(5),
                    opponent         VARCHAR(5),
                    is_home          BOOLEAN,
                    stat             VARCHAR(20) NOT NULL,
                    odds_type        VARCHAR(10) NOT NULL DEFAULT 'standard',
                    line             FLOAT NOT NULL,
                    pp_implied_prob  FLOAT DEFAULT 57.7,
                    pp_american_odds INTEGER DEFAULT -136,
                    avg_season       FLOAT,
                    avg_last5        FLOAT,
                    avg_last10       FLOAT,
                    avg_last20       FLOAT,
                    home_avg         FLOAT,
                    away_avg         FLOAT,
                    hit_rate_season  FLOAT,
                    hit_rate_last5   FLOAT,
                    hit_rate_last10  FLOAT,
                    composite_score  FLOAT,
                    score_label      VARCHAR(30),
                    score_color      VARCHAR(10),
                    factors          JSONB,
                    game_log         JSONB,
                    is_b2b           BOOLEAN DEFAULT FALSE,
                    rest_days        INTEGER,
                    opp_def_label    VARCHAR(20),
                    opp_def_margin   FLOAT,
                    computed_at      TIMESTAMPTZ DEFAULT NOW(),
                    game_date        DATE NOT NULL,
                    UNIQUE (player_name, stat, odds_type, game_date)
                )
            """)
            for col, defn in [
                ("odds_type",        "VARCHAR(10) NOT NULL DEFAULT 'standard'"),
                ("pp_implied_prob",  "FLOAT DEFAULT 57.7"),
                ("pp_american_odds", "INTEGER DEFAULT -136"),
            ]:
                cur.execute(f"ALTER TABLE prop_board ADD COLUMN IF NOT EXISTS {col} {defn}")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_prop_board_date  ON prop_board(game_date)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_prop_board_score ON prop_board(composite_score DESC)")

async def fetch_prizepicks_props(client):
    """Fetch props — SKIPS demon tier entirely (16.3% accuracy)."""
    try:
        r = await client.get(PP_URL,
            params={"league_id": 7, "per_page": 500, "single_stat": "true"},
            headers=PP_HEADERS, timeout=15)
        if r.status_code != 200:
            logger.error(f"PrizePicks {r.status_code}: {r.text[:200]}")
            return {}
        data = r.json()
    except Exception as e:
        logger.error(f"PrizePicks fetch failed: {e}")
        return {}

    projections = data.get("data", [])
    included    = {i["id"]: i for i in data.get("included", [])}
    all_props   = defaultdict(lambda: defaultdict(dict))
    skipped_demons = 0

    for proj in projections:
        attrs     = proj.get("attributes", {})
        pp_stat   = attrs.get("stat_type", "")
        stat      = PP_STAT_MAP.get(pp_stat)
        odds_type = attrs.get("odds_type", "standard")

        if not stat:
            continue

        # SKIP demons — 16.3% accuracy, systematically wrong
        if odds_type == "demon":
            skipped_demons += 1
            continue

        line = attrs.get("line_score")
        if line is None:
            continue
        line = float(line)

        player_id   = proj.get("relationships", {}).get("new_player", {}).get("data", {}).get("id")
        player_obj  = included.get(player_id, {})
        p_attrs     = player_obj.get("attributes", {})
        player_name = p_attrs.get("display_name", "")
        pp_team     = p_attrs.get("team_abbreviation") or p_attrs.get("team", "")
        team_abbr   = PP_TEAM_MAP.get(pp_team, pp_team)

        if not player_name:
            continue

        pkey = player_name.lower()
        if odds_type not in all_props[pkey][stat]:
            all_props[pkey][stat][odds_type] = {
                "player_name": player_name,
                "line":        line,
                "team":        team_abbr,
                "odds_type":   odds_type,
            }

    total = sum(len(ot) for sv in all_props.values() for ot in sv.values())
    logger.info(f"PrizePicks: {len(all_props)} players, {total} props (skipped {skipped_demons} demons)")
    return all_props

def normalize(abbr):
    return ABBR_NORMALIZE.get(abbr, abbr)

async def fetch_player_logs(client, player_name, team_abbr, n_games=20):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT g.game_id, g.game_date, th.abbreviation, ta.abbreviation
                FROM games g
                JOIN teams th ON th.team_id = g.home_team_id
                JOIN teams ta ON ta.team_id = g.away_team_id
                WHERE g.season_id = '2025-26' AND g.home_score IS NOT NULL
                AND (th.abbreviation = %s OR ta.abbreviation = %s)
                ORDER BY g.game_date DESC LIMIT %s
            """, (team_abbr, team_abbr, n_games))
            games = cur.fetchall()

    results = []
    for game_id, game_date, home_abbr, away_abbr in games:
        espn_id = game_id.replace("espn_", "")
        try:
            r    = await client.get(ESPN_SUMMARY, params={"event": espn_id}, timeout=8)
            data = r.json()
        except Exception:
            continue

        is_home = (home_abbr == team_abbr)
        opp     = away_abbr if is_home else home_abbr

        for boxscore in data.get("boxscore", {}).get("players", []):
            t_abbr = normalize(boxscore.get("team", {}).get("abbreviation", ""))
            if t_abbr != team_abbr:
                continue
            for stat_group in boxscore.get("statistics", []):
                labels = stat_group.get("labels", [])
                for athlete in stat_group.get("athletes", []):
                    name = athlete.get("athlete", {}).get("displayName", "")
                    if not all(tok in name.lower() for tok in player_name.lower().split()):
                        continue
                    stats = athlete.get("stats", [])
                    if not stats or stats[0] == "DNP":
                        continue
                    try:
                        def get_stat(label, default=0, _l=labels, _s=stats):
                            if label not in _l: return default
                            idx = _l.index(label)
                            val = _s[idx] if idx < len(_s) else None
                            if val is None or val in ("", "DNP"): return default
                            if "-" in str(val) and label in ("FG","3PT","FT"):
                                return int(str(val).split("-")[0])
                            try: return float(val)
                            except: return default

                        minutes = get_stat("MIN")
                        if minutes < 1: continue
                        results.append({
                            "date": str(game_date), "opp": opp, "is_home": is_home,
                            "min":  minutes,
                            "pts":  int(get_stat("PTS")),
                            "reb":  int(get_stat("REB")),
                            "ast":  int(get_stat("AST")),
                            "stl":  int(get_stat("STL")),
                            "blk":  int(get_stat("BLK")),
                            "fg3m": int(get_stat("3PT")),
                        })
                    except Exception:
                        continue
    return results

def compute_stats(logs, stat, line):
    vals = [g[stat] for g in logs if g.get("min", 0) >= 10]
    if not vals: return None
    def avg(arr): return round(sum(arr)/len(arr), 1) if arr else None
    def hr(arr):  return round(sum(1 for v in arr if v > line)/len(arr)*100, 1) if arr else None
    home = [g[stat] for g in logs if     g.get("is_home") and g.get("min",0) >= 10]
    away = [g[stat] for g in logs if not g.get("is_home") and g.get("min",0) >= 10]

    # Streak: how many consecutive recent games over the line
    streak = 0
    for g in logs:
        if g.get("min", 0) >= 10 and g[stat] > line:
            streak += 1
        else:
            break

    return {
        "avg_season":      avg(vals),
        "avg_last5":       avg(vals[:5]),
        "avg_last10":      avg(vals[:10]),
        "avg_last20":      avg(vals[:20]),
        "home_avg":        avg(home),
        "away_avg":        avg(away),
        "hit_rate_season": hr(vals),
        "hit_rate_last5":  hr(vals[:5]),
        "hit_rate_last10": hr(vals[:10]),
        "streak":          streak,
        "game_log": [
            {"date": g["date"], "opp": g["opp"], "home": g["is_home"],
             "val": g[stat], "min": g["min"]} for g in logs[:20]
        ],
    }

def compute_score(stats, opp_def_margin, is_b2b, is_home, line, stat, odds_type):
    """
    v10 improvements (data-driven from 1,026 outcome sample):
    - Stat-specific avg weights (STL/BLK/AST boosted, REB reduced)
    - L5 hit rate weight increased to 0.40
    - Season hit rate weight decreased to 0.15
    - Consistency bonus: L5 AND L10 both above line = +3
    - Hot streak bonus: 3+ consecutive games over line = +4
    - Toss-up filter applied at storage level (edge -3 to +3 skipped)
    """
    score   = PP_IMPLIED_PROB
    factors = []

    # 1. L5 hit rate (40% weight — most recent, most predictive)
    if stats.get("hit_rate_last5") is not None:
        delta = stats["hit_rate_last5"] - PP_IMPLIED_PROB
        score += delta * 0.40
        factors.append({"label": "Last 5 hit rate", "value": f"{stats['hit_rate_last5']}%",
                         "impact": "positive" if delta > 0 else "negative"})

    # 2. Season hit rate (15% weight — reduced, less predictive than recent)
    if stats.get("hit_rate_season") is not None:
        delta = stats["hit_rate_season"] - PP_IMPLIED_PROB
        score += delta * 0.15
        factors.append({"label": "Season hit rate", "value": f"{stats['hit_rate_season']}%",
                         "impact": "positive" if delta > 0 else "negative"})

    # 3. L10 avg vs line — stat-specific weight
    if stats.get("avg_last10") is not None:
        margin = stats["avg_last10"] - line
        weight = STAT_AVG_WEIGHT.get(stat, 2.5)
        contribution = max(-10, min(10, margin * weight))
        score += contribution
        factors.append({"label": f"L10 avg vs line", "value": f"{'+' if margin>=0 else ''}{margin:.1f}",
                         "impact": "positive" if margin > 0 else "negative"})

    # 4. Consistency bonus: both L5 and L10 avg above line = high confidence
    l5_avg  = stats.get("avg_last5")
    l10_avg = stats.get("avg_last10")
    if l5_avg is not None and l10_avg is not None:
        if l5_avg > line and l10_avg > line:
            score += 3.0
            factors.append({"label": "Consistent form", "value": "L5+L10 both above", "impact": "positive"})
        elif l5_avg < line and l10_avg < line:
            score -= 3.0
            factors.append({"label": "Consistent slump", "value": "L5+L10 both below", "impact": "negative"})

    # 5. Hot streak bonus: 3+ consecutive games over line
    streak = stats.get("streak", 0)
    if streak >= 5:
        score += 5.0
        factors.append({"label": "Hot streak", "value": f"{streak} straight", "impact": "positive"})
    elif streak >= 3:
        score += 3.0
        factors.append({"label": "Hot streak", "value": f"{streak} straight", "impact": "positive"})

    # 6. Opponent defense
    if opp_def_margin is not None:
        score -= opp_def_margin * 1.5
        lbl = "good" if opp_def_margin < -2 else "poor" if opp_def_margin > 2 else "average"
        factors.append({"label": "Opp defense", "value": lbl,
                         "impact": "negative" if opp_def_margin < -1 else "positive" if opp_def_margin > 1 else "neutral"})

    # 7. Back-to-back penalty
    if is_b2b:
        score -= 5
        factors.append({"label": "Back-to-back", "value": "yes", "impact": "negative"})

    # 8. Home court
    if is_home:
        score += 1.5
        factors.append({"label": "Home game", "value": "yes", "impact": "positive"})

    score = max(5, min(95, score))
    edge  = score - PP_IMPLIED_PROB

    if odds_type == "goblin":
        # Goblin: over only, easy line — label reflects confidence in the over
        if edge >= 10:   label, color = "Strong Over",  "#4ade80"
        elif edge >= 4:  label, color = "Lean Over",    "#86efac"
        elif edge <= -4: label, color = "Risky Pick",   "#f87171"
        else:            label, color = "Marginal",     "#fbbf24"
    else:
        # Standard: over or under
        if edge >= 10:    label, color = "Strong Over",  "#4ade80"
        elif edge >= 4:   label, color = "Lean Over",    "#86efac"
        elif edge <= -10: label, color = "Strong Under", "#f87171"
        elif edge <= -4:  label, color = "Lean Under",   "#fb923c"
        else:             label, color = "Toss-up",      "#fbbf24"

    return round(score, 1), label, color, factors

def get_opp_defense(opp_abbr):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT ROUND(AVG(
                        CASE WHEN g.home_team_id = t.team_id THEN g.away_score - g.home_score
                             ELSE g.home_score - g.away_score END
                    )::numeric, 1)
                    FROM teams t
                    JOIN games g ON (g.home_team_id = t.team_id OR g.away_team_id = t.team_id)
                    WHERE t.abbreviation = %s AND g.season_id = '2025-26' AND g.home_score IS NOT NULL
                """, (opp_abbr,))
                row = cur.fetchone()
                return float(row[0]) if row and row[0] else 0.0
    except Exception: return 0.0

def get_rest_info(team_abbr):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT g.home_b2b, g.away_b2b, g.home_rest_days, g.away_rest_days,
                           th.abbreviation, ta.abbreviation
                    FROM games g
                    JOIN teams th ON th.team_id = g.home_team_id
                    JOIN teams ta ON ta.team_id = g.away_team_id
                    WHERE g.season_id = '2025-26' AND g.home_score IS NULL
                    AND (th.abbreviation = %s OR ta.abbreviation = %s)
                    ORDER BY g.game_date ASC LIMIT 1
                """, (team_abbr, team_abbr))
                row = cur.fetchone()
                if row:
                    is_home = row[4] == team_abbr
                    return {"is_b2b": bool(row[0] if is_home else row[1]),
                            "rest_days": row[2] if is_home else row[3]}
    except Exception: pass
    return {}

def get_team_game_info(team_abbr):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT th.abbreviation, ta.abbreviation
                    FROM games g
                    JOIN teams th ON th.team_id = g.home_team_id
                    JOIN teams ta ON ta.team_id = g.away_team_id
                    WHERE g.season_id = '2025-26' AND g.home_score IS NULL
                    AND (th.abbreviation = %s OR ta.abbreviation = %s)
                    ORDER BY g.game_date ASC LIMIT 1
                """, (team_abbr, team_abbr))
                row = cur.fetchone()
                if row:
                    home_abbr, away_abbr = row
                    is_home = home_abbr == team_abbr
                    return {"home": home_abbr, "away": away_abbr,
                            "is_home": is_home,
                            "opponent": away_abbr if is_home else home_abbr}
    except Exception: pass
    return {}

async def run():
    init_pool()
    ensure_table()

    pst   = timezone(timedelta(hours=-8))
    today = datetime.now(pst).date()

    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True) as client:
        logger.info("Fetching NBA props from PrizePicks (v10 model)...")
        all_props = await fetch_prizepicks_props(client)

        if not all_props:
            logger.info("No props from PrizePicks — exiting")
            return

        rows_written  = 0
        rows_skipped  = 0

        for pkey, stat_map in all_props.items():
            first_prop  = next(prop for sv in stat_map.values() for prop in sv.values())
            player_name = first_prop["player_name"]
            team_abbr   = first_prop.get("team", "")

            if not team_abbr:
                continue

            game_info   = get_team_game_info(team_abbr)
            is_home     = game_info.get("is_home", False)
            opponent    = game_info.get("opponent", "")
            player_logs = await fetch_player_logs(client, player_name, team_abbr)
            rest        = get_rest_info(team_abbr)
            is_b2b      = rest.get("is_b2b", False)
            rest_days   = rest.get("rest_days", 1)
            opp_def     = get_opp_defense(opponent) if opponent else 0.0
            opp_def_label = "good" if opp_def < -2 else "poor" if opp_def > 2 else "average"

            for stat, tiers in stat_map.items():
                for odds_type, prop_info in tiers.items():
                    line  = prop_info["line"]
                    stats = compute_stats(player_logs, stat, line) if player_logs else None

                    if stats:
                        comp_score, score_label, score_color, factors = compute_score(
                            stats, opp_def, is_b2b, is_home, line, stat, odds_type
                        )
                    else:
                        comp_score  = PP_IMPLIED_PROB
                        score_label = "Insufficient data"
                        score_color = "#555"
                        factors     = [{"label": "No history", "value": "—", "impact": "neutral"}]

                    # Skip toss-ups for standard props — no actionable signal
                    edge = comp_score - PP_IMPLIED_PROB
                    if odds_type == "standard" and abs(edge) < 3:
                        rows_skipped += 1
                        continue

                    with get_conn() as conn:
                        with conn.cursor() as cur:
                            cur.execute("""
                                INSERT INTO prop_board (
                                    player_name, team, opponent, is_home,
                                    stat, odds_type, line,
                                    pp_implied_prob, pp_american_odds,
                                    avg_season, avg_last5, avg_last10, avg_last20,
                                    home_avg, away_avg,
                                    hit_rate_season, hit_rate_last5, hit_rate_last10,
                                    composite_score, score_label, score_color,
                                    factors, game_log,
                                    is_b2b, rest_days, opp_def_label, opp_def_margin,
                                    game_date
                                ) VALUES (
                                    %s,%s,%s,%s,%s,%s,%s,%s,%s,
                                    %s,%s,%s,%s,%s,%s,%s,%s,%s,
                                    %s,%s,%s,%s,%s,%s,%s,%s,%s,%s
                                )
                                ON CONFLICT (player_name, stat, odds_type, game_date) DO UPDATE SET
                                    line            = EXCLUDED.line,
                                    composite_score = EXCLUDED.composite_score,
                                    score_label     = EXCLUDED.score_label,
                                    score_color     = EXCLUDED.score_color,
                                    avg_last5       = EXCLUDED.avg_last5,
                                    avg_last10      = EXCLUDED.avg_last10,
                                    hit_rate_last5  = EXCLUDED.hit_rate_last5,
                                    hit_rate_last10 = EXCLUDED.hit_rate_last10,
                                    factors         = EXCLUDED.factors,
                                    game_log        = EXCLUDED.game_log,
                                    computed_at     = NOW()
                            """, (
                                player_name, team_abbr, opponent, is_home,
                                stat, odds_type, line,
                                PP_IMPLIED_PROB, PP_AMERICAN_ODDS,
                                stats.get("avg_season")      if stats else None,
                                stats.get("avg_last5")       if stats else None,
                                stats.get("avg_last10")      if stats else None,
                                stats.get("avg_last20")      if stats else None,
                                stats.get("home_avg")        if stats else None,
                                stats.get("away_avg")        if stats else None,
                                stats.get("hit_rate_season") if stats else None,
                                stats.get("hit_rate_last5")  if stats else None,
                                stats.get("hit_rate_last10") if stats else None,
                                comp_score, score_label, score_color,
                                json.dumps(factors),
                                json.dumps(stats.get("game_log",[]) if stats else []),
                                is_b2b, rest_days, opp_def_label, opp_def,
                                today,
                            ))
                    rows_written += 1

        logger.info(f"Written {rows_written} props, skipped {rows_skipped} toss-ups for {today}")

if __name__ == "__main__":
    asyncio.run(run())
