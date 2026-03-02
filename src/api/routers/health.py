"""
Pipeline Health & Observability Dashboard.
Tracks ETL runs, data freshness, coverage, and system stats.
"""
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from src.etl.db import get_conn
from datetime import date, datetime, timezone, timedelta

router = APIRouter()

def ensure_etl_log_table():
    """Create etl_runs table if it doesn't exist."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS etl_runs (
                    run_id SERIAL PRIMARY KEY,
                    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    finished_at TIMESTAMPTZ,
                    season_id VARCHAR(10) NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'running',
                    games_processed INTEGER DEFAULT 0,
                    plays_processed INTEGER DEFAULT 0,
                    stints_processed INTEGER DEFAULT 0,
                    errors INTEGER DEFAULT 0,
                    error_details TEXT,
                    duration_seconds FLOAT,
                    latest_game_date DATE
                )
            """)

@router.get("")
async def health_dashboard():
    """Full pipeline health snapshot."""
    ensure_etl_log_table()

    with get_conn() as conn:
        with conn.cursor() as cur:

            # --- Data volume ---
            cur.execute("""
                SELECT
                    COUNT(*) FILTER (WHERE home_score IS NOT NULL) as completed_games,
                    COUNT(*) FILTER (WHERE home_score IS NULL) as scheduled_games,
                    MAX(game_date) FILTER (WHERE home_score IS NOT NULL) as latest_game,
                    MIN(game_date) as first_game,
                    COUNT(DISTINCT home_team_id) as teams
                FROM games WHERE season_id = '2025-26'
            """)
            row = cur.fetchone()
            games_completed = row[0] or 0
            games_scheduled = row[1] or 0
            latest_game = str(row[2]) if row[2] else None
            first_game = str(row[3]) if row[3] else None
            n_teams = row[4] or 0

            cur.execute("SELECT COUNT(*) FROM plays p JOIN games g ON g.game_id = p.game_id WHERE g.season_id = '2025-26'")
            total_plays = cur.fetchone()[0] or 0

            cur.execute("SELECT COUNT(*) FROM stints s JOIN games g ON g.game_id = s.game_id WHERE g.season_id = '2025-26'")
            total_stints = cur.fetchone()[0] or 0

            cur.execute("""
                SELECT COUNT(DISTINCT lp.player_id)
                FROM lineup_players lp
                JOIN stints s ON s.lineup_id = lp.lineup_id
                JOIN games g ON g.game_id = s.game_id
                WHERE g.season_id = '2025-26'
            """)
            total_players = cur.fetchone()[0] or 0

            # --- Coverage: games with plays vs without ---
            cur.execute("""
                SELECT
                    COUNT(DISTINCT g.game_id) FILTER (WHERE p.game_id IS NOT NULL) as games_with_plays,
                    COUNT(DISTINCT g.game_id) FILTER (WHERE p.game_id IS NULL) as games_missing_plays
                FROM games g
                LEFT JOIN plays p ON p.game_id = g.game_id
                WHERE g.season_id = '2025-26' AND g.home_score IS NOT NULL
            """)
            row = cur.fetchone()
            games_with_plays = row[0] or 0
            games_missing_plays = row[1] or 0

            # --- Games with stints ---
            cur.execute("""
                SELECT COUNT(DISTINCT g.game_id)
                FROM games g
                JOIN stints s ON s.game_id = g.game_id
                WHERE g.season_id = '2025-26'
            """)
            games_with_stints = cur.fetchone()[0] or 0

            # --- Per-team coverage ---
            cur.execute("""
                SELECT t.abbreviation,
                    COUNT(*) FILTER (WHERE g.home_score IS NOT NULL) as completed,
                    COUNT(*) as total,
                    MAX(g.game_date) FILTER (WHERE g.home_score IS NOT NULL) as latest
                FROM teams t
                JOIN games g ON (g.home_team_id = t.team_id OR g.away_team_id = t.team_id)
                WHERE g.season_id = '2025-26'
                GROUP BY t.abbreviation
                ORDER BY t.abbreviation
            """)
            team_coverage = [
                {"team": r[0], "completed": r[1], "total": r[2], "latest": str(r[3]) if r[3] else None}
                for r in cur.fetchall()
            ]

            # --- Recent ETL runs ---
            cur.execute("""
                SELECT run_id, started_at, finished_at, status,
                       games_processed, plays_processed, stints_processed,
                       errors, duration_seconds, latest_game_date
                FROM etl_runs
                ORDER BY started_at DESC
                LIMIT 20
            """)
            etl_cols = [d[0] for d in cur.description]
            etl_runs = []
            for r in cur.fetchall():
                row_dict = dict(zip(etl_cols, r))
                # serialize datetimes
                for k in ('started_at', 'finished_at'):
                    if row_dict.get(k):
                        row_dict[k] = row_dict[k].isoformat()
                if row_dict.get('latest_game_date'):
                    row_dict['latest_game_date'] = str(row_dict['latest_game_date'])
                etl_runs.append(row_dict)

            # --- Data freshness ---
            now_utc = datetime.now(timezone.utc)
            days_stale = None
            if latest_game:
                latest_dt = date.fromisoformat(latest_game)
                days_stale = (date.today() - latest_dt).days

            freshness_status = (
                "fresh" if days_stale is not None and days_stale <= 1
                else "stale_1d" if days_stale is not None and days_stale <= 2
                else "stale" if days_stale is not None
                else "unknown"
            )

            # --- Avg plays per game (quality signal) ---
            cur.execute("""
                SELECT ROUND(AVG(play_count), 0) FROM (
                    SELECT g.game_id, COUNT(p.play_id) as play_count
                    FROM games g
                    JOIN plays p ON p.game_id = g.game_id
                    WHERE g.season_id = '2025-26'
                    GROUP BY g.game_id
                ) sub
            """)
            avg_plays_per_game = float(cur.fetchone()[0] or 0)

            # --- Season progress ---
            total_season_games = 1230  # NBA regular season
            season_pct = round(games_completed / total_season_games * 100, 1)

    return JSONResponse({
        "status": "ok",
        "as_of": datetime.now(timezone.utc).isoformat(),
        "freshness": {
            "status": freshness_status,
            "latest_game_date": latest_game,
            "days_since_update": days_stale,
            "first_game_date": first_game,
        },
        "volume": {
            "games_completed": games_completed,
            "games_scheduled": games_scheduled,
            "total_plays": total_plays,
            "total_stints": total_stints,
            "total_players": total_players,
            "teams": n_teams,
            "avg_plays_per_game": avg_plays_per_game,
            "season_progress_pct": season_pct,
        },
        "coverage": {
            "games_with_plays": games_with_plays,
            "games_missing_plays": games_missing_plays,
            "games_with_stints": games_with_stints,
            "play_coverage_pct": round(games_with_plays / games_completed * 100, 1) if games_completed else 0,
            "stint_coverage_pct": round(games_with_stints / games_completed * 100, 1) if games_completed else 0,
        },
        "team_coverage": team_coverage,
        "etl_runs": etl_runs,
    })


@router.post("/log_run")
async def log_etl_run(payload: dict):
    """Called by the ETL script to record a run."""
    ensure_etl_log_table()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO etl_runs (
                    started_at, finished_at, season_id, status,
                    games_processed, plays_processed, stints_processed,
                    errors, error_details, duration_seconds, latest_game_date
                ) VALUES (
                    %(started_at)s, %(finished_at)s, %(season_id)s, %(status)s,
                    %(games_processed)s, %(plays_processed)s, %(stints_processed)s,
                    %(errors)s, %(error_details)s, %(duration_seconds)s, %(latest_game_date)s
                )
            """, {
                "started_at": payload.get("started_at"),
                "finished_at": payload.get("finished_at"),
                "season_id": payload.get("season_id", "2025-26"),
                "status": payload.get("status", "success"),
                "games_processed": payload.get("games_processed", 0),
                "plays_processed": payload.get("plays_processed", 0),
                "stints_processed": payload.get("stints_processed", 0),
                "errors": payload.get("errors", 0),
                "error_details": payload.get("error_details"),
                "duration_seconds": payload.get("duration_seconds"),
                "latest_game_date": payload.get("latest_game_date"),
            })
    return {"ok": True}
