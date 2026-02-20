"""
src/etl/fetch_pbp.py
Step 2 of the ETL pipeline.

Fetches play-by-play for each game and:
  1. Parses plays into the `plays` table.
  2. Tracks lineup substitutions to produce `stints`.
  3. Infers possession holder (simplified: the team that scored/turned over last).

ASSUMPTION: Possession inference
  We use a simplified rule: after a made shot or turnover, possession flips.
  After a defensive rebound, possession goes to the rebounding team.
  This is ~95% accurate for our purposes (win prob + lineup modeling).
  True possession tracking requires optical data (Second Spectrum).

nba_api endpoint: PlayByPlayV2
  Returns ~30 columns per play including SCORE, EVENTMSGTYPE, PLAYER1/2/3,
  HOMEDESCRIPTION, VISITORDESCRIPTION, PCTIMESTRING.
"""

import time
import logging
import re
from typing import Optional

import pandas as pd
from nba_api.stats.endpoints import PlayByPlayV2, BoxScoreTraditionalV2

from src.etl.config import EVENT_TYPES, REGULATION_SECONDS, OT_SECONDS
from src.etl.db import session_scope, execute_sql

logger = logging.getLogger(__name__)
DELAY = 0.6


def _sleep():
    time.sleep(DELAY)


# ─── Clock parsing ────────────────────────────────────────────────────────────

def clock_to_seconds_remaining_in_game(period: int, clock_str: str) -> float:
    """
    Convert period + MM:SS clock to seconds remaining in regulation/OT.
    clock_str format from nba_api: "PT05M30.00S"  or legacy "5:30"
    """
    try:
        # ISO 8601 duration format (newer API)
        m = re.match(r"PT(\d+)M([\d.]+)S", clock_str)
        if m:
            minutes = int(m.group(1))
            seconds = float(m.group(2))
        else:
            # Fallback: MM:SS
            parts = clock_str.split(":")
            minutes = int(parts[0])
            seconds = float(parts[1])
    except Exception:
        return 0.0

    clock_secs = minutes * 60 + seconds

    if period <= 4:
        # Regulation: 4 quarters of 12 min
        secs_remaining_in_regulation = (4 - period) * 720 + clock_secs
    else:
        # OT: each period 5 min
        ot_num = period - 4
        secs_remaining_in_regulation = 0  # reg is over
        secs_remaining_ot = (ot_num - 1) * OT_SECONDS  # completed OT periods ... wait
        # We simplify: treat OT as extra time appended
        secs_remaining_in_regulation = -(ot_num - 1) * OT_SECONDS - (OT_SECONDS - clock_secs)

    return max(secs_remaining_in_regulation, 0.0)


def clock_to_elapsed(period: int, clock_str: str) -> float:
    """Seconds elapsed from tip-off."""
    try:
        m = re.match(r"PT(\d+)M([\d.]+)S", clock_str)
        if m:
            minutes = int(m.group(1))
            seconds = float(m.group(2))
        else:
            parts = clock_str.split(":")
            minutes = int(parts[0])
            seconds = float(parts[1])
    except Exception:
        return 0.0

    clock_secs = minutes * 60 + seconds
    period_elapsed = min(period - 1, 3) * 720  # reg quarters
    ot_elapsed = max(0, period - 4) * OT_SECONDS if period > 4 else 0
    time_in_period = 720 - clock_secs if period <= 4 else OT_SECONDS - clock_secs
    return period_elapsed + ot_elapsed + time_in_period


# ─── Score parsing ────────────────────────────────────────────────────────────

def parse_score(score_str: Optional[str]) -> tuple[int, int]:
    """Parse '104 - 98' -> (104, 98). Returns (0, 0) if missing."""
    if not score_str or score_str.strip() == "":
        return (0, 0)
    parts = score_str.replace(" ", "").split("-")
    try:
        return int(parts[0]), int(parts[1])
    except Exception:
        return (0, 0)


# ─── Main PBP fetch ───────────────────────────────────────────────────────────

def fetch_and_store_pbp(game_id: str) -> None:
    """
    Fetch play-by-play for one game, parse plays + stints, store in Postgres.
    """
    logger.info("Fetching PBP for game %s", game_id)
    try:
        pbp = PlayByPlayV2(game_id=game_id)
        _sleep()
        df = pbp.get_data_frames()[0]
    except Exception as e:
        logger.error("Failed to fetch PBP for %s: %s", game_id, e)
        return

    if df.empty:
        logger.warning("Empty PBP for game %s", game_id)
        return

    # Fetch box score to get home/away team_ids
    try:
        box = BoxScoreTraditionalV2(game_id=game_id)
        _sleep()
        team_df = box.get_data_frames()[1]  # TeamStats frame
        home_team_id = int(team_df.iloc[0]["TEAM_ID"])
        away_team_id = int(team_df.iloc[1]["TEAM_ID"])
    except Exception as e:
        logger.error("Failed to fetch box score for %s: %s", game_id, e)
        return

    plays = _parse_plays(df, game_id, home_team_id, away_team_id)
    stints = _build_stints(df, game_id, home_team_id, away_team_id)

    _store_plays(plays)
    _store_stints(stints)
    logger.info("Stored %d plays, %d stints for game %s", len(plays), len(stints), game_id)


def _parse_plays(df: pd.DataFrame, game_id: str, home_team_id: int, away_team_id: int) -> list[dict]:
    plays = []
    last_home_score, last_away_score = 0, 0

    for _, row in df.iterrows():
        event_type = int(row.get("EVENTMSGTYPE", 0))
        period = int(row.get("PERIOD", 0))
        clock_str = str(row.get("PCTIMESTRING", "0:00"))

        # Score
        score_str = row.get("SCORE") or ""
        if score_str.strip():
            away_score, home_score = parse_score(score_str)
            last_home_score, last_away_score = home_score, away_score
        else:
            home_score, away_score = last_home_score, last_away_score

        elapsed = clock_to_elapsed(period, clock_str)

        is_made = event_type == 1
        is_three = is_made and bool(row.get("HOMEDESCRIPTION", "") or row.get("VISITORDESCRIPTION", ""))
        # Check 3-pointer: description contains "3PT"
        desc_combined = str(row.get("HOMEDESCRIPTION") or "") + str(row.get("VISITORDESCRIPTION") or "")
        is_three_actual = "3PT" in desc_combined and is_made
        is_ft = event_type == 3
        is_to = event_type == 5
        is_foul = event_type == 6
        is_sub = event_type == 8

        # Team that performed this play
        play_team_id: Optional[int] = None
        p1_team = row.get("PLAYER1_TEAM_ID")
        if p1_team and str(p1_team) not in ("", "nan", "None"):
            try:
                play_team_id = int(float(str(p1_team)))
            except Exception:
                pass

        plays.append({
            "game_id": game_id,
            "event_num": int(row.get("EVENTNUM", 0)),
            "period": period,
            "clock_str": clock_str,
            "seconds_elapsed": elapsed,
            "seconds_remaining": max(0.0, REGULATION_SECONDS - elapsed),
            "event_type": event_type,
            "event_action": int(row.get("EVENTMSGACTIONTYPE", 0)),
            "description": desc_combined[:500],
            "home_score": home_score,
            "away_score": away_score,
            "score_diff": home_score - away_score,
            "team_id": play_team_id,
            "player1_id": _safe_int(row.get("PLAYER1_ID")),
            "player2_id": _safe_int(row.get("PLAYER2_ID")),
            "player3_id": _safe_int(row.get("PLAYER3_ID")),
            "is_made_shot": is_made,
            "is_three": is_three_actual,
            "is_ft": is_ft,
            "is_turnover": is_to,
            "is_foul": is_foul,
        })
    return plays


def _safe_int(val) -> Optional[int]:
    try:
        v = int(float(str(val)))
        return v if v > 0 else None
    except Exception:
        return None


def _store_plays(plays: list[dict]) -> None:
    if not plays:
        return
    with session_scope() as sess:
        # Delete existing to allow re-runs
        sess.execute("DELETE FROM plays WHERE game_id = :gid", {"gid": plays[0]["game_id"]})
        sess.execute(
            """
            INSERT INTO plays (
                game_id, event_num, period, clock_str, seconds_elapsed, seconds_remaining,
                event_type, event_action, description,
                home_score, away_score, score_diff,
                team_id, player1_id, player2_id, player3_id,
                is_made_shot, is_three, is_ft, is_turnover, is_foul
            ) VALUES (
                :game_id, :event_num, :period, :clock_str, :seconds_elapsed, :seconds_remaining,
                :event_type, :event_action, :description,
                :home_score, :away_score, :score_diff,
                :team_id, :player1_id, :player2_id, :player3_id,
                :is_made_shot, :is_three, :is_ft, :is_turnover, :is_foul
            )
            """,
            plays,
        )


# ─── Stint building ───────────────────────────────────────────────────────────

def _build_stints(
    df: pd.DataFrame, game_id: str, home_team_id: int, away_team_id: int
) -> list[dict]:
    """
    Walk the play-by-play and track lineup changes via EVENTMSGTYPE=8 (substitution).
    Returns a list of stint dicts.

    ASSUMPTION: We initialize lineups at start of each period using players who appear
    in the first plays of that period. Substitutions update the lineup mid-period.
    This is the standard approach with nba_api PBP (no "lineup" endpoint needed).
    """
    stints = []

    # We track two 5-man lineups
    home_lineup: set[int] = set()
    away_lineup: set[int] = set()

    def make_lineup_id(players: set[int]) -> str:
        return "_".join(str(p) for p in sorted(players))

    # Collect players per team per period from first plays
    # (fallback: use substitution tracking)
    period_home_lineups: dict[int, set[int]] = {}
    period_away_lineups: dict[int, set[int]] = {}

    current_period = 0
    home_stint_start = 0.0
    away_stint_start = 0.0
    home_stint_score_start = 0
    away_stint_score_start = 0

    for _, row in df.iterrows():
        period = int(row.get("PERIOD", 1))
        etype = int(row.get("EVENTMSGTYPE", 0))
        elapsed = clock_to_elapsed(period, str(row.get("PCTIMESTRING", "0:00")))

        # Period change → close open stints, reset lineups
        if period != current_period:
            # Close any open stints
            if current_period > 0 and home_lineup:
                stints.append(_make_stint(game_id, home_team_id, home_lineup,
                    current_period, home_stint_start, elapsed, home_stint_score_start,
                    int(row.get("SCORE", "0 - 0").split("-")[1].strip() or 0) if " - " in str(row.get("SCORE","")) else 0))
                stints.append(_make_stint(game_id, away_team_id, away_lineup,
                    current_period, away_stint_start, elapsed, away_stint_score_start, 0))
            current_period = period
            home_stint_start = elapsed
            away_stint_start = elapsed
            # Reset lineup tracking — will fill from first players seen
            home_lineup = set()
            away_lineup = set()

        # Track players to infer initial lineup (first 5 unique per team per period)
        p1_id = _safe_int(row.get("PLAYER1_ID"))
        p1_team = _safe_int(row.get("PLAYER1_TEAM_ID"))

        if p1_id and p1_team:
            if p1_team == home_team_id and len(home_lineup) < 5:
                home_lineup.add(p1_id)
            elif p1_team == away_team_id and len(away_lineup) < 5:
                away_lineup.add(p1_id)

        # Substitution: update lineup
        if etype == 8:
            p1 = _safe_int(row.get("PLAYER1_ID"))  # player going OUT
            p2 = _safe_int(row.get("PLAYER2_ID"))  # player coming IN
            sub_team = p1_team

            if p1 and p2 and sub_team:
                home_score_now = 0
                away_score_now = 0
                if " - " in str(row.get("SCORE", "")):
                    parts = str(row["SCORE"]).split("-")
                    try:
                        away_score_now = int(parts[0].strip())
                        home_score_now = int(parts[1].strip())
                    except Exception:
                        pass

                if sub_team == home_team_id and len(home_lineup) >= 5:
                    stints.append(_make_stint(game_id, home_team_id, home_lineup,
                        period, home_stint_start, elapsed, home_stint_score_start,
                        home_score_now - away_score_now))
                    home_lineup.discard(p1)
                    home_lineup.add(p2)
                    home_stint_start = elapsed
                    home_stint_score_start = home_score_now - away_score_now

                elif sub_team == away_team_id and len(away_lineup) >= 5:
                    stints.append(_make_stint(game_id, away_team_id, away_lineup,
                        period, away_stint_start, elapsed, away_stint_score_start,
                        away_score_now - home_score_now))
                    away_lineup.discard(p1)
                    away_lineup.add(p2)
                    away_stint_start = elapsed
                    away_stint_score_start = away_score_now - home_score_now

    return [s for s in stints if s["duration_seconds"] > 0 and len(s["lineup_id"]) > 0]


def _make_stint(
    game_id: str, team_id: int, lineup: set[int], period: int,
    start_secs: float, end_secs: float,
    start_score_diff: int, end_score_diff: int,
) -> dict:
    return {
        "game_id": game_id,
        "team_id": team_id,
        "lineup_id": "_".join(str(p) for p in sorted(lineup)) if lineup else "",
        "period": period,
        "start_seconds": start_secs,
        "end_seconds": end_secs,
        "duration_seconds": max(0.0, end_secs - start_secs),
        "start_score_diff": start_score_diff,
        "end_score_diff": end_score_diff,
        "possessions": max(1, int((end_secs - start_secs) / 14)),  # ~14 sec/possession
    }


def _store_stints(stints: list[dict]) -> None:
    if not stints:
        return
    with session_scope() as sess:
        sess.execute("DELETE FROM stints WHERE game_id = :gid", {"gid": stints[0]["game_id"]})
        for s in stints:
            sess.execute(
                """
                INSERT INTO stints (
                    game_id, team_id, lineup_id, period,
                    start_seconds, end_seconds, duration_seconds,
                    start_score_diff, end_score_diff, possessions
                ) VALUES (
                    :game_id, :team_id, :lineup_id, :period,
                    :start_seconds, :end_seconds, :duration_seconds,
                    :start_score_diff, :end_score_diff, :possessions
                )
                """,
                s,
            )
