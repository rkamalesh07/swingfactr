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


@router.get("/{game_id}/preview")
async def game_preview(game_id: str):
    """
    Pre-game win probability based on team net ratings.
    Works for games in DB and games not yet in DB (fetches from ESPN).
    """
    import httpx, random

    eid = game_id.replace("espn_", "")

    # Try DB first
    game = None
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT g.home_team_id, g.away_team_id,
                       g.home_score, g.away_score, g.home_win,
                       ht.abbreviation as home_team,
                       at.abbreviation as away_team
                FROM games g
                JOIN teams ht ON ht.team_id = g.home_team_id
                JOIN teams at ON at.team_id = g.away_team_id
                WHERE g.game_id = %s
            """, (game_id,))
            row = cur.fetchone()
            if row:
                cols = [d[0] for d in cur.description]
                game = dict(zip(cols, row))

            # Get team ratings by abbreviation (works whether game is in DB or not)
            cur.execute("""
                SELECT t.abbreviation,
                    ROUND(AVG(g2.home_score - g2.away_score) FILTER (WHERE g2.home_team_id = t.team_id)::numeric
                        + AVG(g2.away_score - g2.home_score) FILTER (WHERE g2.away_team_id = t.team_id)::numeric, 1) as net_rtg
                FROM teams t
                JOIN games g2 ON (g2.home_team_id = t.team_id OR g2.away_team_id = t.team_id)
                WHERE g2.season_id = '2025-26' AND g2.home_score IS NOT NULL
                GROUP BY t.team_id, t.abbreviation
            """)
            team_ratings = {r[0]: float(r[1] or 0) for r in cur.fetchall()}

    # If not in DB, fetch from ESPN
    if not game:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary",
                    params={"event": eid},
                    headers={"User-Agent": "Mozilla/5.0"}
                )
                data = r.json()
            comp = data.get("header", {}).get("competitions", [{}])[0]
            teams = {t["homeAway"]: t for t in comp.get("competitors", [])}
            home_abbr = teams.get("home", {}).get("team", {}).get("abbreviation", "?")
            away_abbr = teams.get("away", {}).get("team", {}).get("abbreviation", "?")
            home_score = teams.get("home", {}).get("score")
            away_score = teams.get("away", {}).get("score")
            game = {
                "home_team": home_abbr,
                "away_team": away_abbr,
                "home_team_id": None,
                "away_team_id": None,
                "home_score": int(home_score) if home_score else None,
                "away_score": int(away_score) if away_score else None,
                "home_win": None,
            }
        except Exception as e:
            raise HTTPException(status_code=404, detail=f"Game not found: {e}")

    home_rtg = team_ratings.get(game["home_team"], 0)
    away_rtg = team_ratings.get(game["away_team"], 0)
    expected_diff = (home_rtg - away_rtg) + 2.5

    random.seed(hash(game_id))
    pregame_prob = win_prob_from_state(int(expected_diff), 2880, home_court=0)

    # Simulation: start score at 0 but immediately reflect team strength via home_court+expected_diff.
    # The win_prob_from_state uses home_court=2.5 PLUS the score diff, so at tipoff (score=0)
    # the probability already bakes in home court. But we also want team quality baked in from
    # the start — so we initialize score_diff to a small fraction of expected_diff.
    # This way SA (better team) starts already favored even when score is 0-0.
    series = []
    # Start score diff at 0 — team quality shows through win_prob via expected_diff offset
    # We pass expected_diff as a separate home_court-like offset so it affects prob from tip
    score_diff = 0.0
    quality_offset = expected_diff - 2.5  # strip out home court, keep team quality diff

    for sec in range(0, 2881, 30):
        time_rem = 2880 - sec
        if sec > 0:
            drift = expected_diff / 2880 * 30
            noise = random.gauss(0, 1.2)
            score_diff += drift + noise
            score_diff = max(-40, min(40, score_diff))
        # Use score_diff as integer (NBA scores are whole numbers)
        int_diff = round(score_diff)
        # home_court bakes in both home advantage AND team quality from tipoff
        prob = win_prob_from_state(int_diff, time_rem, home_court=expected_diff)
        series.append({
            "game_seconds": sec,
            "time_remaining": time_rem,
            "home_win_prob": round(prob, 3),
            "score_diff": int_diff,
            "quarter": min(sec // 720 + 1, 4),
            "is_simulated": True,
        })

    return JSONResponse({
        "game_id": game_id,
        "home_team": game["home_team"],
        "away_team": game["away_team"],
        "home_score": game["home_score"],
        "away_score": game["away_score"],
        "home_win": game["home_win"],
        "home_net_rtg": home_rtg,
        "away_net_rtg": away_rtg,
        "pregame_home_win_prob": round(pregame_prob, 3),
        "expected_margin": round(expected_diff, 1),
        "series": series,
        "is_preview": True,
    })
