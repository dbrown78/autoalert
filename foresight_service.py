#!/usr/bin/env python3
"""
ml/foresight_service.py

FastAPI microservice — runs alongside Node.js backend.
Called by Express route /api/foresight/:vehicleId

Endpoints:
  GET  /predict/:vehicleId   → per-part failure scores + maintenance estimate
  GET  /health               → service health check
  POST /retrain              → trigger model retraining (admin only)

Start:
  uvicorn foresight_service:app --host 0.0.0.0 --port 8001 --reload
"""

import os
import json
import pickle
import numpy as np
from pathlib import Path
from datetime import datetime, timedelta, date
from typing import Optional

from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel

from feature_engineer import engineer_features

MODEL_DIR    = Path(__file__).parent / "models"
INTERNAL_KEY = os.environ.get("FORESIGHT_INTERNAL_KEY", "odin-internal-2024")

app = FastAPI(title="ODIN Foresight ML Service", version="1.1.0")

# ── Load all part models at startup ──────────────────────────────────────────

LOADED_MODELS = {}

def load_models():
    for pkl_path in MODEL_DIR.glob("foresight_*.pkl"):
        with open(pkl_path, "rb") as f:
            payload = pickle.load(f)
        LOADED_MODELS[payload["part"]] = payload
    print(f"[Foresight] Loaded {len(LOADED_MODELS)} part models: {list(LOADED_MODELS.keys())}")

load_models()

# ── Response schema ───────────────────────────────────────────────────────────

class PartScore(BaseModel):
    probability:  float         # 0.0 - 1.0
    risk_level:   str           # 'low', 'moderate', 'high', 'critical'
    label:        str           # human-readable e.g. "Coolant System"

class ForesightResponse(BaseModel):
    vehicle_id:               int
    predicted_at:             str
    maintenance_probability:  float
    maintenance_urgency:      str           # 'normal', 'watch', 'soon', 'critical'
    estimated_service_date:   Optional[str] # ISO date string or null
    days_until_service:       Optional[int]
    part_scores:              dict[str, PartScore]
    data_quality:             str           # 'good', 'partial', 'low'
    is_premium:               bool

# ── Risk helpers ──────────────────────────────────────────────────────────────

def score_to_risk(prob: float) -> str:
    if prob < 0.25:  return "low"
    if prob < 0.50:  return "moderate"
    if prob < 0.75:  return "high"
    return "critical"

def estimate_service_date(urgency: str) -> tuple[Optional[str], Optional[int]]:
    """Map urgency to estimated service date range."""
    today = date.today()
    mapping = {
        "critical": 3,
        "soon":     14,
        "watch":    30,
        "normal":   None,
    }
    days = mapping.get(urgency)
    if days is None:
        return None, None
    estimated = today + timedelta(days=days)
    return estimated.isoformat(), days

PART_LABELS = {
    "coolant_system": "Coolant System",
    "oil_system":     "Oil System",
    "battery":        "Battery",
    "fuel_system":    "Fuel System",
    "engine_stress":  "Engine",
}

# ── Predict endpoint ──────────────────────────────────────────────────────────

@app.get("/predict/{vehicle_id}", response_model=ForesightResponse)
async def predict(vehicle_id: int, x_internal_key: str = Header(default=None)):
    if x_internal_key != INTERNAL_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")

    if not LOADED_MODELS:
        raise HTTPException(status_code=503, detail="Models not loaded — run train_foresight.py first")

    # 1. Engineer features from sensor history
    features = engineer_features(vehicle_id)
    if features is None:
        raise HTTPException(status_code=404, detail="Insufficient sensor data for this vehicle")

    # 2. Data quality check
    valid_sensors = features.get("valid_sensor_count", 0)
    if valid_sensors >= 7:
        data_quality = "good"
    elif valid_sensors >= 4:
        data_quality = "partial"
    else:
        raise HTTPException(status_code=422, detail="Too few valid sensors for reliable prediction")

    # 3. Run each part model
    part_scores = {}
    probabilities = []

    for part, payload in LOADED_MODELS.items():
        model    = payload["model"]
        feat_cols = payload["features"]

        # Build input vector — fill missing with median (safe fallback)
        X = np.array([[features.get(f, np.nan) for f in feat_cols]])
        X = np.where(np.isnan(X), 0.0, X)  # fallback 0 for missing

        prob = float(model.predict_proba(X)[0][1])
        probabilities.append(prob)

        part_scores[part] = PartScore(
            probability=round(prob, 4),
            risk_level=score_to_risk(prob),
            label=PART_LABELS.get(part, part),
        )

    # 4. Overall maintenance probability = max of all part scores
    overall_prob = max(probabilities) if probabilities else 0.0

    # 5. Urgency classification
    if overall_prob >= 0.75:
        urgency = "critical"
    elif overall_prob >= 0.50:
        urgency = "soon"
    elif overall_prob >= 0.25:
        urgency = "watch"
    else:
        urgency = "normal"

    # 6. Maintenance date estimate
    service_date, days_until = estimate_service_date(urgency)

    return ForesightResponse(
        vehicle_id=vehicle_id,
        predicted_at=datetime.utcnow().isoformat(),
        maintenance_probability=round(overall_prob, 4),
        maintenance_urgency=urgency,
        estimated_service_date=service_date,
        days_until_service=days_until,
        part_scores={k: v for k, v in part_scores.items()},
        data_quality=data_quality,
        is_premium=True,
    )


# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status":         "ok",
        "models_loaded":  list(LOADED_MODELS.keys()),
        "model_count":    len(LOADED_MODELS),
        "timestamp":      datetime.utcnow().isoformat(),
    }


# ── Retrain trigger ───────────────────────────────────────────────────────────

@app.post("/retrain")
async def retrain(x_internal_key: str = Header(default=None)):
    if x_internal_key != INTERNAL_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")

    import subprocess
    result = subprocess.run(
        ["python", "train_foresight.py"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=result.stderr)

    # Reload models
    LOADED_MODELS.clear()
    load_models()

    return {"status": "retrained", "models": list(LOADED_MODELS.keys())}
