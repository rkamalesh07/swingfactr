"""
Props API — serves pre-computed prop board from DB.

The heavy lifting (Odds API fetch + ESPN box score history + composite scoring)
is done by src/etl/props_board.py on a cron schedule.
This router just reads from the prop_board table — instant page loads.
"""

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from src.etl.db import get_conn
from datetime import date, datetime, timezone, timedelta
import json

def get_today():
    # Use PST date to match when ETL runs
    pst = timezone(timedelta(hours=-8))
    return datetime.now(pst).date()

router = APIRouter()

@router.get("/board")
async def get_board(
    stat: str = Query(None),
    min_score: float = Query(0),
    search: str = Query(None),
):
    """
    Full prop board for today sorted by composite score descending.
    Optionally filter by stat, min score, or player name search.
    """
    today = get_today()

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    player_name, team, opponent, is_home, stat, line,
                    over_odds, under_odds, implied_prob_over, bookmaker,
                    avg_season, avg_last5, avg_last10, avg_last20,
                    home_avg, away_avg,
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
        # Apply filters
        if stat and r["stat"] != stat:
            continue
        if r["composite_score"] < min_score:
            continue
        if search and search.lower() not in r["player_name"].lower():
            continue
        # Deserialize JSONB
        if isinstance(r["factors"], str):
            r["factors"] = json.loads(r["factors"])
        if isinstance(r["game_log"], str):
            r["game_log"] = json.loads(r["game_log"])
        if r["computed_at"]:
            r["computed_at"] = r["computed_at"].isoformat()
        results.append(r)

    # Get last computed time
    last_computed = results[0]["computed_at"] if results else None

    return JSONResponse({
        "date": str(today),
        "total": len(results),
        "last_computed": last_computed,
        "results": results,
    })

@router.get("/board/stats")
async def board_stats():
    """Summary stats for today's board — used for the header."""
    today = get_today()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE composite_score >= 65) as strong_overs,
                    COUNT(*) FILTER (WHERE composite_score >= 55) as lean_overs,
                    COUNT(*) FILTER (WHERE composite_score <= 35) as strong_unders,
                    MAX(computed_at) as last_computed,
                    COUNT(DISTINCT player_name) as players,
                    COUNT(DISTINCT stat) as stats
                FROM prop_board WHERE game_date = %s
            """, (today,))
            row = cur.fetchone()
            if not row or not row[0]:
                return JSONResponse({"total": 0, "message": "No props computed yet for today. Check back after 5am PST."})
            return JSONResponse({
                "total": row[0],
                "strong_overs": row[1],
                "lean_overs": row[2],
                "strong_unders": row[3],
                "last_computed": row[4].isoformat() if row[4] else None,
                "players": row[5],
                "stats": row[6],
            })

@router.get("/player")
async def player_detail(
    name: str = Query(...),
    stat: str = Query("pts"),
):
    """Detailed view for a single player prop — for expanded row view."""
    today = get_today()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT * FROM prop_board
                WHERE game_date = %s
                AND LOWER(player_name) LIKE %s
                AND stat = %s
                LIMIT 1
            """, (today, f"%{name.lower()}%", stat))
            cols = [d[0] for d in cur.description]
            row = cur.fetchone()

    if not row:
        return JSONResponse({"error": f"No data for {name} ({stat}) today"})

    r = dict(zip(cols, row))
    if isinstance(r.get("factors"), str):
        r["factors"] = json.loads(r["factors"])
    if isinstance(r.get("game_log"), str):
        r["game_log"] = json.loads(r["game_log"])
    if r.get("computed_at"):
        r["computed_at"] = r["computed_at"].isoformat()
    if r.get("game_date"):
        r["game_date"] = str(r["game_date"])
    return JSONResponse(r)
