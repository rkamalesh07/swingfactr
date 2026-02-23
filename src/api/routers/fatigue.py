"""Fatigue and travel effects router."""
from datetime import datetime
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

# Hardcoded coefficients as fallback if pickle not available
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


def get_coefficients():
    """Get model coefficients, falling back to hardcoded values."""
    try:
        payload = get_fatigue_effects()
        if payload:
            return {k: v["coefficient"] for k, v in payload.items() if isinstance(v, dict)}
    except Exception:
        pass
    return FALLBACK_COEFFICIENTS


def compute_game_fatigue(home_schedule: dict, away_schedule: dict, coefs: dict) -> dict:
    """Compute expected fatigue effect for a single game."""
    if not home_schedule or not away_schedule:
        return {"expected_effect": 0, "flags": [], "advantaged_team": None}

    home_b2b = home_schedule.get("b2b", False)
    away_b2b = away_schedule.get("b2b", False)
    away_miles = away_schedule.get("travel_miles", 0) or 0
    home_altitude = home_schedule.get("altitude_ft", 0) or 0
    away_tz = away_schedule.get("tz_change", 0) or 0
    home_rest = home_schedule.get("rest_days", 2) or 2
    away_rest = away_schedule.get("rest_days", 2) or 2

    effect = 0
    flags = []

    if home_b2b:
        effect += coefs.get("home_b2b", -0.965)
        flags.append({"label": "Home on B2B", "effect": round(coefs.get("home_b2b", -0.965), 2), "team": "home"})

    if away_b2b:
        effect += coefs.get("away_b2b", 1.4)
        flags.append({"label": "Away on B2B", "effect": round(coefs.get("away_b2b", 1.4), 2), "team": "away"})

    if home_b2b and not away_b2b:
        effect += coefs.get("fatigue_asymmetry", 2.366) * -1
        flags.append({"label": "Fatigue asymmetry (home disadvantaged)", "effect": round(-coefs.get("fatigue_asymmetry", 2.366), 2), "team": "home"})
    elif away_b2b and not home_b2b:
        effect += coefs.get("fatigue_asymmetry", 2.366)
        flags.append({"label": "Fatigue asymmetry (away disadvantaged)", "effect": round(coefs.get("fatigue_asymmetry", 2.366), 2), "team": "away"})

    if away_miles > 1500:
        trip_effect = coefs.get("long_trip", -4.51)
        effect += trip_effect
        flags.append({"label": f"Long road trip ({int(away_miles)} mi)", "effect": round(trip_effect, 2), "team": "away"})
    elif away_miles > 0:
        miles_effect = (away_miles / 100) * coefs.get("travel_miles_100", 0.04)
        effect += miles_effect
        flags.append({"label": f"Travel distance ({int(away_miles)} mi)", "effect": round(miles_effect, 2), "team": "away"})

    if home_altitude > 4000:
        alt_effect = coefs.get("high_altitude", 4.629)
        effect += alt_effect
        flags.append({"label": "High altitude venue", "effect": round(alt_effect, 2), "team": "home"})

    if away_tz != 0:
        tz_effect = away_tz * coefs.get("tz_change", 0.268)
        effect += tz_effect
        flags.append({"label": f"Timezone change ({away_tz:+d} hrs)", "effect": round(tz_effect, 2), "team": "away"})

    rest_adv = home_rest - away_rest
    if abs(rest_adv) >= 1:
        rest_effect = rest_adv * coefs.get("rest_advantage", -0.131)
        effect += rest_effect
        flags.append({"label": f"Rest advantage ({rest_adv:+d} days)", "effect": round(rest_effect, 2), "team": "home" if rest_adv > 0 else "away"})

    advantaged = None
    if effect > 1:
        advantaged = "home"
    elif effect < -1:
        advantaged = "away"

    return {
        "expected_effect": round(float(effect), 2),
        "flags": flags,
        "advantaged_team": advantaged,
    }


@router.get("/today")
async def fatigue_today(date: str = Query(None)):
    """Return today's games with fatigue context applied."""
    date_str = date or datetime.now().strftime("%Y%m%d")
    coefs = get_coefficients()

    try:
        games = fetch_games_for_date(date_str)
    except Exception as e:
        return JSONResponse({"games": [], "error": str(e)})

    results = []
    for g in games:
        home_id = g.get("home_team_espn_id")
        away_id = g.get("away_team_espn_id")
        game_id = g.get("game_id")

        home_sched = None
        away_sched = None

        try:
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT rest_days, b2b, travel_miles, tz_change, altitude_ft
                        FROM schedule WHERE team_id = %s AND game_id = %s
                    """, (home_id, game_id))
                    row = cur.fetchone()
                    if row:
                        home_sched = dict(zip(["rest_days", "b2b", "travel_miles", "tz_change", "altitude_ft"], row))

                    cur.execute("""
                        SELECT rest_days, b2b, travel_miles, tz_change, altitude_ft
                        FROM schedule WHERE team_id = %s AND game_id = %s
                    """, (away_id, game_id))
                    row = cur.fetchone()
                    if row:
                        away_sched = dict(zip(["rest_days", "b2b", "travel_miles", "tz_change", "altitude_ft"], row))
        except Exception:
            pass

        fatigue = compute_game_fatigue(home_sched, away_sched, coefs)

        results.append({
            "game_id": game_id,
            "home_team": g.get("home_team_abbr"),
            "away_team": g.get("away_team_abbr"),
            "home_score": g.get("home_score"),
            "away_score": g.get("away_score"),
            "status": g.get("status"),
            "completed": g.get("completed"),
            "fatigue": fatigue,
        })

    return JSONResponse({"games": results, "date": date_str, "coefficients_used": "model" if coefs != FALLBACK_COEFFICIENTS else "fallback"})


@router.get("/")
async def fatigue_effects():
    try:
        payload = get_fatigue_effects()
        if not payload:
            # Return fallback coefficients so page always has data
            results = [
                {"factor": k, "label": LABEL_MAP.get(k, k),
                 "coefficient": v, "p_value": 0.05, "ci_low": 0, "ci_high": 0, "significant": False}
                for k, v in FALLBACK_COEFFICIENTS.items()
            ]
            return JSONResponse({"effects": results, "r_squared": 0.029, "n_games": 995, "source": "fallback"})

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
            "r_squared": round(float(r_squared), 4) if r_squared is not None else None,
            "n_games": int(n_games) if n_games is not None else None,
        })
    except Exception as e:
        import traceback
        # Return fallback so page never crashes
        results = [
            {"factor": k, "label": LABEL_MAP.get(k, k),
             "coefficient": v, "p_value": 0.05, "ci_low": 0, "ci_high": 0, "significant": False}
            for k, v in FALLBACK_COEFFICIENTS.items()
        ]
        return JSONResponse({"effects": results, "r_squared": 0.029, "n_games": 995, "source": "fallback"})
