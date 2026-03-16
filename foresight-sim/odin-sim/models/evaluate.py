"""
models/evaluate.py
Validation scoring for trained Foresight models against known injected failures.
Loads a saved model and evaluates it against sim ground-truth labels.

Usage:
    # Evaluate latest saved model
    python models/evaluate.py

    # Evaluate a specific model file
    python models/evaluate.py --model models/saved/foresight_20240101_1200.pkl

    # Full report with per-failure-mode breakdown
    python models/evaluate.py --detailed
"""

import os
import argparse
import json
import pickle
import glob
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg2
from sklearn.metrics import (
    roc_auc_score,
    average_precision_score,
    precision_recall_curve,
    confusion_matrix,
    classification_report,
)
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
MODEL_DIR = Path("models/saved")


def find_latest_model() -> tuple[Path, Path]:
    """Find the most recently saved model + metadata pair."""
    pkl_files = sorted(MODEL_DIR.glob("foresight_*.pkl"), reverse=True)
    if not pkl_files:
        raise FileNotFoundError(
            f"No saved models in {MODEL_DIR}. Run: python models/train.py --source sim"
        )
    model_path = pkl_files[0]
    meta_path = model_path.with_suffix("").with_suffix("").parent / (model_path.stem + "_meta.json")
    return model_path, meta_path


def load_model(model_path: Path) -> tuple:
    """Load model and metadata. Returns (model, meta_dict)."""
    with open(model_path, "rb") as f:
        model = pickle.load(f)

    meta_path = Path(str(model_path).replace(".pkl", "_meta.json"))
    if meta_path.exists():
        with open(meta_path) as f:
            meta = json.load(f)
    else:
        meta = {"features": None}

    return model, meta


def load_eval_data(source: str = "sim") -> pd.DataFrame:
    """Load sensor readings + failure labels from PostgreSQL."""
    if not DATABASE_URL:
        raise EnvironmentError("DATABASE_URL not set in .env")

    conn = psycopg2.connect(DATABASE_URL)

    readings_query = """
        SELECT
            sr.vehicle_id,
            sr.day,
            sr.sensor_name,
            AVG(sr.value)              AS mean_val,
            STDDEV(sr.value)           AS std_val,
            MIN(sr.value)              AS min_val,
            MAX(sr.value)              AS max_val,
            MAX(sr.degradation_factor) AS max_degradation,
            BOOL_OR(NOT sr.is_healthy) AS has_anomaly
        FROM sensor_readings sr
        WHERE sr.source LIKE %s
        GROUP BY sr.vehicle_id, sr.day, sr.sensor_name
        ORDER BY sr.vehicle_id, sr.day, sr.sensor_name
    """
    df = pd.read_sql(readings_query, conn, params=(f"{source}%",))

    labels_query = """
        SELECT
            vehicle_id,
            failure_mode,
            dtc_code,
            failure_start_day,
            dtc_fire_day
        FROM sim_failure_events
    """
    labels_df = pd.read_sql(labels_query, conn)
    conn.close()

    if df.empty:
        raise ValueError("No sim data found. Run the pipeline first.")

    # Pivot to wide format
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

    anomaly_pivot = df.groupby(["vehicle_id", "day"])[["has_anomaly", "max_degradation"]].max()
    pivot_dfs.append(anomaly_pivot)

    wide_df = pd.concat(pivot_dfs, axis=1).reset_index()
    wide_df = wide_df.merge(labels_df, on="vehicle_id", how="left")

    wide_df["label"] = 0
    mask = (
        wide_df["dtc_fire_day"].notna()
        & (wide_df["day"] >= wide_df["failure_start_day"])
        & (wide_df["day"] <= wide_df["dtc_fire_day"])
    )
    wide_df.loc[mask, "label"] = 1

    return wide_df


def build_feature_matrix(df: pd.DataFrame, feature_cols: list):
    """Align DataFrame columns to the trained feature set."""
    drop_cols = {"vehicle_id", "day", "label", "failure_start_day",
                 "dtc_fire_day", "failure_mode", "dtc_code"}
    available = [c for c in feature_cols if c in df.columns]
    missing = [c for c in feature_cols if c not in df.columns]

    X = df[available].replace({None: np.nan})
    # Add NaN-filled columns for features the model saw during training but are
    # absent from eval data (e.g. ABS/TCM sensors not logged by some vehicles).
    # LightGBM uses its learned NaN split direction — do NOT zero-fill.
    for col in missing:
        X[col] = np.nan
    X = X[feature_cols]  # Ensure column order matches training
    y = df["label"]
    return X, y


def find_optimal_threshold(y_true, y_prob) -> float:
    """Find the threshold that maximises F1 on the eval set."""
    precision, recall, thresholds = precision_recall_curve(y_true, y_prob)
    f1_scores = 2 * precision * recall / (precision + recall + 1e-9)
    best_idx = np.argmax(f1_scores[:-1])  # last threshold has no recall
    return float(thresholds[best_idx])


def per_failure_breakdown(df: pd.DataFrame, y_prob: np.ndarray, threshold: float) -> pd.DataFrame:
    """Score predictions per failure mode."""
    df = df.copy()
    df["y_prob"] = y_prob
    df["y_pred"] = (y_prob >= threshold).astype(int)

    rows = []
    for mode, grp in df.groupby("failure_mode"):
        if grp["label"].sum() == 0:
            continue
        auc = roc_auc_score(grp["label"], grp["y_prob"])
        ap = average_precision_score(grp["label"], grp["y_prob"])
        tp = ((grp["y_pred"] == 1) & (grp["label"] == 1)).sum()
        fp = ((grp["y_pred"] == 1) & (grp["label"] == 0)).sum()
        fn = ((grp["y_pred"] == 0) & (grp["label"] == 1)).sum()
        precision = tp / (tp + fp + 1e-9)
        recall = tp / (tp + fn + 1e-9)
        rows.append({
            "failure_mode": mode,
            "n_vehicles": grp["vehicle_id"].nunique(),
            "positive_days": int(grp["label"].sum()),
            "roc_auc": round(auc, 4),
            "avg_precision": round(ap, 4),
            "precision": round(precision, 4),
            "recall": round(recall, 4),
        })

    return pd.DataFrame(rows).sort_values("roc_auc", ascending=False)


def main():
    parser = argparse.ArgumentParser(description="Foresight Model Evaluator")
    parser.add_argument("--model", type=str, default=None, help="Path to .pkl model file (default: latest)")
    parser.add_argument("--source", type=str, default="sim", help="Data source (sim | real)")
    parser.add_argument("--detailed", action="store_true", help="Show per-failure-mode breakdown")
    parser.add_argument("--threshold", type=float, default=None, help="Decision threshold (default: auto)")
    args = parser.parse_args()

    # Load model
    if args.model:
        model_path = Path(args.model)
    else:
        model_path, _ = find_latest_model()

    print(f"Model: {model_path}")
    model, meta = load_model(model_path)
    feature_cols = meta.get("features")

    if feature_cols is None:
        print("WARNING: No feature list in metadata — using all numeric columns.")

    # Load eval data
    print(f"Loading {args.source} data...")
    df = load_eval_data(source=args.source)
    print(f"  {len(df):,} (vehicle, day) rows | positives: {df['label'].sum():,} | negatives: {(df['label']==0).sum():,}")

    # Build feature matrix
    if feature_cols:
        X, y = build_feature_matrix(df, feature_cols)
    else:
        drop_cols = ["vehicle_id", "day", "label", "failure_start_day",
                     "dtc_fire_day", "failure_mode", "dtc_code"]
        feat_cols = [c for c in df.columns if c not in drop_cols]
        X = df[feat_cols].fillna(0)
        y = df["label"]

    # Predict
    y_prob = model.predict(X)

    # Threshold
    threshold = args.threshold or find_optimal_threshold(y.values, y_prob)
    y_pred = (y_prob >= threshold).astype(int)

    # Core metrics
    auc = roc_auc_score(y, y_prob)
    ap = average_precision_score(y, y_prob)

    print(f"\n── Overall Evaluation (threshold={threshold:.3f}) ──")
    print(f"  ROC-AUC:           {auc:.4f}")
    print(f"  Avg Precision:     {ap:.4f}")
    print()
    print(classification_report(y, y_pred, target_names=["healthy", "pre-failure"]))

    cm = confusion_matrix(y, y_pred)
    print(f"Confusion Matrix:")
    print(f"  TN={cm[0,0]:,}  FP={cm[0,1]:,}")
    print(f"  FN={cm[1,0]:,}  TP={cm[1,1]:,}")

    if args.detailed and "failure_mode" in df.columns:
        df_eval = df.copy()
        breakdown = per_failure_breakdown(df_eval, y_prob, threshold)
        print(f"\n── Per-Failure-Mode Breakdown ──")
        print(breakdown.to_string(index=False))

    # Model metadata summary
    if meta:
        print(f"\n── Model Metadata ──")
        print(f"  Trained:   {meta.get('timestamp', 'unknown')}")
        print(f"  Source:    {meta.get('source', 'unknown')}")
        print(f"  Optimized: {meta.get('optimized', False)}")
        if meta.get("optimized"):
            print(f"  Trials:    {meta.get('trials', 0)}")


if __name__ == "__main__":
    main()
