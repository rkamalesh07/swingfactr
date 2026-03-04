"""
Props API — serves pre-computed PrizePicks prop board from DB.
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
    stat:      str   = Query(None),
    odds_type: str   = Query(None),
    min_score: float = Query(0),
    search:    str   = Query(None),
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
                ORDER BY composite_score DESC
            """, (today,))
            cols = [d[0] for d in cur.description]
            rows = cur.fetchall()

    results = []
    for row in rows:
        r = dict(zip(cols, row))

        if stat      and r["stat"]      != stat:       continue
        if odds_type and r["odds_type"] != odds_type:  continue
        if r["composite_score"] < min_score:           continue
        if search and search.lower() not in r["player_name"].lower(): continue

        if isinstance(r["factors"],  str): r["factors"]  = json.loads(r["factors"])
        if isinstance(r["game_log"], str): r["game_log"] = json.loads(r["game_log"])
        if r["computed_at"]: r["computed_at"] = r["computed_at"].isoformat()

        # Edge vs PrizePicks implied prob
        r["edge"] = round((r["composite_score"] or 0) - PP_IMPLIED_PROB, 1)

        # O/U signal:
        # demon   → always Over (boosted line, over only)
        # goblin  → always Over (discounted line, over only)
        # standard→ Over if score > PP_IMPLIED_PROB, else Under
        ot = r.get("odds_type", "standard")
        if ot in ("demon", "goblin"):
            r["pick_side"] = "over"
        else:
            r["pick_side"] = "over" if r["edge"] > 0 else "under"

        # For standard toss-ups (edge between -4 and +4), flag as low confidence
        r["is_tossup"] = (ot == "standard" and abs(r["edge"]) < 4)

        results.append(r)

    last_computed = results[0]["computed_at"] if results else None
    return JSONResponse({
        "date":         str(today),
        "total":        len(results),
        "last_computed": last_computed,
        "results":      results,
    })

@router.get("/board/stats")
async def board_stats():
    today = get_today()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    COUNT(*)                                                        as total,
                    COUNT(*) FILTER (WHERE composite_score >= 67.7)                as strong_overs,
                    COUNT(*) FILTER (WHERE composite_score >= 61.7)                as lean_overs,
                    COUNT(*) FILTER (WHERE composite_score <= 47.7 AND odds_type = 'standard') as strong_unders,
                    MAX(computed_at)                                                as last_computed,
                    COUNT(DISTINCT player_name)                                     as players
                FROM prop_board WHERE game_date = %s
            """, (today,))
            row = cur.fetchone()
            if not row or not row[0]:
                return JSONResponse({"total": 0, "message": "No props computed yet for today. Check back after 6:30am PST."})
            return JSONResponse({
                "total":          row[0],
                "strong_overs":   row[1],
                "lean_overs":     row[2],
                "strong_unders":  row[3],
                "last_computed":  row[4].isoformat() if row[4] else None,
                "players":        row[5],
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
        if isinstance(r.get("factors"),  str): r["factors"]  = json.loads(r["factors"])
        if isinstance(r.get("game_log"), str): r["game_log"] = json.loads(r["game_log"])
        if r.get("computed_at"):  r["computed_at"]  = r["computed_at"].isoformat()
        if r.get("game_date"):    r["game_date"]     = str(r["game_date"])
        results.append(r)
    return JSONResponse(results)
