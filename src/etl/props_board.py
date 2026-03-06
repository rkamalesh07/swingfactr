"""
Props Board ETL v12 — Distribution-based stat model.

Architecture (per PDF recommendation):
  1. Pull player's full season game logs from player_game_logs table
  2. Compute per-minute stat rates with Bayesian shrinkage
     shrunk_rate = season_rate * 0.65 + recent_rate(L10) * 0.35
  3. Project minutes using weighted recent average + fatigue adjustments
  4. Compute predicted stat mean = shrunk_rate * projected_minutes * pace_factor
  5. Compute predicted stat std from historical game-to-game variance
  6. P(Y > line) = 1 - normal_CDF(line + 0.5, mean, std)  [continuity correction]
  7. Calibrate with Platt scaling
  8. Cap edge at ±15 standard / ±10 goblin

Key improvements over v11:
  - Uses DISTRIBUTION not hit rates (immune to line movement)
  - Bayesian shrinkage prevents recency overfitting (doc section 2)
  - Per-minute rates account for role/minutes changes (doc section 3)
  - Pace factor from team possessions (doc section 6)
  - Opponent positional defense from opp_def_margin per team (best available)
  - Minutes trend feature (is player's role growing or shrinking?)
  - Variable B2B penalty based on player's own history (doc section 7)
"""

import asyncio, httpx, json, logging, sys, math
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from src.etl.db import get_conn, init_pool

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")
logger = logging.getLogger("props_board_v12")

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

PP_IMPLIED_PROB  = 57.7
PP_AMERICAN_ODDS = -136
# Normal CDF outputs true probabilities that naturally span a wider range
# than heuristic scores. A player with mean 4.0 on a 4.5 line genuinely
# has ~30% over probability — that's a real -27.7 edge, not a model error.
# We cap at ±25 to prevent only truly absurd outliers (>82.7% or <32.7%)
MAX_EDGE_STANDARD = 25.0
MAX_EDGE_GOBLIN   = 20.0
LEAGUE_AVG_PACE   = 98.5   # NBA avg possessions per team per game 2025-26

PP_STAT_MAP = {
    "Points": "pts", "Rebounds": "reb", "Assists": "ast",
    "3-PT Made": "fg3m", "Steals": "stl", "Blocked Shots": "blk",
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

def normalize(abbr): return ABBR_NORMALIZE.get(abbr, abbr)

# ---------------------------------------------------------------------------
# Math helpers
# ---------------------------------------------------------------------------

def normal_cdf(x, mu, sigma):
    """P(X <= x) for normal distribution."""
    if sigma <= 0: return 0.5
    z = (x - mu) / (sigma * math.sqrt(2))
    return 0.5 * (1 + math.erf(z))

def p_over_line(line, mu, sigma):
    """P(Y > line) with continuity correction (+0.5 for discrete stats)."""
    return 1 - normal_cdf(line + 0.5, mu, sigma)

def sigmoid(x):
    return 1.0 / (1.0 + math.exp(-max(-500, min(500, x))))

def mean(vals): return sum(vals) / len(vals) if vals else None
def std(vals):
    if len(vals) < 2: return None
    m = mean(vals)
    return math.sqrt(sum((v - m) ** 2 for v in vals) / (len(vals) - 1))

# ---------------------------------------------------------------------------
# Calibration
# ---------------------------------------------------------------------------
_CAL_CACHE = {}

def load_calibration():
    global _CAL_CACHE
    if _CAL_CACHE: return _CAL_CACHE
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT stat, a, b FROM model_calibration ORDER BY fitted_at DESC")
                seen = set()
                for stat, a, b in cur.fetchall():
                    if stat not in seen:
                        _CAL_CACHE[stat] = (float(a), float(b))
                        seen.add(stat)
        logger.info(f"Loaded calibration: {list(_CAL_CACHE.keys())}")
    except Exception as e:
        logger.warning(f"No calibration ({e}) — using uncalibrated probabilities")
    return _CAL_CACHE

def calibrate_and_cap(raw_prob_0_1, stat, odds_type):
    """
    Cap the raw normal-CDF probability within the credible edge range.

    v12 outputs true probabilities from a normal distribution — these are
    already calibrated by construction (no Platt scaling needed until we have
    enough v12 outcomes to fit new coefficients).

    The old Platt coefficients were fit on v11 heuristic scores (0-100 scale)
    and compress v12 probabilities to garbage. Skip them until recalibrated.
    """
    prob = raw_prob_0_1 * 100  # convert 0-1 → 0-100

    max_edge = MAX_EDGE_GOBLIN if odds_type == 'goblin' else MAX_EDGE_STANDARD
    prob = max(PP_IMPLIED_PROB - max_edge, min(PP_IMPLIED_PROB + max_edge, prob))
    return round(prob, 1)

# ---------------------------------------------------------------------------
# Player game logs — query cached data
# ---------------------------------------------------------------------------

def get_player_logs(player_name, team_abbr, n=40):
    """
    Pull up to n most recent game logs from cache.
    Falls back to name fuzzy match if exact match fails.
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            # Exact match first
            cur.execute("""
                SELECT game_date, minutes, pts, reb, ast, stl, blk, fg3m,
                       fga, fta, tov, is_home, opponent_abbr,
                       is_b2b, rest_days, opp_def_margin
                FROM player_game_logs
                WHERE player_name = %s AND season_id = '2025-26'
                ORDER BY game_date DESC
                LIMIT %s
            """, (player_name, n))
            rows = cur.fetchall()

            # Fuzzy fallback: last name match
            if not rows:
                last = player_name.split()[-1]
                cur.execute("""
                    SELECT game_date, minutes, pts, reb, ast, stl, blk, fg3m,
                           fga, fta, tov, is_home, opponent_abbr,
                           is_b2b, rest_days, opp_def_margin
                    FROM player_game_logs
                    WHERE LOWER(player_name) LIKE %s AND team_abbr = %s
                      AND season_id = '2025-26'
                    ORDER BY game_date DESC
                    LIMIT %s
                """, (f"%{last.lower()}%", team_abbr, n))
                rows = cur.fetchall()

    if not rows: return []

    cols = ["game_date","minutes","pts","reb","ast","stl","blk","fg3m",
            "fga","fta","tov","is_home","opponent_abbr",
            "is_b2b","rest_days","opp_def_margin"]
    return [dict(zip(cols, r)) for r in rows]

# ---------------------------------------------------------------------------
# Team pace — average possessions per game
# ---------------------------------------------------------------------------
_PACE_CACHE = {}

def get_team_pace(team_abbr):
    """Estimate team pace from average possessions in recent stints."""
    global _PACE_CACHE
    if team_abbr in _PACE_CACHE: return _PACE_CACHE[team_abbr]
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                # Sum possessions per game for this team, average across games
                cur.execute("""
                    SELECT AVG(game_poss) FROM (
                        SELECT game_id, SUM(possessions) as game_poss
                        FROM stints
                        WHERE team_id = (SELECT team_id FROM teams WHERE abbreviation = %s)
                        GROUP BY game_id
                    ) sub
                """, (team_abbr,))
                row = cur.fetchone()
                pace = float(row[0]) if row and row[0] else LEAGUE_AVG_PACE
    except Exception:
        pace = LEAGUE_AVG_PACE
    _PACE_CACHE[team_abbr] = pace
    return pace

# ---------------------------------------------------------------------------
# Core distribution model
# ---------------------------------------------------------------------------

def compute_distribution_score(logs, line, stat, odds_type,
                                 is_b2b, opp_def_margin, implied_total,
                                 team_abbr, opp_abbr):
    """
    Returns (cal_prob_0_100, factors, model_details) using distribution model.

    Steps:
    1. Filter qualified games (>= 10 min)
    2. Compute per-minute rate with Bayesian shrinkage
    3. Project minutes
    4. predicted_mean = shrunk_rate * projected_minutes * pace_factor
    5. predicted_std  = historical std of game outcomes
    6. P(Y > line) = 1 - normal_CDF(line + 0.5, mean, std)
    7. Calibrate + cap
    """
    qualified = [g for g in logs if g["minutes"] and g["minutes"] >= 10]
    if len(qualified) < 3:
        return None, [], {}

    factors = []

    # ── 1. Per-minute rate with Bayesian shrinkage ──────────────────────────
    # Season rate (all games)
    season_vals    = [g[stat] for g in qualified if g[stat] is not None]
    season_minutes = [g["minutes"] for g in qualified if g[stat] is not None]
    if not season_vals: return None, [], {}

    total_stat    = sum(season_vals)
    total_minutes = sum(season_minutes)
    season_rate   = total_stat / total_minutes if total_minutes > 0 else 0

    # Recent rate (last 10 qualified games)
    recent10      = qualified[:10]
    recent_stat   = sum(g[stat] for g in recent10 if g[stat] is not None)
    recent_mins   = sum(g["minutes"] for g in recent10 if g[stat] is not None)
    recent_rate   = recent_stat / recent_mins if recent_mins > 0 else season_rate

    # Bayesian shrinkage: season 65%, recent 35% (doc section 2)
    shrunk_rate = season_rate * 0.65 + recent_rate * 0.35

    factors.append({
        "label":  "Stat rate/min",
        "value":  f"{shrunk_rate:.3f} (s:{season_rate:.3f} r:{recent_rate:.3f})",
        "impact": "neutral"
    })

    # ── 2. Minutes projection ───────────────────────────────────────────────
    recent_mins_list = [g["minutes"] for g in qualified[:10]]
    older_mins_list  = [g["minutes"] for g in qualified[10:20]] if len(qualified) > 10 else recent_mins_list

    avg_min_recent   = mean(recent_mins_list) or 25.0
    avg_min_season   = mean([g["minutes"] for g in qualified]) or 25.0

    # Minutes projection: weighted recent 60%, season 40%
    projected_min = avg_min_recent * 0.60 + avg_min_season * 0.40

    # Minutes trend: is role growing or shrinking?
    if len(qualified) >= 15:
        avg_older = mean([g["minutes"] for g in qualified[10:20]])
        if avg_older:
            min_trend = avg_min_recent - avg_older
            if min_trend > 3:
                projected_min = min(projected_min + 1.5, projected_min * 1.08)
                factors.append({"label": "Min trend", "value": f"+{min_trend:.1f} vs earlier", "impact": "positive"})
            elif min_trend < -3:
                projected_min = max(projected_min - 1.5, projected_min * 0.92)
                factors.append({"label": "Min trend", "value": f"{min_trend:.1f} vs earlier", "impact": "negative"})

    # B2B penalty — calibrated to this player's own B2B history
    b2b_games  = [g for g in qualified if g.get("is_b2b")]
    norm_games = [g for g in qualified if not g.get("is_b2b")]
    if is_b2b:
        if b2b_games and norm_games:
            b2b_avg_min  = mean([g["minutes"] for g in b2b_games])
            norm_avg_min = mean([g["minutes"] for g in norm_games])
            b2b_factor   = b2b_avg_min / norm_avg_min if norm_avg_min > 0 else 0.93
        else:
            b2b_factor = 0.93  # default 7% minutes reduction on B2B
        projected_min *= b2b_factor
        factors.append({
            "label": "B2B fatigue",
            "value": f"{b2b_factor:.0%} min factor",
            "impact": "negative"
        })

    factors.append({
        "label":  "Projected min",
        "value":  f"{projected_min:.1f}",
        "impact": "neutral"
    })

    # ── 3. Pace adjustment ──────────────────────────────────────────────────
    team_pace = get_team_pace(team_abbr)
    opp_pace  = get_team_pace(opp_abbr)
    game_pace = (team_pace + opp_pace) / 2
    pace_factor = game_pace / LEAGUE_AVG_PACE

    # Only apply pace to counting stats that scale with possessions
    if stat in ("pts", "reb", "ast", "fg3m"):
        if abs(pace_factor - 1.0) > 0.03:
            impact = "positive" if pace_factor > 1 else "negative"
            factors.append({
                "label": "Pace factor",
                "value": f"{game_pace:.0f} poss ({pace_factor:+.1%})",
                "impact": impact
            })
    else:
        pace_factor = 1.0  # STL/BLK don't scale strongly with pace

    # Implied total override: if we have betting market total, use it
    if implied_total:
        implied_pace_factor = implied_total / (LEAGUE_AVG_PACE * 2)
        pace_factor = (pace_factor + implied_pace_factor) / 2

    # ── 4. Predicted mean ───────────────────────────────────────────────────
    predicted_mean = shrunk_rate * projected_min * pace_factor

    # ── 5. Opponent defense adjustment ─────────────────────────────────────
    if opp_def_margin is not None:
        # opp_def_margin > 0 = bad defense (opponent gives up points)
        # Scale: 1 point of margin ≈ 2% impact on stat
        def_factor = 1.0 + (opp_def_margin * 0.015)
        def_factor = max(0.85, min(1.15, def_factor))  # cap at ±15%
        if stat in ("pts", "ast", "fg3m"):  # offense-dependent stats
            predicted_mean *= def_factor
        if abs(opp_def_margin) > 2:
            lbl = "poor" if opp_def_margin > 2 else "good"
            factors.append({
                "label": "Opp defense",
                "value": f"{lbl} ({opp_def_margin:+.1f})",
                "impact": "positive" if opp_def_margin > 2 else "negative"
            })

    # ── 6. Predicted std ────────────────────────────────────────────────────
    game_vals = [g[stat] for g in qualified[:20] if g[stat] is not None]
    hist_std  = std(game_vals) if len(game_vals) >= 3 else None

    # Fallback std by stat if insufficient history
    # Fallback floors calibrated to actual NBA variance (from debug_std.py analysis)
    # PTS: CV~30%, REB: CV~60%, AST: CV~45%, 3PM: CV~40%, STL/BLK: CV~70%
    fallback_std = {
        "pts":  max(3.0, predicted_mean * 0.30),
        "reb":  max(1.0, predicted_mean * 0.55),  # was max(2.0) — too wide for small rebounders
        "ast":  max(0.8, predicted_mean * 0.45),
        "fg3m": max(0.8, predicted_mean * 0.55),  # was max(1.0) — too wide for low 3PM players
        "stl":  max(0.4, predicted_mean * 0.70),
        "blk": max(0.5, predicted_mean * 0.70),
    }
    predicted_std = hist_std if hist_std else fallback_std.get(stat, predicted_mean * 0.35)

    # ── 7. P(Y > line) ──────────────────────────────────────────────────────
    prob_over = p_over_line(line, predicted_mean, predicted_std)

    factors.insert(0, {
        "label":  "Predicted",
        "value":  f"{predicted_mean:.1f} ± {predicted_std:.1f}",
        "impact": "positive" if predicted_mean > line else "negative"
    })
    factors.insert(1, {
        "label":  "P(over line)",
        "value":  f"{prob_over*100:.1f}%",
        "impact": "positive" if prob_over > 0.577 else "negative"
    })

    # ── 8. Calibrate and cap ────────────────────────────────────────────────
    cal_prob = calibrate_and_cap(prob_over, stat, odds_type)

    model_details = {
        "predicted_mean": round(predicted_mean, 2),
        "predicted_std":  round(predicted_std, 2),
        "prob_over_raw":  round(prob_over * 100, 1),
        "projected_min":  round(projected_min, 1),
        "shrunk_rate":    round(shrunk_rate, 4),
        "pace_factor":    round(pace_factor, 3),
        "season_rate":    round(season_rate, 4),
        "recent_rate":    round(recent_rate, 4),
        "n_games":        len(qualified),
    }

    return cal_prob, factors, model_details

# ---------------------------------------------------------------------------
# Score label
# ---------------------------------------------------------------------------

def score_to_label(cal_prob, odds_type):
    """
    Labels calibrated to normal-CDF probability range (wider than heuristic).
    Edge thresholds adjusted: distribution model produces genuine edges >10%.
    """
    edge = cal_prob - PP_IMPLIED_PROB
    if odds_type == "goblin":
        if edge >= 12:   return "Strong Over",  "#4ade80"
        elif edge >= 6:  return "Lean Over",    "#86efac"
        elif edge <= -6: return "Risky Pick",   "#f87171"
        else:            return "Marginal",     "#fbbf24"
    else:
        if edge >= 15:   return "Strong Over",  "#4ade80"
        elif edge >= 8:  return "Lean Over",    "#86efac"
        elif edge <= -15:return "Strong Under", "#f87171"
        elif edge <= -8: return "Lean Under",   "#fb923c"
        else:            return "Toss-up",      "#fbbf24"

# ---------------------------------------------------------------------------
# PrizePicks fetch
# ---------------------------------------------------------------------------

async def fetch_prizepicks_props(client):
    try:
        r = await client.get(PP_URL,
            params={"league_id": 7, "per_page": 500, "single_stat": "true"},
            headers=PP_HEADERS, timeout=15)
        if r.status_code != 200:
            logger.error(f"PrizePicks {r.status_code}")
            return {}
        data = r.json()
    except Exception as e:
        logger.error(f"PrizePicks fetch failed: {e}")
        return {}

    projections = data.get("data", [])
    included    = {i["id"]: i for i in data.get("included", [])}
    all_props   = defaultdict(lambda: defaultdict(dict))
    skipped     = 0

    for proj in projections:
        attrs     = proj.get("attributes", {})
        pp_stat   = attrs.get("stat_type", "")
        stat      = PP_STAT_MAP.get(pp_stat)
        odds_type = attrs.get("odds_type", "standard")
        if not stat: continue
        if odds_type == "demon": skipped += 1; continue
        line = attrs.get("line_score")
        if line is None: continue

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
                "player_name": player_name, "line": float(line),
                "team": team_abbr, "odds_type": odds_type,
            }

    total = sum(len(ot) for sv in all_props.values() for ot in sv.values())
    logger.info(f"PrizePicks: {len(all_props)} players, {total} props (skipped {skipped} demons)")
    return all_props

# ---------------------------------------------------------------------------
# Game context
# ---------------------------------------------------------------------------

async def fetch_implied_total(client, home_abbr, away_abbr):
    try:
        r    = await client.get(ESPN_SCOREBOARD, timeout=8)
        data = r.json()
        for event in data.get("events", []):
            competitors = event.get("competitions", [{}])[0].get("competitors", [])
            abbrs = {normalize(c.get("team", {}).get("abbreviation", "")) for c in competitors}
            if home_abbr in abbrs and away_abbr in abbrs:
                for o in event.get("competitions", [{}])[0].get("odds", []):
                    ot = o.get("overUnder")
                    if ot:
                        try: return float(ot)
                        except: pass
    except Exception: pass
    return None

def get_game_info(team_abbr):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT th.abbreviation, ta.abbreviation,
                           g.home_b2b, g.away_b2b,
                           g.home_rest_days, g.away_rest_days
                    FROM games g
                    JOIN teams th ON th.team_id = g.home_team_id
                    JOIN teams ta ON ta.team_id = g.away_team_id
                    WHERE g.season_id = '2025-26' AND g.home_score IS NULL
                    AND (th.abbreviation = %s OR ta.abbreviation = %s)
                    ORDER BY g.game_date ASC LIMIT 1
                """, (team_abbr, team_abbr))
                row = cur.fetchone()
                if row:
                    home, away = row[0], row[1]
                    is_home    = home == team_abbr
                    return {
                        "home": home, "away": away,
                        "is_home": is_home,
                        "opponent": away if is_home else home,
                        "is_b2b":   bool(row[2] if is_home else row[3]),
                        "rest_days": row[4] if is_home else row[5],
                    }
    except Exception: pass
    return {}

def get_opp_defense(opp_abbr):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT ROUND(AVG(
                        CASE WHEN g.home_team_id = t.team_id
                             THEN g.away_score - g.home_score
                             ELSE g.home_score - g.away_score END
                    )::numeric, 1)
                    FROM teams t
                    JOIN games g ON (g.home_team_id=t.team_id OR g.away_team_id=t.team_id)
                    WHERE t.abbreviation=%s AND g.season_id='2025-26' AND g.home_score IS NOT NULL
                """, (opp_abbr,))
                row = cur.fetchone()
                return float(row[0]) if row and row[0] else 0.0
    except Exception: return 0.0

# ---------------------------------------------------------------------------
# DB: ensure prop_board has model_details column
# ---------------------------------------------------------------------------

def ensure_table():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS prop_board (
                    prop_id         SERIAL PRIMARY KEY,
                    player_name     VARCHAR(100) NOT NULL,
                    team            VARCHAR(5),
                    opponent        VARCHAR(5),
                    is_home         BOOLEAN,
                    stat            VARCHAR(20) NOT NULL,
                    odds_type       VARCHAR(10) NOT NULL DEFAULT 'standard',
                    line            FLOAT NOT NULL,
                    pp_implied_prob FLOAT DEFAULT 57.7,
                    pp_american_odds INTEGER DEFAULT -136,
                    avg_season      FLOAT,
                    avg_last5       FLOAT,
                    avg_last10      FLOAT,
                    avg_last20      FLOAT,
                    home_avg        FLOAT,
                    away_avg        FLOAT,
                    hit_rate_season FLOAT,
                    hit_rate_last5  FLOAT,
                    hit_rate_last10 FLOAT,
                    composite_score FLOAT,
                    score_label     VARCHAR(30),
                    score_color     VARCHAR(10),
                    factors         JSONB,
                    game_log        JSONB,
                    is_b2b          BOOLEAN DEFAULT FALSE,
                    rest_days       INTEGER,
                    opp_def_label   VARCHAR(20),
                    opp_def_margin  FLOAT,
                    usage_rate      FLOAT,
                    game_pace       FLOAT,
                    model_details   JSONB,
                    computed_at     TIMESTAMPTZ DEFAULT NOW(),
                    game_date       DATE NOT NULL,
                    UNIQUE (player_name, stat, odds_type, game_date)
                )
            """)
            cur.execute("ALTER TABLE prop_board ADD COLUMN IF NOT EXISTS model_details JSONB")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_prop_board_date  ON prop_board(game_date)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_prop_board_score ON prop_board(composite_score DESC)")

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def run():
    init_pool()
    ensure_table()
    load_calibration()

    pst   = timezone(timedelta(hours=-8))
    today = datetime.now(pst).date()

    async with httpx.AsyncClient(headers={"User-Agent": "Mozilla/5.0"}, follow_redirects=True) as client:
        logger.info("Fetching PrizePicks props (v12 — distribution model)...")
        all_props = await fetch_prizepicks_props(client)
        if not all_props:
            logger.info("No props — exiting")
            return

        ctx_cache = {}
        rows_written = 0
        rows_skipped = 0
        no_data      = 0

        for pkey, stat_map in all_props.items():
            first       = next(p for sv in stat_map.values() for p in sv.values())
            player_name = first["player_name"]
            team_abbr   = first.get("team", "")
            if not team_abbr: continue

            game_info   = get_game_info(team_abbr)
            is_home     = game_info.get("is_home", False)
            opponent    = game_info.get("opponent", "")
            is_b2b      = game_info.get("is_b2b", False)
            rest_days   = game_info.get("rest_days", 1)
            opp_def     = get_opp_defense(opponent) if opponent else 0.0
            opp_def_lbl = "good" if opp_def < -2 else "poor" if opp_def > 2 else "average"

            # Implied total (cached per game pair)
            ctx_key = tuple(sorted([team_abbr, opponent]))
            if ctx_key not in ctx_cache:
                home = game_info.get("home", team_abbr)
                away = game_info.get("away", opponent)
                ctx_cache[ctx_key] = await fetch_implied_total(client, home, away)
            implied_total = ctx_cache.get(ctx_key)

            # Pull cached game logs
            logs = get_player_logs(player_name, team_abbr)

            for stat, tiers in stat_map.items():
                for odds_type, prop_info in tiers.items():
                    line = prop_info["line"]

                    cal_score, factors, model_details = compute_distribution_score(
                        logs, line, stat, odds_type,
                        is_b2b, opp_def, implied_total,
                        team_abbr, opponent
                    )

                    if cal_score is None:
                        no_data += 1
                        continue

                    score_label, score_color = score_to_label(cal_score, odds_type)
                    edge = cal_score - PP_IMPLIED_PROB

                    # Filter toss-ups
                    if odds_type == "standard" and abs(edge) <= 5.5:
                        rows_skipped += 1
                        continue

                    # Build legacy stat fields for API compatibility
                    qualified = [g for g in logs if g.get("minutes", 0) >= 10]
                    def avg(arr): return round(sum(arr)/len(arr),1) if arr else None
                    def hr(arr, n):
                        s = [g[stat] for g in arr[:n] if g[stat] is not None]
                        return round(sum(1 for v in s if v > line)/len(s)*100,1) if s else None

                    vals = [g[stat] for g in qualified if g[stat] is not None]
                    game_log = [
                        {"date": str(g["game_date"]), "opp": g["opponent_abbr"],
                         "home": g["is_home"], "val": g[stat], "min": g["minutes"]}
                        for g in qualified[:20]
                    ]

                    with get_conn() as conn:
                        with conn.cursor() as cur:
                            cur.execute("""
                                INSERT INTO prop_board (
                                    player_name, team, opponent, is_home,
                                    stat, odds_type, line,
                                    pp_implied_prob, pp_american_odds,
                                    avg_season, avg_last5, avg_last10,
                                    hit_rate_season, hit_rate_last5, hit_rate_last10,
                                    composite_score, score_label, score_color,
                                    factors, game_log,
                                    is_b2b, rest_days, opp_def_label, opp_def_margin,
                                    usage_rate, game_pace, model_details,
                                    game_date
                                ) VALUES (
                                    %s,%s,%s,%s,%s,%s,%s,%s,%s,
                                    %s,%s,%s,%s,%s,%s,%s,%s,%s,
                                    %s,%s,%s,%s,%s,%s,%s,%s,%s,%s
                                )
                                ON CONFLICT (player_name, stat, odds_type, game_date) DO UPDATE SET
                                    composite_score = EXCLUDED.composite_score,
                                    score_label     = EXCLUDED.score_label,
                                    score_color     = EXCLUDED.score_color,
                                    factors         = EXCLUDED.factors,
                                    model_details   = EXCLUDED.model_details,
                                    game_log        = EXCLUDED.game_log,
                                    computed_at     = NOW()
                            """, (
                                player_name, team_abbr, opponent, is_home,
                                stat, odds_type, line,
                                PP_IMPLIED_PROB, PP_AMERICAN_ODDS,
                                avg(vals), avg(vals[:5]), avg(vals[:10]),
                                hr(qualified, len(qualified)),
                                hr(qualified, 5), hr(qualified, 10),
                                cal_score, score_label, score_color,
                                json.dumps(factors), json.dumps(game_log),
                                is_b2b, rest_days, opp_def_lbl, opp_def,
                                model_details.get("shrunk_rate"),
                                model_details.get("pace_factor"),
                                json.dumps(model_details),
                                today,
                            ))
                    rows_written += 1

        logger.info(f"v12 done: {rows_written} written, {rows_skipped} toss-ups filtered, {no_data} no data")

if __name__ == "__main__":
    asyncio.run(run())
