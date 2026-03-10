"""
foresight_service.py — FastAPI ML Foresight microservice.

Start: uvicorn foresight_service:app --host 0.0.0.0 --port 8001

Endpoints:
  GET  /health           — liveness check
  POST /predict          — run ML prediction for a vehicle (internal only)
  POST /retrain          — retrain models from scratch (internal only)
"""

import asyncio
import os
import subprocess
import sys
from datetime import date, timedelta

import joblib
import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from feature_engineer import FEATURE_NAMES, extract_features

load_dotenv()

app = FastAPI(title="ODIN Foresight Service", version="1.0.0")

MODELS_DIR    = os.path.join(os.path.dirname(__file__), "models")
INTERNAL_KEY  = os.getenv("FORESIGHT_INTERNAL_KEY", "")

SYSTEM_META: dict[str, str] = {
    "coolant_system": "Coolant System",
    "oil_system":     "Oil System",
    "battery":        "Battery",
    "fuel_system":    "Fuel System",
    "engine_stress":  "Engine",
}

# ---------------------------------------------------------------------------
# Model registry (loaded at startup, reloaded after retrain)
# ---------------------------------------------------------------------------
_models: dict = {}
_features: list[str] = []


def _load_models() -> None:
    global _models, _features
    features_path = os.path.join(MODELS_DIR, "features.pkl")
    if not os.path.exists(features_path):
        return
    _features = joblib.load(features_path)
    for system in SYSTEM_META:
        path = os.path.join(MODELS_DIR, f"{system}.pkl")
        if os.path.exists(path):
            _models[system] = joblib.load(path)


@app.on_event("startup")
async def startup() -> None:
    try:
        _load_models()
        print(f"[foresight] Loaded {len(_models)} models")
    except Exception as exc:
        print(f"[foresight] Warning: could not load models at startup: {exc}")


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------

def _check_internal_key(key: str | None) -> None:
    if INTERNAL_KEY and key != INTERNAL_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")


# ---------------------------------------------------------------------------
# GET /health
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok", "models_loaded": len(_models)}


# ---------------------------------------------------------------------------
# POST /predict
# ---------------------------------------------------------------------------

class PredictRequest(BaseModel):
    vehicle_id: int
    user_id: int


def _risk_level(prob: float) -> str:
    if prob < 0.20:
        return "low"
    if prob < 0.50:
        return "moderate"
    if prob < 0.75:
        return "high"
    return "critical"


def _urgency(max_prob: float) -> tuple[str, int]:
    if max_prob < 0.20:
        return "ok", 90
    if max_prob < 0.50:
        return "watch", 30
    if max_prob < 0.75:
        return "soon", 14
    return "urgent", 3


@app.post("/predict")
async def predict(
    req: PredictRequest,
    x_internal_key: str | None = Header(default=None, alias="x-internal-key"),
):
    _check_internal_key(x_internal_key)

    if not _models:
        raise HTTPException(
            status_code=503,
            detail="Models not loaded — run python train_foresight.py first",
        )

    # Feature extraction runs a DB query — offload to thread pool
    features, data_quality = await asyncio.to_thread(
        extract_features, req.vehicle_id
    )

    if features is None:
        raise HTTPException(
            status_code=422,
            detail=f"Insufficient sensor data (data_quality={data_quality})",
        )

    feature_list = _features or FEATURE_NAMES
    X = np.array([[features.get(f, 0.0) for f in feature_list]])

    part_scores: dict = {}
    for system, label in SYSTEM_META.items():
        if system in _models:
            prob = float(_models[system].predict_proba(X)[0][1])
        else:
            prob = 0.0
        part_scores[system] = {
            "probability": round(prob, 4),
            "risk_level":  _risk_level(prob),
            "label":       label,
        }

    max_prob = max(s["probability"] for s in part_scores.values())
    urgency, days = _urgency(max_prob)
    service_date  = (date.today() + timedelta(days=days)).isoformat()

    return {
        "source":                   "live",
        "maintenance_probability":  round(max_prob, 4),
        "maintenance_urgency":      urgency,
        "estimated_service_date":   service_date,
        "days_until_service":       days,
        "part_scores":              part_scores,
        "data_quality":             data_quality,
    }


# ---------------------------------------------------------------------------
# POST /retrain
# ---------------------------------------------------------------------------

@app.post("/retrain")
async def retrain(
    x_internal_key: str | None = Header(default=None, alias="x-internal-key"),
):
    _check_internal_key(x_internal_key)

    async def _run():
        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            os.path.join(os.path.dirname(__file__), "train_foresight.py"),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        stdout, _ = await proc.communicate()
        return proc.returncode, stdout.decode()

    returncode, output = await _run()

    if returncode != 0:
        raise HTTPException(status_code=500, detail=f"Training failed:\n{output}")

    # Reload models hot
    _load_models()

    return {
        "status":        "ok",
        "models_loaded": len(_models),
        "output":        output,
    }
