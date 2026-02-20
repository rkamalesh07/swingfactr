"""Win probability router."""
from fastapi import APIRouter, HTTPException
from src.etl.db import get_conn
from src.api.schemas import WinProbResponse, WinProbPoint

router = APIRouter()


@router.get("/{game_id}/winprob", response_model=WinProbResponse)
async def get_win_prob(game_id: str):
    """
    Return win probability time series for a game.
    
    If precomputed predictions exist in DB, returns those.
    Otherwise returns empty series (run predict_game_win_prob first).
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT g.home_team_id, g.away_team_id
                FROM games g WHERE g.game_id = %s
            """, (game_id,))
            game = cur.fetchone()
            if not game:
                raise HTTPException(status_code=404, detail=f"Game {game_id} not found")

            cur.execute("""
                SELECT wp.game_seconds, wp.home_win_prob,
                       p.period, p.score_diff
                FROM win_prob_predictions wp
                LEFT JOIN plays p ON p.play_id = wp.play_id
                WHERE wp.game_id = %s
                ORDER BY wp.game_seconds
            """, (game_id,))
            rows = cur.fetchall()
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r)) for r in rows]

    series = []
    for r in rows:
        quarter = min((r["game_seconds"] // 720) + 1, 4) if r["game_seconds"] else 1
        series.append(WinProbPoint(
            game_seconds=r["game_seconds"] or 0,
            home_win_prob=round(r["home_win_prob"] or 0.5, 3),
            quarter=r["period"] or quarter,
            score_diff=r["score_diff"] or 0,
        ))

    final_prob = series[-1].home_win_prob if series else None

    return WinProbResponse(
        game_id=game_id,
        home_team_id=game["home_team_id"],
        away_team_id=game["away_team_id"],
        final_home_win_prob=final_prob,
        series=series,
    )


@router.get("/{game_id}/lineups")
async def get_game_lineups(game_id: str):
    """Return lineup stints for a game with context."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT s.stint_id, s.team_id, s.lineup_id, s.period,
                       s.start_game_seconds, s.end_game_seconds, s.duration_seconds,
                       s.start_score_diff, s.end_score_diff, s.net_points, s.is_clutch,
                       t.abbreviation AS team_abbr,
                       ls.net_rating, ls.rapm_estimate
                FROM stints s
                JOIN teams t ON t.team_id = s.team_id
                LEFT JOIN lineup_stats ls ON ls.lineup_id = s.lineup_id
                WHERE s.game_id = %s
                ORDER BY s.start_game_seconds
            """, (game_id,))
            rows = cur.fetchall()
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r)) for r in rows]

    return rows
