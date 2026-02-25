"""Win probability router — computed on the fly from plays data."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from src.etl.db import get_conn
import math

router = APIRouter()

def win_prob_from_state(score_diff: int, time_remaining: int, home_court: float = 0.0) -> float:
    """
    Compute home team win probability from score diff and time remaining.
    Based on NBA historical calibration:
    - score_diff: home_score - away_score (positive = home leading)
    - time_remaining: seconds left in regulation (0-2880)
    - home_court: home court advantage in points (~2.5 pts)
    
    Uses logistic model calibrated to NBA: k=0.1697 from Stern 1994 / updated
    """
    if time_remaining <= 0:
        if score_diff > 0:
            return 0.97
        elif score_diff < 0:
            return 0.03
        else:
            return 0.5

    # Adjusted score diff includes home court advantage
    adj_diff = score_diff + home_court
    
    # Variance of score grows with time (random walk model)
    # NBA pace ~100 possessions/48min, ~1 pt per possession
    # std_dev of final margin ≈ sqrt(time_remaining / 2880) * 11.5
    std_dev = 11.5 * math.sqrt(time_remaining / 2880)
    
    # P(home wins) = P(Z > -adj_diff / std_dev) where Z~N(0,1)
    z = adj_diff / std_dev
    prob = 0.5 * (1 + math.erf(z / math.sqrt(2)))
    
    # Clamp to reasonable range
    return max(0.02, min(0.98, prob))


@router.get("/{game_id}/winprob")
async def get_win_prob(game_id: str):
    """Return win probability time series computed from plays data."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            # Get game info
            cur.execute("""
                SELECT g.home_team_id, g.away_team_id, 
                       g.home_score, g.away_score, g.home_win,
                       g.game_date,
                       ht.abbreviation as home_team,
                       at.abbreviation as away_team
                FROM games g
                JOIN teams ht ON ht.team_id = g.home_team_id
                JOIN teams at ON at.team_id = g.away_team_id
                WHERE g.game_id = %s
            """, (game_id,))
            game = cur.fetchone()
            if not game:
                raise HTTPException(status_code=404, detail=f"Game {game_id} not found")
            
            cols = [d[0] for d in cur.description]
            game = dict(zip(cols, game))

            # Get plays with score and time
            cur.execute("""
                SELECT play_num, game_seconds_elapsed, time_remaining_seconds,
                       home_score, away_score, score_diff, period
                FROM plays
                WHERE game_id = %s
                AND home_score IS NOT NULL
                AND time_remaining_seconds IS NOT NULL
                ORDER BY play_num
            """, (game_id,))
            plays = cur.fetchall()
            play_cols = [d[0] for d in cur.description]
            plays = [dict(zip(play_cols, p)) for p in plays]

    if not plays:
        return JSONResponse({
            "game_id": game_id,
            "home_team_id": game["home_team_id"],
            "away_team_id": game["away_team_id"],
            "home_team": game["home_team"],
            "away_team": game["away_team"],
            "home_score": game["home_score"],
            "away_score": game["away_score"],
            "home_win": game["home_win"],
            "series": [],
        })

    # Sample every ~15 seconds to avoid massive payloads
    # Group plays by time bucket
    series = []
    last_bucket = -1
    BUCKET_SIZE = 15  # seconds

    for p in plays:
        game_secs = p["game_seconds_elapsed"] or 0
        time_rem = p["time_remaining_seconds"] or 0
        score_diff = p["score_diff"] or 0
        period = p["period"] or 1

        bucket = game_secs // BUCKET_SIZE
        if bucket == last_bucket:
            continue
        last_bucket = bucket

        prob = win_prob_from_state(score_diff, time_rem, home_court=2.5)

        series.append({
            "game_seconds": game_secs,
            "time_remaining": time_rem,
            "home_win_prob": round(prob, 3),
            "score_diff": score_diff,
            "quarter": min(period, 4),
        })

    # Always add tip-off at 50%
    if series and series[0]["game_seconds"] > 30:
        series.insert(0, {
            "game_seconds": 0,
            "time_remaining": 2880,
            "home_win_prob": win_prob_from_state(0, 2880, home_court=2.5),
            "score_diff": 0,
            "quarter": 1,
        })

    return JSONResponse({
        "game_id": game_id,
        "home_team_id": game["home_team_id"],
        "away_team_id": game["away_team_id"],
        "home_team": game["home_team"],
        "away_team": game["away_team"],
        "home_score": game["home_score"],
        "away_score": game["away_score"],
        "home_win": game["home_win"],
        "series": series,
    })


@router.get("/{game_id}/lineups")
async def get_game_lineups(game_id: str):
    """Return lineup stints for a game."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT s.stint_id, s.team_id, s.lineup_id, s.period,
                       s.start_game_seconds, s.end_game_seconds, s.duration_seconds,
                       s.start_score_diff, s.end_score_diff, s.net_points, s.is_clutch,
                       t.abbreviation AS team_abbr
                FROM stints s
                JOIN teams t ON t.team_id = s.team_id
                WHERE s.game_id = %s
                ORDER BY s.start_game_seconds
            """, (game_id,))
            rows = cur.fetchall()
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, r)) for r in rows]
