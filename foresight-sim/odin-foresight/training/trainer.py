"""
training/trainer.py

LightGBM trainer with optional Optuna HPO.
Handles class imbalance via scale_pos_weight.
Early stopping on validation AUC.

training/objective.py (also in this file)
Optuna objective function for hyperparameter optimization.
"""

from __future__ import annotations
import logging
import pickle
from typing import Optional, Tuple

import lightgbm as lgb
import numpy as np
import optuna
import pandas as pd
from sklearn.metrics import (
    roc_auc_score, average_precision_score,
    classification_report, confusion_matrix
)

log = logging.getLogger(__name__)

# Suppress LightGBM and Optuna verbosity unless DEBUG
optuna.logging.set_verbosity(optuna.logging.WARNING)


# ── Default hyperparameters (baseline — no HPO) ───────────────────────────────

DEFAULT_PARAMS = {
    "objective": "binary",
    "metric": "auc",
    "verbosity": -1,
    "boosting_type": "gbdt",
    "num_leaves": 64,
    "max_depth": 8,
    "learning_rate": 0.05,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq": 5,
    "min_child_samples": 20,
    "lambda_l1": 0.1,
    "lambda_l2": 0.1,
    "n_estimators": 500,
}


# ── Optuna objective ──────────────────────────────────────────────────────────

def optuna_objective(
    trial: optuna.Trial,
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_val: pd.DataFrame,
    y_val: pd.Series,
    scale_pos_weight: float,
) -> float:
    """Optuna objective — maximizes validation ROC-AUC."""
    params = {
        "objective": "binary",
        "metric": "auc",
        "verbosity": -1,
        "boosting_type": "gbdt",
        "num_leaves": trial.suggest_int("num_leaves", 16, 256),
        "max_depth": trial.suggest_int("max_depth", 3, 14),
        "learning_rate": trial.suggest_float("learning_rate", 0.005, 0.3, log=True),
        "feature_fraction": trial.suggest_float("feature_fraction", 0.4, 1.0),
        "bagging_fraction": trial.suggest_float("bagging_fraction", 0.4, 1.0),
        "bagging_freq": trial.suggest_int("bagging_freq", 1, 10),
        "min_child_samples": trial.suggest_int("min_child_samples", 5, 100),
        "lambda_l1": trial.suggest_float("lambda_l1", 1e-8, 10.0, log=True),
        "lambda_l2": trial.suggest_float("lambda_l2", 1e-8, 10.0, log=True),
        "scale_pos_weight": trial.suggest_float("scale_pos_weight", 1.0, 10.0),
        "min_gain_to_split": trial.suggest_float("min_gain_to_split", 0.0, 1.0),
    }

    model = _train_lgbm(params, X_train, y_train, X_val, y_val)
    preds = model.predict(X_val)
    return roc_auc_score(y_val, preds)


# ── Core trainer ──────────────────────────────────────────────────────────────

def _train_lgbm(
    params: dict,
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_val: pd.DataFrame,
    y_val: pd.Series,
    num_boost_round: int = 1000,
) -> lgb.Booster:
    dtrain = lgb.Dataset(X_train, label=y_train)
    dval   = lgb.Dataset(X_val,   label=y_val, reference=dtrain)

    callbacks = [
        lgb.early_stopping(stopping_rounds=50, verbose=False),
        lgb.log_evaluation(period=100),
    ]

    return lgb.train(
        params,
        dtrain,
        num_boost_round=num_boost_round,
        valid_sets=[dval],
        callbacks=callbacks,
    )


class ForesightTrainer:
    """
    Trains the Foresight LightGBM model.

    Usage:
        trainer = ForesightTrainer()
        model, meta = trainer.train(X_train, y_train, X_val, y_val)
        eval_results = trainer.evaluate(model, X_test, y_test)
    """

    def __init__(self, seed: int = 42):
        self.seed = seed
        self._best_params: Optional[dict] = None
        self._study: Optional[optuna.Study] = None

    def _compute_scale_pos_weight(self, y: pd.Series) -> float:
        """Compute class imbalance weight: n_negative / n_positive."""
        n_pos = y.sum()
        n_neg = len(y) - n_pos
        if n_pos == 0:
            return 1.0
        weight = n_neg / n_pos
        log.info(f"  scale_pos_weight: {weight:.2f} (neg={n_neg:,}, pos={n_pos:,})")
        return float(weight)

    def optimize(
        self,
        X_train: pd.DataFrame,
        y_train: pd.Series,
        X_val: pd.DataFrame,
        y_val: pd.Series,
        n_trials: int = 50,
    ) -> dict:
        """Run Optuna HPO and return best params."""
        log.info(f"Running Optuna HPO ({n_trials} trials)...")
        scale_pos_weight = self._compute_scale_pos_weight(y_train)

        study = optuna.create_study(
            direction="maximize",
            sampler=optuna.samplers.TPESampler(seed=self.seed),
        )
        study.optimize(
            lambda trial: optuna_objective(
                trial, X_train, y_train, X_val, y_val, scale_pos_weight
            ),
            n_trials=n_trials,
            show_progress_bar=True,
        )

        self._study = study
        best = study.best_params
        log.info(f"  Best AUC: {study.best_value:.4f}")
        log.info(f"  Best params: {best}")
        self._best_params = {**DEFAULT_PARAMS, **best}
        return self._best_params

    def train(
        self,
        X_train: pd.DataFrame,
        y_train: pd.Series,
        X_val: pd.DataFrame,
        y_val: pd.Series,
        params: Optional[dict] = None,
    ) -> Tuple[lgb.Booster, dict]:
        """
        Train LightGBM model.
        params: if None, uses DEFAULT_PARAMS (or best params from optimize()).
        Returns (booster, training_metadata).
        """
        use_params = params or self._best_params or DEFAULT_PARAMS.copy()

        # Set scale_pos_weight if not already in params
        if "scale_pos_weight" not in use_params:
            use_params = {
                **use_params,
                "scale_pos_weight": self._compute_scale_pos_weight(y_train),
            }

        log.info(f"Training LightGBM: {len(X_train):,} train | {len(X_val):,} val | "
                 f"{X_train.shape[1]} features")

        model = _train_lgbm(use_params, X_train, y_train, X_val, y_val)

        val_preds = model.predict(X_val)
        val_auc = roc_auc_score(y_val, val_preds)
        val_ap  = average_precision_score(y_val, val_preds)

        log.info(f"  Val AUC: {val_auc:.4f} | Val AP: {val_ap:.4f}")

        meta = {
            "val_auc": round(val_auc, 4),
            "val_ap": round(val_ap, 4),
            "n_train": len(X_train),
            "n_val": len(X_val),
            "n_features": X_train.shape[1],
            "best_iteration": model.best_iteration,
            "params": use_params,
            "optimized": self._best_params is not None,
            "n_optuna_trials": len(self._study.trials) if self._study else 0,
        }

        return model, meta

    def evaluate(
        self,
        model: lgb.Booster,
        X_test: pd.DataFrame,
        y_test: pd.Series,
        threshold: float = 0.5,
    ) -> dict:
        """Full evaluation on test set. Returns metrics dict."""
        preds_proba = model.predict(X_test)
        preds_binary = (preds_proba >= threshold).astype(int)

        auc = roc_auc_score(y_test, preds_proba)
        ap  = average_precision_score(y_test, preds_proba)
        report = classification_report(y_test, preds_binary, output_dict=True)
        cm = confusion_matrix(y_test, preds_binary).tolist()

        # Feature importance
        importance = sorted(
            zip(X_test.columns, model.feature_importance(importance_type="gain")),
            key=lambda x: x[1], reverse=True,
        )

        results = {
            "test_auc": round(auc, 4),
            "test_ap": round(ap, 4),
            "classification_report": report,
            "confusion_matrix": cm,
            "feature_importance": [
                {"feature": f, "gain": round(float(g), 2)}
                for f, g in importance[:20]
            ],
            "threshold": threshold,
            "n_test": len(X_test),
            "positive_rate": float(y_test.mean()),
        }

        return results

    def print_evaluation(self, results: dict):
        """Print a human-readable evaluation report."""
        print(f"\n{'═'*60}")
        print(f"  Foresight Model Evaluation")
        print(f"{'═'*60}")
        print(f"  Test ROC-AUC:       {results['test_auc']:.4f}")
        print(f"  Test Avg Precision: {results['test_ap']:.4f}")
        print(f"  Test samples:       {results['n_test']:,}")
        print(f"  Positive rate:      {results['positive_rate']:.1%}")
        print(f"\n  Confusion Matrix:")
        cm = results["confusion_matrix"]
        print(f"    TN={cm[0][0]:>6,}  FP={cm[0][1]:>6,}")
        print(f"    FN={cm[1][0]:>6,}  TP={cm[1][1]:>6,}")
        print(f"\n  Top 10 Features by Gain:")
        for i, fi in enumerate(results["feature_importance"][:10], 1):
            print(f"    {i:>2}. {fi['feature']:<45} {fi['gain']:>10.1f}")
        print()
