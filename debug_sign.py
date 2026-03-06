"""Diagnose the sign flip / consistency bug."""
import sys, math
sys.path.insert(0, '.')
from src.etl.db import get_conn, init_pool
import json

init_pool()

PP = 57.7

def ncdf(x, mu, s):
    if s <= 0: return 0.5
    z = (x - mu) / (s * math.sqrt(2))
    return 0.5 * (1 + math.erf(z))

# Pull today's props for specific players flagged in feedback
test_players = ['Bam Adebayo', 'Derik Queen', "De'Aaron Fox", 'Devin Vassell']

with get_conn() as conn:
    with conn.cursor() as cur:
        for player in test_players:
            cur.execute("""
                SELECT player_name, stat, line, odds_type,
                       avg_last10, hit_rate_last10, hit_rate_last5,
                       composite_score, score_label, model_details
                FROM prop_board
                WHERE player_name = %s AND game_date >= '2026-03-05'
                ORDER BY stat
            """, (player,))
            rows = cur.fetchall()
            cols = ['player','stat','line','odds_type','avg_l10','hr_l10','hr_l5',
                    'score','label','model_details']
            for r in rows:
                d = dict(zip(cols, r))
                md = d['model_details'] if isinstance(d['model_details'], dict) else (json.loads(d['model_details']) if d['model_details'] else {})
                edge = (d['score'] or 0) - PP
                pick = 'OVER' if edge > 0 else 'UNDER'
                p_over = md.get('prob_over_raw', '?')
                mean   = md.get('predicted_mean', '?')
                
                print(f"\n{d['player']} {d['stat']} line={d['line']}")
                print(f"  avg_l10={d['avg_l10']}  hr_l10={d['hr_l10']}%  hr_l5={d['hr_l5']}%")
                print(f"  predicted_mean={mean}  p_over_raw={p_over}%")
                print(f"  composite_score={d['score']}  edge={edge:.1f}  pick={pick}")
                print(f"  label={d['label']}")
                
                # Flag the inconsistency
                if d['avg_l10'] and d['avg_l10'] > d['line'] and pick == 'UNDER':
                    print(f"  *** BUG: avg {d['avg_l10']} > line {d['line']} but pick is UNDER ***")
                if d['avg_l10'] and d['avg_l10'] < d['line'] and pick == 'OVER':
                    print(f"  *** BUG: avg {d['avg_l10']} < line {d['line']} but pick is OVER ***")
