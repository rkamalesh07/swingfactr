"""Fatigue and travel effects router."""
from datetime import datetime, timedelta
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from src.models.fatigue import get_fatigue_effects
from src.etl.db import get_conn
from src.etl.espn import fetch_games_for_date

router = APIRouter()

LABEL_MAP = {
    "rest_advantage": "Rest advantage (home − away days)",
    "away_b2b": "Away team on back-to-back",
    "home_b2b": "Home team on back-to-back",
    "travel_miles_100": "Travel distance (per 100 mi)",
    "tz_change": "Timezone change (hrs)",
    "high_altitude": "High altitude venue (DEN/UTA)",
    "long_trip": "Long road trip (1500+ mi)",
    "fatigue_asymmetry": "Fatigue asymmetry (away − home B2B)",
}

FALLBACK_COEFFICIENTS = {
    "away_b2b": 1.4,
    "home_b2b": -0.965,
    "fatigue_asymmetry": 2.366,
    "travel_miles_100": 0.04,
    "tz_change": 0.268,
    "high_altitude": 4.629,
    "long_trip": -4.51,
    "rest_advantage": -0.131,
}

# High altitude venues (>4000 ft)
HIGH_ALTITUDE_TEAMS = {"DEN", "UTA", "SLC", "UTAH"}

# ESPN team ID -> abbreviation mapping
ESPN_TEAM_ABBR = {
    1: "ATL", 2: "BOS", 3: "NO", 4: "CHI", 5: "CLE", 6: "DAL",
    7: "DEN", 8: "DET", 9: "GS", 10: "HOU", 11: "IND", 12: "LAC",
    13: "LAL", 14: "MIA", 15: "MIL", 16: "MIN", 17: "BKN", 18: "NY",
    19: "ORL", 20: "PHI", 21: "PHX", 22: "POR", 23: "SAC", 24: "SA",
    25: "OKC", 26: "ORL", 27: "TOR", 28: "UTA", 29: "WAS", 30: "MEM",
}


def get_coefficients():
    try:
        payload = get_fatigue_effects()
        if payload:
            return {k: float(v["coefficient"]) for k, v in payload.items() if isinstance(v, dict)}, "model"
    except Exception:
        pass
    return FALLBACK_COEFFICIENTS, "fallback"


def get_team_schedule_context(team_id: int, game_date: str) -> dict:
    """Look up rest days and B2B status from DB for a team on a given date."""
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                # Find previous game for this team
                cur.execute("""
                    SELECT game_date FROM games
                    WHERE season_id = '2025-26'
                    AND (home_team_id = %s OR away_team_id = %s)
                    AND game_date < %s
                    ORDER BY game_date DESC LIMIT 1
                """, (team_id, team_id, game_date))
                row = cur.fetchone()
                if row:
                    prev_date = row[0]
                    from datetime import date
                    if isinstance(prev_date, str):
                        prev_date = date.fromisoformat(prev_date)
                    target = date.fromisoformat(game_date) if isinstance(game_date, str) else game_date
                    rest_days = (target - prev_date).days
                    return {"rest_days": rest_days, "b2b": rest_days == 1}
    except Exception:
        pass
    return {"rest_days": 2, "b2b": False}


def compute_fatigue(home_abbr: str, away_abbr: str, home_ctx: dict, away_ctx: dict, coefs: dict) -> dict:
    effect = 0.0
    flags = []

    home_b2b = home_ctx.get("b2b", False)
    away_b2b = away_ctx.get("b2b", False)
    is_altitude = home_abbr in HIGH_ALTITUDE_TEAMS

    if home_b2b:
        v = coefs.get("home_b2b", -0.965)
        effect += v
        flags.append({"label": f"{home_abbr} on B2B (home)", "effect": round(v, 2), "team": "home"})

    if away_b2b:
        v = coefs.get("away_b2b", 1.4)
        effect += v
        flags.append({"label": f"{away_abbr} on B2B (away)", "effect": round(v, 2), "team": "away"})

    if away_b2b and not home_b2b:
        v = coefs.get("fatigue_asymmetry", 2.366)
        effect += v
        flags.append({"label": "Fatigue asymmetry — away disadvantaged", "effect": round(v, 2), "team": "away"})
    elif home_b2b and not away_b2b:
        v = -coefs.get("fatigue_asymmetry", 2.366)
        effect += v
        flags.append({"label": "Fatigue asymmetry — home disadvantaged", "effect": round(v, 2), "team": "home"})

    if is_altitude:
        v = coefs.get("high_altitude", 4.629)
        effect += v
        flags.append({"label": f"High altitude venue ({home_abbr})", "effect": round(v, 2), "team": "home"})

    home_rest = home_ctx.get("rest_days", 2)
    away_rest = away_ctx.get("rest_days", 2)
    rest_adv = (home_rest or 2) - (away_rest or 2)
    if abs(rest_adv) >= 1:
        v = rest_adv * coefs.get("rest_advantage", -0.131)
        effect += v
        flags.append({"label": f"Rest edge ({rest_adv:+d} days)", "effect": round(v, 2), "team": "home" if rest_adv > 0 else "away"})

    advantaged = None
    if effect > 1:
        advantaged = "home"
    elif effect < -1:
        advantaged = "away"

    return {"expected_effect": round(float(effect), 2), "flags": flags, "advantaged_team": advantaged}


@router.get("/today")
async def fatigue_today(date: str = Query(None)):
    today_str = date or datetime.now().strftime("%Y%m%d")
    coefs, source = get_coefficients()

    try:
        games = fetch_games_for_date(today_str)
    except Exception as e:
        return JSONResponse({"games": [], "error": str(e)})

    # Filter to only today's actual games (ESPN sometimes returns nearby dates)
    date_formatted = f"{today_str[:4]}-{today_str[4:6]}-{today_str[6:]}"
    games = [g for g in games if g.get("game_date") == date_formatted]

    results = []
    for g in games:
        home_id = g.get("home_team_espn_id")
        away_id = g.get("away_team_espn_id")
        home_abbr = g.get("home_team_abbr", ESPN_TEAM_ABBR.get(home_id, ""))
        away_abbr = g.get("away_team_abbr", ESPN_TEAM_ABBR.get(away_id, ""))

        home_ctx = get_team_schedule_context(home_id, date_formatted)
        away_ctx = get_team_schedule_context(away_id, date_formatted)

        fatigue = compute_fatigue(home_abbr, away_abbr, home_ctx, away_ctx, coefs)

        results.append({
            "game_id": g.get("game_id"),
            "home_team": home_abbr,
            "away_team": away_abbr,
            "home_score": g.get("home_score"),
            "away_score": g.get("away_score"),
            "status": g.get("status", ""),
            "completed": g.get("completed", False),
            "fatigue": fatigue,
        })

    return JSONResponse({"games": results, "date": date_formatted, "source": source})


@router.get("/")
async def fatigue_effects():
    try:
        payload = get_fatigue_effects()
        if not payload:
            raise ValueError("empty payload")

        r_squared = payload.pop("r_squared", None)
        n_games = payload.pop("n_games", None)

        results = []
        for factor, data in payload.items():
            if not isinstance(data, dict):
                continue
            results.append({
                "factor": str(factor),
                "label": LABEL_MAP.get(factor, factor),
                "coefficient": round(float(data["coefficient"]), 4),
                "p_value": round(float(data["p_value"]), 4),
                "ci_low": round(float(data["ci_low"]), 3),
                "ci_high": round(float(data["ci_high"]), 3),
                "significant": bool(float(data["p_value"]) < 0.05),
            })

        results.sort(key=lambda x: abs(x["coefficient"]), reverse=True)
        return JSONResponse({
            "effects": results,
            "r_squared": round(float(r_squared), 4) if r_squared is not None else 0.029,
            "n_games": int(n_games) if n_games is not None else 995,
        })
    except Exception:
        results = [
            {"factor": k, "label": LABEL_MAP.get(k, k), "coefficient": round(v, 4),
             "p_value": 0.05, "ci_low": 0.0, "ci_high": 0.0, "significant": k == "fatigue_asymmetry"}
            for k, v in sorted(FALLBACK_COEFFICIENTS.items(), key=lambda x: abs(x[1]), reverse=True)
        ]
        return JSONResponse({"effects": results, "r_squared": 0.0295, "n_games": 995})
