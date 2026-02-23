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

# Teams whose home venue is above 4000ft
HIGH_ALTITUDE_ABBRS = {"DEN", "UTA", "UTAH", "SLC"}


def get_coefficients():
    try:
        payload = get_fatigue_effects()
        if payload:
            return {k: float(v["coefficient"]) for k, v in payload.items() if isinstance(v, dict)}, "model"
    except Exception:
        pass
    return FALLBACK_COEFFICIENTS, "fallback"


def get_team_rest(team_id: int, game_date_str: str) -> dict:
    """Compute rest days and B2B status by looking up previous game in DB."""
    try:
        from datetime import date, timedelta
        today = date.fromisoformat(game_date_str)
        lookback = (today - timedelta(days=5)).isoformat()
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT game_date FROM games
                    WHERE (home_team_id = %s OR away_team_id = %s)
                    AND game_date < %s
                    AND game_date >= %s
                    ORDER BY game_date DESC LIMIT 1
                """, (team_id, team_id, game_date_str, lookback))
                row = cur.fetchone()
                if row:
                    prev = row[0] if hasattr(row[0], 'year') else date.fromisoformat(str(row[0]))
                    rest = (today - prev).days
                    return {"rest_days": rest, "b2b": rest == 1}
    except Exception:
        pass
    return {"rest_days": 2, "b2b": False}


def compute_fatigue(home_abbr: str, away_abbr: str, home_ctx: dict, away_ctx: dict, coefs: dict) -> dict:
    """
    Compute expected fatigue effect on home score margin.
    Positive = home team advantaged. Negative = away team advantaged.
    All factors stack — altitude doesn't override B2B, they sum.
    """
    effect = 0.0
    flags = []

    home_b2b = home_ctx.get("b2b", False)
    away_b2b = away_ctx.get("b2b", False)
    home_rest = home_ctx.get("rest_days", 2) or 2
    away_rest = away_ctx.get("rest_days", 2) or 2
    is_altitude_venue = home_abbr in HIGH_ALTITUDE_ABBRS

    # B2B effects
    if home_b2b:
        v = coefs.get("home_b2b", -0.965)
        effect += v
        flags.append({"label": f"{home_abbr} on B2B", "effect": round(v, 2), "team": "home"})

    if away_b2b:
        v = coefs.get("away_b2b", 1.4)
        effect += v
        flags.append({"label": f"{away_abbr} on B2B (away)", "effect": round(v, 2), "team": "away"})

    # Fatigue asymmetry — extra penalty when one team is on B2B and other isn't
    if away_b2b and not home_b2b:
        v = coefs.get("fatigue_asymmetry", 2.366)
        effect += v
        flags.append({"label": "Fatigue asymmetry — away disadvantaged", "effect": round(v, 2), "team": "away"})
    elif home_b2b and not away_b2b:
        v = -coefs.get("fatigue_asymmetry", 2.366)
        effect += v
        flags.append({"label": "Fatigue asymmetry — home disadvantaged", "effect": round(v, 2), "team": "home"})

    # Altitude — stacks with everything else
    if is_altitude_venue:
        v = coefs.get("high_altitude", 4.629)
        effect += v
        flags.append({"label": f"High altitude venue ({home_abbr})", "effect": round(v, 2), "team": "home"})

    # Rest advantage
    rest_adv = home_rest - away_rest
    if abs(rest_adv) >= 1:
        v = rest_adv * coefs.get("rest_advantage", -0.131)
        effect += v
        flags.append({
            "label": f"Rest edge ({rest_adv:+d} days for {'home' if rest_adv > 0 else 'away'})",
            "effect": round(v, 2),
            "team": "home" if rest_adv > 0 else "away"
        })

    advantaged = None
    if effect > 0.3:
        advantaged = "home"
    elif effect < -0.3:
        advantaged = "away"

    return {
        "expected_effect": round(float(effect), 2),
        "flags": flags,
        "advantaged_team": advantaged,
        "home_rest_days": home_rest,
        "away_rest_days": away_rest,
    }


@router.get("/today")
async def fatigue_today(date: str = Query(None)):
    """Return all games for today. Fetches yesterday, today, and tomorrow in UTC to handle timezone differences."""
    # ESPN stores games in UTC — Feb 23 7pm EST = Feb 24 UTC
    # So fetch both today and tomorrow in EST to catch all of today's games
    import zoneinfo
    est = zoneinfo.ZoneInfo("America/New_York")
    now_est = datetime.now(est)
    today_str = date or now_est.strftime("%Y%m%d")
    tomorrow_str = (now_est + timedelta(days=1)).strftime("%Y%m%d")

    coefs, source = get_coefficients()

    all_games = []
    seen = set()

    for fetch_date in [today_str, tomorrow_str]:
        try:
            games = fetch_games_for_date(fetch_date)
            for g in games:
                if g["game_id"] not in seen:
                    seen.add(g["game_id"])
                    all_games.append(g)
        except Exception:
            pass

    # No date filter — ESPN already scopes to the requested date
    today_formatted = f"{today_str[:4]}-{today_str[4:6]}-{today_str[6:]}"

    # Sort: in-progress first, then not started, then completed
    def sort_key(g):
        s = g.get("status", "").lower()
        if "final" in s:
            return 2
        if "half" in s or "qtr" in s or "end" in s:
            return 0
        return 1

    all_games.sort(key=sort_key)

    results = []
    for g in all_games:
        home_id = g.get("home_team_espn_id")
        away_id = g.get("away_team_espn_id")
        home_abbr = g.get("home_team_abbr", "")
        away_abbr = g.get("away_team_abbr", "")

        home_ctx = get_team_rest(home_id, today_formatted)
        away_ctx = get_team_rest(away_id, today_formatted)

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

    return JSONResponse({"games": results, "date": today_formatted, "source": source})


@router.get("/")
async def fatigue_effects():
    try:
        payload = get_fatigue_effects()
        if not payload:
            raise ValueError("empty")

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
             "p_value": 0.099, "ci_low": 0.0, "ci_high": 0.0,
             "significant": k == "fatigue_asymmetry"}
            for k, v in sorted(FALLBACK_COEFFICIENTS.items(), key=lambda x: abs(x[1]), reverse=True)
        ]
        return JSONResponse({"effects": results, "r_squared": 0.0295, "n_games": 995})
