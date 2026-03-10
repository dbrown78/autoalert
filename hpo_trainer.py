#!/usr/bin/env python3
"""
ml/hpo_trainer.py

Hyperparameter Optimization for Foresight GBM models using Optuna.
Replaces the fixed-param training in train_foresight.py once you have
enough real sensor data (100+ labeled failure events per part).

Mirrors AWS SageMaker HPO job behavior — but self-hosted via Optuna.

Usage:
  python hpo_trainer.py                      # optimize + train all parts
  python hpo_trainer.py --part coolant_system --trials 50
  python hpo_trainer.py --part battery --trials 30 --study-name battery_v2

Output:
  models/foresight_<part>.pkl        — best model per part
  models/hpo_results_<part>.json     — best params + trial history
  models/training_report.json        — updated accuracy report
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

import optuna
import lightgbm as lgb
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.metrics import roc_auc_score
from sqlalchemy import create_engine

# Reuse feature groups and data loading from train_foresight
from train_foresight import (
    PART_FEATURE_GROUPS,
    load_training_data,
    generate_synthetic_training_data,
    MODEL_DIR,
)

optuna.logging.set_verbosity(optuna.logging.WARNING)  # suppress per-trial noise

N_CV_FOLDS   = 5   # stratified k-fold for robust HPO evaluation
N_TRIALS_DEFAULT = 50


# ── Search space ──────────────────────────────────────────────────────────────

def build_search_space(trial: optuna.Trial) -> dict:
    """
    Defines the LightGBM hyperparameter search space.
    Mirrors the range of params SageMaker HPO would explore.
    """
    return {
        "objective":          "binary",
        "metric":             "auc",
        "verbosity":          -1,
        "boosting_type":      trial.suggest_categorical("boosting_type", ["gbdt", "dart"]),
        "n_estimators":       trial.suggest_int("n_estimators", 100, 500),
        "learning_rate":      trial.suggest_float("learning_rate", 0.01, 0.2, log=True),
        "max_depth":          trial.suggest_int("max_depth", 3, 8),
        "num_leaves":         trial.suggest_int("num_leaves", 8, 64),
        "min_child_samples":  trial.suggest_int("min_child_samples", 10, 100),
        "subsample":          trial.suggest_float("subsample", 0.5, 1.0),
        "colsample_bytree":   trial.suggest_float("colsample_bytree", 0.5, 1.0),
        "reg_alpha":          trial.suggest_float("reg_alpha", 1e-4, 10.0, log=True),
        "reg_lambda":         trial.suggest_float("reg_lambda", 1e-4, 10.0, log=True),
        "class_weight":       "balanced",
        "random_state":       42,
    }


# ── Objective function ────────────────────────────────────────────────────────

def make_objective(X: np.ndarray, y: np.ndarray):
    """Returns an Optuna objective function for one part's dataset."""
    def objective(trial: optuna.Trial) -> float:
        params = build_search_space(trial)
        model  = lgb.LGBMClassifier(**params)

        cv = StratifiedKFold(n_splits=N_CV_FOLDS, shuffle=True, random_state=42)
        scores = cross_val_score(model, X, y, cv=cv, scoring="roc_auc", n_jobs=-1)
        return float(np.mean(scores))

    return objective


# ── HPO + train for one part ──────────────────────────────────────────────────

def optimize_and_train(part: str, df: pd.DataFrame, n_trials: int, study_name: str) -> dict:
    feature_cols = PART_FEATURE_GROUPS[part]
    label_col    = f"label_{part}"

    X = df[feature_cols].fillna(df[feature_cols].median()).values
    y = df[label_col].values

    print(f"\n[HPO] {part} — running {n_trials} trials...")
    study = optuna.create_study(
        direction="maximize",
        study_name=study_name or f"foresight_{part}",
        sampler=optuna.samplers.TPESampler(seed=42),
    )
    study.optimize(make_objective(X, y), n_trials=n_trials, show_progress_bar=True)

    best_params = study.best_params
    best_auc    = study.best_value
    print(f"  Best ROC-AUC: {best_auc:.4f}")
    print(f"  Best params:  {json.dumps(best_params, indent=4)}")

    # Retrain on full dataset with best params
    final_params = {
        "objective":    "binary",
        "metric":       "auc",
        "verbosity":    -1,
        "class_weight": "balanced",
        "random_state": 42,
        **best_params,
    }
    final_model = lgb.LGBMClassifier(**final_params)
    final_model.fit(X, y)

    # Save model
    model_path = MODEL_DIR / f"foresight_{part}.pkl"
    with open(model_path, "wb") as f:
        pickle.dump({"model": final_model, "features": feature_cols, "part": part}, f)

    # Save HPO results
    hpo_results = {
        "part":       part,
        "best_auc":   round(best_auc, 4),
        "best_params": best_params,
        "n_trials":   n_trials,
        "trained_at": datetime.utcnow().isoformat(),
        "trial_history": [
            {"number": t.number, "value": round(t.value, 4), "params": t.params}
            for t in study.trials
        ],
    }
    hpo_path = MODEL_DIR / f"hpo_results_{part}.json"
    with open(hpo_path, "w") as f:
        json.dump(hpo_results, f, indent=2)

    return hpo_results


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--part",       default=None,    help="Optimize a single part")
    parser.add_argument("--trials",     type=int, default=N_TRIALS_DEFAULT)
    parser.add_argument("--study-name", default=None)
    args = parser.parse_args()

    print("[HPO] Loading training data...")
    df = load_training_data()

    parts = [args.part] if args.part else list(PART_FEATURE_GROUPS.keys())
    print(f"[HPO] Optimizing: {parts} | {args.trials} trials each")

    report = []
    for part in parts:
        result = optimize_and_train(part, df, args.trials, args.study_name)
        report.append(result)

    # Update training report
    report_path = MODEL_DIR / "training_report.json"
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)

    print("\n[HPO] Optimization complete:")
    for r in report:
        print(f"  {r['part']:20s}  Best ROC-AUC: {r['best_auc']}")


if __name__ == "__main__":
    main()
