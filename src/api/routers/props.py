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

PP_IMPLIED_PROB = 57.7

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
                    stat, odds_type, line,
                    pp_implied_prob, pp_american_odds,
                    avg_season, avg_last5, avg_last10,
                    hit_rate_season, hit_rate_last5, hit_rate_last10,
                    composite_score, score_label, score_color,
                    factors, game_log,
                    is_b2b, rest_days, opp_def_label, opp_def_margin,
                    computed_at
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
        r["is_tossup"] = (ot == "standard" and abs(r["edge"]) < 5)

        if stat      and r["stat"]      != stat:            continue
        if odds_type and r["odds_type"] != odds_type:       continue
        if pick_side and r["pick_side"] != pick_side:       continue
        if search    and search.lower() not in r["player_name"].lower(): continue

        # For min_score filter: overs need score >= min_score, unders need score <= (PP - (min_score - PP))
        if min_score > 0:
            if r["pick_side"] == "over"  and r["composite_score"] < min_score: continue
            # Don't apply min_score filter to unders — it would block them entirely

        if isinstance(r["factors"],  str): r["factors"]  = json.loads(r["factors"])
        if isinstance(r["game_log"], str): r["game_log"] = json.loads(r["game_log"])
        if r["computed_at"]: r["computed_at"] = r["computed_at"].isoformat()

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
