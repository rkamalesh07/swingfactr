"""
Insights API — four analytical features:
1. Hot/Cold streak detector
2. Breakout probability
3. Player vs Player comparison
4. Matchup difficulty rating
"""
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from src.etl.db import get_conn
import math
from datetime import date

router = APIRouter()
SEASON = "2025-26"
MIN_GAMES = 8
STATS = ["pts", "reb", "ast", "fg3m", "stl", "blk"]

# ---------------------------------------------------------------------------
# Math helpers
# ---------------------------------------------------------------------------

def mean(vals):
    return sum(vals) / len(vals) if vals else 0.0

def std(vals):
    if len(vals) < 2: return 0.0
    m = mean(vals)
    return math.sqrt(sum((v - m)**2 for v in vals) / (len(vals) - 1))

def pct_change(old, new):
    if not old: return 0.0
    return round((new - old) / abs(old) * 100, 1)

# ---------------------------------------------------------------------------
# 1. Hot/Cold Streak Detector
# ---------------------------------------------------------------------------

@router.get("/streaks")
async def get_streaks(
    stat:    str   = Query("pts"),
    min_gp:  int   = Query(10),
    limit:   int   = Query(50),
):
    """
    Detect players on hot/cold streaks by comparing L5 average
    to season average. Returns sorted list with streak score.
    """
    if stat not in STATS:
        return JSONResponse({"error": f"Invalid stat. Choose from {STATS}"}, status_code=400)

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"""
                WITH ranked AS (
                    SELECT
                        player_name, team_abbr, position,
                        {stat} as val,
                        minutes,
                        game_date,
                        ROW_NUMBER() OVER (PARTITION BY player_name ORDER BY game_date DESC) as rn
                    FROM player_game_logs
                    WHERE season_id = %s AND minutes >= 10 AND {stat} IS NOT NULL
                ),
                season_avg AS (
                    SELECT player_name,
                           AVG(val)  as season_avg,
                           STDDEV(val) as season_std,
                           COUNT(*)     as gp,
                           MAX(team_abbr) as team
                    FROM ranked
                    GROUP BY player_name
                    HAVING COUNT(*) >= %s
                ),
                recent AS (
                    SELECT player_name,
                           AVG(val) as l5_avg,
                           MAX(position) as position
                    FROM ranked WHERE rn <= 5
                    GROUP BY player_name
                )
                SELECT s.player_name, s.team, r.position,
                       ROUND(s.season_avg::numeric, 1) as season_avg,
                       ROUND(r.l5_avg::numeric, 1)    as l5_avg,
                       ROUND(s.season_std::numeric, 2) as season_std,
                       s.gp
                FROM season_avg s
                JOIN recent r ON s.player_name = r.player_name
                ORDER BY (r.l5_avg - s.season_avg) / NULLIF(s.season_std, 0) DESC
            """, (SEASON, min_gp))
            cols = [d[0] for d in cur.description]
            rows = cur.fetchall()

    results = []
    for row in rows:
        r = dict(zip(cols, row))
        s_avg = float(r["season_avg"] or 0)
        l5    = float(r["l5_avg"] or 0)
        s_std = float(r["season_std"] or 1)

        # Z-score: how many std devs above/below season avg
        z = (l5 - s_avg) / s_std if s_std > 0 else 0
        pct = pct_change(s_avg, l5)

        streak = "hot"    if z >= 1.0  else \
                 "warm"   if z >= 0.4  else \
                 "cold"   if z <= -1.0 else \
                 "cool"   if z <= -0.4 else "neutral"

        results.append({
            "player_name": r["player_name"],
            "team":        r["team"],
            "position":    r["position"],
            "stat":        stat,
            "season_avg":  s_avg,
            "l5_avg":      l5,
            "pct_change":  pct,
            "z_score":     round(z, 2),
            "streak":      streak,
            "gp":          r["gp"],
        })

    # Return hot at top, cold at bottom
    hot   = [r for r in results if r["streak"] in ("hot","warm")][:limit//2]
    cold  = sorted([r for r in results if r["streak"] in ("cold","cool")],
                   key=lambda x: x["z_score"])[:limit//2]

    return JSONResponse({
        "stat":   stat,
        "as_of":  date.today().isoformat(),
        "hot":    hot,
        "cold":   cold,
    })


# ---------------------------------------------------------------------------
# 2. Breakout Probability
# ---------------------------------------------------------------------------

@router.get("/breakout")
async def get_breakout(limit: int = Query(30)):
    """
    Identify players with rising trends across multiple stats.
    Breakout score = weighted combo of:
    - Usage trend (minutes increasing)
    - Stat production trend (L10 vs season avg)
    - Consistency (low std dev = reliable)
    - Opportunity (high minutes, positive role change)
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                WITH ranked AS (
                    SELECT player_name, team_abbr, position,
                           pts, reb, ast, fg3m, stl, blk, minutes,
                           fga, tov, game_date,
                           ROW_NUMBER() OVER (PARTITION BY player_name ORDER BY game_date DESC) as rn
                    FROM player_game_logs
                    WHERE season_id = %s AND minutes >= 8
                ),
                season_stats AS (
                    SELECT player_name,
                           MAX(team_abbr) as team,
                           MAX(position)  as position,
                           COUNT(*)       as gp,
                           AVG(pts)       as pts_avg,
                           AVG(reb)       as reb_avg,
                           AVG(ast)       as ast_avg,
                           AVG(minutes)   as min_avg,
                           AVG(fga)       as fga_avg,
                           STDDEV(pts)    as pts_std
                    FROM ranked
                    GROUP BY player_name
                    HAVING COUNT(*) >= 12
                ),
                recent_stats AS (
                    SELECT player_name,
                           AVG(pts)     as pts_l10,
                           AVG(reb)     as reb_l10,
                           AVG(ast)     as ast_l10,
                           AVG(minutes) as min_l10,
                           AVG(fga)     as fga_l10
                    FROM ranked WHERE rn <= 10
                    GROUP BY player_name
                ),
                very_recent AS (
                    SELECT player_name,
                           AVG(pts)     as pts_l5,
                           AVG(minutes) as min_l5
                    FROM ranked WHERE rn <= 5
                    GROUP BY player_name
                )
                SELECT s.player_name, s.team, s.position, s.gp,
                       ROUND(s.pts_avg::numeric,1) as pts_season,
                       ROUND(r.pts_l10::numeric,1) as pts_l10,
                       ROUND(v.pts_l5::numeric,1)  as pts_l5,
                       ROUND(s.min_avg::numeric,1) as min_season,
                       ROUND(r.min_l10::numeric,1) as min_l10,
                       ROUND(v.min_l5::numeric,1)  as min_l5,
                       ROUND(s.pts_std::numeric,2) as pts_std,
                       ROUND(r.fga_l10::numeric,1) as fga_l10,
                       ROUND(s.fga_avg::numeric,1) as fga_season
                FROM season_stats s
                JOIN recent_stats r ON s.player_name = r.player_name
                JOIN very_recent  v ON s.player_name = v.player_name
            """, (SEASON,))
            cols = [d[0] for d in cur.description]
            rows = cur.fetchall()

    results = []
    for row in rows:
        r = dict(zip(cols, row))

        pts_s   = float(r["pts_season"] or 0)
        pts_l10 = float(r["pts_l10"]    or 0)
        pts_l5  = float(r["pts_l5"]     or 0)
        min_s   = float(r["min_season"] or 0)
        min_l10 = float(r["min_l10"]    or 0)
        min_l5  = float(r["min_l5"]     or 0)
        pts_std = float(r["pts_std"]    or 1)
        fga_l10 = float(r["fga_l10"]    or 0)
        fga_s   = float(r["fga_season"] or 0)

        # Component scores (each 0-25 points)
        # 1. Pts trend: L10 vs season
        pts_trend = min(25, max(0, (pts_l10 - pts_s) / max(pts_s, 1) * 50))
        # 2. Acceleration: L5 vs L10
        pts_accel = min(25, max(0, (pts_l5 - pts_l10) / max(pts_l10, 1) * 50))
        # 3. Minutes trend: L10 vs season
        min_trend = min(25, max(0, (min_l10 - min_s) / max(min_s, 1) * 50))
        # 4. Usage trend: FGA increasing
        usage_trend = min(25, max(0, (fga_l10 - fga_s) / max(fga_s, 1) * 50))

        score = round(pts_trend + pts_accel + min_trend + usage_trend, 1)

        if score < 5: continue  # filter out flat players

        results.append({
            "player_name":  r["player_name"],
            "team":         r["team"],
            "position":     r["position"],
            "gp":           r["gp"],
            "breakout_score": score,
            "pts_season":   pts_s,
            "pts_l10":      pts_l10,
            "pts_l5":       pts_l5,
            "min_season":   min_s,
            "min_l10":      min_l10,
            "min_l5":       min_l5,
            "pts_trend_pct": round(pct_change(pts_s, pts_l10), 1),
            "min_trend_pct": round(pct_change(min_s, min_l10), 1),
        })

    results.sort(key=lambda x: -x["breakout_score"])
    return JSONResponse({
        "as_of":   date.today().isoformat(),
        "results": results[:limit],
    })


# ---------------------------------------------------------------------------
# 3. Player vs Player comparison
# ---------------------------------------------------------------------------

@router.get("/compare")
async def compare_players(
    p1: str = Query(..., description="First player name"),
    p2: str = Query(..., description="Second player name"),
):
    """Full head-to-head comparison of two players across all stats."""

    def get_player_data(name: str) -> dict | None:
        with get_conn() as conn:
            with conn.cursor() as cur:
                # Try exact match first
                cur.execute("""
                    SELECT player_name, team_abbr, position,
                           pts, reb, ast, fg3m, stl, blk,
                           fga, fta, tov, minutes, game_date
                    FROM player_game_logs
                    WHERE season_id = %s AND LOWER(player_name) = LOWER(%s)
                      AND minutes >= 8
                    ORDER BY game_date DESC
                    LIMIT 40
                """, (SEASON, name))
                rows = cur.fetchall()

                if not rows:
                    cur.execute("""
                        SELECT player_name, team_abbr, position,
                               pts, reb, ast, fg3m, stl, blk,
                               fga, fta, tov, minutes, game_date
                        FROM player_game_logs
                        WHERE season_id = %s
                          AND LOWER(player_name) LIKE LOWER(%s)
                          AND minutes >= 8
                        ORDER BY game_date DESC
                        LIMIT 40
                    """, (SEASON, f"%{name}%"))
                    rows = cur.fetchall()

        if not rows: return None
        cols = ["player_name","team","position","pts","reb","ast","fg3m",
                "stl","blk","fga","fta","tov","minutes","game_date"]
        games = [dict(zip(cols, r)) for r in rows]

        def stat_summary(stat, n=None):
            vals = [g[stat] for g in (games[:n] if n else games)
                    if g[stat] is not None]
            if not vals: return None
            m = mean(vals)
            s = std(vals)
            return {
                "avg": round(m, 1),
                "std": round(s, 2),
                "cv":  round(s / m * 100, 1) if m > 0 else 0,  # consistency %
                "max": max(vals),
                "min": min(vals),
            }

        result = {
            "player_name": games[0]["player_name"],
            "team":        games[0]["team"],
            "position":    games[0]["position"],
            "gp":          len(games),
        }
        for s in STATS + ["fga", "tov", "minutes"]:
            result[f"{s}_season"] = stat_summary(s)
            result[f"{s}_l10"]    = stat_summary(s, 10)
            result[f"{s}_l5"]     = stat_summary(s, 5)

        # Recent game log for sparkline
        result["game_log"] = [
            {"date": str(g["game_date"]), "pts": g["pts"], "reb": g["reb"],
             "ast": g["ast"], "min": g["minutes"]}
            for g in games[:20]
        ]
        return result

    d1 = get_player_data(p1)
    d2 = get_player_data(p2)

    if not d1:
        return JSONResponse({"error": f"Player '{p1}' not found"}, status_code=404)
    if not d2:
        return JSONResponse({"error": f"Player '{p2}' not found"}, status_code=404)

    # Head-to-head advantage per stat
    advantages = {}
    for s in STATS:
        v1 = (d1.get(f"{s}_season") or {}).get("avg", 0)
        v2 = (d2.get(f"{s}_season") or {}).get("avg", 0)
        if v1 > v2:
            advantages[s] = d1["player_name"]
        elif v2 > v1:
            advantages[s] = d2["player_name"]
        else:
            advantages[s] = "tie"

    return JSONResponse({
        "player1":    d1,
        "player2":    d2,
        "advantages": advantages,
        "as_of":      date.today().isoformat(),
    })


# ---------------------------------------------------------------------------
# 4. Matchup Difficulty Rating
# ---------------------------------------------------------------------------

@router.get("/matchup")
async def matchup_difficulty(
    player: str = Query(...),
    opp:    str = Query(..., description="Opponent team abbreviation"),
):
    """
    Rate how difficult a specific matchup is for a player
    using defensive profiles + historical performance vs this opponent.
    """
    ABBR_NORM = {"GSW":"GS","SAS":"SA","NOP":"NO","NYK":"NY","UTA":"UTAH","WAS":"WSH","PHO":"PHX","CHA":"CHA"}
    opp = ABBR_NORM.get(opp.upper(), opp.upper())

    with get_conn() as conn:
        with conn.cursor() as cur:
            # Player's season averages
            cur.execute("""
                SELECT player_name, MAX(team_abbr) as team_abbr, MAX(position) as position,
                       AVG(pts) as pts, AVG(reb) as reb, AVG(ast) as ast,
                       AVG(fg3m) as fg3m, AVG(stl) as stl, AVG(blk) as blk,
                       AVG(minutes) as minutes, COUNT(*) as gp
                FROM player_game_logs
                WHERE season_id = %s AND LOWER(player_name) = LOWER(%s)
                  AND minutes >= 8
                GROUP BY player_name
            """, (SEASON, player))
            row = cur.fetchone()

            if not row:
                # fuzzy
                cur.execute("""
                    SELECT player_name, MAX(team_abbr) as team_abbr, MAX(position) as position,
                           AVG(pts) as pts, AVG(reb) as reb, AVG(ast) as ast,
                           AVG(fg3m) as fg3m, AVG(stl) as stl, AVG(blk) as blk,
                           AVG(minutes) as minutes, COUNT(*) as gp
                    FROM player_game_logs
                    WHERE season_id = %s AND LOWER(player_name) LIKE LOWER(%s)
                      AND minutes >= 8
                    GROUP BY player_name
                    LIMIT 1
                """, (SEASON, f"%{player}%"))
                row = cur.fetchone()

            if not row:
                return JSONResponse({"error": f"Player '{player}' not found"}, status_code=404)

            cols = ["player_name","team","position","pts","reb","ast",
                    "fg3m","stl","blk","minutes","gp"]
            p_data = dict(zip(cols, row))
            pos = p_data["position"] or "G"

            # Historical vs this opponent
            cur.execute("""
                SELECT pts, reb, ast, fg3m, stl, blk, minutes, game_date
                FROM player_game_logs
                WHERE season_id = %s AND LOWER(player_name) = LOWER(%s)
                  AND opponent_abbr = %s AND minutes >= 8
                ORDER BY game_date DESC
            """, (SEASON, p_data["player_name"], opp))
            vs_rows = cur.fetchall()
            vs_cols = ["pts","reb","ast","fg3m","stl","blk","minutes","game_date"]
            vs_games = [dict(zip(vs_cols, r)) for r in vs_rows]

            # Defensive profiles for this matchup
            cur.execute("""
                SELECT stat, def_ratio, sample_size, league_avg, team_allowed
                FROM defensive_profiles
                WHERE season_id = %s AND team_abbr = %s AND position = %s
            """, (SEASON, opp, pos))
            def_rows = cur.fetchall()
            def_profiles = {r[0]: {"ratio": float(r[1]), "n": r[2],
                                    "league_avg": float(r[3]), "allowed": float(r[4])}
                           for r in def_rows}

    # Build matchup ratings per stat
    stat_ratings = {}
    for s in STATS:
        p_avg = float(p_data.get(s) or 0)
        dp    = def_profiles.get(s, {})
        ratio = dp.get("ratio", 1.0)
        n     = dp.get("n", 0)

        # Adjusted expectation
        adj_exp = round(p_avg * ratio, 1) if ratio else p_avg

        # Historical vs this opp
        hist_vals = [g[s] for g in vs_games if g[s] is not None]
        hist_avg  = round(mean(hist_vals), 1) if hist_vals else None

        # Difficulty: ratio < 1 = tough defense, > 1 = easy
        difficulty = "easy"   if ratio >= 1.10 else \
                     "neutral" if ratio >= 0.92 else \
                     "tough"

        stat_ratings[s] = {
            "player_avg":  round(p_avg, 1),
            "adj_expected": adj_exp,
            "def_ratio":   round(ratio, 3),
            "difficulty":  difficulty,
            "hist_avg":    hist_avg,
            "hist_games":  len(hist_vals),
            "sample_size": n,
        }

    # Overall matchup score: avg difficulty across key stats
    ratios = [stat_ratings[s]["def_ratio"] for s in ["pts","reb","ast"]]
    avg_ratio = mean(ratios)
    overall = "easy"   if avg_ratio >= 1.08 else \
              "neutral" if avg_ratio >= 0.94 else \
              "tough"

    return JSONResponse({
        "player_name":  p_data["player_name"],
        "team":         p_data["team"],
        "position":     pos,
        "opponent":     opp,
        "overall":      overall,
        "avg_def_ratio": round(avg_ratio, 3),
        "stats":        stat_ratings,
        "vs_games":     vs_games[:10],
        "as_of":        date.today().isoformat(),
    })
