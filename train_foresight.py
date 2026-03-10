#!/usr/bin/env python3
"""
ml/train_foresight.py

Trains per-part GBM (LightGBM) failure probability models using
accumulated sensor_readings from PostgreSQL.

Models trained (one binary classifier per part):
  - coolant_system   (coolant_temp, coolant_pressure)
  - oil_system       (lub_oil_temp, lub_oil_pressure)
  - battery          (battery_voltage)
  - fuel_system      (fuel_pressure)
  - engine_stress    (engine_rpm, temp_difference, throttle_position)

Output:
  models/foresight_<part>.pkl    — trained LightGBM binary classifier
  models/feature_names.json      — ordered feature list for inference
  models/training_report.json    — accuracy, ROC-AUC per model

Usage:
  python train_foresight.py              # train all parts
  python train_foresight.py --part oil   # retrain one part
"""

import os
import sys
import json
import pickle
import argparse
import numpy as np
import pandas as pd
from pathlib import Path
from datetime import datetime

from sqlalchemy import create_engine, text
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, classification_report
from sklearn.preprocessing import LabelEncoder
import lightgbm as lgb

DATABASE_URL = os.environ.get("DATABASE_URL")
MODEL_DIR    = Path(__file__).parent / "models"
MODEL_DIR.mkdir(exist_ok=True)

engine = create_engine(DATABASE_URL)

# ── Part → sensor mapping ─────────────────────────────────────────────────────
# Each part uses a subset of engineered features as its primary signal
PART_FEATURE_GROUPS = {
    "coolant_system": [
        "coolant_temp_mean_1h", "coolant_temp_max_1h", "coolant_temp_slope_1h",
        "coolant_temp_std_24h", "coolant_pressure_mean_1h", "temp_difference_latest",
    ],
    "oil_system": [
        "lub_oil_temp_mean_1h", "lub_oil_temp_max_1h", "lub_oil_temp_slope_1h",
        "lub_oil_pressure_mean_1h", "lub_oil_pressure_std_1h",
    ],
    "battery": [
        "battery_voltage_mean_1h", "battery_voltage_min_1h",
        "battery_voltage_slope_1h", "battery_voltage_std_24h",
    ],
    "fuel_system": [
        "fuel_pressure_mean_1h", "fuel_pressure_std_1h",
        "fuel_pressure_slope_1h", "fuel_pressure_min_1h",
    ],
    "engine_stress": [
        "engine_rpm_mean_1h", "engine_rpm_max_1h", "engine_rpm_std_1h",
        "throttle_position_mean_1h", "temp_difference_latest",
        "coolant_temp_mean_1h", "engine_rpm_slope_1h",
    ],
}

# LightGBM hyperparameters (conservative, good for small datasets)
LGB_PARAMS = {
    "objective":        "binary",
    "metric":           "auc",
    "n_estimators":     200,
    "learning_rate":    0.05,
    "max_depth":        4,
    "num_leaves":       15,
    "min_child_samples": 20,
    "subsample":        0.8,
    "colsample_bytree": 0.8,
    "class_weight":     "balanced",  # handles imbalanced failure labels
    "random_state":     42,
    "verbose":          -1,
}


def load_training_data() -> pd.DataFrame:
    """
    Load engineered features + labels from Postgres.
    Expects a `foresight_training_data` view or table that joins
    sensor_readings with maintenance/failure events.

    For initial training with mock data, generates synthetic labels
    using rule-based heuristics (high coolant temp → coolant failure, etc.)
    until real failure history accumulates.
    """
    sql = text("""
        SELECT *
        FROM foresight_training_features
        ORDER BY vehicle_id, window_start
    """)
    try:
        with engine.connect() as conn:
            df = pd.read_sql(sql, conn)
        print(f"[Train] Loaded {len(df)} training rows from DB")
        return df
    except Exception:
        print("[Train] foresight_training_features not found — generating synthetic data")
        return generate_synthetic_training_data()


def generate_synthetic_training_data(n_samples: int = 5000) -> pd.DataFrame:
    """
    Generates synthetic training data using domain-based rules.
    Used for bootstrapping before real failure history exists.
    Mirrors the iDharshan repo's training approach.
    """
    np.random.seed(42)
    n = n_samples

    df = pd.DataFrame({
        # Normal operating ranges with occasional anomalies
        "coolant_temp_mean_1h":       np.random.normal(90, 10, n).clip(60, 130),
        "coolant_temp_max_1h":        np.random.normal(95, 12, n).clip(60, 135),
        "coolant_temp_slope_1h":      np.random.normal(0, 0.5, n),
        "coolant_temp_std_24h":       np.random.exponential(5, n),
        "coolant_pressure_mean_1h":   np.random.normal(100, 20, n).clip(0, 300),
        "lub_oil_temp_mean_1h":       np.random.normal(100, 12, n).clip(60, 150),
        "lub_oil_temp_max_1h":        np.random.normal(108, 14, n).clip(60, 155),
        "lub_oil_temp_slope_1h":      np.random.normal(0, 0.4, n),
        "lub_oil_pressure_mean_1h":   np.random.normal(300, 50, n).clip(50, 700),
        "lub_oil_pressure_std_1h":    np.random.exponential(20, n),
        "battery_voltage_mean_1h":    np.random.normal(14.2, 0.4, n).clip(9, 16),
        "battery_voltage_min_1h":     np.random.normal(13.8, 0.5, n).clip(9, 16),
        "battery_voltage_slope_1h":   np.random.normal(0, 0.05, n),
        "battery_voltage_std_24h":    np.random.exponential(0.2, n),
        "fuel_pressure_mean_1h":      np.random.normal(50, 10, n).clip(0, 100),
        "fuel_pressure_std_1h":       np.random.exponential(3, n),
        "fuel_pressure_slope_1h":     np.random.normal(0, 0.3, n),
        "fuel_pressure_min_1h":       np.random.normal(45, 12, n).clip(0, 100),
        "engine_rpm_mean_1h":         np.random.normal(1800, 600, n).clip(600, 6000),
        "engine_rpm_max_1h":          np.random.normal(3000, 800, n).clip(800, 7000),
        "engine_rpm_std_1h":          np.random.exponential(300, n),
        "engine_rpm_slope_1h":        np.random.normal(0, 10, n),
        "throttle_position_mean_1h":  np.random.normal(20, 15, n).clip(0, 100),
        "temp_difference_latest":     np.random.normal(55, 10, n).clip(10, 100),
    })

    # Synthetic failure labels based on domain rules
    df["label_coolant_system"] = (
        (df["coolant_temp_max_1h"] > 115) |
        (df["coolant_pressure_mean_1h"] < 30) |
        (df["temp_difference_latest"] > 80)
    ).astype(int)

    df["label_oil_system"] = (
        (df["lub_oil_temp_max_1h"] > 130) |
        (df["lub_oil_pressure_mean_1h"] < 100)
    ).astype(int)

    df["label_battery"] = (
        (df["battery_voltage_min_1h"] < 11.5) |
        (df["battery_voltage_slope_1h"] < -0.1)
    ).astype(int)

    df["label_fuel_system"] = (
        (df["fuel_pressure_min_1h"] < 20) |
        (df["fuel_pressure_std_1h"] > 15)
    ).astype(int)

    df["label_engine_stress"] = (
        (df["engine_rpm_max_1h"] > 5500) |
        (df["coolant_temp_mean_1h"] > 108) |
        (df["engine_rpm_std_1h"] > 1000)
    ).astype(int)

    print(f"[Train] Synthetic data: {len(df)} samples")
    for part in PART_FEATURE_GROUPS:
        label_col = f"label_{part}"
        pos = df[label_col].sum()
        print(f"  {part}: {pos} positive / {len(df) - pos} negative")

    return df


def train_part_model(part: str, df: pd.DataFrame) -> dict:
    """Train a LightGBM binary classifier for one part."""
    feature_cols = PART_FEATURE_GROUPS[part]
    label_col    = f"label_{part}"

    X = df[feature_cols].fillna(df[feature_cols].median())
    y = df[label_col]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    model = lgb.LGBMClassifier(**LGB_PARAMS)
    model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        callbacks=[lgb.early_stopping(20, verbose=False), lgb.log_evaluation(period=-1)],
    )

    y_prob  = model.predict_proba(X_test)[:, 1]
    roc_auc = roc_auc_score(y_test, y_prob)
    report  = classification_report(y_test, model.predict(X_test), output_dict=True)

    print(f"  [{part}] ROC-AUC: {roc_auc:.4f} | F1: {report['1']['f1-score']:.4f}")

    # Save model
    model_path = MODEL_DIR / f"foresight_{part}.pkl"
    with open(model_path, "wb") as f:
        pickle.dump({"model": model, "features": feature_cols, "part": part}, f)

    return {
        "part":        part,
        "roc_auc":     round(roc_auc, 4),
        "f1":          round(report["1"]["f1-score"], 4),
        "n_train":     len(X_train),
        "n_test":      len(X_test),
        "model_path":  str(model_path),
        "trained_at":  datetime.utcnow().isoformat(),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--part", help="Train a single part model", default=None)
    args = parser.parse_args()

    print("[Foresight] Loading training data...")
    df = load_training_data()

    parts = [args.part] if args.part else list(PART_FEATURE_GROUPS.keys())
    print(f"[Foresight] Training models for: {parts}")

    report = []
    for part in parts:
        print(f"\n[Train] → {part}")
        result = train_part_model(part, df)
        report.append(result)

    # Save feature names for inference
    feature_names = {part: PART_FEATURE_GROUPS[part] for part in PART_FEATURE_GROUPS}
    with open(MODEL_DIR / "feature_names.json", "w") as f:
        json.dump(feature_names, f, indent=2)

    # Save training report
    with open(MODEL_DIR / "training_report.json", "w") as f:
        json.dump(report, f, indent=2)

    print(f"\n[Foresight] Training complete. Models saved to {MODEL_DIR}")
    for r in report:
        print(f"  {r['part']:20s} ROC-AUC: {r['roc_auc']}  F1: {r['f1']}")


if __name__ == "__main__":
    main()
