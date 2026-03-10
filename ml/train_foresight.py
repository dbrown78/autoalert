"""
train_foresight.py — Train one LightGBM binary classifier per vehicle system.

Run: python train_foresight.py
Output: ml/models/<system>.pkl + ml/models/features.pkl

Systems: coolant_system, oil_system, battery, fuel_system, engine_stress

Synthetic data bootstraps the models until real failure history accumulates.
Retrain monthly with real sensor_readings + foresight_predictions data.
"""

import os

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

from feature_engineer import FEATURE_NAMES

SYSTEMS = ["coolant_system", "oil_system", "battery", "fuel_system", "engine_stress"]

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")


# ---------------------------------------------------------------------------
# Synthetic data generator
# ---------------------------------------------------------------------------

def _generate_synthetic(n: int = 5000, seed: int = 42) -> pd.DataFrame:
    """
    Produce n synthetic vehicle-session feature rows with binary labels per system.

    Healthy baseline + per-system failure perturbations so each classifier
    learns the correct signal.
    """
    rng = np.random.default_rng(seed)
    rows = []

    for _ in range(n):
        # Each system fails independently ~25% of the time
        failing = {s: rng.random() < 0.25 for s in SYSTEMS}

        # --- Healthy baseline ---
        ct_mean  = rng.normal(85, 5)       # coolant temp °C
        v_mean   = rng.normal(13.8, 0.3)   # voltage V
        ft_mean  = rng.normal(1.5, 3.0)    # fuel trim %
        rpm_mean = rng.normal(1700, 300)   # rpm
        el_mean  = rng.normal(40, 12)      # engine load %
        o2_mean  = rng.normal(0.45, 0.05)  # o2 sensor V
        it_mean  = rng.normal(35, 5)       # intake temp °C

        # --- Apply failure perturbations ---
        if failing["coolant_system"]:
            ct_mean += rng.uniform(15, 25)   # push to 100–110 °C

        if failing["battery"]:
            v_mean  -= rng.uniform(1.5, 2.5) # drop to 11.3–12.3 V

        if failing["fuel_system"]:
            sign     = rng.choice([-1, 1])
            ft_mean += sign * rng.uniform(15, 30)  # rich or lean

        if failing["oil_system"] or failing["engine_stress"]:
            el_mean  += rng.uniform(30, 50)  # sustained high load
            rpm_mean += rng.uniform(1500, 2500)

        # --- Build feature row ---
        ct_std  = rng.uniform(2, 10) * (2.0 if failing["coolant_system"] else 1.0)
        v_std   = rng.uniform(0.05, 0.5) * (3.0 if failing["battery"] else 1.0)
        ft_std  = rng.uniform(1, 8) * (2.0 if failing["fuel_system"] else 1.0)

        row = {
            # Coolant
            "coolant_temp_mean": float(np.clip(ct_mean, 40, 130)),
            "coolant_temp_std":  float(np.clip(ct_std, 0, 30)),
            "coolant_temp_max":  float(np.clip(ct_mean + rng.uniform(5, 20), 40, 130)),
            "coolant_temp_p95":  float(np.clip(ct_mean + rng.uniform(3, 12), 40, 130)),
            # Battery / voltage
            "voltage_mean":      float(np.clip(v_mean, 9, 18)),
            "voltage_std":       float(np.clip(v_std, 0, 2)),
            "voltage_min":       float(np.clip(v_mean - rng.uniform(0.2, 1.5), 9, 18)),
            # Fuel trim
            "fuel_trim_mean":    float(np.clip(ft_mean, -50, 50)),
            "fuel_trim_std":     float(np.clip(ft_std, 0, 20)),
            "fuel_trim_abs_mean": float(abs(ft_mean)),
            # O2 sensor
            "o2_sensor_mean":   float(np.clip(o2_mean + (rng.uniform(-0.2, 0.2) if failing["fuel_system"] else 0), 0, 2)),
            "o2_sensor_std":    float(rng.uniform(0.01, 0.1)),
            # RPM
            "rpm_mean":         float(np.clip(rpm_mean, 500, 6000)),
            "rpm_max":          float(np.clip(rpm_mean + rng.uniform(200, 1500), 500, 7000)),
            "rpm_p95":          float(np.clip(rpm_mean + rng.uniform(100, 800), 500, 6500)),
            # Engine load
            "engine_load_mean": float(np.clip(el_mean, 10, 100)),
            "engine_load_max":  float(np.clip(el_mean + rng.uniform(10, 30), 10, 100)),
            "engine_load_p95":  float(np.clip(el_mean + rng.uniform(5, 20), 10, 100)),
            # Intake temp
            "intake_temp_mean": float(np.clip(it_mean, 10, 80)),
            # Data quality proxy
            "reading_count":    float(rng.integers(50, 1000)),
        }

        # Labels
        for s in SYSTEMS:
            row[s] = int(failing[s])

        rows.append(row)

    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

def train():
    os.makedirs(MODELS_DIR, exist_ok=True)

    print(f"[Train] Synthetic data: 5000 samples")
    df = _generate_synthetic(n=5000)

    lgb_params = dict(
        n_estimators=200,
        learning_rate=0.05,
        max_depth=6,
        num_leaves=31,
        min_child_samples=20,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        verbose=-1,
    )

    for system in SYSTEMS:
        X = df[FEATURE_NAMES]
        y = df[system]

        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )

        model = lgb.LGBMClassifier(**lgb_params)
        model.fit(X_train, y_train)

        auc = roc_auc_score(y_test, model.predict_proba(X_test)[:, 1])
        print(f"  {system:<20} ROC-AUC: {auc:.2f}")

        joblib.dump(model, os.path.join(MODELS_DIR, f"{system}.pkl"))

    # Save canonical feature list so the service always uses the same order
    joblib.dump(FEATURE_NAMES, os.path.join(MODELS_DIR, "features.pkl"))
    print(f"Models saved to {MODELS_DIR}/")


if __name__ == "__main__":
    train()
