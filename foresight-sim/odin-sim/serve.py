"""
serve.py
Foresight LightGBM inference server.

Exposes the trained model for real-time and demo predictions with per-component
SHAP attribution (engine / transmission / abs_wheel_sensor).

Usage:
    uvicorn serve:app --host 0.0.0.0 --port 8001

Endpoints:
    POST /predict                         — predict from feature dict
    GET  /predict/demo/{vehicle_id}       — pre-cached demo vehicle prediction
    GET  /health                          — liveness + model status
    GET  /model/info                      — metadata, feature list, failure modes
"""

from __future__ import annotations

import os
import json
import pickle
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
import psycopg2
import shap
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
MODEL_DIR = Path("models/saved")

# ── Component feature groups ─────────────────────────────────────────────────
# Used to route SHAP attribution to a primary failing component.
# A feature is matched if any of these base sensor names is a substring of
# the full feature column name (e.g. "trans_fluid_temp" in "trans_fluid_temp_mean_val").

_TRANSMISSION_SENSORS: frozenset[str] = frozenset({
    "trans_fluid_temp", "slip_rpm", "line_pressure",
    "thermal_delta", "slip_temp_ratio",
})

_ABS_SENSORS: frozenset[str] = frozenset({
    "wheel_speed_fl", "wheel_speed_fr", "wheel_speed_rl", "wheel_speed_rr",
    "wheel_speed_delta",
})


# ── Module-level model state ─────────────────────────────────────────────────

class _ModelState:
    model: object = None
    meta: dict = {}
    explainer: object = None
    feature_cols: list[str] = []
    demo_cache: dict[str, dict] = {}


_state = _ModelState()


# ── Model loading ─────────────────────────────────────────────────────────────

def _find_latest_model() -> Path:
    pkl_files = sorted(MODEL_DIR.glob("foresight_*.pkl"), reverse=True)
    if not pkl_files:
        raise FileNotFoundError(
            f"No saved models in {MODEL_DIR}. "
            "Run: python train.py --source sim"
        )
    return pkl_files[0]


def _load_model() -> None:
    model_path = _find_latest_model()
    with open(model_path, "rb") as fh:
        _state.model = pickle.load(fh)

    meta_path = Path(str(model_path).replace(".pkl", "_meta.json"))
    if meta_path.exists():
        with open(meta_path) as fh:
            _state.meta = json.load(fh)

    _state.feature_cols = _state.meta.get("features", [])
    _state.explainer = shap.TreeExplainer(_state.model)
    print(f"[serve] Model loaded: {model_path.name} ({len(_state.feature_cols)} features)")


# ── SHAP helpers ──────────────────────────────────────────────────────────────

def _compute_shap_top(df: pd.DataFrame) -> list[dict]:
    """Return top-10 SHAP features (by |value|) for the first row of df."""
    raw = _state.explainer.shap_values(df)
    # lgb binary: shap_values returns a list [neg_class, pos_class] or a single array
    shap_arr: np.ndarray = raw[1][0] if isinstance(raw, list) else raw[0]

    top_idx = np.argsort(np.abs(shap_arr))[::-1][:10]
    return [
        {
            "feature": _state.feature_cols[i],
            "value": float(df.iloc[0, i]) if not pd.isna(df.iloc[0, i]) else None,
            "shap": float(shap_arr[i]),
        }
        for i in top_idx
    ]


def _route_component(shap_top: list[dict]) -> str:
    """
    Infer the primary failing component from the top-10 SHAP features.

    Each feature's base name is checked against the transmission and ABS
    sensor groups.  The group with the higher total |SHAP| score wins.
    Falls back to 'engine' when neither group has any contribution.
    """
    trans_score = 0.0
    abs_score = 0.0
    for entry in shap_top:
        feat = entry["feature"]
        if any(s in feat for s in _TRANSMISSION_SENSORS):
            trans_score += abs(entry["shap"])
        elif any(s in feat for s in _ABS_SENSORS):
            abs_score += abs(entry["shap"])

    if trans_score == 0.0 and abs_score == 0.0:
        return "engine"
    return "transmission" if trans_score >= abs_score else "abs_wheel_sensor"


# ── Feature helpers ───────────────────────────────────────────────────────────

def _build_input_df(features: dict) -> pd.DataFrame:
    """
    Build a single-row DataFrame aligned to the model's feature columns.
    Missing features become NaN — LightGBM handles NaN natively.
    """
    row = {col: features.get(col, np.nan) for col in _state.feature_cols}
    return pd.DataFrame([row])


def _predict_row(features: dict) -> dict:
    """Run model prediction + SHAP attribution for one feature dict."""
    df = _build_input_df(features)
    prob = float(_state.model.predict(df)[0])
    shap_top = _compute_shap_top(df)
    component = _route_component(shap_top)
    return {
        "probability": round(prob, 4),
        "component": component,
        "shap_top_features": shap_top,
    }


def _compute_derived(features: dict) -> dict:
    """
    Compute derived cross-sensor features from raw sensor mean values and
    merge them into the features dict (in-place, returns dict).
    """
    ws_keys = [f"wheel_speed_{w}_mean_val" for w in ("fl", "fr", "rl", "rr")]
    ws_vals = [features[k] for k in ws_keys if k in features and features[k] is not None]
    features["wheel_speed_delta"] = (max(ws_vals) - min(ws_vals)) if len(ws_vals) == 4 else np.nan

    t_fluid  = features.get("trans_fluid_temp_mean_val")
    t_intake = features.get("intake_air_temp_mean_val")
    if t_fluid is not None and t_intake is not None:
        features["thermal_delta"] = t_fluid - t_intake
    else:
        features["thermal_delta"] = np.nan

    slip = features.get("slip_rpm_mean_val")
    if slip is not None and t_fluid is not None and t_fluid != 0:
        features["slip_temp_ratio"] = slip / t_fluid
    else:
        features["slip_temp_ratio"] = np.nan

    return features


# ── Demo pre-caching ──────────────────────────────────────────────────────────

def _load_demo_prediction(vehicle_id: str) -> Optional[dict]:
    """
    Query PostgreSQL for the demo vehicle's highest-degradation day, build the
    feature vector (including derived features), and return the prediction dict.
    Returns None if the vehicle has no data or the DB is unavailable.
    """
    if not DATABASE_URL:
        return None
    try:
        conn = psycopg2.connect(DATABASE_URL)
        query = """
            SELECT
                sr.sensor_name,
                AVG(sr.value)              AS mean_val,
                STDDEV(sr.value)           AS std_val,
                MIN(sr.value)              AS min_val,
                MAX(sr.value)              AS max_val,
                MAX(sr.degradation_factor) AS max_degradation,
                BOOL_OR(NOT sr.is_healthy) AS has_anomaly
            FROM sensor_readings sr
            WHERE sr.vehicle_id = %s
              AND sr.day = (
                  SELECT day FROM sensor_readings
                  WHERE vehicle_id = %s
                  GROUP BY day
                  ORDER BY MAX(degradation_factor) DESC
                  LIMIT 1
              )
            GROUP BY sr.sensor_name
        """
        sensor_df = pd.read_sql(query, conn, params=(vehicle_id, vehicle_id))
        conn.close()

        if sensor_df.empty:
            return None

        # Build flat feature dict matching training column names
        features: dict = {}
        stat_map = {
            "mean_val": "mean_val",
            "std_val":  "std_val",
            "min_val":  "min_val",
            "max_val":  "max_val",
        }
        for _, row in sensor_df.iterrows():
            for stat, col_suffix in stat_map.items():
                val = row.get(stat)
                features[f"{row['sensor_name']}_{col_suffix}"] = (
                    float(val) if val is not None and not (isinstance(val, float) and np.isnan(val)) else None
                )

        # Scalar aggregates
        agg = sensor_df[["max_degradation", "has_anomaly"]].max()
        features["max_degradation"] = float(agg["max_degradation"])
        features["has_anomaly"]     = float(agg["has_anomaly"])

        # Derived features
        _compute_derived(features)

        return _predict_row(features)

    except Exception as exc:
        print(f"[serve] Demo cache error for {vehicle_id}: {exc}")
        return None


# ── FastAPI app ───────────────────────────────────────────────────────────────

app = FastAPI(title="Foresight Inference API", version="2.0.0")

_DEMO_IDS = [
    "DEMO-001", "DEMO-002", "DEMO-003", "DEMO-004", "DEMO-005",
    "DEMO-006", "DEMO-007",
]


@app.on_event("startup")
async def startup() -> None:
    _load_model()
    # Pre-cache predictions for all demo vehicles
    for vid in _DEMO_IDS:
        result = _load_demo_prediction(vid)
        if result:
            _state.demo_cache[vid] = result
            print(f"[serve] Cached demo prediction: {vid} → {result['component']} p={result['probability']}")
        else:
            print(f"[serve] No data found for demo vehicle {vid} (skipped)")


# ── Request / Response models ─────────────────────────────────────────────────

class PredictRequest(BaseModel):
    vehicle_id: Optional[str] = None
    features: dict  # feature_column_name → float | None


class ShapFeature(BaseModel):
    feature: str
    value: Optional[float]
    shap: float


class PredictResponse(BaseModel):
    probability: float
    component: str
    shap_top_features: list[ShapFeature]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.post("/predict", response_model=PredictResponse)
async def predict(req: PredictRequest) -> dict:
    """
    Predict failure probability for a single (vehicle_id, day) feature vector.

    Input: { "features": { "rpm_mean_val": 1800, "coolant_temp_mean_val": 95, ... } }
    Missing features default to NaN (LightGBM handles them without imputation).

    Output: { probability, component, shap_top_features }
    """
    if _state.model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    try:
        return _predict_row(req.features)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/predict/demo/{vehicle_id}", response_model=PredictResponse)
async def predict_demo(vehicle_id: str) -> dict:
    """
    Return a pre-cached prediction for a demo vehicle.
    Demo vehicles are seeded with specific failure scenarios for Demo Mode.
    Falls back to a live DB query if the vehicle wasn't cached at startup.
    """
    if _state.model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    result = _state.demo_cache.get(vehicle_id)
    if result is None:
        result = _load_demo_prediction(vehicle_id)
        if result:
            _state.demo_cache[vehicle_id] = result

    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"No prediction available for {vehicle_id}. "
                   "Ensure demo vehicles are generated: python bootstrap.py --demo",
        )
    return result


@app.get("/health")
async def health() -> dict:
    """Liveness probe + model readiness."""
    return {
        "status": "ok" if _state.model is not None else "no_model",
        "model_loaded": _state.model is not None,
        "feature_count": len(_state.feature_cols),
        "demo_cached": sorted(_state.demo_cache.keys()),
    }


@app.get("/model/info")
async def model_info() -> dict:
    """
    Return model metadata including feature list, failure mode inventory,
    and per-mode training row counts for class-balance verification.
    """
    if not _state.meta:
        raise HTTPException(status_code=503, detail="Model metadata not available")

    return {
        "timestamp": _state.meta.get("timestamp"),
        "source": _state.meta.get("source"),
        "feature_count": _state.meta.get("feature_count", len(_state.feature_cols)),
        "features": _state.feature_cols,
        "failure_modes": _state.meta.get("failure_modes", []),
        "failure_mode_counts": _state.meta.get("failure_mode_counts", {}),
        "optimized": _state.meta.get("optimized", False),
        "params": _state.meta.get("params", {}),
    }
