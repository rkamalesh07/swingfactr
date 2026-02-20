"""Fatigue and travel effects router."""
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from src.models.fatigue import get_fatigue_effects

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

@router.get("/")
async def fatigue_effects():
    try:
        payload = get_fatigue_effects()
        if not payload:
            return JSONResponse({"effects": [], "r_squared": None, "n_games": None})

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
        return JSONResponse({"error": str(e), "trace": traceback.format_exc(), "effects": []}, status_code=500)
