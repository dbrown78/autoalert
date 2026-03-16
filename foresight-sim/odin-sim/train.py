"""
models/train.py
Foresight ML trainer. Pulls sim data from PostgreSQL, engineers features,
trains a LightGBM model with Optuna HPO, and saves the trained model.

Usage:
    # Train on sim data with Optuna optimization
    python models/train.py --source sim --optimize --trials 50

    # Train without HPO (fast, uses default params)
    python models/train.py --source sim

    # Evaluate after training
    python models/train.py --source sim --optimize --evaluate
"""

import os
import argparse
import json
import pickle
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import lightgbm as lgb
import optuna
import psycopg2
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, average_precision_score, classification_report
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
MODEL_DIR = Path("models/saved")
MODEL_DIR.mkdir(parents=True, exist_ok=True)

# Sensors used as features — engine first, then TCM and ABS (may be NaN for
# vehicles that don't support those modules; LightGBM handles NaN natively).
FEATURE_SENSORS = [
    # Engine / PCM sensors (standard OBD-II Mode 01)
    "rpm", "coolant_temp", "o2_voltage_b1s1", "o2_voltage_b1s2",
    "maf", "throttle_position", "short_fuel_trim", "long_fuel_trim",
    "intake_air_temp", "vehicle_speed", "battery_voltage", "catalyst_temp",
    # Transmission sensors (TCM — Mode 22 enhanced PIDs)
    "trans_fluid_temp", "slip_rpm", "line_pressure",
    # ABS wheel speed sensors (accessed via ATSH760 / CAN PIDs)
    "wheel_speed_fl", "wheel_speed_fr", "wheel_speed_rl", "wheel_speed_rr",
]

# Rolling window sizes (in samples) for feature engineering
WINDOWS = [10, 60, 300]  # ~10s, 1min, 5min at 1Hz


def add_derived_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute derived cross-sensor features and append them as new columns.
    Operates on the wide-pivoted DataFrame (columns like sensor_mean_val).

    Derived features:
      wheel_speed_delta  — MAX(fl, fr, rl, rr) - MIN(fl, fr, rl, rr);
                           detects per-wheel dropouts or imbalance.
      thermal_delta      — trans_fluid_temp - intake_air_temp;
                           captures abnormal transmission heating vs ambient.
      slip_temp_ratio    — slip_rpm / trans_fluid_temp;
                           normalises slip against fluid temp; high ratio = hot slip.

    Any column absent in df yields NaN for that derived feature so rows with
    partial ABS/TCM support are not dropped.
    """
    df = df.copy()

    # wheel_speed_delta
    ws_cols = [f"wheel_speed_{w}_mean_val" for w in ("fl", "fr", "rl", "rr")]
    present_ws = [c for c in ws_cols if c in df.columns]
    if len(present_ws) == 4:
        df["wheel_speed_delta"] = df[ws_cols].max(axis=1) - df[ws_cols].min(axis=1)
    else:
        df["wheel_speed_delta"] = np.nan

    # thermal_delta
    t_fluid_col  = "trans_fluid_temp_mean_val"
    t_intake_col = "intake_air_temp_mean_val"
    if t_fluid_col in df.columns and t_intake_col in df.columns:
        df["thermal_delta"] = df[t_fluid_col] - df[t_intake_col]
    else:
        df["thermal_delta"] = np.nan

    # slip_temp_ratio — guard div-by-zero: replace 0 temp with NaN before divide
    slip_col = "slip_rpm_mean_val"
    if slip_col in df.columns and t_fluid_col in df.columns:
        denom = df[t_fluid_col].replace(0, np.nan)
        df["slip_temp_ratio"] = df[slip_col] / denom
    else:
        df["slip_temp_ratio"] = np.nan

    return df


def load_training_data(source: str = "sim") -> pd.DataFrame:
    """
    Load sensor readings from PostgreSQL and pivot to wide format.
    Returns a DataFrame with one row per (vehicle_id, day) and
    aggregated sensor statistics as features.

    The sim/real firewall is enforced here: source LIKE %s ensures we never
    mix real user data into sim training (source='sim' matches 'sim' and
    'sim_dtc_PXXXX' but not 'real').
    """
    print(f"Loading {source} data from PostgreSQL...")
    conn = psycopg2.connect(DATABASE_URL)

    # Load sensor readings
    query = """
        SELECT
            sr.vehicle_id,
            sr.day,
            sr.sensor_name,
            AVG(sr.value) as mean_val,
            STDDEV(sr.value) as std_val,
            MIN(sr.value) as min_val,
            MAX(sr.value) as max_val,
            MAX(sr.degradation_factor) as max_degradation,
            BOOL_OR(NOT sr.is_healthy) as has_anomaly
        FROM sensor_readings sr
        WHERE sr.source LIKE %s
        GROUP BY sr.vehicle_id, sr.day, sr.sensor_name
        ORDER BY sr.vehicle_id, sr.day, sr.sensor_name
    """
    df = pd.read_sql(query, conn, params=(f"{source}%",))

    # Load failure event labels
    labels_query = """
        SELECT
            vehicle_id,
            failure_start_day,
            dtc_fire_day,
            failure_mode,
            dtc_code
        FROM sim_failure_events
    """
    labels_df = pd.read_sql(labels_query, conn)
    conn.close()

    if df.empty:
        raise ValueError("No sim data found. Run the pipeline first: python sim/pipeline.py --vehicles 50 --days 90 --random-failures")

    print(f"  Raw rows: {len(df):,}")

    # Pivot to wide format: one row per (vehicle_id, day)
    pivot_dfs = []
    for stat in ["mean_val", "std_val", "min_val", "max_val"]:
        pivoted = df.pivot_table(
            index=["vehicle_id", "day"],
            columns="sensor_name",
            values=stat,
            aggfunc="first",
        )
        pivoted.columns = [f"{col}_{stat}" for col in pivoted.columns]
        pivot_dfs.append(pivoted)

    # Add has_anomaly and max_degradation
    anomaly_pivot = df.groupby(["vehicle_id", "day"])[["has_anomaly", "max_degradation"]].max()
    pivot_dfs.append(anomaly_pivot)

    wide_df = pd.concat(pivot_dfs, axis=1).reset_index()

    # Add derived cross-sensor features before merging labels
    wide_df = add_derived_features(wide_df)

    # Merge failure labels
    wide_df = wide_df.merge(labels_df, on="vehicle_id", how="left")

    # Label: 1 if within the pre-failure prediction window
    wide_df["label"] = 0
    mask = (
        wide_df["dtc_fire_day"].notna() &
        (wide_df["day"] >= wide_df["failure_start_day"]) &
        (wide_df["day"] <= wide_df["dtc_fire_day"])
    )
    wide_df.loc[mask, "label"] = 1

    print(f"  Wide features: {wide_df.shape[1]}")
    print(f"  Positive labels (pre-failure): {wide_df['label'].sum():,}")
    print(f"  Negative labels (healthy): {(wide_df['label'] == 0).sum():,}")

    return wide_df


def build_features(df: pd.DataFrame):
    """
    Extract feature matrix X and label vector y.

    NaN values are preserved — do NOT impute or fill with 0.
    LightGBM learns optimal split directions for NaN during training, so a
    vehicle with no ABS/TCM support (NaN in those columns) will follow the
    learned NaN branch rather than being forced to a zero reading.
    """
    drop_cols = ["vehicle_id", "day", "label", "failure_start_day",
                 "dtc_fire_day", "failure_mode", "dtc_code"]
    feature_cols = [c for c in df.columns if c not in drop_cols]
    # Replace Python None → np.nan; existing np.nan remains; do not zero-fill.
    X = df[feature_cols].replace({None: np.nan})
    y = df["label"]
    return X, y, feature_cols


def train_lightgbm(X_train, y_train, X_val, y_val, params: dict) -> lgb.Booster:
    dtrain = lgb.Dataset(X_train, label=y_train)
    dval = lgb.Dataset(X_val, label=y_val, reference=dtrain)

    callbacks = [
        lgb.early_stopping(stopping_rounds=50, verbose=False),
        lgb.log_evaluation(period=50),
    ]

    model = lgb.train(
        params,
        dtrain,
        num_boost_round=500,
        valid_sets=[dval],
        callbacks=callbacks,
    )
    return model


def optuna_objective(trial, X_train, y_train, X_val, y_val):
    params = {
        "objective": "binary",
        "metric": "auc",
        "verbosity": -1,
        "boosting_type": "gbdt",
        "num_leaves": trial.suggest_int("num_leaves", 20, 200),
        "max_depth": trial.suggest_int("max_depth", 3, 12),
        "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.3, log=True),
        "feature_fraction": trial.suggest_float("feature_fraction", 0.4, 1.0),
        "bagging_fraction": trial.suggest_float("bagging_fraction", 0.4, 1.0),
        "bagging_freq": trial.suggest_int("bagging_freq", 1, 10),
        "min_child_samples": trial.suggest_int("min_child_samples", 5, 100),
        "lambda_l1": trial.suggest_float("lambda_l1", 1e-8, 10.0, log=True),
        "lambda_l2": trial.suggest_float("lambda_l2", 1e-8, 10.0, log=True),
        "scale_pos_weight": trial.suggest_float("scale_pos_weight", 1.0, 10.0),
    }

    model = train_lightgbm(X_train, y_train, X_val, y_val, params)
    preds = model.predict(X_val)
    return roc_auc_score(y_val, preds)


def main():
    parser = argparse.ArgumentParser(description="Foresight ML Trainer")
    parser.add_argument("--source", type=str, default="sim", help="Data source filter (sim | real)")
    parser.add_argument("--optimize", action="store_true", help="Run Optuna HPO")
    parser.add_argument("--trials", type=int, default=30, help="Optuna trial count")
    parser.add_argument("--evaluate", action="store_true", help="Print evaluation report after training")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    # Load data
    df = load_training_data(source=args.source)
    X, y, feature_cols = build_features(df)

    # Failure mode distribution (for model metadata / /model/info)
    failure_counts: dict = {}
    if "failure_mode" in df.columns:
        for mode, grp in df.groupby("failure_mode", dropna=False):
            key = str(mode) if pd.notna(mode) else "healthy"
            failure_counts[key] = {
                "total_rows": int(len(grp)),
                "positive_rows": int(grp["label"].sum()),
            }

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=args.seed, stratify=y
    )
    X_train, X_val, y_train, y_val = train_test_split(
        X_train, y_train, test_size=0.15, random_state=args.seed, stratify=y_train
    )

    print(f"\nTrain: {len(X_train):,} | Val: {len(X_val):,} | Test: {len(X_test):,}")
    print(f"Features: {len(feature_cols)}")

    best_params = {
        "objective": "binary",
        "metric": "auc",
        "verbosity": -1,
        "num_leaves": 64,
        "learning_rate": 0.05,
        "feature_fraction": 0.8,
        "bagging_fraction": 0.8,
        "bagging_freq": 5,
        "scale_pos_weight": 3.0,
    }

    if args.optimize:
        print(f"\nRunning Optuna HPO ({args.trials} trials)...")
        optuna.logging.set_verbosity(optuna.logging.WARNING)
        study = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=args.seed))
        study.optimize(
            lambda trial: optuna_objective(trial, X_train, y_train, X_val, y_val),
            n_trials=args.trials,
        )
        best_params.update(study.best_params)
        print(f"  Best AUC: {study.best_value:.4f}")
        print(f"  Best params: {study.best_params}")

    print("\nTraining final model...")
    model = train_lightgbm(X_train, y_train, X_val, y_val, best_params)

    # Save model
    timestamp = datetime.now().strftime("%Y%m%d_%H%M")
    model_path = MODEL_DIR / f"foresight_{timestamp}.pkl"
    meta_path = MODEL_DIR / f"foresight_{timestamp}_meta.json"

    with open(model_path, "wb") as f:
        pickle.dump(model, f)

    meta = {
        "timestamp": timestamp,
        "source": args.source,
        "features": feature_cols,
        "feature_count": len(feature_cols),
        "params": best_params,
        "optimized": args.optimize,
        "trials": args.trials if args.optimize else 0,
        "failure_modes": sorted(k for k in failure_counts if k != "healthy"),
        "failure_mode_counts": failure_counts,
    }
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    print(f"\n✓ Model saved: {model_path}")
    print(f"✓ Metadata:    {meta_path}")
    print(f"✓ Feature count: {len(feature_cols)}")
    print(f"✓ Failure modes: {meta['failure_modes']}")

    if args.evaluate:
        preds = model.predict(X_test)
        preds_binary = (preds >= 0.5).astype(int)
        auc = roc_auc_score(y_test, preds)
        ap = average_precision_score(y_test, preds)
        print(f"\n── Test Set Evaluation ──")
        print(f"  ROC-AUC:          {auc:.4f}")
        print(f"  Avg Precision:    {ap:.4f}")
        print(f"\n{classification_report(y_test, preds_binary)}")

        # Feature importance top 15
        importance = sorted(
            zip(feature_cols, model.feature_importance(importance_type="gain")),
            key=lambda x: x[1], reverse=True
        )[:15]
        print("\nTop 15 Features by Gain:")
        for feat, imp in importance:
            print(f"  {feat:<50} {imp:.1f}")


if __name__ == "__main__":
    main()
