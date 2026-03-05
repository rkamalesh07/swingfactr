"""
Model Calibration Script — fits Platt scaling (logistic regression) on outcome data.

Reads prop_results table → fits sigmoid(a * raw_score + b) → stores coefficients
in model_calibration table → used by props_board.py to output calibrated probabilities.

Walk-forward validation: trains on all data before last 7 days, validates on last 7 days.

Run: python -m src.etl.calibrate_model
Run after every 2 weeks of new data for best results.
"""

import sys, logging, json
import numpy as np
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from src.etl.db import get_conn, init_pool

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")
logger = logging.getLogger("calibrate")

# ---------------------------------------------------------------------------
# Sigmoid / logistic helpers (no sklearn dependency in production)
# ---------------------------------------------------------------------------

def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-np.clip(x, -500, 500)))

def log_loss(y_true, y_pred):
    y_pred = np.clip(y_pred, 1e-7, 1 - 1e-7)
    return -np.mean(y_true * np.log(y_pred) + (1 - y_true) * np.log(1 - y_pred))

def brier_score(y_true, y_pred):
    return np.mean((y_pred - y_true) ** 2)

def fit_platt_scaling(scores, labels, lr=0.01, n_iter=2000):
    """
    Fit p = sigmoid(a * score + b) via gradient descent.
    scores: raw composite scores (0-100)
    labels: 1 if hit, 0 if miss
    Returns: (a, b)
    """
    scores = np.array(scores, dtype=float)
    labels = np.array(labels, dtype=float)

    # Normalize scores to ~[-3, 3] for numerical stability
    score_mean = scores.mean()
    score_std  = scores.std() + 1e-8
    x = (scores - score_mean) / score_std

    a = np.float64(1.0)
    b = np.float64(0.0)

    for i in range(n_iter):
        p    = sigmoid(a * x + b)
        err  = p - labels
        grad_a = np.mean(err * x)
        grad_b = np.mean(err)

        # Adaptive learning rate
        step = lr * (0.995 ** (i // 100))
        a -= step * grad_a
        b -= step * grad_b

        if i % 500 == 0:
            loss = log_loss(labels, p)
            logger.debug(f"  iter {i}: loss={loss:.4f} a={a:.4f} b={b:.4f}")

    # Convert back to original scale: sigmoid(a_orig * score + b_orig)
    # p = sigmoid(a * (score - mean)/std + b) = sigmoid(a/std * score - a*mean/std + b)
    a_orig = a / score_std
    b_orig = b - a * score_mean / score_std
    return float(a_orig), float(b_orig)

def calibrate_score(score, a, b):
    """Convert raw composite score to calibrated probability (0-1)."""
    return float(sigmoid(a * score + b))

# ---------------------------------------------------------------------------
# DB setup
# ---------------------------------------------------------------------------

def ensure_table():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS model_calibration (
                    cal_id       SERIAL PRIMARY KEY,
                    stat         VARCHAR(20) NOT NULL,  -- 'all' or specific stat
                    a            FLOAT NOT NULL,         -- Platt slope
                    b            FLOAT NOT NULL,         -- Platt intercept
                    n_train      INTEGER,
                    n_val        INTEGER,
                    train_logloss FLOAT,
                    val_logloss   FLOAT,
                    train_brier   FLOAT,
                    val_brier     FLOAT,
                    val_accuracy  FLOAT,
                    fitted_at    TIMESTAMPTZ DEFAULT NOW()
                )
            """)

# ---------------------------------------------------------------------------
# Load outcome data
# ---------------------------------------------------------------------------

def load_outcomes():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT game_date, stat, composite_score, hit, correct, pick_side, odds_type
                FROM prop_results
                WHERE composite_score IS NOT NULL
                  AND hit IS NOT NULL
                ORDER BY game_date ASC
            """)
            rows = cur.fetchall()

    data = []
    for game_date, stat, score, hit, correct, pick_side, odds_type in rows:
        # Label = 1 if the over hit (consistent with model direction)
        data.append({
            "date":      game_date,
            "stat":      stat,
            "score":     float(score),
            "hit":       int(hit),       # 1 if actual > line
            "correct":   int(correct),   # 1 if our pick was right
            "pick_side": pick_side,
            "odds_type": odds_type,
        })
    return data

# ---------------------------------------------------------------------------
# Main calibration
# ---------------------------------------------------------------------------

def run():
    init_pool()
    ensure_table()

    data = load_outcomes()
    if len(data) < 50:
        logger.warning(f"Only {len(data)} outcomes — need at least 50 to calibrate reliably")
        return

    logger.info(f"Loaded {len(data)} outcomes for calibration")

    # Walk-forward split: last 7 days = validation, rest = training
    pst      = timezone(timedelta(hours=-8))
    cutoff   = (datetime.now(pst) - timedelta(days=7)).date()
    train    = [d for d in data if d["date"] < cutoff]
    val      = [d for d in data if d["date"] >= cutoff]

    logger.info(f"Train: {len(train)} | Val: {len(val)}")

    if len(train) < 30:
        logger.warning("Not enough training data — using all data for calibration")
        train = data
        val   = data

    # ---------------------------------------------------------------------------
    # 1. Global calibration (all stats combined)
    # ---------------------------------------------------------------------------
    logger.info("Fitting global calibration...")

    train_scores = [d["score"] for d in train]
    train_hits   = [d["hit"]   for d in train]
    val_scores   = [d["score"] for d in val]
    val_hits     = [d["hit"]   for d in val]

    a_all, b_all = fit_platt_scaling(train_scores, train_hits)

    train_probs  = [calibrate_score(s, a_all, b_all) for s in train_scores]
    val_probs    = [calibrate_score(s, a_all, b_all) for s in val_scores]

    train_ll  = log_loss(np.array(train_hits), np.array(train_probs))
    val_ll    = log_loss(np.array(val_hits),   np.array(val_probs))
    train_bs  = brier_score(np.array(train_hits), np.array(train_probs))
    val_bs    = brier_score(np.array(val_hits),   np.array(val_probs))
    val_acc   = float(np.mean([(p > 0.5) == h for p, h in zip(val_probs, val_hits)]))

    logger.info(f"Global — a={a_all:.4f} b={b_all:.4f}")
    logger.info(f"  Train log-loss={train_ll:.4f} brier={train_bs:.4f}")
    logger.info(f"  Val   log-loss={val_ll:.4f}   brier={val_bs:.4f} accuracy={val_acc:.3f}")

    def f(x): return float(x)  # force Python float, never np.float64

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM model_calibration WHERE stat = 'all'")
            cur.execute("""
                INSERT INTO model_calibration
                    (stat, a, b, n_train, n_val, train_logloss, val_logloss,
                     train_brier, val_brier, val_accuracy)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, ('all', f(a_all), f(b_all), int(len(train)), int(len(val)),
                  f(train_ll), f(val_ll), f(train_bs), f(val_bs), f(val_acc)))

    # ---------------------------------------------------------------------------
    # 2. Per-stat calibration (only if enough data)
    # ---------------------------------------------------------------------------
    stats = ['pts', 'reb', 'ast', 'fg3m', 'stl', 'blk']
    for stat in stats:
        stat_train = [d for d in train if d["stat"] == stat]
        stat_val   = [d for d in val   if d["stat"] == stat]

        if len(stat_train) < 30:
            logger.info(f"  {stat}: only {len(stat_train)} train rows — skipping per-stat calibration")
            continue

        s_scores = [d["score"] for d in stat_train]
        s_hits   = [d["hit"]   for d in stat_train]
        a_s, b_s = fit_platt_scaling(s_scores, s_hits)

        sv_scores = [d["score"] for d in stat_val] if stat_val else s_scores
        sv_hits   = [d["hit"]   for d in stat_val] if stat_val else s_hits
        sv_probs  = [calibrate_score(sc, a_s, b_s) for sc in sv_scores]
        sv_ll     = log_loss(np.array(sv_hits), np.array(sv_probs))
        sv_bs     = brier_score(np.array(sv_hits), np.array(sv_probs))
        sv_acc    = float(np.mean([(p > 0.5) == h for p, h in zip(sv_probs, sv_hits)]))

        logger.info(f"  {stat}: a={a_s:.4f} b={b_s:.4f} val_ll={sv_ll:.4f} val_acc={sv_acc:.3f}")

        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM model_calibration WHERE stat = %s", (stat,))
                cur.execute("""
                    INSERT INTO model_calibration
                        (stat, a, b, n_train, n_val, train_logloss, val_logloss,
                         train_brier, val_brier, val_accuracy)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """, (stat, float(a_s), float(b_s),
                      int(len(stat_train)), int(len(stat_val)),
                      0.0, float(sv_ll), 0.0, float(sv_bs), float(sv_acc)))

    # ---------------------------------------------------------------------------
    # 3. Calibration curve — log how well the scores are bucketed
    # ---------------------------------------------------------------------------
    logger.info("\nCalibration curve (raw score bucket → actual hit rate):")
    buckets = [(50,55),(55,60),(60,65),(65,70),(70,75),(75,80),(80,95)]
    for lo, hi in buckets:
        bucket = [d for d in data if lo <= d["score"] < hi]
        if bucket:
            hit_rate = sum(d["hit"] for d in bucket) / len(bucket)
            cal_prob = calibrate_score((lo+hi)/2, a_all, b_all)
            logger.info(f"  {lo}-{hi}: n={len(bucket):4d}  hit%={hit_rate*100:.1f}%  calibrated_p={cal_prob*100:.1f}%")

    logger.info("\nCalibration complete. Coefficients stored in model_calibration table.")
    logger.info("Re-run props_board ETL to apply calibrated probabilities to today's props.")

if __name__ == "__main__":
    run()
