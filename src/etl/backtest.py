"""
Walk-Forward Backtest — simulates exactly how the model would have performed.

Rules (PDF section 11):
  - Time-based split only (never random)
  - Only props that were available that day
  - The multiplier rules that applied
  - Entry construction constraints
  - No cherry-picking after outcomes known

Output:
  - ROI and profit curve
  - Hit rate vs confidence bucket
  - Calibration curve
  - Biggest drawdown
  - Sensitivity to thresholds

Run: python -m src.etl.backtest
"""

import sys, json, math
from datetime import datetime, timezone, timedelta
from pathlib import Path
from collections import defaultdict

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from src.etl.db import get_conn, init_pool

# Flex payout schedule
FLEX_SCHEDULE = {
    2: {2: 3.0,  1: 0,    0: 0},
    3: {3: 2.25, 2: 1.25, 1: 0,   0: 0},
    4: {4: 5.0,  3: 1.5,  2: 0,   1: 0, 0: 0},
    5: {5: 10.0, 4: 2.0,  3: 0.4, 2: 0, 1: 0, 0: 0},
    6: {6: 25.0, 5: 2.0,  4: 0.4, 3: 0, 2: 0, 1: 0, 0: 0},
}

POWER_MULTIPLIERS = {2: 3, 3: 5, 4: 10, 5: 20, 6: 25}
POWER_BREAKEVEN   = {2: 57.7, 3: 58.5, 4: 56.2, 5: 54.9, 6: 58.5}

def sigmoid(x):
    return 1.0 / (1.0 + math.exp(-max(-500, min(500, x))))

def poisson_binomial_dp(probs):
    dp = [1.0]
    for p in probs:
        new_dp = [0.0] * (len(dp) + 1)
        for k, val in enumerate(dp):
            new_dp[k]     += val * (1 - p)
            new_dp[k + 1] += val * p
        dp = new_dp
    return dp

def ev_flex(probs, entry=10):
    n = len(probs)
    sched = FLEX_SCHEDULE.get(n, {})
    dp = poisson_binomial_dp(probs)
    ev = sum((sched.get(k, 0) * entry * dp[k]) for k in range(n+1)) - entry
    return ev

def ev_power(probs, entry=10, corr_penalty=1.0):
    n    = probs.length if hasattr(probs, 'length') else len(probs)
    M    = POWER_MULTIPLIERS.get(n, 0)
    p_win = math.prod(probs) * corr_penalty
    return M * p_win * entry - entry

def run():
    init_pool()

    # Load all outcomes ordered by date
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    r.game_date, r.player_name, r.stat, r.odds_type,
                    r.line, r.actual_value, r.hit, r.composite_score,
                    r.score_label, r.edge, r.pick_side, r.correct
                FROM prop_results r
                WHERE r.composite_score IS NOT NULL
                  AND r.hit IS NOT NULL
                  AND r.correct IS NOT NULL
                ORDER BY r.game_date ASC
            """)
            rows = cur.fetchall()

    if not rows:
        print("No outcome data found. Run outcome_checker.py first.")
        return

    print(f"\n{'='*60}")
    print(f"WALK-FORWARD BACKTEST — {len(rows)} picks")
    print(f"{'='*60}\n")

    # -------------------------------------------------------------------------
    # 1. Single-leg performance by score bucket
    # -------------------------------------------------------------------------
    print("── SINGLE LEG ACCURACY BY SCORE BUCKET ──")
    print(f"{'Bucket':<22} {'n':>5} {'Hit%':>7} {'vs BE':>8} {'Profitable?':>12}")
    print("-" * 57)

    buckets = [
        ("Strong Over (67.7+)",    67.7,  95,   'over'),
        ("Lean Over (61.7-67.7)",  61.7,  67.7, 'over'),
        ("Toss-up (53.7-61.7)",    53.7,  61.7, 'any'),
        ("Lean Under (47.7-53.7)", 47.7,  53.7, 'under'),
        ("Strong Under (<47.7)",   0,     47.7, 'under'),
    ]

    for label, lo, hi, side in buckets:
        bucket = [r for r in rows if lo <= r[7] < hi]
        if not bucket: continue
        correct = sum(1 for r in bucket if r[11])
        hit_pct = correct / len(bucket) * 100
        be      = 57.7
        vs_be   = hit_pct - be
        flag    = "✓ YES" if vs_be > 2 else "✗ NO" if vs_be < -2 else "~ BREAK-EVEN"
        print(f"{label:<22} {len(bucket):>5} {hit_pct:>6.1f}% {vs_be:>+7.1f}% {flag:>12}")

    # -------------------------------------------------------------------------
    # 2. Per-stat performance
    # -------------------------------------------------------------------------
    print(f"\n── ACCURACY BY STAT ──")
    print(f"{'Stat':<8} {'n':>5} {'Hit%':>7} {'vs BE':>8}")
    print("-" * 30)
    for stat in ['pts','reb','ast','fg3m','stl','blk']:
        stat_rows = [r for r in rows if r[2] == stat]
        if not stat_rows: continue
        correct = sum(1 for r in stat_rows if r[11])
        hit_pct = correct / len(stat_rows) * 100
        print(f"{stat:<8} {len(stat_rows):>5} {hit_pct:>6.1f}% {hit_pct-57.7:>+7.1f}%")

    # -------------------------------------------------------------------------
    # 3. Simulated 2-pick Power Play (top 2 picks per day, flex entry)
    # -------------------------------------------------------------------------
    print(f"\n── SIMULATED 2-PICK FLEX ENTRIES (top 2 by score per day) ──")

    by_date = defaultdict(list)
    for r in rows:
        by_date[r[0]].append(r)

    total_entry  = 0
    total_return = 0
    wins         = 0
    partial_wins = 0
    losses       = 0
    profit_curve = []
    running_pnl  = 0
    max_drawdown = 0
    peak         = 0

    ENTRY = 10.0

    for date in sorted(by_date.keys()):
        day_rows = sorted(by_date[date], key=lambda r: -r[7])  # sort by score desc
        # Take top 2 strong overs
        top = [r for r in day_rows if r[7] >= 61.7 and r[10] == 'over'][:2]
        if len(top) < 2:
            continue

        hits = sum(1 for r in top if r[6])
        payout_mult = FLEX_SCHEDULE[2].get(hits, 0)
        payout = payout_mult * ENTRY
        pnl    = payout - ENTRY

        total_entry  += ENTRY
        total_return += payout
        running_pnl  += pnl

        if hits == 2:   wins += 1
        elif hits == 1: partial_wins += 1
        else:           losses += 1

        # Track drawdown
        if running_pnl > peak:
            peak = running_pnl
        dd = peak - running_pnl
        if dd > max_drawdown:
            max_drawdown = dd

        profit_curve.append((str(date), round(running_pnl, 2)))

    if total_entry > 0:
        roi = (total_return / total_entry - 1) * 100
        total_entries = wins + partial_wins + losses
        print(f"  Entries simulated:  {total_entries}")
        print(f"  Both correct:       {wins} ({wins/total_entries*100:.1f}%)")
        print(f"  1/2 correct:        {partial_wins} ({partial_wins/total_entries*100:.1f}%)")
        print(f"  0/2 correct:        {losses} ({losses/total_entries*100:.1f}%)")
        print(f"  Total wagered:      ${total_entry:.2f}")
        print(f"  Total returned:     ${total_return:.2f}")
        print(f"  Net P&L:            ${total_return-total_entry:+.2f}")
        print(f"  ROI:                {roi:+.1f}%")
        print(f"  Max drawdown:       ${max_drawdown:.2f}")

    # -------------------------------------------------------------------------
    # 4. Calibration curve
    # -------------------------------------------------------------------------
    print(f"\n── CALIBRATION CURVE ──")
    print(f"{'Score range':<18} {'n':>5} {'Actual hit%':>12} {'Expected%':>12} {'Calibrated?':>12}")
    print("-" * 62)
    cal_buckets = [(50,55),(55,60),(60,65),(65,70),(70,75),(75,80),(80,95)]
    for lo, hi in cal_buckets:
        b = [r for r in rows if lo <= r[7] < hi]
        if len(b) < 5: continue
        actual_hit = sum(1 for r in b if r[6]) / len(b) * 100
        expected   = (lo + hi) / 2
        diff       = actual_hit - expected
        flag       = "✓ good" if abs(diff) < 5 else "⚠ off" if abs(diff) < 10 else "✗ bad"
        print(f"{lo}-{hi:<12}       {len(b):>5} {actual_hit:>10.1f}% {expected:>11.0f}% {flag:>12}")

    # -------------------------------------------------------------------------
    # 5. EV threshold sensitivity
    # -------------------------------------------------------------------------
    print(f"\n── EV THRESHOLD SENSITIVITY ──")
    print(f"{'Min score':<12} {'Picks':>6} {'Accuracy':>10} {'vs 57.7%':>10}")
    print("-" * 42)
    for threshold in [57.7, 61.7, 65.0, 67.7, 70.0]:
        subset = [r for r in rows if r[7] >= threshold and r[10] == 'over']
        if not subset: continue
        acc = sum(1 for r in subset if r[11]) / len(subset) * 100
        print(f"{threshold:<12} {len(subset):>6} {acc:>9.1f}% {acc-57.7:>+9.1f}%")

    print(f"\n{'='*60}")
    print("Tip: If Strong Over accuracy is 64%+ consistently, the model has real edge.")
    print("Run calibrate_model.py to update Platt coefficients with latest data.")
    print(f"{'='*60}\n")

if __name__ == "__main__":
    run()
