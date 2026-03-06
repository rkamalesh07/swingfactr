"""Check if our std estimates are realistic vs actual game variance."""
import sys, math
sys.path.insert(0, '.')
from src.etl.db import get_conn, init_pool

init_pool()

players = [
    ('LaMelo Ball',   'CHA', 'pts'),
    ('Devin Booker',  'PHX', 'pts'),
    ('Devin Booker',  'PHX', 'reb'),
    ('Stephen Curry', 'GSW', 'fg3m'),
    ('Nikola Jokic',  'DEN', 'pts'),
]

with get_conn() as conn:
    with conn.cursor() as cur:
        for player, team, stat in players:
            cur.execute("""
                SELECT minutes, pts, reb, ast, stl, blk, fg3m
                FROM player_game_logs
                WHERE player_name = %s AND season_id = '2025-26'
                  AND minutes >= 10
                ORDER BY game_date DESC LIMIT 20
            """, (player,))
            rows = cur.fetchall()
            if not rows:
                print(f"{player}: no data")
                continue

            cols = ['minutes','pts','reb','ast','stl','blk','fg3m']
            logs = [dict(zip(cols, r)) for r in rows]
            
            vals = [g[stat] for g in logs if g[stat] is not None]
            mins = [g['minutes'] for g in logs]
            
            if len(vals) < 3:
                print(f"{player} {stat}: insufficient data")
                continue

            mean_v = sum(vals) / len(vals)
            std_v  = math.sqrt(sum((v-mean_v)**2 for v in vals) / (len(vals)-1))
            cv     = std_v / mean_v if mean_v > 0 else 0
            
            mean_m = sum(mins) / len(mins)
            std_m  = math.sqrt(sum((m-mean_m)**2 for m in mins) / (len(mins)-1))
            
            # Per-minute rate std
            rates = [g[stat]/g['minutes'] for g in logs if g[stat] is not None and g['minutes'] > 0]
            mean_r = sum(rates)/len(rates)
            std_r  = math.sqrt(sum((r-mean_r)**2 for r in rates)/(len(rates)-1))
            
            print(f"\n{player} {stat} (n={len(vals)}):")
            print(f"  values: {vals[:8]}")
            print(f"  mean={mean_v:.1f}  std={std_v:.1f}  CV={cv:.0%}")
            print(f"  minutes: mean={mean_m:.1f}  std={std_m:.1f}")
            print(f"  rate/min: mean={mean_r:.3f}  std={std_r:.3f}  CV={std_r/mean_r:.0%}")
            print(f"  fallback_std_formula = max(4, mean*0.28) = {max(4.0, mean_v*0.28):.1f}")
            print(f"  actual_std = {std_v:.1f}  {'← USE THIS' if abs(std_v - max(4.0, mean_v*0.28)) > 1 else ''}")
