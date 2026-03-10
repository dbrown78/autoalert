#!/usr/bin/env python3
"""
ml/stratified_sampler.py

Handles class imbalance in Fleet tier training data.
Failure events are rare vs. normal readings — without balancing,
the model learns to always predict "normal" and still scores high accuracy.

Mirrors the AWS fleet repo's stratified_sampler.py approach, adapted for
scikit-learn / LightGBM (no PyTorch dependency required).

Three strategies available:
  1. StratifiedKFold          — for cross-validation (already in hpo_trainer.py)
  2. SMOTE oversampling        — synthesizes minority class samples
  3. Undersampling + weights   — downsamples majority + uses class_weight='balanced'

Usage:
  from stratified_sampler import prepare_balanced_dataset
  X_train, y_train = prepare_balanced_dataset(X, y, strategy='smote')
"""

import numpy as np
import pandas as pd
from collections import Counter

# ── Strategy 1: SMOTE (preferred for small datasets) ──────────────────────────

def smote_oversample(X: np.ndarray, y: np.ndarray, random_state: int = 42):
    """
    Synthetic Minority Over-sampling Technique.
    Generates synthetic failure samples by interpolating between existing ones.
    Good when failure events are < 10% of dataset.
    """
    try:
        from imblearn.over_sampling import SMOTE
    except ImportError:
        raise ImportError("pip install imbalanced-learn")

    counts = Counter(y)
    print(f"[Sampler] Before SMOTE: {dict(counts)}")

    sm  = SMOTE(random_state=random_state, k_neighbors=min(5, counts[1] - 1))
    X_res, y_res = sm.fit_resample(X, y)

    print(f"[Sampler] After SMOTE:  {dict(Counter(y_res))}")
    return X_res, y_res


# ── Strategy 2: Random undersampling ─────────────────────────────────────────

def undersample_majority(X: np.ndarray, y: np.ndarray,
                         ratio: float = 3.0, random_state: int = 42):
    """
    Randomly undersamples the majority class to ratio:1 majority:minority.
    ratio=3.0 means 3 normal readings per failure reading.
    Faster than SMOTE, good when dataset is large.
    """
    rng = np.random.default_rng(random_state)
    minority_idx = np.where(y == 1)[0]
    majority_idx = np.where(y == 0)[0]

    n_minority = len(minority_idx)
    n_majority_target = int(n_minority * ratio)

    if n_majority_target >= len(majority_idx):
        print(f"[Sampler] No undersampling needed (ratio already within target)")
        return X, y

    sampled_majority = rng.choice(majority_idx, size=n_majority_target, replace=False)
    selected_idx = np.concatenate([minority_idx, sampled_majority])
    rng.shuffle(selected_idx)

    print(f"[Sampler] Undersampled: {n_minority} failures, {n_majority_target} normal ({ratio}:1 ratio)")
    return X[selected_idx], y[selected_idx]


# ── Strategy 3: Class weights (simplest, no resampling) ──────────────────────

def compute_class_weights(y: np.ndarray) -> dict:
    """
    Compute balanced class weights for LightGBM.
    Use with LGBMClassifier(class_weight=weights) or scale_pos_weight.
    """
    counts    = Counter(y)
    total     = len(y)
    n_classes = len(counts)
    weights   = {cls: total / (n_classes * count) for cls, count in counts.items()}
    print(f"[Sampler] Class weights: {weights}")
    return weights


def compute_scale_pos_weight(y: np.ndarray) -> float:
    """
    LightGBM-specific: scale_pos_weight = n_negative / n_positive
    Use when failure rate < 5%.
    """
    counts = Counter(y)
    ratio = counts[0] / max(counts[1], 1)
    print(f"[Sampler] scale_pos_weight: {ratio:.2f} ({counts[0]} normal / {counts[1]} failures)")
    return ratio


# ── Main entry point ──────────────────────────────────────────────────────────

def prepare_balanced_dataset(
    X: np.ndarray,
    y: np.ndarray,
    strategy: str = "auto",
    random_state: int = 42,
):
    """
    Selects and applies the best balancing strategy based on dataset characteristics.

    strategy options:
      'auto'        — picks best strategy automatically
      'smote'       — SMOTE oversampling
      'undersample' — random undersampling
      'weights'     — returns unmodified X, y (use class_weight in model)

    Returns: (X_balanced, y_balanced, extra_params)
      extra_params: dict of additional kwargs to pass to LGBMClassifier
    """
    counts = Counter(y)
    n_minority = counts.get(1, 0)
    n_majority = counts.get(0, 0)
    imbalance_ratio = n_majority / max(n_minority, 1)

    print(f"[Sampler] Dataset: {n_majority} normal, {n_minority} failures (ratio {imbalance_ratio:.1f}:1)")

    if strategy == "auto":
        if n_minority < 10:
            print("[Sampler] Too few failure samples — using class weights only")
            strategy = "weights"
        elif imbalance_ratio > 20:
            print("[Sampler] High imbalance — using SMOTE")
            strategy = "smote"
        elif imbalance_ratio > 5:
            print("[Sampler] Moderate imbalance — using undersampling")
            strategy = "undersample"
        else:
            print("[Sampler] Mild imbalance — using class weights")
            strategy = "weights"

    if strategy == "smote":
        X_out, y_out = smote_oversample(X, y, random_state)
        return X_out, y_out, {}

    elif strategy == "undersample":
        X_out, y_out = undersample_majority(X, y, ratio=3.0, random_state=random_state)
        scale_weight = compute_scale_pos_weight(y_out)
        return X_out, y_out, {"scale_pos_weight": scale_weight}

    else:  # weights
        weights = compute_class_weights(y)
        return X, y, {"class_weight": "balanced"}


# ── Fleet training data loader ────────────────────────────────────────────────

def load_fleet_training_data(fleet_id: int, db_engine) -> pd.DataFrame:
    """
    Loads sensor history + failure labels for all vehicles in a fleet.
    Fleet tier only — includes cross-vehicle patterns for more robust training.
    """
    sql = f"""
        SELECT sr.vehicle_id, sr.sensor_type, sr.value::float, sr.recorded_at,
               v.make, v.model, v.year
        FROM sensor_readings sr
        JOIN vehicles v ON v.id = sr.vehicle_id
        JOIN fleet_vehicles fv ON fv.vehicle_id = sr.vehicle_id
        WHERE fv.fleet_id = {fleet_id}
          AND sr.quality >= 1
          AND sr.recorded_at > NOW() - INTERVAL '90 days'
        ORDER BY sr.vehicle_id, sr.recorded_at
    """
    import pandas as pd
    return pd.read_sql(sql, db_engine)


if __name__ == "__main__":
    # Quick test
    np.random.seed(42)
    y_test = np.array([0] * 950 + [1] * 50)
    X_test = np.random.randn(1000, 10)
    X_bal, y_bal, extra = prepare_balanced_dataset(X_test, y_test, strategy="auto")
    print(f"Output shape: {X_bal.shape}, label dist: {Counter(y_bal)}")
    print(f"Extra model params: {extra}")
