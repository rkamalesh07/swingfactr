"""Live game data — fetches real-time from ESPN."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
import httpx
import math
from datetime import datetime, timezone, timedelta

router = APIRouter()

ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
ESPN_CDN = "https://cdn.espn.com/core/nba"

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; swingfactr/1.0)"}


def win_prob(score_diff: int, time_remaining: int, home_court: float = 2.5) -> float:
    if time_remaining <= 0:
        if score_diff > 0: return 0.97
        elif score_diff < 0: return 0.03
        return 0.5
    adj = score_diff + home_court
    std = 11.5 * math.sqrt(time_remaining / 2880)
    z = adj / std
    p = 0.5 * (1 + math.erf(z / math.sqrt(2)))
    return max(0.02, min(0.98, p))


@router.get("/today")
async def today_games():
    """Get today's games with live status."""
    est = timezone(timedelta(hours=-5))
    now_est = datetime.now(est)
    today = now_est.strftime("%Y%m%d")
    tomorrow = (now_est + timedelta(days=1)).strftime("%Y%m%d")

    games = []
    async with httpx.AsyncClient(headers=HEADERS, timeout=10) as client:
        for date_str in [today, tomorrow]:
            try:
                r = await client.get(f"{ESPN_BASE}/scoreboard", params={"dates": date_str, "limit": 20})
                data = r.json()
                for event in data.get("events", []):
                    comp = event.get("competitions", [{}])[0]
                    status = comp.get("status", {})
                    state = status.get("type", {}).get("state", "pre")
                    desc = status.get("type", {}).get("shortDetail", "")

                    teams = {t["homeAway"]: t for t in comp.get("competitors", [])}
                    home = teams.get("home", {})
                    away = teams.get("away", {})

                    home_score = int(home.get("score", 0)) if state != "pre" else None
                    away_score = int(away.get("score", 0)) if state != "pre" else None
                    score_diff = (home_score - away_score) if home_score is not None else 0

                    # Time remaining
                    clock = status.get("displayClock", "0:00")
                    period = status.get("period", 0)
                    mins, secs = (clock.split(":") + ["0"])[:2]
                    try:
                        clock_secs = int(mins) * 60 + int(secs)
                    except:
                        clock_secs = 0
                    periods_left = max(0, 4 - period)
                    time_rem = clock_secs + periods_left * 720

                    # Win prob
                    prob = win_prob(score_diff, time_rem) if state == "in" else None

                    # Game date in EST
                    utc_dt = datetime.fromisoformat(event["date"].replace("Z", "+00:00"))
                    est_dt = utc_dt.astimezone(est)

                    games.append({
                        "espn_id": event["id"],
                        "game_id": f"espn_{event['id']}",
                        "game_date": est_dt.strftime("%Y-%m-%d"),
                        "game_time": est_dt.strftime("%I:%M %p ET").lstrip("0"),
                        "home_team": home.get("team", {}).get("abbreviation", "?"),
                        "away_team": away.get("team", {}).get("abbreviation", "?"),
                        "home_score": home_score,
                        "away_score": away_score,
                        "state": state,  # pre, in, post
                        "status_desc": desc,
                        "period": period,
                        "clock": clock,
                        "home_win_prob": round(prob, 3) if prob else None,
                    })
            except Exception as e:
                continue

    # Sort: live first, then by date/time
    state_order = {"in": 0, "pre": 1, "post": 2}
    games.sort(key=lambda g: (state_order.get(g["state"], 3), g["game_date"], g["game_time"]))

    return JSONResponse({"games": games, "as_of": datetime.now(est).isoformat()})


@router.get("/{espn_id}/live")
async def live_game(espn_id: str):
    """
    Fetch live play-by-play for a game and compute win probability curve.
    espn_id can be raw ESPN id or espn_XXXXX format.
    """
    eid = espn_id.replace("espn_", "")

    async with httpx.AsyncClient(headers=HEADERS, timeout=15) as client:
        # Get game summary (score, status)
        try:
            r = await client.get(f"{ESPN_BASE}/summary", params={"event": eid})
            summary = r.json()
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"ESPN API error: {e}")

    comp = summary.get("header", {}).get("competitions", [{}])[0]
    status = comp.get("status", {})
    state = status.get("type", {}).get("state", "pre")
    period = status.get("period", 0)
    clock = status.get("displayClock", "0:00")

    teams = {t["homeAway"]: t for t in comp.get("competitors", [])}
    home = teams.get("home", {})
    away = teams.get("away", {})

    home_score = int(home.get("score", 0))
    away_score = int(away.get("score", 0))
    home_team = home.get("team", {}).get("abbreviation", "?")
    away_team = away.get("team", {}).get("abbreviation", "?")

    # Parse plays from ESPN summary
    plays_raw = summary.get("plays", []) or summary.get("playByPlay", [])

    series = []
    total_regulation = 2880

    if plays_raw:
        last_bucket = -1
        for p in plays_raw:
            p_period = p.get("period", {}).get("number", p.get("period", 1))
            if isinstance(p_period, dict):
                p_period = p_period.get("number", 1)

            clock_str = p.get("clock", {}).get("displayValue", p.get("clock", "12:00"))
            if isinstance(clock_str, dict):
                clock_str = clock_str.get("displayValue", "12:00")

            try:
                parts = clock_str.split(":")
                c_secs = int(parts[0]) * 60 + int(parts[1])
            except:
                c_secs = 0

            game_secs = (min(p_period, 4) - 1) * 720 + (720 - c_secs)
            time_rem = max(0, total_regulation - game_secs)

            h_score = p.get("homeScore", 0) or 0
            a_score = p.get("awayScore", 0) or 0
            diff = int(h_score) - int(a_score)

            bucket = game_secs // 15
            if bucket == last_bucket:
                continue
            last_bucket = bucket

            prob = win_prob(diff, time_rem)
            series.append({
                "game_seconds": game_secs,
                "time_remaining": time_rem,
                "home_win_prob": round(prob, 3),
                "score_diff": diff,
                "quarter": min(p_period, 4),
            })
    
    # If no plays yet (pre-game or ESPN not returning plays), add tipoff point
    if not series:
        series = [{
            "game_seconds": 0,
            "time_remaining": 2880,
            "home_win_prob": round(win_prob(0, 2880), 3),
            "score_diff": 0,
            "quarter": 1,
        }]

    # Current live prob
    if state == "in":
        mins, secs_str = (clock.split(":") + ["0"])[:2]
        try:
            c = int(mins) * 60 + int(secs_str)
        except:
            c = 0
        periods_left = max(0, 4 - period)
        time_rem_now = c + periods_left * 720
        live_prob = win_prob(home_score - away_score, time_rem_now)
    elif state == "post":
        live_prob = 0.97 if home_score > away_score else 0.03
    else:
        live_prob = win_prob(0, 2880)

    return JSONResponse({
        "espn_id": eid,
        "game_id": f"espn_{eid}",
        "home_team": home_team,
        "away_team": away_team,
        "home_score": home_score,
        "away_score": away_score,
        "state": state,
        "period": period,
        "clock": clock,
        "live_home_win_prob": round(live_prob, 3),
        "series": series,
    })
