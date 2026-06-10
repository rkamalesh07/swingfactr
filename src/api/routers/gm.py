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

    # Usage*PPG floors -- only apply for players with positive BPM
    # Negative BPM = bad player on bad team inflating stats, no floor boost
    usage_pts = usage * ppg
    if bpm >= 0:
        if   usage_pts >= 11.0: base = max(base, 86)
        elif usage_pts >= 9.0:  base = max(base, 84)
        elif usage_pts >= 7.5:  base = max(base, 83)
        elif usage_pts >= 6.5:  base = max(base, 81)
        elif usage_pts >= 5.5:  base = max(base, 78)
        elif usage_pts >= 5.0:  base = max(base, 72)
    elif bpm >= -1:
        if   usage_pts >= 11.0: base = max(base, 80)
        elif usage_pts >= 9.0:  base = max(base, 78)
        elif usage_pts >= 7.5:  base = max(base, 76)

    # Small sample cap
    if mp < 400:   base = min(base, 65)
    elif mp < 600: base = min(base, 70)

    base = min(base, 90)  # Jokic outlier cap
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
        "bh_score": apg * 2.0 - tov,
    }

def build_distributions(all_raw: list[dict]) -> dict:
    keys = ["pts36", "ast36", "reb36", "stk36", "pm_net",
            "fg3_36", "efg", "availability", "mpg", "bh_score"]
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

    # PPG floors (only for high efficiency -- volume scorers on bad teams shouldn't rate high)
    if   ppg >= 30: base = max(base, 83)
    elif ppg >= 25: base = max(base, 76)
    elif ppg >= 20: base = max(base, 68)
    elif ppg >= 16: base = max(base, 58)  # lowered from 14->54 to 16->58
    elif ppg >= 12: base = max(base, 50)
    elif ppg >= 9:  base = max(base, 44)

    # Non-scorer cap (tightened -- high ppg without BPM signal = inefficient volume)
    if   ppg < 8:  base = min(base, 56)
    elif ppg < 10: base = min(base, 61)
    elif ppg < 13: base = min(base, 66)
    elif ppg < 16: base = min(base, 70)  # new: 13-16ppg caps at 70

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
        "ball_handling":  dim("bh_score", 15, 88),
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
            COALESCE(pc.team, lt.team_abbr, p.team_id::text, 'FA') AS team_abbr,
            s.gp, s.ppg, s.rpg, s.apg, s.spg, s.bpg,
            s.fg3m, s.tov, s.mpg, s.fg_pct, s.efg_pct, s.fg3_pct_est
        FROM season_stats s
        LEFT JOIN latest_team lt ON lt.player_name = s.player_name
        LEFT JOIN players p ON p.full_name = s.player_name
        LEFT JOIN player_ages pa ON pa.full_name = s.player_name
        LEFT JOIN player_contracts pc ON pc.player_name = s.player_name
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
                "ball_handling": ratings.get("ball_handling", 50),
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

        # Enrich adv_lookup with PPG and usage from box score data
        # so talent_from_advanced can apply usage*ppg floors correctly
        import unicodedata as _ud
        def _norm_adv(s):
            s = _ud.normalize("NFKD", str(s))
            s = "".join(c for c in s if not _ud.combining(c))
            for sfx in [" III", " II", " IV", " Jr.", " Sr.", " Jr", " Sr"]:
                s = s.replace(sfx, "")
            return s.strip()

        for p in players:
            # players use "name" key, not "full_name"
            name = _norm_adv(p.get("name") or p.get("full_name") or p.get("player_name") or "")
            ppg  = float(p.get("ppg") or 0)
            mpg  = float(p.get("mpg") or 1)
            # Use ppg-based usage approximation:
            # Stars carrying offense: 27ppg in 30mpg = high usage
            # Simple: usage_approx = ppg / (mpg * 2.0) capped at 0.40
            usage_approx = min(0.40, ppg / max(1.0, mpg * 2.0))

            # Try matching against adv_lookup keys
            for key in list(adv_lookup.keys()):
                if _norm_adv(key) == name:
                    adv_lookup[key]["ppg"]     = ppg
                    adv_lookup[key]["usg_pct"] = usage_approx
                    break

        league  = build_league(players, adv_lookup=adv_lookup, contracts=contracts)
        adv_count = len(adv_lookup)
        league["teams"][abbr]["gm_team"] = True
        league["gm_team"] = abbr
        # Initialize pick registry from real futures -- stored in save so trades mutate it
        league["picks"] = {
            team: [dict(p) for p in picks]
            for team, picks in REAL_PICK_REGISTRY.items()
        }
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

# ─── Trade Evaluation ────────────────────────────────────────────────────────

TEAM_STATUS_MAP = {
    "OKC":"Dynasty","BOS":"Contender","CLE":"Contender","NY":"Contender",
    "SA":"Contender","DEN":"Contender","MIN":"Contender","MEM":"Rising",
    "HOU":"Rising","ATL":"Rising","NO":"Rising","IND":"Retooling",
    "DAL":"Retooling","LAL":"Retooling","MIL":"Retooling","PHX":"Retooling",
    "SAC":"Retooling","GS":"Retooling","MIA":"Retooling","LAC":"Retooling",
    "POR":"Rebuilding","DET":"Rebuilding","CHA":"Rebuilding","WSH":"Rebuilding",
    "UTAH":"Rebuilding","BKN":"Rebuilding","TOR":"Rebuilding","CHI":"Rebuilding",
    "ORL":"Rebuilding","PHI":"Rebuilding",
}


def is_untouchable(player: dict, team_status: str) -> bool:
    """
    A player is untouchable if they are a franchise cornerstone.
    Based on overall rating, age, and trade value.
    Contending/Dynasty teams protect more players.
    """
    ovr = player.get("overall", 0)
    age = player.get("age", 28)
    tv  = player.get("trade_value", 0)
    sal = player.get("salary", 0)

    # Always untouchable: elite young stars (Wemby, Flagg, Chet, JDub, Castle, Harper tier)
    if ovr >= 80 and age <= 24:
        return True

    # Always untouchable: franchise stars in prime (SGA, Jokic, Giannis, Luka, Ant, Brunson tier)
    if ovr >= 82 and age <= 30:
        return True

    # Untouchable for contending/dynasty teams: proven stars
    if team_status in ("Contender", "Dynasty"):
        if ovr >= 78 and age <= 32:
            return True
        if ovr >= 75 and tv >= 75:
            return True

    # High trade value young players (Amen Thompson, Paolo, Franz, Barnes tier)
    if tv >= 78 and age <= 26:
        return True

    return False

POSITIONAL_SCARCITY = {
    "Shot Creator":       1.28,
    "Primary Ball Handler": 1.25,
    "Two-Way Wing":       1.22,
    "3-and-D":            1.18,
    "Rim Protector":      1.15,
    "Point Forward":      1.20,
    "Scoring Wing":       1.12,
    "Wing Scorer":        1.10,
    "Stretch Four":       1.05,
    "Traditional Big":    0.95,
    "Energy Big":         0.88,
    "Role Player":        0.90,
    "Secondary Playmaker":0.92,
    "Playmaking Big":     1.05,
}

def get_trade_memory(league: dict, team_a: str, team_b: str, trade_sig: str) -> dict:
    """Get negotiation history between two teams for this trade."""
    mem = league.setdefault("trade_memory", {})
    key = f"{team_a}:{team_b}:{trade_sig}"
    return mem.get(key, {"rejections": 0, "insult_count": 0, "blocked_until": 0})

def update_trade_memory(league: dict, team_a: str, team_b: str, trade_sig: str, result: str, insult: bool = False):
    """Update negotiation memory after a trade response."""
    import time as _t
    mem = league.setdefault("trade_memory", {})
    key = f"{team_a}:{team_b}:{trade_sig}"
    entry = mem.get(key, {"rejections": 0, "insult_count": 0, "blocked_until": 0})
    if result == "REJECTED":
        entry["rejections"] += 1
        if insult:
            entry["insult_count"] += 1
        # After 3 rejections, block for a simulated period
        if entry["rejections"] >= 3:
            entry["blocked_until"] = entry.get("blocked_until", 0) + 30  # 30 sim days
    mem[key] = entry

def ai_trade_decision(
    give_players: list, get_players: list, give_picks: list, get_picks: list,
    target_team: str, state: dict, league: dict
) -> dict:
    """
    AI evaluates a trade proposal from the player's perspective.
    Returns decision with reasoning.
    """
    import random
    import hashlib as _hl

    gm_team     = state.get("gm_team", "")
    target_status = TEAM_STATUS_MAP.get(target_team, "Retooling")
    gm_status     = TEAM_STATUS_MAP.get(gm_team, "Retooling")

    gm_status_local = TEAM_STATUS_MAP.get(gm_team, "Retooling")
    target_status_local = TEAM_STATUS_MAP.get(target_team, "Retooling")

    # Generate deterministic trade signature for memory lookup
    give_ids = sorted(p.get("id","") for p in give_players)
    get_ids  = sorted(p.get("id","") for p in get_players)
    trade_sig = _hl.md5((str(give_ids)+str(get_ids)+str(sorted(give_picks))+str(sorted(get_picks))).encode()).hexdigest()[:12]

    # Check negotiation memory -- repeated bad offers get auto-rejected
    mem = get_trade_memory(league, gm_team, target_team, trade_sig)
    sim_day = league.get("day", 0)
    if mem.get("rejections", 0) >= 3:
        return {
            "result": "REJECTED",
            "reason": f"{target_team} is no longer interested in discussing this trade. Try a different offer.",
        }
    if mem.get("insult_count", 0) >= 2:
        return {
            "result": "REJECTED",
            "reason": f"{target_team}'s GM is offended by repeated lowball offers. This negotiation is dead.",
        }

    # Check if user is requesting an untouchable from the target team
    untouchable_requested = [
        p for p in get_players
        if is_untouchable(p, target_status_local)
    ]

    if untouchable_requested:
        names = ", ".join(p["name"] for p in untouchable_requested)
        # AI will only give up untouchables if receiving an untouchable back
        untouchable_offered = [p for p in give_players if is_untouchable(p, gm_status_local)]
        if not untouchable_offered:
            return {
                "result": "REJECTED",
                "reason": f"{target_team} considers {names} untouchable. You need to offer a franchise-level player in return.",
            }
        # Both sides giving up untouchables -- evaluate normally but harder threshold
        # Fall through to normal evaluation with tighter threshold

    # Apply positional scarcity multipliers
    def _scarce_tv(p):
        base = p.get("trade_value", 50)
        arch = p.get("archetype", "Role Player")
        mult = POSITIONAL_SCARCITY.get(arch, 1.0)
        # Age curve: prime players (25-30) get bonus
        age  = p.get("age", 28)
        age_mult = 1.10 if 25 <= age <= 30 else (0.85 if age >= 34 else 1.0)
        return base * mult * age_mult

    give_tv  = sum(_scarce_tv(p) for p in give_players)
    get_tv   = sum(_scarce_tv(p) for p in get_players)
    give_sal = sum(p.get("salary", 0) for p in give_players)
    get_sal  = sum(p.get("salary", 0) for p in get_players)

    # Pick value: R1 = 12pts, R2 = 4pts
    give_pick_val = sum(12 if "Round 1" in p or "R1" in p else 4 for p in give_picks)
    get_pick_val  = sum(12 if "Round 1" in p or "R1" in p else 4 for p in get_picks)

    give_total = give_tv + give_pick_val
    get_total  = get_tv  + get_pick_val

    # CBA check
    SALARY_CAP   = 154_647_000
    FIRST_APRON  = 178_132_000
    SECOND_APRON = 188_931_000
    target_payroll = sum(
        p.get("salary", 0)
        for p in league.get("teams", {}).get(target_team, {}).get("roster", [])
    )
    if target_payroll > SECOND_APRON:
        max_incoming = give_sal
    elif target_payroll > FIRST_APRON:
        max_incoming = give_sal * 1.10
    else:
        max_incoming = give_sal + 7_500_000

    if give_sal > max_incoming * 1.01:
        return {
            "result": "REJECTED",
            "reason": f"{target_team} is over the second apron and can't take back more salary.",
        }

    # Value ratio -- how lopsided is the trade?
    if give_total == 0:
        return {"result": "REJECTED", "reason": "You're not offering anything."}

    ratio = get_total / max(give_total, 1)

    # Base acceptance thresholds by team status
    # Rebuilding teams: want picks and young talent, not win-now pieces
    # Contenders: want proven players, hate picks-only deals
    rebuilding = target_status in ("Rebuilding", "Rising")
    contending = target_status in ("Dynasty", "Contender")

    # Check if we're offering picks to a rebuilding team (they love this)
    picks_to_rebuilder = rebuilding and give_pick_val > 0

    # Check if target team is receiving a player that fits their needs
    target_roster = league.get("teams", {}).get(target_team, {}).get("roster", [])
    target_avg_ovr = sum(p.get("overall", 50) for p in target_roster) / max(len(target_roster), 1)
    getting_better = any(p.get("overall", 0) > target_avg_ovr + 5 for p in give_players)

    # Decision logic
    threshold = 0.85  # default: need to receive 85% of what you give
    if rebuilding:
        if give_pick_val >= 20:   threshold = 0.65  # rebuilders desperate for picks
        elif give_pick_val >= 12: threshold = 0.75
        else:                     threshold = 0.90  # rebuilders don't want bad contracts
    elif contending:
        if get_pick_val > 0 and get_tv < give_tv * 0.7:
            return {
                "result": "REJECTED",
                "reason": f"{target_team} is competing now. They're not trading quality players for picks.",
            }
        threshold = 0.88  # contenders drive harder bargains

    # Noise: AI isn't perfect
    noise = random.uniform(-0.08, 0.08)
    effective_ratio = ratio + noise

    if effective_ratio >= 1.10:
        return {
            "result": "ACCEPTED",
            "reason": f"{target_team} views this as a favorable deal." +
                (" They're prioritizing picks to rebuild." if picks_to_rebuilder else ""),
        }
    elif effective_ratio >= threshold:
        # Counter offer scenario
        if random.random() < 0.35:
            shortfall = round((1.0 - effective_ratio) * give_total)
            return {
                "result": "COUNTERED",
                "reason": f"{target_team} likes the framework but wants more value. " +
                    f"Add {shortfall} trade value (a pick or role player) to get this done.",
            }
        return {
            "result": "ACCEPTED",
            "reason": f"{target_team} accepts. The value works out." +
                (" They needed to move this contract." if get_sal > 30_000_000 and rebuilding else ""),
        }
    else:
        # Hard strategy gates first
        if rebuilding:
            bad_fits = [p for p in give_players if p.get('age',25) >= 31 and p.get('salary',0) > 20_000_000]
            if bad_fits:
                names = ', '.join(p['name'] for p in bad_fits)
                return {
                    'result': 'REJECTED',
                    'reason': f'{target_team} is rebuilding. They will not take on {names} age/contract.',
                }
        if contending and give_pick_val > get_tv * 0.5:
            reason = f'{target_team} does not need picks. They need players who can help now.'
        elif get_tv > give_tv * 1.3:
            reason = f'{target_team} values their player too highly to move them for this.'
        elif rebuilding and get_tv < 40 and give_pick_val == 0:
            reason = f'{target_team} is rebuilding. They want draft capital, not expiring veterans.'
        else:
            reason = f'{target_team} does not see enough value here.'
        return {'result': 'REJECTED', 'reason': reason}

        return {"result": "REJECTED", "reason": reason}


@router.post("/trade/{save_id}")
async def propose_trade(save_id: str, body: dict):
    """
    Evaluate a trade proposal. Applies real CBA rules + AI logic.
    If accepted, updates the save state.
    """
    giving_ids     = body.get("giving", [])
    getting_ids    = body.get("getting", [])
    target_team    = body.get("target_team", "")
    picks_offered  = body.get("picks_offered", [])
    picks_requested= body.get("picks_requested", [])

    if not target_team:
        return {"result": "REJECTED", "reason": "No target team specified."}

    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT state FROM gm_saves WHERE save_id=%s", (save_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Save not found")
        cur.close()

    league = row[0]
    state  = league.get("state", league)
    gm_team = league.get("gm_team") or state.get("gm_team", "")

    my_roster     = league["teams"][gm_team]["roster"]
    target_roster = league["teams"].get(target_team, {}).get("roster", [])

    give_players = [p for p in my_roster     if p["id"] in giving_ids]
    get_players  = [p for p in target_roster if p["id"] in getting_ids]

    # Block expired contracts from being traded
    expired_give = [p for p in give_players if p.get("years_left", 1) == 0]
    expired_get  = [p for p in get_players  if p.get("years_left", 1) == 0]
    if expired_give:
        names = ", ".join(p["name"] for p in expired_give)
        return {"result": f"REJECTED — {names} has an expired contract and cannot be traded."}
    if expired_get:
        names = ", ".join(p["name"] for p in expired_get)
        return {"result": f"REJECTED — {names} has an expired contract and cannot be traded."}

    # CBA matching check (from user's side)
    give_sal = sum(p.get("salary", 0) for p in give_players)
    get_sal  = sum(p.get("salary", 0) for p in get_players)
    cap_used = league["teams"][gm_team].get("cap_used",
               sum(p.get("salary",0) for p in my_roster))

    SALARY_CAP   = 154_647_000
    FIRST_APRON  = 178_132_000
    SECOND_APRON = 188_931_000

    if cap_used > SECOND_APRON:
        max_incoming = give_sal
        apron = "second apron"
    elif cap_used > FIRST_APRON:
        max_incoming = give_sal * 1.10
        apron = "first apron"
    else:
        max_incoming = give_sal + 7_500_000
        apron = "over cap"

    if get_sal > max_incoming * 1.01:
        return {
            "result": f"REJECTED — Salary mismatch ({apron}). "
                      f"Sending ${give_sal/1e6:.1f}M, max you can receive: ${max_incoming/1e6:.1f}M"
        }

    import hashlib as _hl

    # Compute trade value totals for insult detection
    give_total = sum(p.get("trade_value",50) for p in give_players) + sum(12 if "R1" in pk or "Round 1" in pk else 4 for pk in picks_offered)
    get_total  = sum(p.get("trade_value",50) for p in get_players)  + sum(12 if "R1" in pk or "Round 1" in pk else 4 for pk in picks_requested)

    # AI decision
    decision = ai_trade_decision(
        give_players, get_players, picks_offered, picks_requested,
        target_team, {"gm_team": gm_team}, league
    )

    # If accepted, execute the trade in the save state
    if decision["result"] == "ACCEPTED":
        # Idempotency: re-check players are still on their rosters
        my_roster_now     = league["teams"][gm_team]["roster"]
        target_roster_now = league["teams"].get(target_team, {}).get("roster", [])
        still_have = all(any(p["id"]==gid for p in my_roster_now)     for gid in giving_ids)
        they_still = all(any(p["id"]==gid for p in target_roster_now) for gid in getting_ids)
        if not still_have or not they_still:
            return {
                "result": "REJECTED — Trade already processed or players no longer available.",
                "accepted": False,
            }
        # Move players
        league["teams"][gm_team]["roster"]  = [
            p for p in my_roster_now if p["id"] not in giving_ids
        ] + get_players

        league["teams"][target_team]["roster"] = [
            p for p in target_roster_now if p["id"] not in getting_ids
        ] + give_players

        # Move picks between teams
        if picks_offered or picks_requested:
            if "picks" not in league:
                league["picks"] = {t: list(p) for t, p in REAL_PICK_REGISTRY.items()}
            my_team_picks  = league["picks"].get(gm_team, [])
            opp_team_picks = league["picks"].get(target_team, [])

            # Picks offered by GM go to target team
            new_my_picks  = [p for p in my_team_picks  if p.get("note") not in picks_offered]
            given_picks   = [p for p in my_team_picks  if p.get("note") in picks_offered]
            opp_team_picks += given_picks

            # Picks requested from target team come to GM
            new_opp_picks  = [p for p in opp_team_picks if p.get("note") not in picks_requested]
            received_picks = [p for p in opp_team_picks if p.get("note") in picks_requested]
            # Update original_owner to reflect new ownership
            for pk in received_picks:
                pk["acquired_from"] = target_team
            new_my_picks += received_picks

            league["picks"][gm_team]    = new_my_picks
            league["picks"][target_team] = new_opp_picks

        # Recalculate cap
        for team in [gm_team, target_team]:
            roster = league["teams"][team]["roster"]
            league["teams"][team]["cap_used"] = sum(p.get("salary",0) for p in roster)

        # Save
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute("UPDATE gm_saves SET state=%s WHERE save_id=%s",
                        (json.dumps(league), save_id))
            conn.commit()
            cur.close()

    # Update negotiation memory
    was_insult = False
    if decision["result"] == "REJECTED":
        # Detect insult: offering <65% of requested value
        if give_total > 0 and get_total > 0:
            was_insult = (give_total / max(get_total, 1)) < 0.55
        update_trade_memory(league, gm_team, target_team, 
                           _hl.md5((str(sorted(giving_ids))+str(sorted(getting_ids))).encode()).hexdigest()[:12],
                           "REJECTED", was_insult)
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute("UPDATE gm_saves SET state=%s WHERE save_id=%s",
                        (json.dumps(league), save_id))
            conn.commit()
            cur.close()

    return {
        "result": f"{decision['result']} — {decision['reason']}",
        "accepted": decision["result"] == "ACCEPTED",
    }


@router.get("/ai-trade-offers/{save_id}")
async def get_ai_trade_offers(save_id: str):
    """
    Generate 1-2 unsolicited trade offers from AI teams based on roster needs.
    Rebuilding/retooling teams offer picks for your veterans.
    Contending teams offer players for your stars.
    """
    import random

    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT state FROM gm_saves WHERE save_id=%s", (save_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Save not found")
        cur.close()

    league  = row[0]
    gm_team = league.get("gm_team", "")
    my_roster = sorted(
        league["teams"][gm_team]["roster"],
        key=lambda p: -p.get("overall", 0)
    )

    if not my_roster:
        return {"offers": []}

    offers = []
    teams  = [t for t in league["teams"] if t != gm_team]
    random.shuffle(teams)

    gm_st = TEAM_STATUS_MAP.get(gm_team, "Retooling")
    gm_is_rebuilding = gm_st in ("Rebuilding", "Rising")
    gm_is_contending = gm_st in ("Contender", "Dynasty")

    for target_team in teams[:12]:
        status = TEAM_STATUS_MAP.get(target_team, "Retooling")
        target_roster = league["teams"][target_team].get("roster", [])
        if not target_roster:
            continue

        # ── Case 1: Retooling/Rebuilding team wants to SELL a veteran ──────────
        # They have aging expensive players they want off the books
        # They offer that player + picks to YOUR team in exchange for matching salary
        if status in ("Rebuilding", "Retooling", "Rising") and not gm_is_rebuilding:
            # Their veteran they want to move: age 31+, OVR 58-74, expensive
            their_for_sale = [
                p for p in target_roster
                if p.get("age", 25) >= 31
                and 56 <= p.get("overall", 0) <= 74
                and p.get("salary", 0) >= 10_000_000
                and not is_untouchable(p, status)
                and p.get("years_left", 1) >= 1  # no expired contracts
            ]
            if not their_for_sale:
                continue
            their_player = random.choice(their_for_sale[:3])

            # Find matching salary on YOUR team to take back
            # Use real CBA matching: target team can receive up to outgoing + $7.5M
            their_sal = their_player.get("salary", 0)
            target_payroll = sum(p.get("salary",0) for p in target_roster)
            if target_payroll > 188_931_000:
                max_incoming = their_sal  # second apron: must match
            elif target_payroll > 178_132_000:
                max_incoming = their_sal * 1.10  # first apron: 110%
            else:
                max_incoming = their_sal + 7_500_000  # standard: +$7.5M

            my_matches = [
                p for p in my_roster
                if p.get("salary", 0) <= max_incoming
                and p.get("salary", 0) >= their_sal * 0.75  # reasonable floor
                and not is_untouchable(p, gm_st)
                and p.get("years_left", 1) >= 1  # no expired contracts in trades
                and p.get("overall", 0) <= their_player.get("overall", 0) + 8
            ]
            if not my_matches:
                continue
            my_match = random.choice(my_matches[:3])

            # They sweeten with a pick
            pick_sweetener = ["2027 2nd Round Pick"] if random.random() < 0.6 else []
            offer = {
                "from_team": target_team,
                "from_team_status": status,
                "type": "sell_veteran",
                "they_want": [{"name": my_match["name"], "overall": my_match["overall"],
                               "salary": my_match.get("salary",0), "id": my_match["id"]}],
                "they_offer_picks": pick_sweetener,
                "they_offer_players": [{"name": their_player["name"], "overall": their_player["overall"],
                                        "salary": their_player.get("salary",0), "id": their_player["id"]}],
                "message": f"{target_team} is looking to move {their_player['name']} ({their_player.get('age')}yo, ${their_player.get('salary',0)/1e6:.1f}M). They want matching salary back.",
            }
            offers.append(offer)

        # ── Case 2: Rebuilding team offers picks for YOUR expiring veteran ──────
        # Only targets non-untouchable players on expiring/short deals
        elif status in ("Rebuilding", "Rising") and gm_is_contending:
            my_expiring = [
                p for p in my_roster
                if p.get("age", 25) >= 30
                and p.get("years_left", 2) == 1  # expiring but NOT yet expired
                and 58 <= p.get("overall", 0) <= 76
                and not is_untouchable(p, gm_st)
            ]
            if not my_expiring:
                continue
            target_player = random.choice(my_expiring[:3])
            picks = ["2027 1st Round Pick"] if random.random() < 0.4 else ["2027 2nd Round Pick", "2028 2nd Round Pick"]
            offer = {
                "from_team": target_team,
                "from_team_status": status,
                "type": "picks_for_expiring",
                "they_want": [{"name": target_player["name"], "overall": target_player["overall"],
                               "salary": target_player.get("salary",0), "id": target_player["id"]}],
                "they_offer_picks": picks,
                "they_offer_players": [],
                "message": f"{target_team} wants {target_player['name']} for a playoff push. They're offering draft capital.",
            }
            offers.append(offer)

        if len(offers) >= 2:
            break
    # Randomly generate 0, 1, or 2 offers (weighted toward 1-2)
    import random as _r2
    if _r2.random() < 0.15:
        offers = []  # 15% chance no offers
    elif _r2.random() < 0.3 and len(offers) > 1:
        offers = offers[:1]  # 30% chance only 1 offer

    return {"offers": offers}

# ─── Draft Pick Registry ──────────────────────────────────────────────────────

# Real 2026-2032 draft pick ownership from NBA futures document
# Format: {team: [{round, year, note, protection, original_owner}]}
# Only includes picks the team currently OWNS (not traded away)
REAL_PICK_REGISTRY: dict = {
  "WSH": [
    {"round":1,"year":2026,"note":"Own #1 (lottery)","original_owner":"WSH"},
    {"round":2,"year":2026,"note":"via NYK-OKC","original_owner":"NYK"},
    {"round":2,"year":2026,"note":"via MIN-DET","original_owner":"MIN"},
    {"round":2,"year":2026,"note":"via MIA-SAN","original_owner":"OKC"},
    {"round":1,"year":2027,"note":"Own","original_owner":"WSH"},
    {"round":1,"year":2028,"note":"Own","original_owner":"WSH"},
    {"round":1,"year":2029,"note":"Own","original_owner":"WSH"},
    {"round":1,"year":2030,"note":"Own","original_owner":"WSH"},
    {"round":1,"year":2031,"note":"Own","original_owner":"WSH"},
    {"round":1,"year":2032,"note":"Own","original_owner":"WSH"},
  ],
  "UTAH": [
    {"round":1,"year":2026,"note":"Own #2","original_owner":"UTAH"},
    {"round":1,"year":2027,"note":"2nd-best of UTH/CLE/MIN","original_owner":"UTAH","protection":"complex swap"},
    {"round":1,"year":2028,"note":"Own or swap CLE","original_owner":"UTAH"},
    {"round":1,"year":2029,"note":"Own","original_owner":"UTAH","protection":"complex swap w/CLE/MIN"},
    {"round":1,"year":2030,"note":"Own","original_owner":"UTAH"},
    {"round":1,"year":2031,"note":"Own","original_owner":"UTAH"},
    {"round":1,"year":2032,"note":"Own","original_owner":"UTAH"},
  ],
  "MEM": [
    {"round":1,"year":2026,"note":"Own #3","original_owner":"MEM"},
    {"round":1,"year":2026,"note":"PHX #16 (via swap)","original_owner":"PHX"},
    {"round":2,"year":2026,"note":"IND via MIL","original_owner":"IND"},
    {"round":1,"year":2027,"note":"Own","original_owner":"MEM"},
    {"round":1,"year":2027,"note":"LAL 5-30","original_owner":"LAL","protection":"top-4 protected"},
    {"round":1,"year":2027,"note":"Best of UTH/CLE/MIN","original_owner":"UTAH"},
    {"round":1,"year":2028,"note":"Own","original_owner":"MEM"},
    {"round":1,"year":2029,"note":"Own or swap ORL 3-30","original_owner":"MEM"},
    {"round":1,"year":2030,"note":"Own or best w/PHX/WAS","original_owner":"MEM"},
    {"round":1,"year":2031,"note":"Own + PHX via UTH","original_owner":"MEM"},
    {"round":1,"year":2032,"note":"Own","original_owner":"MEM"},
  ],
  "CHI": [
    {"round":1,"year":2026,"note":"Own #4","original_owner":"CHI"},
    {"round":1,"year":2026,"note":"POR #15","original_owner":"POR"},
    {"round":2,"year":2026,"note":"NO via POR-DET-BOS","original_owner":"NO"},
    {"round":2,"year":2026,"note":"DEN via PHX-CHA","original_owner":"DEN"},
    {"round":1,"year":2027,"note":"Own","original_owner":"CHI"},
    {"round":1,"year":2028,"note":"Own","original_owner":"CHI"},
    {"round":1,"year":2029,"note":"Own","original_owner":"CHI"},
    {"round":1,"year":2030,"note":"Own","original_owner":"CHI"},
    {"round":1,"year":2031,"note":"Own","original_owner":"CHI"},
    {"round":1,"year":2032,"note":"Own","original_owner":"CHI"},
  ],
  "LAC": [
    {"round":1,"year":2026,"note":"IND #5","original_owner":"IND"},
    {"round":2,"year":2026,"note":"MEM via UTAH-ATL","original_owner":"MEM"},
    {"round":2,"year":2026,"note":"CLE","original_owner":"CLE"},
    {"round":1,"year":2027,"note":"Own (swap w/DEN/OKC)","original_owner":"LAC","protection":"top-5 protected"},
    {"round":1,"year":2029,"note":"Own 1-3; rest own or PHI swap","original_owner":"LAC"},
    {"round":1,"year":2030,"note":"Own","original_owner":"LAC"},
    {"round":1,"year":2031,"note":"Own","original_owner":"LAC"},
    {"round":1,"year":2032,"note":"Own","original_owner":"LAC"},
  ],
  "BKN": [
    {"round":1,"year":2026,"note":"Own #6 (via HOU)","original_owner":"BKN"},
    {"round":2,"year":2026,"note":"Own #33","original_owner":"BKN"},
    {"round":2,"year":2026,"note":"LAC via HOU","original_owner":"LAC"},
    {"round":1,"year":2027,"note":"Own or HOU swap","original_owner":"BKN"},
    {"round":1,"year":2027,"note":"NYK","original_owner":"NYK"},
    {"round":1,"year":2028,"note":"Own + complex PHX/NYK picks","original_owner":"BKN"},
    {"round":1,"year":2029,"note":"Own + DAL/PHX/HOU picks","original_owner":"BKN"},
    {"round":1,"year":2030,"note":"Own","original_owner":"BKN"},
    {"round":1,"year":2031,"note":"Own + NYK","original_owner":"BKN"},
    {"round":1,"year":2032,"note":"Own + DEN","original_owner":"BKN"},
  ],
  "SAC": [
    {"round":1,"year":2026,"note":"Own #7","original_owner":"SAC"},
    {"round":2,"year":2026,"note":"Own #34","original_owner":"SAC"},
    {"round":2,"year":2026,"note":"CHA via NYK-ATL-SAN","original_owner":"CHA"},
    {"round":1,"year":2027,"note":"Own + SAN 1-16","original_owner":"SAC"},
    {"round":1,"year":2028,"note":"Own","original_owner":"SAC"},
    {"round":1,"year":2029,"note":"Own","original_owner":"SAC"},
    {"round":1,"year":2030,"note":"Own","original_owner":"SAC"},
    {"round":1,"year":2031,"note":"Own or SAN swap","original_owner":"SAC"},
    {"round":1,"year":2032,"note":"Own","original_owner":"SAC"},
  ],
  "NO": [
    {"round":2,"year":2026,"note":"DET via LAC-ORL-PHX-BRK-NYK","original_owner":"DET"},
    {"round":1,"year":2027,"note":"Own (NOP or MIL better)","original_owner":"NO","protection":"top-4 to ATL"},
    {"round":1,"year":2028,"note":"Own","original_owner":"NO"},
    {"round":1,"year":2029,"note":"Own","original_owner":"NO"},
    {"round":1,"year":2030,"note":"Own or ORL swap","original_owner":"NO"},
    {"round":1,"year":2031,"note":"Own","original_owner":"NO"},
    {"round":1,"year":2032,"note":"Own","original_owner":"NO"},
  ],
  "DAL": [
    {"round":1,"year":2026,"note":"Own #9","original_owner":"DAL"},
    {"round":1,"year":2026,"note":"OKC #30 via PHI-WAS","original_owner":"OKC"},
    {"round":2,"year":2026,"note":"PHX via WAS","original_owner":"PHX"},
    {"round":1,"year":2027,"note":"Own 1-2; 3-30 to CHA","original_owner":"DAL","protection":"top-2 protected"},
    {"round":1,"year":2028,"note":"Own or OKC swap","original_owner":"DAL"},
    {"round":1,"year":2030,"note":"Own or SAN swap","original_owner":"DAL"},
    {"round":1,"year":2031,"note":"Own","original_owner":"DAL"},
    {"round":1,"year":2032,"note":"Own","original_owner":"DAL"},
  ],
  "MIL": [
    {"round":1,"year":2026,"note":"Own #10","original_owner":"MIL"},
    {"round":1,"year":2028,"note":"Own (complex swap)","original_owner":"MIL"},
    {"round":1,"year":2030,"note":"Own or POR swap","original_owner":"MIL"},
    {"round":1,"year":2031,"note":"Own","original_owner":"MIL"},
    {"round":1,"year":2032,"note":"Own","original_owner":"MIL"},
  ],
  "GS": [
    {"round":1,"year":2026,"note":"Own #11","original_owner":"GS"},
    {"round":2,"year":2026,"note":"LAL via CLE-MIA-TOR","original_owner":"LAL"},
    {"round":1,"year":2027,"note":"Own","original_owner":"GS"},
    {"round":1,"year":2028,"note":"Own","original_owner":"GS"},
    {"round":1,"year":2029,"note":"Own","original_owner":"GS"},
    {"round":1,"year":2030,"note":"Own 1-20; 21-30 to DAL","original_owner":"GS","protection":"top-20 protected"},
    {"round":1,"year":2031,"note":"Own","original_owner":"GS"},
    {"round":1,"year":2032,"note":"Own","original_owner":"GS"},
  ],
  "OKC": [
    {"round":1,"year":2026,"note":"LAC #12","original_owner":"LAC"},
    {"round":1,"year":2026,"note":"PHI #17","original_owner":"PHI"},
    {"round":2,"year":2026,"note":"DAL","original_owner":"DAL"},
    {"round":2,"year":2026,"note":"WAS via MIA-SAN","original_owner":"WAS"},
    {"round":1,"year":2027,"note":"Own + DEN 6-30","original_owner":"OKC"},
    {"round":1,"year":2028,"note":"Own or swap DAL + DEN 6-30","original_owner":"OKC"},
    {"round":1,"year":2029,"note":"Own + DEN 6-30","original_owner":"OKC"},
    {"round":1,"year":2030,"note":"Own + DEN 6-30","original_owner":"OKC"},
    {"round":1,"year":2031,"note":"Own","original_owner":"OKC"},
    {"round":1,"year":2032,"note":"Own","original_owner":"OKC"},
  ],
  "MIA": [
    {"round":1,"year":2026,"note":"Own #13","original_owner":"MIA"},
    {"round":2,"year":2026,"note":"GS via ATL-OKC-NYK-CHA","original_owner":"GS"},
    {"round":1,"year":2027,"note":"Own 1-14; 15-30 to CHA","original_owner":"MIA","protection":"top-14 protected"},
    {"round":1,"year":2029,"note":"Own","original_owner":"MIA"},
    {"round":1,"year":2030,"note":"Own","original_owner":"MIA"},
    {"round":1,"year":2031,"note":"Own","original_owner":"MIA"},
    {"round":1,"year":2032,"note":"Own","original_owner":"MIA"},
  ],
  "CHA": [
    {"round":1,"year":2026,"note":"Own #14","original_owner":"CHA"},
    {"round":1,"year":2026,"note":"ORL #18 (via MEM swap)","original_owner":"ORL"},
    {"round":1,"year":2027,"note":"Own + DAL 3-30 + MIA 15-30","original_owner":"CHA"},
    {"round":1,"year":2028,"note":"Own + MIA","original_owner":"CHA"},
    {"round":1,"year":2029,"note":"Own + UTH/CLE/MIN picks","original_owner":"CHA"},
    {"round":1,"year":2030,"note":"Own","original_owner":"CHA"},
    {"round":1,"year":2031,"note":"Own","original_owner":"CHA"},
    {"round":1,"year":2032,"note":"Own","original_owner":"CHA"},
  ],
  "ATL": [
    {"round":1,"year":2026,"note":"NO #8 via SAN swap","original_owner":"NO"},
    {"round":1,"year":2026,"note":"CLE #23 via SAN swap","original_owner":"CLE"},
    {"round":2,"year":2026,"note":"BOS #57","original_owner":"BOS"},
    {"round":1,"year":2027,"note":"SAN (traded to SAN)","original_owner":"ATL"},
    {"round":1,"year":2029,"note":"Own","original_owner":"ATL"},
    {"round":1,"year":2030,"note":"Own","original_owner":"ATL"},
    {"round":1,"year":2031,"note":"Own","original_owner":"ATL"},
    {"round":1,"year":2032,"note":"Own","original_owner":"ATL"},
  ],
  "DET": [
    {"round":1,"year":2026,"note":"MIN #21 (via DET swap)","original_owner":"MIN"},
    {"round":1,"year":2027,"note":"Own","original_owner":"DET"},
    {"round":1,"year":2028,"note":"Own","original_owner":"DET"},
    {"round":1,"year":2029,"note":"Own","original_owner":"DET"},
    {"round":1,"year":2030,"note":"Own","original_owner":"DET"},
    {"round":1,"year":2031,"note":"Own","original_owner":"DET"},
    {"round":1,"year":2032,"note":"Own","original_owner":"DET"},
  ],
  "PHI": [
    {"round":2,"year":2026,"note":"HOU #22 via OKC","original_owner":"HOU"},
    {"round":2,"year":2026,"note":"HOU #53","original_owner":"HOU"},
    {"round":1,"year":2027,"note":"Own","original_owner":"PHI"},
    {"round":1,"year":2028,"note":"Own 1-8; complex 9-30","original_owner":"PHI","protection":"lottery protected complex"},
    {"round":1,"year":2029,"note":"Own or swap LAC 4-30","original_owner":"PHI"},
    {"round":1,"year":2030,"note":"Own","original_owner":"PHI"},
    {"round":1,"year":2031,"note":"Own","original_owner":"PHI"},
    {"round":1,"year":2032,"note":"Own","original_owner":"PHI"},
  ],
  "DEN": [
    {"round":1,"year":2026,"note":"Own #26","original_owner":"DEN"},
    {"round":2,"year":2026,"note":"ATL via GOS-BRK","original_owner":"ATL"},
    {"round":1,"year":2027,"note":"Own 1-5; 6-30 to OKC","original_owner":"DEN","protection":"top-5 protected"},
    {"round":1,"year":2028,"note":"Own 1-5; 6-30 to OKC","original_owner":"DEN","protection":"top-5 protected"},
    {"round":1,"year":2029,"note":"Own 1-5; 6-30 to OKC","original_owner":"DEN","protection":"top-5 protected"},
    {"round":1,"year":2030,"note":"Own 1-5; 6-30 to OKC","original_owner":"DEN","protection":"top-5 protected"},
    {"round":1,"year":2031,"note":"Own","original_owner":"DEN"},
  ],
  "CLE": [
    {"round":2,"year":2026,"note":"SAN #29 via SAN swap","original_owner":"SA"},
    {"round":1,"year":2030,"note":"Own","original_owner":"CLE"},
    {"round":1,"year":2031,"note":"Own","original_owner":"CLE"},
    {"round":1,"year":2032,"note":"Own","original_owner":"CLE"},
  ],
  "TOR": [
    {"round":1,"year":2026,"note":"Own #19","original_owner":"TOR"},
    {"round":2,"year":2026,"note":"Own #50","original_owner":"TOR"},
    {"round":1,"year":2027,"note":"Own","original_owner":"TOR"},
    {"round":1,"year":2028,"note":"Own","original_owner":"TOR"},
    {"round":1,"year":2029,"note":"Own","original_owner":"TOR"},
    {"round":1,"year":2030,"note":"Own","original_owner":"TOR"},
    {"round":1,"year":2031,"note":"Own","original_owner":"TOR"},
    {"round":1,"year":2032,"note":"Own","original_owner":"TOR"},
  ],
  "ORL": [
    {"round":2,"year":2026,"note":"Own #46","original_owner":"ORL"},
    {"round":1,"year":2027,"note":"Own","original_owner":"ORL"},
    {"round":1,"year":2029,"note":"Own 1-2; 3-30 complex","original_owner":"ORL","protection":"top-2 protected"},
    {"round":1,"year":2031,"note":"Own","original_owner":"ORL"},
    {"round":1,"year":2032,"note":"Own","original_owner":"ORL"},
  ],
  "SA": [
    {"round":1,"year":2026,"note":"ATL #20 (via SAN swap)","original_owner":"ATL"},
    {"round":2,"year":2026,"note":"UTAH #35 via MIN","original_owner":"UTAH"},
    {"round":2,"year":2026,"note":"POR #42 via NO","original_owner":"POR"},
    {"round":2,"year":2026,"note":"MIA #44 via MIA-IND","original_owner":"MIA"},
    {"round":2,"year":2026,"note":"MIN #59 via MIA-IND","original_owner":"MIN"},
    {"round":1,"year":2027,"note":"ATL (via SAN swap)","original_owner":"SA"},
    {"round":1,"year":2028,"note":"Own or swap BOS 2-30","original_owner":"SA"},
    {"round":1,"year":2029,"note":"Own","original_owner":"SA"},
    {"round":1,"year":2030,"note":"Best of SAN/DAL/MIN","original_owner":"SA"},
    {"round":1,"year":2031,"note":"Own or swap SAC","original_owner":"SA"},
    {"round":1,"year":2032,"note":"Own","original_owner":"SA"},
  ],
  "HOU": [
    {"round":2,"year":2026,"note":"CHI #39 via WAS","original_owner":"CHI"},
    {"round":2,"year":2026,"note":"Own #53","original_owner":"HOU"},
    {"round":1,"year":2027,"note":"Own or swap BRK + PHX","original_owner":"HOU"},
    {"round":1,"year":2028,"note":"Own","original_owner":"HOU"},
    {"round":1,"year":2029,"note":"Own + best of HOU/DAL/PHX","original_owner":"HOU"},
    {"round":1,"year":2030,"note":"Own","original_owner":"HOU"},
    {"round":1,"year":2031,"note":"Own","original_owner":"HOU"},
    {"round":1,"year":2032,"note":"Own","original_owner":"HOU"},
  ],
  "NYK": [
    {"round":1,"year":2026,"note":"Own #24","original_owner":"NYK"},
    {"round":2,"year":2026,"note":"WAS #31 via HOU-OKC","original_owner":"WAS"},
    {"round":2,"year":2026,"note":"Own #55","original_owner":"NYK"},
    {"round":1,"year":2028,"note":"Own (complex swap)","original_owner":"NYK"},
    {"round":1,"year":2030,"note":"Own","original_owner":"NYK"},
    {"round":1,"year":2032,"note":"Own","original_owner":"NYK"},
  ],
  "LAL": [
    {"round":1,"year":2026,"note":"Own #25","original_owner":"LAL"},
    {"round":1,"year":2027,"note":"Own 1-4; 5-30 to MEM","original_owner":"LAL","protection":"top-4 protected"},
    {"round":1,"year":2028,"note":"Own","original_owner":"LAL"},
    {"round":1,"year":2030,"note":"Own","original_owner":"LAL"},
    {"round":1,"year":2031,"note":"Own","original_owner":"LAL"},
    {"round":1,"year":2032,"note":"Own","original_owner":"LAL"},
  ],
  "PHX": [
    {"round":2,"year":2026,"note":"PHI #47 via OKC-HOU","original_owner":"PHI"},
    {"round":1,"year":2030,"note":"Own","original_owner":"PHX"},
    {"round":1,"year":2032,"note":"Own (frozen thru 27-28)","original_owner":"PHX","protection":"frozen"},
  ],
  "MIN": [
    {"round":1,"year":2026,"note":"DET #28 via DET swap","original_owner":"DET"},
    {"round":2,"year":2026,"note":"SAN #59 via MIA-IND","original_owner":"SA"},
    {"round":1,"year":2028,"note":"Own","original_owner":"MIN"},
    {"round":1,"year":2029,"note":"Own 1-5; 6-30 complex","original_owner":"MIN","protection":"top-5 protected"},
    {"round":1,"year":2030,"note":"Own (complex SAN/DAL swap)","original_owner":"MIN"},
    {"round":1,"year":2032,"note":"Own (frozen thru 27-28)","original_owner":"MIN","protection":"frozen"},
  ],
  "POR": [
    {"round":1,"year":2027,"note":"Own","original_owner":"POR"},
    {"round":1,"year":2028,"note":"Own or swap MIL","original_owner":"POR"},
    {"round":1,"year":2029,"note":"Own","original_owner":"POR"},
    {"round":1,"year":2030,"note":"Own or swap MIL","original_owner":"POR"},
    {"round":1,"year":2031,"note":"Own","original_owner":"POR"},
    {"round":1,"year":2032,"note":"Own","original_owner":"POR"},
  ],
  "IND": [
    {"round":1,"year":2027,"note":"Own","original_owner":"IND"},
    {"round":1,"year":2028,"note":"Own","original_owner":"IND"},
    {"round":1,"year":2030,"note":"Own","original_owner":"IND"},
    {"round":1,"year":2031,"note":"Own","original_owner":"IND"},
    {"round":1,"year":2032,"note":"Own","original_owner":"IND"},
  ],
  "BOS": [
    {"round":1,"year":2026,"note":"Own #27","original_owner":"BOS"},
    {"round":2,"year":2026,"note":"MIL #40 via ORL","original_owner":"MIL"},
    {"round":1,"year":2027,"note":"Own","original_owner":"BOS"},
    {"round":1,"year":2028,"note":"Own 1 or swap SAN 2-30","original_owner":"BOS"},
    {"round":1,"year":2030,"note":"Own","original_owner":"BOS"},
    {"round":1,"year":2031,"note":"Own","original_owner":"BOS"},
    {"round":1,"year":2032,"note":"Own (frozen thru 27-28)","original_owner":"BOS","protection":"frozen"},
  ],
}


@router.get("/picks/{save_id}")
async def get_team_picks(save_id: str, team: str = None):
    """Get draft pick inventory for a team from the save state."""
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT state FROM gm_saves WHERE save_id=%s", (save_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Save not found")
        cur.close()

    league = row[0]
    gm_team = league.get("gm_team", "")
    target = team or gm_team

    # Picks live in the save state -- if not there yet (old save), fall back to registry
    picks = league.get("picks") or {}
    team_picks = picks.get(target) if picks.get(target) is not None else REAL_PICK_REGISTRY.get(target, [])
    return {"team": target, "picks": team_picks}


@router.get("/all-picks/{save_id}")
async def get_all_picks(save_id: str):
    """Get pick inventory for all 30 teams."""
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT state FROM gm_saves WHERE save_id=%s", (save_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Save not found")
        cur.close()

    league = row[0]
    saved_picks = league.get("picks", {})

    all_picks = {}
    for team in REAL_PICK_REGISTRY:
        all_picks[team] = saved_picks.get(team, REAL_PICK_REGISTRY[team])

    return {"picks": all_picks}


# ─── Re-sign / Bird Rights System ────────────────────────────────────────────

MARKET_SIZE: dict = {
    "NY":90,"LAL":88,"GS":82,"BOS":80,"CHI":78,"MIA":76,"LAC":74,
    "HOU":72,"DAL":70,"PHX":68,"ATL":66,"WAS":64,"SA":62,"DEN":62,
    "MIN":58,"MEM":56,"OKC":54,"NO":52,"CLE":52,"PHI":70,
    "TOR":60,"POR":48,"SAC":50,"DET":48,"ORL":50,"IND":50,
    "MIL":52,"BKN":74,"CHA":46,"UTAH":44,
}

PERSONALITY_WEIGHTS = {
    "ring_chaser":  {"money":0.20,"winning":0.60,"market":0.10,"loyalty":0.10},
    "businessman":  {"money":0.40,"winning":0.15,"market":0.35,"loyalty":0.10},
    "mercenary":    {"money":0.75,"winning":0.10,"market":0.10,"loyalty":0.05},
    "balanced":     {"money":0.40,"winning":0.30,"market":0.20,"loyalty":0.10},
}

import random as _random

def get_bird_rights(player: dict, team_abbr: str) -> str:
    """
    Determine Bird Rights based on years_left at time of signing.
    We approximate: if the contract_type from BBRef suggests a long deal,
    assume they've been there 3+ years. Otherwise use years_left as proxy.
    In a real multi-season game, we'd track actual tenure.
    For Year 1 of the sim, use a heuristic:
      - players making >$20M on expiring deals likely have full bird rights
      - everyone else gets early or non-bird based on salary tier
    """
    salary = player.get("salary", 0)
    age    = player.get("age", 28)
    if salary >= 20_000_000:
        return "full"       # star players, clearly been there
    elif salary >= 8_000_000:
        return "early"      # solid rotation players
    else:
        return "non_bird"   # cheap/short-term guys

def bird_max_offer(player: dict, team_abbr: str, cap: int = 154_647_000) -> dict:
    """
    Calculate max offer team can make using Bird Rights.
    Returns offer details including years and salary.
    """
    rights = get_bird_rights(player, team_abbr)
    salary = player.get("salary", 0)
    ovr    = player.get("overall", 60)
    age    = player.get("age", 28)

    # Max salary tiers (% of cap)
    service_years = max(1, 2026 - (2026 - (player.get("years_left", 1) + 1)))
    if ovr >= 84:
        max_pct = 0.35  # supermax eligible
    elif ovr >= 78:
        max_pct = 0.30
    else:
        max_pct = 0.25
    max_salary = int(cap * max_pct)

    if rights == "full":
        offer_salary = min(max_salary, max(salary, int(salary * 1.08)))
        max_years = 5
    elif rights == "early":
        offer_salary = min(int(salary * 1.75), int(cap * 0.25))
        max_years = 4
    else:  # non_bird
        offer_salary = min(int(salary * 1.20), int(cap * 0.20))
        max_years = 4

    # Age adjusts years
    if age >= 34: max_years = min(max_years, 2)
    elif age >= 30: max_years = min(max_years, 3)

    return {
        "bird_rights": rights,
        "offer_salary": offer_salary,
        "max_years": max_years,
        "max_salary": max_salary,
    }

def player_will_accept(player: dict, offer_salary: int, offer_years: int,
                       team_abbr: str, cap_used: int, cap: int = 154_647_000) -> tuple[bool, str]:
    """
    Player evaluates offer using personality-weighted formula.
    Returns (will_accept, reason).
    """
    ovr = player.get("overall", 60)
    age = player.get("age", 28)

    # Assign personality (in full game this would be stored per player)
    _random.seed(hash(player.get("id","")) % 10000)
    personalities = ["ring_chaser","businessman","mercenary","balanced","balanced"]
    # Stars more likely ring-chasers, vets more mercenary
    if ovr >= 82:
        personalities = ["ring_chaser","balanced","balanced","businessman"]
    elif age >= 32:
        personalities = ["mercenary","mercenary","balanced","ring_chaser"]
    personality = _random.choice(personalities)
    weights = PERSONALITY_WEIGHTS[personality]

    # Money score: offer / what they could get elsewhere
    elsewhere_salary = int(cap * (0.25 if ovr >= 80 else 0.15 if ovr >= 70 else 0.07))
    money_score = min(100, (offer_salary / max(elsewhere_salary, 1)) * 100)

    # Winning score: based on team strength
    team_ovr = 65 + (ovr - 70) * 0.3  # proxy -- in real game use actual team OVR
    winning_score = min(100, max(0, team_ovr))

    # Market score
    market_score = MARKET_SIZE.get(team_abbr, 55)

    # Loyalty bonus (they're already here)
    loyalty_bonus = 12

    offer_score = (
        money_score    * weights["money"] +
        winning_score  * weights["winning"] +
        market_score   * weights["market"] +
        loyalty_bonus  * weights["loyalty"]
    )

    # Threshold: player accepts if offer score >= 62
    # Stars demand more, role players more flexible
    threshold = 68 if ovr >= 78 else 60 if ovr >= 68 else 55

    if offer_score >= threshold:
        return True, f"Accepted {personality.replace('_',' ')}: offer score {offer_score:.0f}"
    else:
        shortfall = threshold - offer_score
        if weights["money"] > 0.5:
            return False, f"Wants more money (${offer_salary/1e6:.1f}M isn't enough)"
        elif weights["winning"] > 0.4:
            return False, f"Prioritizing winning. Looking for a contender."
        else:
            return False, f"Looking at other options (score {offer_score:.0f} vs threshold {threshold})"


@router.get("/expiring-players/{save_id}")
def get_expiring_players(save_id: str):
    """
    Return your team's players with expiring contracts (years_left = 0 or 1).
    These can be re-signed using Bird Rights before free agency.
    Includes the max Bird Rights offer for each.
    """
    with get_conn() as conn:
        league = get_save(conn, save_id)

    abbr    = league["gm_team"]
    roster  = league["teams"][abbr]["roster"]
    cap     = SALARY_CAP

    expiring = []
    for p in roster:
        if p.get("years_left", 2) == 0:
            offer = bird_max_offer(p, abbr, cap)
            expiring.append({
                **p,
                "bird_rights":  offer["bird_rights"],
                "offer_salary": offer["offer_salary"],
                "max_years":    offer["max_years"],
                "max_salary":   offer["max_salary"],
                "is_expiring":  True,
            })

    expiring.sort(key=lambda x: -x["overall"])
    return {"expiring": expiring, "count": len(expiring)}


class ResignBody(BaseModel):
    player_id: str
    salary:    int
    years:     int

@router.post("/resign/{save_id}")
def resign_player(save_id: str, body: ResignBody):
    """
    Re-sign an expiring player using Bird Rights.
    Validates offer is within Bird Rights limits.
    Player may decline if offer is too low.
    """
    conn = get_conn()
    league = get_save(conn, save_id)

    abbr    = league["gm_team"]
    team    = league["teams"][abbr]
    roster  = team["roster"]
    cap_used = team["cap_used"]

    player = next((p for p in roster if p["id"] == body.player_id), None)
    if not player:
        raise HTTPException(404, "Player not on your roster")

    if player.get("years_left", 2) > 1:
        raise HTTPException(400, "Player still has years remaining -- cannot re-sign yet")

    # Validate Bird Rights limits
    offer_info = bird_max_offer(player, abbr, SALARY_CAP)
    if body.salary > offer_info["max_salary"] * 1.02:
        raise HTTPException(400, f"Offer exceeds max salary (${offer_info['max_salary']:,.0f})")
    if body.years > offer_info["max_years"]:
        raise HTTPException(400, f"Contract too long (max {offer_info['max_years']} years)")
    if body.years < 1:
        raise HTTPException(400, "Minimum 1 year")

    # CBA: Bird Rights teams can exceed cap to re-sign own players
    # But check apron limits
    new_cap = cap_used - player.get("salary", 0) + body.salary
    FIRST_APRON  = 178_132_000
    SECOND_APRON = 188_931_000

    if new_cap > SECOND_APRON and body.salary > SALARY_CAP * 0.20:
        raise HTTPException(400, f"Second apron teams can only offer vet minimum to new additions")

    # Player decides
    will_accept, reason = player_will_accept(
        player, body.salary, body.years, abbr, cap_used
    )

    if not will_accept:
        # Player walks -- move to FA pool
        team["roster"] = [p for p in roster if p["id"] != body.player_id]
        team["cap_used"] = cap_used - player.get("salary", 0)
        league["fa_pool"].append({**player, "team": "FA", "years_left": 0})
        with get_conn() as conn:
            put_save(conn, save_id, league)
        return {
            "accepted": False,
            "reason":   reason,
            "player":   player["name"],
            "outcome":  f"{player['name']} declined and became a free agent.",
        }

    # Update player contract
    player["salary"]     = body.salary
    player["years_left"] = body.years
    team["cap_used"]     = new_cap

    with get_conn() as conn:
        put_save(conn, save_id, league)

    return {
        "accepted":   True,
        "reason":     reason,
        "player":     player["name"],
        "salary":     body.salary,
        "years":      body.years,
        "cap_used":   new_cap,
        "cap_space":  SALARY_CAP - new_cap,
        "outcome":    f"{player['name']} re-signed for ${body.salary/1e6:.1f}M x {body.years} years.",
    }

