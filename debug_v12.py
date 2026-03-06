"""Debug why compute_distribution_score returns None for most players."""
import sys, math
sys.path.insert(0, '.')
from src.etl.db import get_conn, init_pool

init_pool()

def get_player_logs(player_name, team_abbr, n=40):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT game_date, minutes, pts, reb, ast, stl, blk, fg3m,
                       fga, fta, tov, is_home, opponent_abbr,
                       is_b2b, rest_days, opp_def_margin
                FROM player_game_logs
                WHERE player_name = %s AND season_id = '2025-26'
                ORDER BY game_date DESC LIMIT %s
            """, (player_name, n))
            rows = cur.fetchall()
            if not rows:
                last = player_name.split()[-1]
                cur.execute("""
                    SELECT game_date, minutes, pts, reb, ast, stl, blk, fg3m,
                           fga, fta, tov, is_home, opponent_abbr,
                           is_b2b, rest_days, opp_def_margin
                    FROM player_game_logs
                    WHERE LOWER(player_name) LIKE %s AND team_abbr = %s
                      AND season_id = '2025-26'
                    ORDER BY game_date DESC LIMIT %s
                """, (f"%{last.lower()}%", team_abbr, n))
                rows = cur.fetchall()

    if not rows: return []
    cols = ["game_date","minutes","pts","reb","ast","stl","blk","fg3m",
            "fga","fta","tov","is_home","opponent_abbr","is_b2b","rest_days","opp_def_margin"]
    return [dict(zip(cols, r)) for r in rows]

# Test known players
test_cases = [
    ("Devin Booker",   "PHX", "pts",  22.5),
    ("Devin Booker",   "PHX", "reb",  4.5),
    ("LeBron James",   "LAL", "pts",  25.5),
    ("Stephen Curry",  "GSW", "fg3m", 3.5),
    ("Anthony Black",  "ORL", "ast",  3.5),
]

for player, team, stat, line in test_cases:
    logs = get_player_logs(player, team)
    qualified = [g for g in logs if g["minutes"] and g["minutes"] >= 10]
    
    if not qualified:
        print(f"{player} {stat}: NO LOGS (logs={len(logs)})")
        continue

    # Check if stat values are actually populated
    stat_vals = [g[stat] for g in qualified[:5]]
    none_count = sum(1 for v in stat_vals if v is None)
    
    print(f"{player} {stat}: {len(qualified)} qualified games, "
          f"last 5 values: {stat_vals}, "
          f"None count: {none_count}/{len(stat_vals)}")
    
    # Check what happens in compute_distribution_score
    season_vals = [g[stat] for g in qualified if g[stat] is not None]
    print(f"  season_vals count: {len(season_vals)}, "
          f"first 3: {season_vals[:3] if season_vals else 'EMPTY'}")
    
    if len(season_vals) >= 3:
        total_stat    = sum(season_vals)
        total_minutes = sum(g["minutes"] for g in qualified if g[stat] is not None)
        season_rate   = total_stat / total_minutes
        recent10      = qualified[:10]
        recent_stat   = sum(g[stat] for g in recent10 if g[stat] is not None)
        recent_mins   = sum(g["minutes"] for g in recent10 if g[stat] is not None)
        recent_rate   = recent_stat / recent_mins if recent_mins > 0 else season_rate
        shrunk_rate   = season_rate * 0.65 + recent_rate * 0.35
        projected_min = sum(g["minutes"] for g in qualified[:10]) / min(10, len(qualified))
        predicted_mean = shrunk_rate * projected_min
        
        import math
        sigma = max(1.0, predicted_mean * 0.35)
        z = (line + 0.5 - predicted_mean) / (sigma * math.sqrt(2))
        prob_over = 1 - 0.5 * (1 + math.erf(z))
        
        print(f"  season_rate={season_rate:.3f} recent_rate={recent_rate:.3f} "
              f"shrunk={shrunk_rate:.3f}")
        print(f"  projected_min={projected_min:.1f} predicted_mean={predicted_mean:.1f} "
              f"P(over {line})={prob_over*100:.1f}%")
    print()

