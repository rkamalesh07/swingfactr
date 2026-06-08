"""
SwingFactr GM Mode — FastAPI Router
src/api/routers/gm.py

Add to main.py:
    from src.api.routers.gm import router as gm_router
    app.include_router(gm_router)
"""

import uuid
import math
import random
import json
from datetime import datetime, date
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from src.etl.db import get_conn

router = APIRouter(prefix="/gm", tags=["gm"])

# ─── Constants ────────────────────────────────────────────────────────────────

SALARY_CAP       = 140_000_000
LUXURY_TAX       = 170_000_000
MID_LEVEL        = 12_400_000
VET_MIN          = 1_200_000
PLAYOFFS_START   = "2026-04-18"

NBA_TEAMS = [
    "ATL","BOS","BKN","CHA","CHI","CLE","DAL","DEN","DET","GS",
    "HOU","IND","LAC","LAL","MEM","MIA","MIL","MIN","NO","NY",
    "OKC","ORL","PHI","PHX","POR","SA","SAC","TOR","UTAH","WSH"
]

TEAM_FULL_NAMES = {
    "ATL":"Atlanta Hawks","BOS":"Boston Celtics","BKN":"Brooklyn Nets",
    "CHA":"Charlotte Hornets","CHI":"Chicago Bulls","CLE":"Cleveland Cavaliers",
    "DAL":"Dallas Mavericks","DEN":"Denver Nuggets","DET":"Detroit Pistons",
    "GS":"Golden State Warriors","HOU":"Houston Rockets","IND":"Indiana Pacers",
    "LAC":"LA Clippers","LAL":"LA Lakers","MEM":"Memphis Grizzlies",
    "MIA":"Miami Heat","MIL":"Milwaukee Bucks","MIN":"Minnesota Timberwolves",
    "NO":"New Orleans Pelicans","NY":"New York Knicks","OKC":"Oklahoma City Thunder",
    "ORL":"Orlando Magic","PHI":"Philadelphia 76ers","PHX":"Phoenix Suns",
    "POR":"Portland Trail Blazers","SA":"San Antonio Spurs","SAC":"Sacramento Kings",
    "TOR":"Toronto Raptors","UTAH":"Utah Jazz","WSH":"Washington Wizards"
}

CONFERENCE = {
    "ATL":"East","BOS":"East","BKN":"East","CHA":"East","CHI":"East",
    "CLE":"East","DET":"East","IND":"East","MIA":"East","MIL":"East",
    "NY":"East","ORL":"East","PHI":"East","TOR":"East","WSH":"East",
    "DAL":"West","DEN":"West","GS":"West","HOU":"West","LAC":"West",
    "LAL":"West","MEM":"West","MIN":"West","NO":"West","OKC":"West",
    "PHX":"West","POR":"West","SA":"West","SAC":"West","UTAH":"West"
}



# ─── Rating Engine (Advanced Metrics Edition) ────────────────────────────────
"""
SwingFactr GM Rating Engine — Advanced Metrics Edition
=======================================================

Replaces the pure box-score engine with one that uses
BBRef advanced metrics (BPM, VORP, WS/48, TS%) as primary signal.

Falls back to box-score percentile engine for players not in BBRef.

Three outputs:
  talent       — true basketball ability (0-99), ignores availability
  trade_value  — market worth (0-99), bakes in age/contract/health
  future       — projected peak ability (0-99)
"""

import math
import random
import uuid


# ─── Core Math ────────────────────────────────────────────────────────────────

def safe_div(a, b, default=0.0):
    try:
        a, b = float(a), float(b)
    except (TypeError, ValueError):
        return default
    return a / b if b > 0 else default

def clamp(v, lo=0.0, hi=99.0):
    return max(lo, min(hi, float(v)))

def percentile_rank(value: float, distribution: list) -> float:
    if not distribution:
        return 50.0
    below = sum(1 for x in distribution if x < value)
    return (below / len(distribution)) * 100.0

def percentile_to_rating(pct: float, lo=25.0, hi=95.0) -> float:
    return clamp(lo + (pct / 100.0) * (hi - lo), lo, hi)

def normalize(val, lo, hi, out_lo=20.0, out_hi=95.0):
    """Linear normalize val from [lo,hi] to [out_lo,out_hi]."""
    if hi == lo:
        return (out_lo + out_hi) / 2
    frac = (val - lo) / (hi - lo)
    return clamp(out_lo + frac * (out_hi - out_lo), out_lo, out_hi)


# ─── Advanced Metrics → Talent ────────────────────────────────────────────────

# BBRef BPM scale: elite ~+8, avg ~0, replacement ~-2
# WS/48 scale: elite ~0.25, avg ~0.10, replacement ~0.00
# VORP scale: elite ~6+, avg ~1-2, replacement ~0
# TS%: elite ~63%+, avg ~55%, poor ~48%

def talent_from_advanced(adv: dict) -> float | None:
    """
    Two-rating system:
      overall = current impact (injury-penalized, what user sees)
      talent  = true ability (injury-corrected, what AI uses for trades)

    Calibrated against: SGA=87, Jokic=88, Giannis=86, Wemby=85, Luka=87,
    Ant/Brunson/Cade=83, Curry/Kawhi=81, KD=80, Tatum=74 (injured)
    """
    bpm  = adv.get("bpm")
    vorp = adv.get("vorp")
    ws48 = adv.get("ws_per_48")
    ts   = adv.get("ts_pct")
    mp   = float(adv.get("mp") or 0)
    ppg  = float(adv.get("ppg") or adv.get("pts_per_g") or 0)
    usage = float(adv.get("usg_pct") or adv.get("usage") or 0.20)
    age  = float(adv.get("age") or 26)

    if bpm is None:
        return None

    bpm  = float(bpm)
    vorp = float(vorp) if vorp is not None else 0.0
    ws48 = float(ws48) if ws48 is not None else 0.08
    ts   = float(ts)   if ts   is not None else 0.54

    if mp < 300:
        rel = 0.30
    elif mp < 600:
        rel = 0.45
    else:
        rel = min(1.0, 0.50 + 0.50 * (mp / 2500.0) ** 0.5)

    games_frac = max(0.3, min(1.0, mp / 2500.0))
    vorp_pg    = vorp / games_frac  # per-full-season VORP

    # Component scores
    bpm_raw  = clamp(58 + bpm * 2.5,       20, 96)   # cap 96 so Jokic doesn't break scale
    vorp_raw = clamp(56 + vorp_pg * 3.8,   20, 99)
    ws48_raw = clamp(40 + ws48 * 180,      20, 90)
    ts_raw   = clamp(25 + (ts - 0.44) * 350, 20, 88)
    cr_raw   = clamp(50 + (usage * 100 - 20) * 1.8 + (ppg / 30) * 15, 20, 95)

    bpm_adj  = bpm_raw  * rel + 55 * (1 - rel)
    ws48_adj = ws48_raw * rel + 50 * (1 - rel)
    vorp_adj = vorp_raw * (0.6 + 0.4 * rel)

    base = clamp(
        0.52 * bpm_adj +
        0.18 * vorp_adj +
        0.09 * ws48_adj +
        0.16 * cr_raw +
        0.05 * ts_raw,
        20, 99
    )

    # Usage*PPG floors -- primary scorers never underrated due to team depth
    usage_pts = usage * ppg
    if   usage_pts >= 11.0: base = max(base, 86)
    elif usage_pts >= 9.0:  base = max(base, 84)
    elif usage_pts >= 7.5:  base = max(base, 83)
    elif usage_pts >= 6.5:  base = max(base, 81)
    elif usage_pts >= 5.5:  base = max(base, 78)
    elif usage_pts >= 4.0:  base = max(base, 72)

    base = min(base, 90)  # Jokic historically outlier cap
    overall = round(clamp(base, 20, 99))

    # Talent rating: injury-corrected for AI use
    if rel < 0.75 and bpm > 5.0:
        full = clamp(
            0.52 * bpm_raw + 0.18 * vorp_raw + 0.09 * ws48_raw + 0.16 * cr_raw + 0.05 * ts_raw,
            20, 90
        )
        # Apply same usage floors to full-season projection
        if   usage_pts >= 11.0: full = max(full, 86)
        elif usage_pts >= 9.0:  full = max(full, 84)
        elif usage_pts >= 7.5:  full = max(full, 83)
        elif usage_pts >= 6.5:  full = max(full, 81)
        talent = round(clamp((overall + full) / 2, 20, 99))
    else:
        talent = overall

    # Age adjustment on talent
    if   age <= 24: talent = min(talent + 3, 99)
    elif age <= 27: talent = min(talent + 1, 99)
    elif age >= 36: talent = max(talent - 3, 20)
    elif age >= 33: talent = max(talent - 1, 20)

    talent_from_advanced._last_talent = int(talent)
    return float(overall)

talent_from_advanced._last_talent = 0

# ─── Box Score Fallback ───────────────────────────────────────────────────────

def extract_raw_stats(row: dict) -> dict:
    def f(v, default=0.0):
        try:
            return float(v) if v is not None else default
        except (TypeError, ValueError):
            return default
    def i(v, default=0):
        try:
            return int(float(v)) if v is not None else default
        except (TypeError, ValueError):
            return default

    mpg  = max(f(row.get("mpg"), 1.0), 0.5)
    ppg  = f(row.get("ppg"))
    rpg  = f(row.get("rpg"))
    apg  = f(row.get("apg"))
    spg  = f(row.get("spg"))
    bpg  = f(row.get("bpg"))
    tov  = f(row.get("tov"))
    fg3m = f(row.get("fg3m"))
    efg  = f(row.get("efg_pct"), 50.0)
    gp   = f(row.get("gp"), 1.0)
    age  = i(row.get("age"), 26)
    pos  = str(row.get("position") or "G").upper()

    pts36  = safe_div(ppg, mpg) * 36
    ast36  = safe_div(apg, mpg) * 36
    reb36  = safe_div(rpg, mpg) * 36
    stk36  = safe_div(spg + bpg, mpg) * 36
    tov36  = safe_div(tov, mpg) * 36
    fg3_36 = safe_div(fg3m, mpg) * 36
    pm_net = ast36 - tov36 * 0.5
    availability = (gp / 82.0) * (mpg / 36.0)

    return {
        "mpg": mpg, "ppg": ppg, "rpg": rpg, "apg": apg,
        "spg": spg, "bpg": bpg, "tov": tov, "fg3m": fg3m,
        "efg": efg, "gp": gp, "age": age, "pos": pos,
        "pts36": pts36, "ast36": ast36, "reb36": reb36,
        "stk36": stk36, "tov36": tov36, "fg3_36": fg3_36,
        "pm_net": pm_net, "availability": availability,
    }

def build_distributions(all_raw: list[dict]) -> dict:
    keys = ["pts36", "ast36", "reb36", "stk36", "pm_net",
            "fg3_36", "efg", "availability", "mpg"]
    return {k: sorted(r[k] for r in all_raw) for k in keys}

def talent_from_boxscore(raw: dict, dist: dict) -> float:
    """Fallback talent estimate from box score percentiles."""
    pts36  = raw["pts36"]
    pm_net = raw["pm_net"]
    reb36  = raw["reb36"]
    stk36  = raw["stk36"]
    efg    = raw["efg"]
    mpg    = raw["mpg"]
    ppg    = raw["ppg"]

    scoring_pct    = percentile_rank(pts36,  dist["pts36"])
    efficiency_pct = percentile_rank(efg,    dist["efg"])
    playmaking_pct = percentile_rank(pm_net, dist["pm_net"])
    reb_pct        = percentile_rank(reb36,  dist["reb36"])
    def_pct        = percentile_rank(stk36,  dist["stk36"])

    scoring    = percentile_to_rating(scoring_pct,    lo=20, hi=95)
    efficiency = percentile_to_rating(efficiency_pct, lo=25, hi=88)
    playmaking = percentile_to_rating(playmaking_pct, lo=15, hi=90)
    rebounding = percentile_to_rating(reb_pct,        lo=15, hi=88)
    defense    = percentile_to_rating(def_pct,        lo=15, hi=88)

    off = 0.42 * scoring + 0.30 * efficiency + 0.28 * playmaking
    dfn = 0.55 * defense + 0.45 * rebounding

    base = clamp(0.62 * off + 0.35 * dfn + 0.03 * 50)

    # MPG gate
    ppg_relief = 8 if ppg >= 16 else (4 if ppg >= 12 else 0)
    if   mpg < 8:  base = min(base, 44 + ppg_relief)
    elif mpg < 13: base = min(base, 54 + ppg_relief)
    elif mpg < 18: base = min(base, 64 + ppg_relief)
    elif mpg < 22: base = min(base, 76 + ppg_relief)
    elif mpg < 26: base = min(base, 85 + ppg_relief)

    # PPG floors
    if   ppg >= 30: base = max(base, 83)
    elif ppg >= 25: base = max(base, 76)
    elif ppg >= 20: base = max(base, 68)
    elif ppg >= 14: base = max(base, 54)
    elif ppg >= 11: base = max(base, 46)

    # Non-scorer cap
    if   ppg < 8:  base = min(base, 58)
    elif ppg < 10: base = min(base, 63)
    elif ppg < 13: base = min(base, 68)

    # Injury soft boost
    gp = raw.get("gp", 82)
    if gp < 50 and ppg >= 15:
        healthy_proxy = base * (1 + (50 - gp) / 50 * 0.10)
        base = max(base, min(healthy_proxy, base + 6))

    return round(clamp(base))


# ─── Age Curve ────────────────────────────────────────────────────────────────

AGE_TRAJECTORY = {
    19: (+6.0, 5.0), 20: (+5.0, 5.0), 21: (+4.5, 4.5),
    22: (+3.5, 4.0), 23: (+2.5, 3.5), 24: (+1.5, 3.0),
    25: (+0.8, 2.5), 26: (+0.2, 2.0), 27: (-0.3, 2.0),
    28: (-0.8, 2.0), 29: (-1.5, 2.5), 30: (-2.5, 3.0),
    31: (-3.5, 3.0), 32: (-5.0, 3.5), 33: (-6.5, 4.0),
    34: (-8.0, 4.0),
}

def compute_future(talent: float, age: int) -> float:
    if age >= 35:
        return max(talent - 15, 25)
    traj = AGE_TRAJECTORY.get(age, (-2.0, 3.0))
    years_to_peak = max(0, 27 - age)
    delta = traj[0] * min(years_to_peak, 4)
    future = talent + delta
    ceiling = talent + (99 - talent) * 0.30 + (5 if age <= 22 else 0)
    return round(clamp(future, lo=max(15, talent - 20), hi=min(99, ceiling)))


# ─── Contract & Trade Value ───────────────────────────────────────────────────

def market_salary(talent: float, age: int) -> int:
    CAP = 140_000_000
    if   talent >= 88: frac = 0.35
    elif talent >= 80: frac = 0.27
    elif talent >= 72: frac = 0.19
    elif talent >= 64: frac = 0.12
    elif talent >= 55: frac = 0.07
    elif talent >= 45: frac = 0.035
    else:              frac = 0.014

    base = frac * CAP
    if   age <= 22: mult = 0.80
    elif age <= 25: mult = 0.95
    elif age <= 28: mult = 1.10
    elif age <= 30: mult = 1.00
    elif age <= 32: mult = 0.82
    else:           mult = 0.62

    return max(1_200_000, min(int(CAP * 0.35), int(base * mult)))

def contract_years_for(talent: float, age: int) -> int:
    if   talent >= 80: return random.choice([4, 4, 5]) if age <= 30 else random.choice([2, 3])
    elif talent >= 65: return random.choice([3, 3, 4]) if age <= 28 else random.choice([2, 3])
    elif talent >= 50: return random.choice([2, 2, 3])
    else:              return random.choice([1, 2])

def compute_trade_value(talent: float, future: float, salary: int, age: int, archetype: str) -> float:
    expected_sal = market_salary(talent, age)
    contract_score = clamp(50 + (expected_sal / max(salary, 1) - 1.0) * 40, 0, 99)
    years_of_prime = max(0, min(5, 30 - age))
    age_score = clamp(years_of_prime / 5.0 * 80 + 15)

    SCARCITY = {
        "Primary Ball Handler": 1.14, "Shot Creator": 1.12,
        "Floor General": 1.10, "Rim Protector": 1.08,
        "3-and-D": 1.06, "Wing Scorer": 1.05, "Scoring Wing": 1.04,
        "Stretch Four": 1.03, "Playmaking Big": 1.02,
    }
    mult = SCARCITY.get(archetype, 1.00)

    raw = (
        0.40 * talent +
        0.25 * future +
        0.20 * contract_score +
        0.15 * age_score
    ) * mult

    return round(clamp(raw))


# ─── Archetype Detection ──────────────────────────────────────────────────────

def detect_archetype(raw: dict) -> str:
    ppg  = raw["ppg"]
    apg  = raw["apg"]
    rpg  = raw["rpg"]
    spg  = raw["spg"]
    bpg  = raw["bpg"]
    fg3m = raw["fg3m"]
    mpg  = raw["mpg"]
    pos  = raw["pos"]

    ast_rate = safe_div(apg, mpg)
    is_big   = pos in ("C", "F", "PF", "C-F", "F-C", "PF-C", "C-PF")

    if (ast_rate > 0.32 and ppg >= 14) or (apg >= 6.0 and ppg >= 25): return "Primary Ball Handler"
    if ast_rate > 0.28 and ppg >= 12:          return "Floor General"
    if fg3m >= 2.5 and spg >= 1.2:             return "3-and-D"
    if rpg > 7.5 and bpg > 1.2:               return "Rim Protector"
    if rpg > 8.0 and bpg > 0.8 and ppg < 12:  return "Defensive Big"
    if is_big and fg3m >= 1.5 and rpg > 5:    return "Stretch Four"
    if is_big and ast_rate > 0.20 and rpg > 5: return "Playmaking Big"
    if is_big and rpg > 6.5:                   return "Traditional Big"
    if ppg >= 20 and fg3m >= 2.0:             return "Shot Creator"
    if ppg >= 18 and fg3m >= 1.5:             return "Wing Scorer"
    if fg3m >= 2.5 and ppg < 15:              return "Spot-Up Shooter"
    if spg >= 1.5 and ppg < 14:               return "Perimeter Defender"
    if ppg >= 15:                              return "Scoring Wing"
    if rpg > 5 and ppg < 10:                  return "Energy Big"
    if ast_rate > 0.22:                        return "Secondary Playmaker"
    return "Role Player"


# ─── Outcome Tree ─────────────────────────────────────────────────────────────

def build_outcome_tree(talent: float, age: int) -> dict:
    if age <= 21:
        upside = random.uniform(8, 22); bust = random.uniform(0.10, 0.30); traj = "rising"
    elif age <= 23:
        upside = random.uniform(5, 15); bust = random.uniform(0.05, 0.18); traj = "rising"
    elif age <= 25:
        upside = random.uniform(2, 10); bust = random.uniform(0.03, 0.10); traj = "rising"
    elif age <= 28:
        upside = random.uniform(0, 4);  bust = random.uniform(0.02, 0.07); traj = "peak"
    elif age <= 31:
        upside = random.uniform(0, 2);  bust = random.uniform(0.05, 0.15); traj = "declining"
    else:
        upside = 0; bust = random.uniform(0.15, 0.40); traj = "declining"

    ceiling = round(clamp(talent + upside, lo=talent, hi=99))
    floor   = round(clamp(talent - bust * 20, lo=25, hi=talent))

    if   talent >= 82: outcomes = {"superstar":0.70,"all_star":0.22,"starter":0.06,"role":0.02,"bust":0.00}
    elif talent >= 72: outcomes = {"superstar":0.15,"all_star":0.45,"starter":0.30,"role":0.08,"bust":0.02}
    elif talent >= 60: outcomes = {"superstar":0.04,"all_star":0.18,"starter":0.42,"role":0.28,"bust":0.08}
    elif talent >= 48: outcomes = {"superstar":0.01,"all_star":0.05,"starter":0.25,"role":0.50,"bust":0.19}
    else:              outcomes = {"superstar":0.00,"all_star":0.01,"starter":0.10,"role":0.45,"bust":0.44}

    return {
        "ceiling": ceiling, "floor": floor,
        "bust_risk": round(bust, 3), "trajectory": traj,
        "outcomes": outcomes, "revealed": False,
    }


# ─── Full Player Rating ───────────────────────────────────────────────────────

def rate_player(row: dict, dist: dict, adv_metrics: dict | None = None) -> dict:
    """
    Rate a player using advanced metrics (primary) or box score (fallback).

    adv_metrics: row from player_advanced_metrics table, or None.
    """
    raw = extract_raw_stats(row)
    age = raw["age"]

    # Primary: advanced metrics from BBRef
    talent_adv = None
    if adv_metrics:
        talent_adv = talent_from_advanced(adv_metrics)

    # Fallback: box score percentile engine
    talent_box = talent_from_boxscore(raw, dist)

    # Blend: if we have advanced metrics, use them as primary signal
    # Do NOT apply PPG floor when we have real advanced metrics --
    # BPM/VORP already capture scoring contribution properly
    if talent_adv is not None:
        talent = round(clamp(0.90 * talent_adv + 0.10 * talent_box))
    else:
        talent = talent_box

    future     = compute_future(float(talent), age)
    archetype  = detect_archetype(raw)
    salary     = market_salary(float(talent), age)
    years      = contract_years_for(float(talent), age)
    trade_val  = compute_trade_value(float(talent), float(future), salary, age, archetype)
    tree       = build_outcome_tree(float(talent), age)

    # Dimension scores for UI
    def dim(key, lo, hi):
        pct = percentile_rank(raw.get(key, 0), dist.get(key, [0]))
        return round(percentile_to_rating(pct, lo, hi))

    return {
        "overall":       talent,
        "future":        future,
        "trade_value":   trade_val,
        "scoring":       dim("pts36", 20, 97),
        "efficiency":    round(percentile_to_rating(percentile_rank(raw["efg"], dist["efg"]), 25, 90)),
        "playmaking":    dim("pm_net", 15, 92),
        "rebounding":    dim("reb36", 15, 90),
        "defense":       dim("stk36", 15, 88),
        "composure":     round(clamp(normalize(raw["availability"], 0.05, 0.75, 20, 88))),
        "contract_value": round(clamp(50 + (market_salary(float(talent), age) / max(salary, 1) - 1) * 40, 0, 99)),
        "archetype":     archetype,
        "salary":        salary,
        "years_left":    years,
        "_outcome_tree": tree,
        "_used_advanced": talent_adv is not None,
    }


# ─── League Init (two-pass) ───────────────────────────────────────────────────

def build_player_ratings(players: list[dict], adv_lookup: dict | None = None) -> list[dict]:
    """
    Two-pass rating system.
    Pass 1: build population distributions from box scores.
    Pass 2: rate each player, using advanced metrics where available.

    adv_lookup: dict of {player_name: adv_metrics_row}
    """
    # Pass 1
    all_raw = []
    for p in players:
        try:
            raw = extract_raw_stats(p)
            raw["_row"] = p
            all_raw.append(raw)
        except Exception:
            continue

    if not all_raw:
        raise RuntimeError(f"No raw stats extracted from {len(players)} players")

    dist = build_distributions(all_raw)

    # Pass 2
    rated = []
    for raw in all_raw:
        p = raw["_row"]
        try:
            name = p.get("full_name") or p.get("player_name") or ""
            adv  = (adv_lookup or {}).get(name)
            ratings = rate_player(p, dist, adv)
            age = int(p.get("age") or 26)
            rated.append({
                "id":        str(uuid.uuid4())[:8],
                "name":      name or "Unknown",
                "position":  p.get("position") or "G",
                "age":       age,
                "team":      p.get("team_abbr") or "FA",
                "ppg":       round(float(p.get("ppg") or 0), 1),
                "rpg":       round(float(p.get("rpg") or 0), 1),
                "apg":       round(float(p.get("apg") or 0), 1),
                "spg":       round(float(p.get("spg") or 0), 1),
                "bpg":       round(float(p.get("bpg") or 0), 1),
                "fg3m":      round(float(p.get("fg3m") or 0), 1),
                "mpg":       round(float(p.get("mpg") or 0), 1),
                "gp":        int(p.get("gp") or 0),
                **ratings,
            })
        except Exception:
            continue

    return rated


# ─── Salary + Contract helpers (wrappers around engine functions) ───────────

def estimate_salary(overall: int, age: int) -> int:
    return market_salary(float(overall), age)

def contract_years(overall: int, age: int) -> int:
    return contract_years_for(float(overall), age)

# ─── Abbr Normalisation ───────────────────────────────────────────────────────

ABBR_TO_ESPN = {
    "GSW": "GS", "SAS": "SA", "NOP": "NO", "NYK": "NY",
    "UTA": "UTAH", "WAS": "WSH", "PHO": "PHX",
}



def fetch_all_players(conn) -> list[dict]:
    """
    Fetch players with season stats + most recent team from game logs.
    Falls back to players table for teams with no recent logs (injuries etc).
    """
    cur = conn.cursor()
    cur.execute("""
        WITH season_stats AS (
            SELECT
                gl.player_name,
                COUNT(*)                         AS gp,
                AVG(gl.pts)                      AS ppg,
                AVG(gl.reb)                      AS rpg,
                AVG(gl.ast)                      AS apg,
                AVG(gl.stl)                      AS spg,
                AVG(gl.blk)                      AS bpg,
                AVG(gl.fg3m)                     AS fg3m,
                AVG(gl.tov)                      AS tov,
                AVG(gl.minutes)                  AS mpg,
                AVG(CASE WHEN gl.fga > 0
                    THEN gl.fg_made::float / gl.fga * 100 END) AS fg_pct,
                AVG(CASE WHEN gl.fga > 0
                    THEN (gl.fg_made + 0.5*gl.fg3m)::float / gl.fga * 100 END) AS efg_pct,
                AVG(CASE WHEN gl.fga > 0
                    THEN gl.fg3m::float / (gl.fga * 0.38) * 100 END) AS fg3_pct_est
            FROM player_game_logs gl
            WHERE gl.season_id = '2025-26'
            GROUP BY gl.player_name
            HAVING COUNT(*) >= 5 AND AVG(gl.minutes) >= 5
        ),
        latest_team AS (
            SELECT DISTINCT ON (player_name)
                player_name,
                team_abbr,
                game_date
            FROM player_game_logs
            WHERE season_id = '2025-26'
            ORDER BY player_name, game_date DESC
        )
        SELECT
            s.player_name        AS full_name,
            COALESCE(p.position, 'G') AS position,
            COALESCE(pa.age, 26) AS age,
            COALESCE(lt.team_abbr, p.team_id::text, 'FA') AS team_abbr,
            s.gp, s.ppg, s.rpg, s.apg, s.spg, s.bpg,
            s.fg3m, s.tov, s.mpg, s.fg_pct, s.efg_pct, s.fg3_pct_est
        FROM season_stats s
        LEFT JOIN latest_team lt ON lt.player_name = s.player_name
        LEFT JOIN players p ON p.full_name = s.player_name
        LEFT JOIN player_ages pa ON pa.full_name = s.player_name
        ORDER BY s.ppg DESC
    """)
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    cur.close()

    for row in rows:
        abbr = row.get("team_abbr") or "FA"
        row["team_abbr"] = ABBR_TO_ESPN.get(str(abbr).upper(), str(abbr).upper())

    return rows


def fetch_advanced_metrics(conn) -> dict:
    """
    Load BBRef advanced metrics from player_advanced_metrics table.
    Returns dict keyed by player_name.
    Falls back gracefully if table doesn't exist yet.
    """
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT player_name, bpm, vorp, ws, ws_per_48, ts_pct, per, mp
            FROM player_advanced_metrics
            WHERE season_id = '2025-26'
        """)
        rows = cur.fetchall()
        cur.close()
        return {
            r[0]: {
                "bpm": r[1], "vorp": r[2], "ws": r[3],
                "ws_per_48": r[4], "ts_pct": r[5], "per": r[6], "mp": r[7],
            }
            for r in rows
        }
    except Exception as e:
        print(f"Warning: could not load advanced metrics: {e}")
        try:
            conn.rollback()
        except Exception:
            pass
        return {}


def fetch_contracts(conn) -> dict:
    """
    Load real 2025-26 salaries from player_contracts table.
    Returns dict with multiple key aliases for fuzzy name matching.
    """
    import unicodedata
    def norm(s):
        s = unicodedata.normalize("NFKD", str(s))
        s = "".join(c for c in s if not unicodedata.combining(c))
        # Remove suffixes like III, Jr., Sr.
        for suffix in [" III", " II", " IV", " Jr.", " Sr.", " Jr", " Sr"]:
            s = s.replace(suffix, "")
        return s.strip()

    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT player_name, salary_2526, salary_2627, salary_2728,
                   salary_2829, salary_2930, guaranteed, contract_type
            FROM player_contracts
        """)
        rows = cur.fetchall()
        cur.close()
        result = {}
        for r in rows:
            entry = {
                "salary":        int(r[1]) if r[1] else None,
                "salary_2627":   int(r[2]) if r[2] else None,
                "salary_2728":   int(r[3]) if r[3] else None,
                "salary_2829":   int(r[4]) if r[4] else None,
                "salary_2930":   int(r[5]) if r[5] else None,
                "guaranteed":    int(r[6]) if r[6] else None,
                "contract_type": r[7] or "guaranteed",
            }
            # Store under original name and normalized name
            result[r[0]] = entry
            result[norm(r[0])] = entry
        return result
    except Exception as e:
        print(f"Warning: could not load contracts: {e}")
        try:
            conn.rollback()
        except Exception:
            pass
        return {}

def get_save(conn, save_id: str) -> dict:
    cur = conn.cursor()
    cur.execute("SELECT state FROM gm_saves WHERE save_id = %s", (save_id,))
    row = cur.fetchone()
    cur.close()
    if not row:
        raise HTTPException(404, f"Save not found: {save_id}")
    val = row[0]
    return val if isinstance(val, dict) else json.loads(val)

def put_save(conn, save_id: str, state: dict):
    cur = conn.cursor()
    cur.execute("""
        UPDATE gm_saves SET state = %s, updated_at = NOW()
        WHERE save_id = %s
    """, (json.dumps(state), save_id))
    cur.close()

# ─── League Initialisation ────────────────────────────────────────────────────

def build_league(players: list[dict], adv_lookup: dict = None, contracts: dict = None) -> dict:
    """
    Distribute real players across 30 teams.
    Two-pass: compute distributions first, then rate all players.
    """
    # Use passed-in advanced metrics lookup
    if adv_lookup is None:
        adv_lookup = {}
    if contracts is None:
        contracts = {}

    # Pass 1: extract raw stats
    all_raw = []
    for p in players:
        try:
            raw = extract_raw_stats(p)
            raw["_row"] = p
            all_raw.append(raw)
        except Exception:
            continue

    # Pass 2: build distributions and rate
    dist = build_distributions(all_raw) if all_raw else {}

    enriched = []
    for raw in all_raw:
        p = raw["_row"]
        try:
            if dist:
                name = p.get("full_name") or p.get("player_name") or ""
                adv  = adv_lookup.get(name)
                ratings = rate_player(p, dist, adv)
            else:
                continue
            age = int(p.get("age") or 26)
            # Use real contract if available, else estimate
            name = p.get("full_name") or p.get("player_name") or ""
            import unicodedata as _ud
            def _norm(s):
                s = _ud.normalize("NFKD", str(s))
                s = "".join(c for c in s if not _ud.combining(c))
                for sfx in [" III", " II", " IV", " Jr.", " Sr.", " Jr", " Sr"]:
                    s = s.replace(sfx, "")
                return s.strip()
            real_contract = contracts.get(name) or contracts.get(_norm(name)) or {}
            if real_contract.get("salary"):
                sal = real_contract["salary"]
                yrs = sum(1 for k in ["salary_2627","salary_2728","salary_2829","salary_2930"] if real_contract.get(k))
                contract_type = real_contract.get("contract_type", "guaranteed")
            else:
                sal = market_salary(float(ratings["overall"]), age)
                yrs = contract_years_for(float(ratings["overall"]), age)
                contract_type = "guaranteed"
            enriched.append({
                "id":          str(uuid.uuid4())[:8],
                "name":        p.get("full_name") or "Unknown",
                "position":    p.get("position") or "G",
                "age":         age,
                "team":        p.get("team_abbr") or "FA",
                "ppg":         round(float(p.get("ppg") or 0), 1),
                "rpg":         round(float(p.get("rpg") or 0), 1),
                "apg":         round(float(p.get("apg") or 0), 1),
                "spg":         round(float(p.get("spg") or 0), 1),
                "bpg":         round(float(p.get("bpg") or 0), 1),
                "fg3m":        round(float(p.get("fg3m") or 0), 1),
                "mpg":         round(float(p.get("mpg") or 0), 1),
                "gp":          int(p.get("gp") or 0),
                "overall":     ratings["overall"],
                "talent":      talent_from_advanced._last_talent,
                "future":      ratings["future"],
                "trade_value": ratings["trade_value"],
                "scoring":     ratings["scoring"],
                "efficiency":  ratings["efficiency"],
                "playmaking":  ratings["playmaking"],
                "rebounding":  ratings["rebounding"],
                "defense":     ratings["defense"],
                "composure":   ratings["composure"],
                "archetype":   ratings["archetype"],
                "contract_value": ratings["contract_value"],
                "salary":      sal,
                "years_left":  yrs,
                "contract_type": contract_type,
            })
        except Exception as e:
            import traceback as tb
            err = tb.format_exc()[-300:]
            raise RuntimeError(f"rate_player failed for {p.get('full_name','?')}: {e} | {err}")

    # Build team rosters from real team assignments
    teams = {}
    for abbr in NBA_TEAMS:
        teams[abbr] = {
            "abbr":     abbr,
            "name":     TEAM_FULL_NAMES[abbr],
            "conf":     CONFERENCE[abbr],
            "roster":   [],
            "cap_used": 0,
            "wins":     0,
            "losses":   0,
            "gm_team":  False,
        }

    fa_pool = []
    for p in enriched:
        abbr = p["team"]
        if abbr in teams:
            teams[abbr]["roster"].append(p)
            teams[abbr]["cap_used"] += p["salary"]
        else:
            fa_pool.append(p)

    # Trim rosters > 15 (move extras to FA)
    for abbr, team in teams.items():
        roster = sorted(team["roster"], key=lambda x: -x["overall"])
        if len(roster) > 15:
            fa_pool.extend(roster[15:])
            roster = roster[:15]
        team["roster"] = roster
        team["cap_used"] = sum(p["salary"] for p in team["roster"])

    return {"teams": teams, "fa_pool": fa_pool, "season": 1, "day": 0, "games_simmed": 0}

# ─── Season Simulation ────────────────────────────────────────────────────────

def team_strength(team: dict) -> float:
    """Simple team strength from avg overall of top 8 players."""
    roster = sorted(team["roster"], key=lambda x: -x["overall"])[:8]
    if not roster:
        return 50.0
    return sum(p["overall"] for p in roster) / len(roster)

def sim_game(home: dict, away: dict) -> tuple[str, str]:
    """Simulate one game. Returns (winner_abbr, loser_abbr)."""
    home_str = team_strength(home) + 3.0  # home court
    away_str = team_strength(away)
    diff = home_str - away_str
    prob = 1 / (1 + math.exp(-diff * 0.12))
    if random.random() < prob:
        return home["abbr"], away["abbr"]
    return away["abbr"], home["abbr"]

def simulate_days(league: dict, n_days: int) -> dict:
    """Simulate n_days of games across all 30 teams."""
    teams = league["teams"]
    team_list = list(teams.values())

    for _ in range(n_days):
        random.shuffle(team_list)
        # ~15 games per day (all 30 teams play)
        played = set()
        for i in range(0, len(team_list) - 1, 2):
            h = team_list[i]
            a = team_list[i + 1]
            if h["abbr"] in played or a["abbr"] in played:
                continue
            winner, loser = sim_game(h, a)
            teams[winner]["wins"]   += 1
            teams[loser]["losses"]  += 1
            played.add(h["abbr"])
            played.add(a["abbr"])

        league["day"] += 1
        league["games_simmed"] += 15

    return league

# ─── Standings Helper ─────────────────────────────────────────────────────────

def standings_sorted(teams: dict) -> dict:
    east, west = [], []
    for t in teams.values():
        entry = {
            "abbr":   t["abbr"],
            "name":   t["name"],
            "wins":   t["wins"],
            "losses": t["losses"],
            "pct":    round(safe_div(t["wins"], t["wins"] + t["losses"]), 3),
            "gm_team": t.get("gm_team", False),
        }
        if t["conf"] == "East":
            east.append(entry)
        else:
            west.append(entry)
    east.sort(key=lambda x: -x["pct"])
    west.sort(key=lambda x: -x["pct"])
    return {"east": east, "west": west}

# ─── DB Schema Init ───────────────────────────────────────────────────────────

@router.post("/init-db")
def init_db():
    """Create GM tables. Run once."""
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS gm_saves (
                save_id    TEXT PRIMARY KEY,
                team_abbr  TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                state      JSONB NOT NULL
            );
        """)
        cur.close()
    return {"ok": True, "message": "gm_saves table ready"}

# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/teams")
def list_teams():
    """Return all 30 teams with name + conference for franchise select."""
    return [
        {"abbr": abbr, "name": TEAM_FULL_NAMES[abbr], "conf": CONFERENCE[abbr]}
        for abbr in NBA_TEAMS
    ]

class NewGameBody(BaseModel):
    team_abbr: str

@router.post("/new-game")
def new_game(body: NewGameBody):
    """
    Initialise a new GM save.
    Pulls real player data, derives attributes, distributes across 30 teams.
    Returns save_id (UUID) for all subsequent calls.
    """
    abbr = body.team_abbr.upper()
    if abbr not in NBA_TEAMS:
        raise HTTPException(400, f"Unknown team: {abbr}")

    save_id = str(uuid.uuid4())
    with get_conn() as conn:
        players    = fetch_all_players(conn)
        adv_lookup = fetch_advanced_metrics(conn)
        contracts  = fetch_contracts(conn)
        print(f"Advanced metrics: {len(adv_lookup)}, contracts: {len(contracts)}")
        if len(adv_lookup) == 0:
            raise RuntimeError("fetch_advanced_metrics returned empty -- table may not exist on Railway")
        league  = build_league(players, adv_lookup=adv_lookup, contracts=contracts)
        adv_count = len(adv_lookup)
        league["teams"][abbr]["gm_team"] = True
        league["gm_team"] = abbr
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO gm_saves (save_id, team_abbr, state)
            VALUES (%s, %s, %s)
        """, (save_id, abbr, json.dumps(league)))
        cur.close()

    team = league["teams"][abbr]
    total_players = sum(len(t["roster"]) for t in league["teams"].values())
    fa_count = len(league.get("fa_pool", []))
    return {
        "save_id":   save_id,
        "team":      abbr,
        "team_name": TEAM_FULL_NAMES[abbr],
        "roster_count": len(team["roster"]),
        "cap_used":  team["cap_used"],
        "cap_space": SALARY_CAP - team["cap_used"],
        "message":   f"GM save created for {TEAM_FULL_NAMES[abbr]}",
        "debug_total_players": total_players,
        "debug_fa_count": fa_count,
        "debug_adv_metrics": adv_count if "adv_count" in dir() else -1,
    }

@router.get("/state/{save_id}")
def get_state(save_id: str):
    """Return top-level league state (day, season, standings summary)."""
    with get_conn() as conn:
        league = get_save(conn, save_id)

    abbr  = league["gm_team"]
    team  = league["teams"][abbr]
    stnd  = standings_sorted(league["teams"])

    # Find your position in standings
    conf  = CONFERENCE[abbr]
    conf_standings = stnd["east"] if conf == "East" else stnd["west"]
    rank  = next((i+1 for i, t in enumerate(conf_standings) if t["abbr"] == abbr), "?")

    return {
        "save_id":     save_id,
        "season":      league["season"],
        "day":         league["day"],
        "gm_team":     abbr,
        "team_name":   TEAM_FULL_NAMES[abbr],
        "wins":        team["wins"],
        "losses":      team["losses"],
        "cap_used":    team["cap_used"],
        "cap_space":   SALARY_CAP - team["cap_used"],
        "luxury_tax":  LUXURY_TAX,
        "conf_rank":   rank,
        "conference":  conf,
        "games_simmed": league.get("games_simmed", 0),
    }

@router.get("/roster/{save_id}")
def get_roster(save_id: str):
    """Return your team's roster with all attributes."""
    with get_conn() as conn:
        league = get_save(conn, save_id)

    abbr   = league["gm_team"]
    team   = league["teams"][abbr]
    roster = sorted(team["roster"], key=lambda x: -x["overall"])

    return {
        "team":      abbr,
        "team_name": TEAM_FULL_NAMES[abbr],
        "cap_used":  team["cap_used"],
        "cap_space": SALARY_CAP - team["cap_used"],
        "salary_cap": SALARY_CAP,
        "luxury_tax": LUXURY_TAX,
        "roster":    roster,
        "count":     len(roster),
    }

@router.get("/standings/{save_id}")
def get_standings(save_id: str):
    """Return East/West standings."""
    with get_conn() as conn:
        league = get_save(conn, save_id)
    return {
        "day":      league["day"],
        "season":   league["season"],
        "gm_team":  league["gm_team"],
        **standings_sorted(league["teams"])
    }

@router.get("/free-agents/{save_id}")
def get_free_agents(save_id: str, limit: int = Query(50)):
    """Return FA pool sorted by overall."""
    with get_conn() as conn:
        league = get_save(conn, save_id)

    fa = sorted(league["fa_pool"], key=lambda x: -x["overall"])[:limit]
    return {"free_agents": fa, "total": len(league["fa_pool"])}

class SimBody(BaseModel):
    days: int = 7

@router.post("/simulate/{save_id}")
def simulate(save_id: str, body: SimBody):
    """Simulate N days of games. Updates standings in save."""
    days = max(1, min(body.days, 30))
    conn = get_conn()
    league = get_save(conn, save_id)
    league = simulate_days(league, days)
    with get_conn() as conn:
        put_save(conn, save_id, league)

    abbr = league["gm_team"]
    team = league["teams"][abbr]
    return {
        "days_simmed": days,
        "total_day":   league["day"],
        "your_record": f"{team['wins']}-{team['losses']}",
        "standings":   standings_sorted(league["teams"]),
    }

class SignBody(BaseModel):
    player_id: str

@router.post("/sign/{save_id}")
def sign_player(save_id: str, body: SignBody):
    """Sign a free agent to your roster."""
    conn = get_conn()
    league = get_save(conn, save_id)

    abbr = league["gm_team"]
    team = league["teams"][abbr]

    if len(team["roster"]) >= 15:
        raise HTTPException(400, "Roster full (15/15). Release a player first.")

    fa_pool = league["fa_pool"]
    player  = next((p for p in fa_pool if p["id"] == body.player_id), None)
    if not player:
        raise HTTPException(404, "Player not in FA pool")

    new_cap = team["cap_used"] + player["salary"]
    if new_cap > LUXURY_TAX:
        raise HTTPException(400, f"Signing would push you over luxury tax (${LUXURY_TAX:,})")

    team["roster"].append({**player, "team": abbr})
    team["cap_used"] = new_cap
    league["fa_pool"] = [p for p in fa_pool if p["id"] != body.player_id]

    with get_conn() as conn:
        put_save(conn, save_id, league)

    return {
        "signed":    player["name"],
        "salary":    player["salary"],
        "cap_used":  new_cap,
        "cap_space": SALARY_CAP - new_cap,
        "roster_count": len(team["roster"]),
    }

class ReleaseBody(BaseModel):
    player_id: str

@router.post("/release/{save_id}")
def release_player(save_id: str, body: ReleaseBody):
    """Release a player from your roster to the FA pool."""
    conn = get_conn()
    league = get_save(conn, save_id)

    abbr   = league["gm_team"]
    team   = league["teams"][abbr]
    roster = team["roster"]

    player = next((p for p in roster if p["id"] == body.player_id), None)
    if not player:
        raise HTTPException(404, "Player not on your roster")

    team["roster"]   = [p for p in roster if p["id"] != body.player_id]
    team["cap_used"] -= player["salary"]
    league["fa_pool"].append({**player, "team": "FA"})

    with get_conn() as conn:
        put_save(conn, save_id, league)

    return {
        "released":  player["name"],
        "cap_freed": player["salary"],
        "cap_used":  team["cap_used"],
        "cap_space": SALARY_CAP - team["cap_used"],
    }

@router.get("/league-players/{save_id}")
def league_players(save_id: str, limit: int = Query(600)):
    """Return all players across all 30 teams + FA, sorted by overall."""
    with get_conn() as conn:
        league = get_save(conn, save_id)
    all_players = []
    for team in league["teams"].values():
        all_players.extend(team["roster"])
    all_players.extend(league.get("fa_pool", []))
    all_players.sort(key=lambda x: -x.get("overall", 0))
    return {"players": all_players[:limit], "total": len(all_players)}
