"""
Props API v9 — proper over/under support.

Key fix: unders are now surfaced correctly.
- DB stores both overs (score > 62.7) and unders (score < 52.7)
- Router sorts by |edge| descending so strongest picks surface first regardless of direction
- Board stats now correctly counts strong unders
- pick_side computed correctly for all tier types
"""
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from src.etl.db import get_conn
from datetime import datetime, timezone, timedelta
import json

PP_PAYOUTS = {2: 3.0, 3: 5.0, 4: 10.0, 5: 20.0, 6: 25.0}

def pp_break_even(num_legs: int = 2) -> float:
    payout = PP_PAYOUTS.get(num_legs, PP_PAYOUTS[2])
    return round((1.0 / payout) ** (1.0 / num_legs) * 100, 2)

PP_IMPLIED_PROB = pp_break_even(2)   # ≈ 57.7 — default single-leg

def get_today():
    pst = timezone(timedelta(hours=-8))
    return datetime.now(pst).date()

router = APIRouter()

@router.get("/board")
async def get_board(
    stat:       str   = Query(None),
    odds_type:  str   = Query(None),
    min_score:  float = Query(0),
    pick_side:  str   = Query(None),   # NEW: filter by 'over' or 'under'
    search:     str   = Query(None),
):
    today = get_today()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    player_name, team, opponent, is_home,
                    stat, odds_type, line, opening_line, line_moved_at,
                    pp_implied_prob, pp_american_odds,
                    pp_break_even_prob, raw_edge_vs_pp,
                    avg_season, avg_last5, avg_last10,
                    hit_rate_season, hit_rate_last5, hit_rate_last10,
                    composite_score, score_label, score_color,
                    factors, game_log,
                    is_b2b, rest_days, opp_def_label, opp_def_margin,
                    model_details, computed_at
                FROM prop_board
                WHERE game_date = %s
                ORDER BY ABS(composite_score - %s) DESC
            """, (today, PP_IMPLIED_PROB))
            cols = [d[0] for d in cur.description]
            rows = cur.fetchall()

    results = []
    for row in rows:
        r = dict(zip(cols, row))

        # Compute edge + pick direction BEFORE filters
        r["edge"]      = round((r["composite_score"] or 0) - PP_IMPLIED_PROB, 1)
        ot             = r.get("odds_type", "standard")
        r["pick_side"] = "over" if (ot in ("demon","goblin") or r["edge"] > 0) else "under"

        # Use stored pp_break_even_prob if available, else default
        bep = r.get("pp_break_even_prob") or PP_IMPLIED_PROB
        r["pp_break_even_prob"] = round(bep, 2)
        r["raw_edge_vs_pp"]     = round((r["composite_score"] or 0) - bep, 2)

        # Asymmetric toss-up: unders need stronger edge (right-skew correction)
        if ot == "standard":
            if r["pick_side"] == "under":
                r["is_tossup"] = abs(r["edge"]) <= 8.0
            else:
                r["is_tossup"] = abs(r["edge"]) <= 5.5
        else:
            r["is_tossup"] = False

        # Line movement
        opening = r.get("opening_line")
        current = r.get("line")
        if opening is not None and current is not None and opening != current:
            r["line_movement"] = round(current - opening, 1)
        else:
            r["line_movement"] = 0.0

        if stat      and r["stat"]      != stat:            continue
        if odds_type and r["odds_type"] != odds_type:       continue
        if pick_side and r["pick_side"] != pick_side:       continue
        if search    and search.lower() not in r["player_name"].lower(): continue

        # Server-side: never serve genuine toss-ups regardless of client filter
        # A pick where P(under) < 57.7% is a losing bet — don't show it
        if r["is_tossup"]: continue

        # For min_score filter: overs need score >= min_score, unders need score <= (PP - (min_score - PP))
        if min_score > 0:
            if r["pick_side"] == "over"  and r["composite_score"] < min_score: continue
            # Don't apply min_score filter to unders — it would block them entirely

        if isinstance(r["factors"],  str): r["factors"]  = json.loads(r["factors"])
        if isinstance(r["game_log"], str): r["game_log"] = json.loads(r["game_log"])
        if isinstance(r.get("model_details"), str): r["model_details"] = json.loads(r["model_details"])
        if r["computed_at"]: r["computed_at"] = r["computed_at"].isoformat()

        # Attach player's own availability status (GTD flag for UI)
        try:
            from src.etl.injury_engine import load_availability_cache
            cache = load_availability_cache()
            avail = cache.get(r["player_name"].lower())
            r["player_status"] = avail["status"] if avail and avail["status"] != "Active" else None
        except Exception:
            r["player_status"] = None

        # Expose model fields directly for UI display
        md = r.get("model_details") or {}
        r["p_over"]               = md.get("prob_over_raw")
        r["p_under"]              = round(100 - md["prob_over_raw"], 1) if md.get("prob_over_raw") else None
        r["predicted_mean"]       = md.get("predicted_mean")
        r["predicted_std"]        = md.get("predicted_std")
        r["projected_min"]        = md.get("projected_min")
        r["usage_boost_mult"]     = md.get("usage_boost_mult", 1.0)
        r["injured_teammates"]    = md.get("injured_teammates", [])
        r["direction"]            = md.get("direction", r["pick_side"])
        r["market_consensus_prob"]= md.get("market_consensus_prob")   # None until market engine
        r["edge_vs_market"]       = md.get("edge_vs_market")          # None until market engine
        r["clv_after_close"]      = None                               # populated post-game
        avail2 = cache.get(r["player_name"].lower()) if 'cache' in locals() else None
        r["confirmed_starter"] = avail2["is_starter"] if avail2 else False

        results.append(r)

    last_computed = results[0]["computed_at"] if results else None
    return JSONResponse({
        "date":          str(today),
        "total":         len(results),
        "overs":         sum(1 for r in results if r["pick_side"] == "over"),
        "unders":        sum(1 for r in results if r["pick_side"] == "under"),
        "last_computed": last_computed,
        "results":       results,
    })

@router.get("/board/stats")
async def board_stats():
    today = get_today()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    COUNT(*)                                                              as total,
                    COUNT(*) FILTER (WHERE composite_score >= %s + 10)                   as strong_overs,
                    COUNT(*) FILTER (WHERE composite_score >= %s + 5
                                       AND composite_score < %s + 10)                    as lean_overs,
                    COUNT(*) FILTER (WHERE composite_score <= %s - 10
                                       AND odds_type = 'standard')                       as strong_unders,
                    COUNT(*) FILTER (WHERE composite_score <= %s - 5
                                       AND composite_score > %s - 10
                                       AND odds_type = 'standard')                       as lean_unders,
                    MAX(computed_at)                                                      as last_computed,
                    COUNT(DISTINCT player_name)                                           as players
                FROM prop_board WHERE game_date = %s
            """, (PP_IMPLIED_PROB, PP_IMPLIED_PROB, PP_IMPLIED_PROB,
                  PP_IMPLIED_PROB, PP_IMPLIED_PROB, PP_IMPLIED_PROB, today))
            row = cur.fetchone()
            if not row or not row[0]:
                return JSONResponse({"total": 0, "message": "No props computed yet for today. Check back after 6:30am PST."})
            return JSONResponse({
                "total":         row[0],
                "strong_overs":  row[1],
                "lean_overs":    row[2],
                "strong_unders": row[3],
                "lean_unders":   row[4],
                "last_computed": row[5].isoformat() if row[5] else None,
                "players":       row[6],
            })

@router.get("/player")
async def player_detail(name: str = Query(...), stat: str = Query("pts")):
    today = get_today()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT * FROM prop_board
                WHERE game_date = %s AND LOWER(player_name) LIKE %s AND stat = %s
                ORDER BY odds_type LIMIT 3
            """, (today, f"%{name.lower()}%", stat))
            cols = [d[0] for d in cur.description]
            rows = cur.fetchall()

    if not rows:
        return JSONResponse({"error": f"No data for {name} ({stat}) today"})

    results = []
    for row in rows:
        r = dict(zip(cols, row))
        r["edge"]      = round((r.get("composite_score") or 0) - PP_IMPLIED_PROB, 1)
        r["pick_side"] = "over" if r["edge"] > 0 else "under"
        if isinstance(r.get("factors"),  str): r["factors"]  = json.loads(r["factors"])
        if isinstance(r.get("game_log"), str): r["game_log"] = json.loads(r["game_log"])
        if r.get("computed_at"):  r["computed_at"]  = r["computed_at"].isoformat()
        if r.get("game_date"):    r["game_date"]     = str(r["game_date"])
        results.append(r)
    return JSONResponse(results)


@router.get("/player/profile")
async def player_profile(name: str = Query(...)):
    """
    Full player profile — season game logs, per-stat averages,
    hit rates vs PrizePicks lines, today's props if available.
    """
    STATS = ["pts", "reb", "ast", "fg3m", "stl", "blk"]
    today = get_today()

    with get_conn() as conn:
        with conn.cursor() as cur:
            # Resolve exact player name
            cur.execute("""
                SELECT DISTINCT player_name, team_abbr, position
                FROM player_game_logs
                WHERE LOWER(player_name) LIKE %s AND season_id = '2025-26'
                ORDER BY player_name LIMIT 1
            """, (f"%{name.lower()}%",))
            row = cur.fetchone()
            if not row:
                return JSONResponse({"error": f"Player '{name}' not found"}, status_code=404)
            player_name, team_abbr, position = row

            # Full season game log
            cur.execute("""
                SELECT game_date, minutes, pts, reb, ast, fg3m, stl, blk,
                       fga, fta, tov, is_home, opponent_abbr, is_b2b, rest_days
                FROM player_game_logs
                WHERE player_name = %s AND season_id = '2025-26'
                ORDER BY game_date DESC
                LIMIT 50
            """, (player_name,))
            log_cols = ["game_date","minutes","pts","reb","ast","fg3m","stl","blk",
                        "fga","fta","tov","is_home","opponent_abbr","is_b2b","rest_days"]
            game_logs = [dict(zip(log_cols, r)) for r in cur.fetchall()]
            for g in game_logs:
                g["game_date"] = str(g["game_date"])

            # Per-stat summary
            qualified = [g for g in game_logs if g["minutes"] and g["minutes"] >= 10]
            def _avg(vals): return round(sum(vals)/len(vals), 1) if vals else None
            def _std(vals):
                if len(vals) < 2: return None
                import math; m = _avg(vals)
                return round(math.sqrt(sum((v-m)**2 for v in vals)/(len(vals)-1)), 1)

            stat_summary = {}
            for s in STATS:
                vals = [g[s] for g in qualified if g[s] is not None]
                l5   = [g[s] for g in qualified[:5]  if g[s] is not None]
                l10  = [g[s] for g in qualified[:10] if g[s] is not None]
                stat_summary[s] = {
                    "avg_season": _avg(vals),
                    "avg_l5":     _avg(l5),
                    "avg_l10":    _avg(l10),
                    "std":        _std(vals),
                    "n_games":    len(vals),
                }

            # Today's props for this player
            cur.execute("""
                SELECT stat, odds_type, line, composite_score, score_label,
                       model_details, opening_line, line_movement
                FROM prop_board
                WHERE game_date = %s AND LOWER(player_name) = %s
                ORDER BY stat, odds_type
            """, (today, player_name.lower()))
            prop_cols = ["stat","odds_type","line","composite_score","score_label",
                         "model_details","opening_line","line_movement"]
            todays_props = []
            for r in cur.fetchall():
                p = dict(zip(prop_cols, r))
                p["edge"] = round((p["composite_score"] or 0) - PP_IMPLIED_PROB, 1)
                p["pick_side"] = "over" if p["edge"] > 0 else "under"
                if isinstance(p.get("model_details"), str):
                    p["model_details"] = json.loads(p["model_details"])
                todays_props.append(p)

            # Hit rates vs season prop lines (use today's lines if available)
            hit_rates = {}
            for s in STATS:
                prop = next((p for p in todays_props if p["stat"] == s
                             and p["odds_type"] == "standard"), None)
                if prop and qualified:
                    line = prop["line"]
                    vals_all = [g[s] for g in qualified if g[s] is not None]
                    vals_l10 = [g[s] for g in qualified[:10] if g[s] is not None]
                    hit_rates[s] = {
                        "line":     line,
                        "season":   round(sum(1 for v in vals_all if v > line)/len(vals_all)*100, 1) if vals_all else None,
                        "l10":      round(sum(1 for v in vals_l10 if v > line)/len(vals_l10)*100, 1) if vals_l10 else None,
                    }

    return JSONResponse({
        "player_name":  player_name,
        "team":         team_abbr,
        "position":     position,
        "games_played": len(qualified),
        "stat_summary": stat_summary,
        "hit_rates":    hit_rates,
        "todays_props": todays_props,
        "game_logs":    game_logs[:30],
    })

@router.get("/results")
async def get_results(days: int = Query(30)):
    """Outcome tracker results for admin dashboard."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    game_date, player_name, team, opponent,
                    stat, odds_type, line, actual_value,
                    hit, composite_score, score_label, edge,
                    pick_side, correct
                FROM prop_results
                WHERE game_date >= CURRENT_DATE - INTERVAL '%s days'
                ORDER BY game_date DESC, composite_score DESC
            """, (days,))
            cols = [d[0] for d in cur.description]
            rows = cur.fetchall()

    results = []
    for row in rows:
        r = dict(zip(cols, row))
        if r.get("game_date"): r["game_date"] = str(r["game_date"])
        results.append(r)

    return JSONResponse({"total": len(results), "results": results})
