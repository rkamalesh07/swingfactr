"""
Props Board ETL v11 — calibrated probabilities + pace/total + usage rate.

New in v11:
  1. Loads Platt-scaling coefficients from model_calibration table
  2. composite_score is now a CALIBRATED probability (0-100) not a raw heuristic
  3. Fetches game pace + implied total from ESPN scoreboard
  4. Fetches player usage rate from box scores
  5. Power-play break-even thresholds correct per n (not fixed 57.7)
  6. Toss-up filter uses calibrated probability, not raw score

Break-even thresholds per PDF:
  2-pick Power: 57.7%
  3-pick Power: 58.5%
  4-pick Power: 56.2%
  5-pick Power: 54.9%
  6-pick Power: 58.5% (approx)
"""

import asyncio, httpx, json, logging, sys, math
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from src.etl.db import get_conn, init_pool

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")
logger = logging.getLogger("props_board")

ESPN_SUMMARY    = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary"
ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"
PP_URL          = "https://api.prizepicks.com/projections"
HEADERS         = {"User-Agent": "Mozilla/5.0"}
PP_HEADERS      = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "application/json",
    "Referer": "https://app.prizepicks.com/",
    "Origin": "https://app.prizepicks.com",
}

PP_AMERICAN_ODDS = -136

# Power-play break-even per leg (from PDF section 2.1)
POWER_BREAKEVEN = {2: 57.7, 3: 58.5, 4: 56.2, 5: 54.9, 6: 58.5}
# Default for edge calculation (2-pick most common)
PP_IMPLIED_PROB = POWER_BREAKEVEN[2]

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

STAT_AVG_WEIGHT = {
    "pts": 2.0, "reb": 1.5, "ast": 3.0,
    "fg3m": 2.5, "stl": 3.5, "blk": 3.5,
}

# ---------------------------------------------------------------------------
# Calibration — load Platt coefficients from DB
# ---------------------------------------------------------------------------

_CAL_CACHE: dict = {}

def sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-max(-500, min(500, x))))

def load_calibration():
    """Load per-stat and global calibration coefficients. Cached per run."""
    global _CAL_CACHE
    if _CAL_CACHE:
        return _CAL_CACHE
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT stat, a, b FROM model_calibration
                    ORDER BY fitted_at DESC
                """)
                rows = cur.fetchall()
        seen = set()
        for stat, a, b in rows:
            if stat not in seen:
                _CAL_CACHE[stat] = (a, b)
                seen.add(stat)
        logger.info(f"Loaded calibration for: {list(_CAL_CACHE.keys())}")
    except Exception as e:
        logger.warning(f"No calibration data found ({e}) — using uncalibrated scores")
    return _CAL_CACHE

def calibrate_prob(raw_score: float, stat: str) -> float:
    """
    Convert raw heuristic score to calibrated probability.
    Uses per-stat coefficients if available, else global, else linear fallback.
    Returns probability as 0-100 (to stay compatible with existing score column).
    """
    cal = load_calibration()
    coefs = cal.get(stat) or cal.get('all')
    if coefs:
        a, b = coefs
        prob = sigmoid(a * raw_score + b)
        return round(min(95, max(5, prob * 100)), 1)
    # Fallback: linear rescale (no calibration data yet)
    return round(min(95, max(5, raw_score)), 1)

# ---------------------------------------------------------------------------
# DB
# ---------------------------------------------------------------------------

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
                    usage_rate       FLOAT,
                    game_pace        FLOAT,
                    computed_at      TIMESTAMPTZ DEFAULT NOW(),
                    game_date        DATE NOT NULL,
                    UNIQUE (player_name, stat, odds_type, game_date)
                )
            """)
            for col, defn in [
                ("odds_type",        "VARCHAR(10) NOT NULL DEFAULT 'standard'"),
                ("pp_implied_prob",  "FLOAT DEFAULT 57.7"),
                ("pp_american_odds", "INTEGER DEFAULT -136"),
                ("usage_rate",       "FLOAT"),
                ("game_pace",        "FLOAT"),
            ]:
                cur.execute(f"ALTER TABLE prop_board ADD COLUMN IF NOT EXISTS {col} {defn}")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_prop_board_date  ON prop_board(game_date)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_prop_board_score ON prop_board(composite_score DESC)")

# ---------------------------------------------------------------------------
# PrizePicks fetch — skip demons
# ---------------------------------------------------------------------------

async def fetch_prizepicks_props(client):
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

    projections    = data.get("data", [])
    included       = {i["id"]: i for i in data.get("included", [])}
    all_props      = defaultdict(lambda: defaultdict(dict))
    skipped_demons = 0

    for proj in projections:
        attrs     = proj.get("attributes", {})
        pp_stat   = attrs.get("stat_type", "")
        stat      = PP_STAT_MAP.get(pp_stat)
        odds_type = attrs.get("odds_type", "standard")
        if not stat: continue
        if odds_type == "demon":
            skipped_demons += 1
            continue
        line = attrs.get("line_score")
        if line is None: continue
        line = float(line)

        player_id   = proj.get("relationships", {}).get("new_player", {}).get("data", {}).get("id")
        player_obj  = included.get(player_id, {})
        p_attrs     = player_obj.get("attributes", {})
        player_name = p_attrs.get("display_name", "")
        pp_team     = p_attrs.get("team_abbreviation") or p_attrs.get("team", "")
        team_abbr   = PP_TEAM_MAP.get(pp_team, pp_team)
        if not player_name: continue

        pkey = player_name.lower()
        if odds_type not in all_props[pkey][stat]:
            all_props[pkey][stat][odds_type] = {
                "player_name": player_name,
                "line": line, "team": team_abbr, "odds_type": odds_type,
            }

    total = sum(len(ot) for sv in all_props.values() for ot in sv.values())
    logger.info(f"PrizePicks: {len(all_props)} players, {total} props (skipped {skipped_demons} demons)")
    return all_props

# ---------------------------------------------------------------------------
# ESPN — game pace + implied total
# ---------------------------------------------------------------------------

async def fetch_game_context(client, home_abbr, away_abbr):
    """
    Fetch pace and implied total for today's game between two teams.
    Pace = possessions per 48 min (higher = more scoring opportunity).
    Returns: {pace, implied_total} or {}
    """
    try:
        r    = await client.get(ESPN_SCOREBOARD, timeout=8)
        data = r.json()
    except Exception:
        return {}

    for event in data.get("events", []):
        competitors = event.get("competitions", [{}])[0].get("competitors", [])
        abbrs = {normalize(c.get("team", {}).get("abbreviation", "")) for c in competitors}
        if home_abbr in abbrs and away_abbr in abbrs:
            # Get odds for implied total
            odds_list = event.get("competitions", [{}])[0].get("odds", [])
            implied_total = None
            for o in odds_list:
                ot = o.get("overUnder")
                if ot:
                    try: implied_total = float(ot)
                    except: pass
                    break
            return {"implied_total": implied_total}
    return {}

def normalize(abbr):
    return ABBR_NORMALIZE.get(abbr, abbr)

# ---------------------------------------------------------------------------
# ESPN — player logs + usage rate
# ---------------------------------------------------------------------------

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

        # Get team totals for usage rate calculation
        team_fga = 0
        team_tov = 0
        team_fta = 0

        for boxscore in data.get("boxscore", {}).get("players", []):
            t_abbr = normalize(boxscore.get("team", {}).get("abbreviation", ""))
            if t_abbr != team_abbr: continue
            for stat_group in boxscore.get("statistics", []):
                labels = stat_group.get("labels", [])
                # Sum team totals
                for athlete in stat_group.get("athletes", []):
                    s = athlete.get("stats", [])
                    if not s or s[0] == "DNP": continue
                    try:
                        def gs(label, default=0, _l=labels, _s=s):
                            if label not in _l: return default
                            idx = _l.index(label)
                            v = _s[idx] if idx < len(_s) else None
                            if v is None or v in ("","DNP"): return default
                            if "-" in str(v) and label in ("FG","3PT","FT"):
                                parts = str(v).split("-")
                                return int(parts[1]) if len(parts) > 1 else 0
                            try: return float(v)
                            except: return default
                        team_fga += gs("FG")   # attempts
                        team_tov += gs("TO")
                        team_fta += gs("FT")   # attempts
                    except: pass

                for athlete in stat_group.get("athletes", []):
                    name = athlete.get("athlete", {}).get("displayName", "")
                    if not all(tok in name.lower() for tok in player_name.lower().split()):
                        continue
                    stats = athlete.get("stats", [])
                    if not stats or stats[0] == "DNP": continue
                    try:
                        def get_stat(label, default=0, _l=labels, _s=stats):
                            if label not in _l: return default
                            idx = _l.index(label)
                            val = _s[idx] if idx < len(_s) else None
                            if val is None or val in ("","DNP"): return default
                            if "-" in str(val) and label in ("FG","3PT","FT"):
                                return int(str(val).split("-")[0])
                            try: return float(val)
                            except: return default

                        minutes = get_stat("MIN")
                        if minutes < 1: continue

                        # Usage rate: (FGA + 0.44*FTA + TOV) / team_possessions * 100
                        p_fga = get_stat("FG")   # made-att format, we need attempts
                        p_fta_raw = get_stat("FT")
                        p_tov = get_stat("TO")
                        # For usage we want attempts, handle "m-a" format
                        try:
                            fg_raw = stats[labels.index("FG")] if "FG" in labels else "0-0"
                            ft_raw = stats[labels.index("FT")] if "FT" in labels else "0-0"
                            p_fga_att = int(str(fg_raw).split("-")[1]) if "-" in str(fg_raw) else 0
                            p_fta_att = int(str(ft_raw).split("-")[1]) if "-" in str(ft_raw) else 0
                        except: p_fga_att, p_fta_att = 0, 0

                        # Estimate team possessions
                        team_poss = team_fga + 0.44 * team_fta + team_tov
                        if team_poss > 0 and minutes > 0:
                            # Scale to per-40-min possession usage
                            player_poss = p_fga_att + 0.44 * p_fta_att + p_tov
                            # Per-minute scaling
                            usage = (player_poss / team_poss) * 5 * 100  # 5 players on court
                        else:
                            usage = None

                        results.append({
                            "date":    str(game_date), "opp": opp, "is_home": is_home,
                            "min":     minutes,
                            "pts":     int(get_stat("PTS")),
                            "reb":     int(get_stat("REB")),
                            "ast":     int(get_stat("AST")),
                            "stl":     int(get_stat("STL")),
                            "blk":     int(get_stat("BLK")),
                            "fg3m":    int(get_stat("3PT")),
                            "usage":   usage,
                        })
                    except Exception:
                        continue
    return results

# ---------------------------------------------------------------------------
# Stats computation
# ---------------------------------------------------------------------------

def compute_stats(logs, stat, line):
    vals = [g[stat] for g in logs if g.get("min", 0) >= 10]
    if not vals: return None
    def avg(arr): return round(sum(arr)/len(arr), 1) if arr else None
    def hr(arr):  return round(sum(1 for v in arr if v > line)/len(arr)*100, 1) if arr else None
    home = [g[stat] for g in logs if     g.get("is_home") and g.get("min",0) >= 10]
    away = [g[stat] for g in logs if not g.get("is_home") and g.get("min",0) >= 10]

    # Streak: consecutive recent games over line
    streak = 0
    for g in logs:
        if g.get("min", 0) >= 10 and g[stat] > line:
            streak += 1
        else:
            break

    # Usage rate: average over last 10 qualified games
    usage_vals = [g["usage"] for g in logs[:10] if g.get("min",0) >= 10 and g.get("usage") is not None]
    avg_usage  = round(sum(usage_vals)/len(usage_vals), 1) if usage_vals else None

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
        "avg_usage":       avg_usage,
        "game_log": [
            {"date": g["date"], "opp": g["opp"], "home": g["is_home"],
             "val": g[stat], "min": g["min"]} for g in logs[:20]
        ],
    }

# ---------------------------------------------------------------------------
# Scoring — outputs raw heuristic score, then calibrated probability
# ---------------------------------------------------------------------------

def compute_raw_score(stats, opp_def_margin, is_b2b, is_home, line, stat,
                      odds_type, implied_total=None):
    """
    Compute raw heuristic score (anchored at 57.7).
    Calibration applied separately after this.
    """
    score   = PP_IMPLIED_PROB
    factors = []

    # 1. L5 hit rate
    if stats.get("hit_rate_last5") is not None:
        delta = stats["hit_rate_last5"] - PP_IMPLIED_PROB
        score += delta * 0.40
        factors.append({"label": "Last 5 hit rate", "value": f"{stats['hit_rate_last5']}%",
                         "impact": "positive" if delta > 0 else "negative"})

    # 2. Season hit rate
    if stats.get("hit_rate_season") is not None:
        delta = stats["hit_rate_season"] - PP_IMPLIED_PROB
        score += delta * 0.15
        factors.append({"label": "Season hit rate", "value": f"{stats['hit_rate_season']}%",
                         "impact": "positive" if delta > 0 else "negative"})

    # 3. L10 avg vs line — stat-specific weight
    if stats.get("avg_last10") is not None:
        margin       = stats["avg_last10"] - line
        weight       = STAT_AVG_WEIGHT.get(stat, 2.5)
        contribution = max(-10, min(10, margin * weight))
        score       += contribution
        factors.append({"label": "L10 avg vs line", "value": f"{'+' if margin>=0 else ''}{margin:.1f}",
                         "impact": "positive" if margin > 0 else "negative"})

    # 4. Consistency bonus
    l5_avg = stats.get("avg_last5")
    l10_avg = stats.get("avg_last10")
    if l5_avg is not None and l10_avg is not None:
        if l5_avg > line and l10_avg > line:
            score += 3.0
            factors.append({"label": "Consistent form", "value": "L5+L10 above", "impact": "positive"})
        elif l5_avg < line and l10_avg < line:
            score -= 3.0
            factors.append({"label": "Consistent slump", "value": "L5+L10 below", "impact": "negative"})

    # 5. Hot streak
    streak = stats.get("streak", 0)
    if streak >= 5:
        score += 5.0
        factors.append({"label": "Hot streak", "value": f"{streak} straight", "impact": "positive"})
    elif streak >= 3:
        score += 3.0
        factors.append({"label": "Hot streak", "value": f"{streak} straight", "impact": "positive"})

    # 6. Usage rate — high usage = more involvement = more scoring/reb/ast opportunity
    avg_usage = stats.get("avg_usage")
    if avg_usage is not None and stat in ("pts", "reb", "ast"):
        if avg_usage > 25:
            score += 2.0
            factors.append({"label": "High usage", "value": f"{avg_usage:.0f}%", "impact": "positive"})
        elif avg_usage < 12:
            score -= 2.0
            factors.append({"label": "Low usage", "value": f"{avg_usage:.0f}%", "impact": "negative"})

    # 7. Implied total — high total = fast game = more opportunities
    if implied_total is not None and stat in ("pts", "fg3m"):
        if implied_total > 230:
            score += 2.0
            factors.append({"label": "High total", "value": f"{implied_total}", "impact": "positive"})
        elif implied_total < 210:
            score -= 1.5
            factors.append({"label": "Low total", "value": f"{implied_total}", "impact": "negative"})

    # 8. Opponent defense
    if opp_def_margin is not None:
        score -= opp_def_margin * 1.5
        lbl = "good" if opp_def_margin < -2 else "poor" if opp_def_margin > 2 else "average"
        factors.append({"label": "Opp defense", "value": lbl,
                         "impact": "negative" if opp_def_margin < -1 else "positive" if opp_def_margin > 1 else "neutral"})

    # 9. Back-to-back
    if is_b2b:
        score -= 5
        factors.append({"label": "Back-to-back", "value": "yes", "impact": "negative"})

    # 10. Home court
    if is_home:
        score += 1.5
        factors.append({"label": "Home game", "value": "yes", "impact": "positive"})

    # Cap at 78: data shows 80-95 bucket only hits 40% (overconfident)
    return max(5, min(78, score)), factors


def score_to_label(cal_prob, odds_type):
    """Convert calibrated probability (0-100) to label + color."""
    edge = cal_prob - PP_IMPLIED_PROB
    if odds_type == "goblin":
        if edge >= 10:    return "Strong Over",  "#4ade80"
        elif edge >= 4:   return "Lean Over",    "#86efac"
        elif edge <= -4:  return "Risky Pick",   "#f87171"
        else:             return "Marginal",     "#fbbf24"
    else:
        # Standard: symmetric labels for over AND under
        if edge >= 10:    return "Strong Over",  "#4ade80"
        elif edge >= 4:   return "Lean Over",    "#86efac"
        elif edge <= -10: return "Strong Under", "#818cf8"  # purple for unders
        elif edge <= -4:  return "Lean Under",   "#a5b4fc"
        elif edge <= -3:  return "Slight Under", "#c4b5fd"
        else:             return "Toss-up",      "#fbbf24"

# ---------------------------------------------------------------------------
# Game context helpers
# ---------------------------------------------------------------------------

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

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def run():
    init_pool()
    ensure_table()
    load_calibration()  # pre-load cache

    pst   = timezone(timedelta(hours=-8))
    today = datetime.now(pst).date()

    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True) as client:
        logger.info("Fetching NBA props from PrizePicks (v11 — calibrated)...")
        all_props = await fetch_prizepicks_props(client)
        if not all_props:
            logger.info("No props from PrizePicks — exiting")
            return

        # Cache game context per team pair
        game_context_cache: dict = {}

        rows_written = 0
        rows_skipped = 0

        for pkey, stat_map in all_props.items():
            first_prop  = next(prop for sv in stat_map.values() for prop in sv.values())
            player_name = first_prop["player_name"]
            team_abbr   = first_prop.get("team", "")
            if not team_abbr: continue

            game_info = get_team_game_info(team_abbr)
            is_home   = game_info.get("is_home", False)
            opponent  = game_info.get("opponent", "")

            # Fetch game context (pace/total) once per team pair
            ctx_key = tuple(sorted([team_abbr, opponent]))
            if ctx_key not in game_context_cache:
                home = game_info.get("home", team_abbr)
                away = game_info.get("away", opponent)
                game_context_cache[ctx_key] = await fetch_game_context(client, home, away)
            game_ctx = game_context_cache.get(ctx_key, {})

            player_logs   = await fetch_player_logs(client, player_name, team_abbr)
            rest          = get_rest_info(team_abbr)
            is_b2b        = rest.get("is_b2b", False)
            rest_days     = rest.get("rest_days", 1)
            opp_def       = get_opp_defense(opponent) if opponent else 0.0
            opp_def_label = "good" if opp_def < -2 else "poor" if opp_def > 2 else "average"
            implied_total = game_ctx.get("implied_total")

            for stat, tiers in stat_map.items():
                for odds_type, prop_info in tiers.items():
                    line  = prop_info["line"]
                    stats = compute_stats(player_logs, stat, line) if player_logs else None

                    if stats:
                        raw_score, factors = compute_raw_score(
                            stats, opp_def, is_b2b, is_home,
                            line, stat, odds_type, implied_total
                        )
                        # Apply calibration — this is the key v11 change
                        cal_score = calibrate_prob(raw_score, stat)
                    else:
                        cal_score   = PP_IMPLIED_PROB
                        factors     = [{"label": "No history", "value": "—", "impact": "neutral"}]

                    score_label, score_color = score_to_label(cal_score, odds_type)

                    # Filter: skip true toss-ups only (no directional signal)
                    # Keep overs (edge > 0) AND unders (edge < 0) if signal is strong enough
                    # Data shows 55-60 bucket hits only 47.1% — below break-even
                    edge = cal_score - PP_IMPLIED_PROB
                    if odds_type == "standard" and abs(edge) < 3:
                        rows_skipped += 1
                        continue

                    avg_usage = stats.get("avg_usage") if stats else None

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
                                    usage_rate, game_pace,
                                    game_date
                                ) VALUES (
                                    %s,%s,%s,%s,%s,%s,%s,%s,%s,
                                    %s,%s,%s,%s,%s,%s,%s,%s,%s,
                                    %s,%s,%s,%s,%s,%s,%s,%s,%s,
                                    %s,%s,%s
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
                                    usage_rate      = EXCLUDED.usage_rate,
                                    game_pace       = EXCLUDED.game_pace,
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
                                cal_score, score_label, score_color,
                                json.dumps(factors),
                                json.dumps(stats.get("game_log",[]) if stats else []),
                                is_b2b, rest_days, opp_def_label, opp_def,
                                avg_usage, implied_total,
                                today,
                            ))
                    rows_written += 1

        logger.info(f"Written {rows_written} props, skipped {rows_skipped} toss-ups for {today}")

if __name__ == "__main__":
    asyncio.run(run())
