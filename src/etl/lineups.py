"""Reconstruct lineup stints from substitution events in the plays table.

Uses the pattern "X enters the game for Y" to track which 5 players
are on the court at each moment, then builds stint records when the
lineup changes.
"""

import hashlib
import logging
import re
from collections import defaultdict

from src.etl.db import get_conn, upsert_many
from src.etl.espn import fetch_boxscore

logger = logging.getLogger(__name__)

MIN_STINT_SECONDS = 15  # ignore stints shorter than this


def lineup_id(player_ids: list[int]) -> str:
    key = "_".join(str(p) for p in sorted(player_ids))
    return hashlib.md5(key.encode()).hexdigest()[:16]


def parse_sub(description: str):
    """
    Parse 'X enters the game for Y' -> (incoming_name, outgoing_name)
    Returns None if not a sub description.
    """
    m = re.match(r"^(.+?) enters the game for (.+?)$", description.strip())
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return None


def store_game_stints(game_id: str, home_team_id: int, away_team_id: int) -> int:
    espn_id = game_id.replace("espn_", "")

    # Get starters and all players from boxscore
    try:
        boxscore = fetch_boxscore(espn_id)
    except Exception as e:
        logger.warning(f"Could not fetch boxscore for {game_id}: {e}")
        return 0

    # Seed players into DB and build name->id map
    name_to_id = {}
    for side, team_id in [("home", home_team_id), ("away", away_team_id)]:
        players = boxscore.get(side, [])
        if not players:
            continue
        seed_players(players, team_id)
        for p in players:
            pid_str = p["player_id"].replace("espn_", "")
            try:
                pid = int(pid_str)
                name_to_id[p["name"].strip()] = (pid, team_id)
            except ValueError:
                pass

    if not name_to_id:
        return 0

    # Get game score
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT home_score, away_score FROM games WHERE game_id = %s",
                (game_id,)
            )
            row = cur.fetchone()
            if not row:
                return 0
            home_score, away_score = row[0], row[1]

    # Load all plays for this game ordered by time
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT play_type, description, game_seconds_elapsed,
                       period, home_score, away_score, possession_team_id
                FROM plays
                WHERE game_id = %s
                ORDER BY game_seconds_elapsed, play_num
            """, (game_id,))
            cols = [d[0] for d in cur.description]
            plays = [dict(zip(cols, r)) for r in cur.fetchall()]

    if not plays:
        return _store_aggregate_stint(game_id, home_team_id, away_team_id,
                                      home_score, away_score, boxscore)

    # Determine starters from boxscore
    home_on_court = set()
    away_on_court = set()

    for side, team_id, on_court in [("home", home_team_id, home_on_court),
                                     ("away", away_team_id, away_on_court)]:
        players = boxscore.get(side, [])
        starters = [p for p in players if p.get("starter", False)]
        if not starters:
            starters = players[:5]
        for p in starters[:5]:
            pid_str = p["player_id"].replace("espn_", "")
            try:
                on_court.add(int(pid_str))
            except ValueError:
                pass

    # Track player->team mapping
    player_team = {pid: tid for _, (pid, tid) in name_to_id.items()}

    # Reconstruct stints by tracking lineup changes
    stints = []
    lineup_rows = []

    prev_home = frozenset(home_on_court)
    prev_away = frozenset(away_on_court)
    prev_seconds = 0
    prev_home_score = 0
    prev_away_score = 0

    def flush_stint(team_id, lineup, start_sec, end_sec, start_hs, start_as, end_hs, end_as, is_clutch):
        if not lineup or end_sec - start_sec < MIN_STINT_SECONDS:
            return
        lid = lineup_id(list(lineup))
        home_pts = (end_hs or 0) - (start_hs or 0)
        away_pts = (end_as or 0) - (start_as or 0)
        net_pts = home_pts - away_pts if team_id == home_team_id else away_pts - home_pts
        dur = end_sec - start_sec
        poss = max(1, round(dur / 28.8))
        stints.append({
            "game_id": game_id,
            "team_id": team_id,
            "lineup_id": lid,
            "period": 1,
            "start_game_seconds": start_sec,
            "end_game_seconds": end_sec,
            "duration_seconds": dur,
            "start_score_diff": (start_hs or 0) - (start_as or 0),
            "end_score_diff": (end_hs or 0) - (end_as or 0),
            "net_points": net_pts,
            "possessions": poss,
            "is_clutch": is_clutch,
        })
        for pid in lineup:
            lineup_rows.append({"lineup_id": lid, "player_id": pid, "team_id": team_id})

    for play in plays:
        if play["play_type"] != "Substitution":
            continue

        sub = parse_sub(play["description"] or "")
        if not sub:
            continue

        incoming_name, outgoing_name = sub
        incoming = name_to_id.get(incoming_name)
        outgoing = name_to_id.get(outgoing_name)

        if not incoming or not outgoing:
            continue

        incoming_pid, incoming_tid = incoming
        outgoing_pid, _ = outgoing

        cur_seconds = play["game_seconds_elapsed"] or 0
        cur_hs = play["home_score"] or prev_home_score
        cur_as = play["away_score"] or prev_away_score

        score_diff = abs((cur_hs or 0) - (cur_as or 0))
        is_clutch = cur_seconds >= 2580 and score_diff <= 5

        flush_stint(home_team_id, prev_home, prev_seconds, cur_seconds,
                    prev_home_score, prev_away_score, cur_hs, cur_as, is_clutch)
        flush_stint(away_team_id, prev_away, prev_seconds, cur_seconds,
                    prev_home_score, prev_away_score, cur_hs, cur_as, is_clutch)

        if incoming_tid == home_team_id:
            prev_home = frozenset((prev_home - {outgoing_pid}) | {incoming_pid})
        else:
            prev_away = frozenset((prev_away - {outgoing_pid}) | {incoming_pid})

        prev_seconds = cur_seconds
        prev_home_score = cur_hs
        prev_away_score = cur_as

    # Flush final stints
    flush_stint(home_team_id, prev_home, prev_seconds, 2880,
                prev_home_score, prev_away_score, home_score, away_score, False)
    flush_stint(away_team_id, prev_away, prev_seconds, 2880,
                prev_home_score, prev_away_score, home_score, away_score, False)

    if stints:
        upsert_many("stints", stints, ["game_id", "team_id", "lineup_id", "period", "start_game_seconds"])
    if lineup_rows:
        seen = set()
        unique_rows = []
        for r in lineup_rows:
            k = (r["lineup_id"], r["player_id"])
            if k not in seen:
                seen.add(k)
                unique_rows.append(r)
        upsert_many("lineup_players", unique_rows, ["lineup_id", "player_id"])

    logger.info(f"Stored {len(stints)} stints for {game_id}")
    return len(stints)


def _store_aggregate_stint(game_id, home_team_id, away_team_id, home_score, away_score, boxscore):
    """Fallback: one aggregate stint per team if no plays exist."""
    stints = []
    for side, team_id in [("home", home_team_id), ("away", away_team_id)]:
        players = boxscore.get(side, [])
        pids = []
        for p in players:
            pid_str = p["player_id"].replace("espn_", "")
            try:
                pids.append(int(pid_str))
            except ValueError:
                pass
        if not pids:
            continue
        lid = lineup_id(pids)
        score_diff = (home_score or 0) - (away_score or 0)
        stints.append({
            "game_id": game_id, "team_id": team_id, "lineup_id": lid,
            "period": 1, "start_game_seconds": 0, "end_game_seconds": 2880,
            "duration_seconds": 2880, "start_score_diff": 0,
            "end_score_diff": score_diff if side == "home" else -score_diff,
            "net_points": (home_score or 0) - (away_score or 0) if side == "home" else (away_score or 0) - (home_score or 0),
            "possessions": 100, "is_clutch": False,
        })
    if stints:
        upsert_many("stints", stints, ["game_id", "team_id", "lineup_id", "period", "start_game_seconds"])
    return len(stints)


def seed_players(players: list[dict], team_id: int) -> None:
    rows = []
    for p in players:
        pid_str = p["player_id"].replace("espn_", "")
        try:
            pid = int(pid_str)
        except ValueError:
            continue
        name_parts = p["name"].split(" ", 1)
        rows.append({
            "player_id": pid,
            "first_name": name_parts[0] if name_parts else "",
            "last_name": name_parts[1] if len(name_parts) > 1 else "",
            "team_id": team_id,
        })
    if rows:
        upsert_many("players", rows, ["player_id"])
