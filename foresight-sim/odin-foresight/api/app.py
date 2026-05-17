"""
api/app.py

FastAPI application definition, schemas, and route handlers for the
Foresight prediction microservice.
"""

from __future__ import annotations
import logging
import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Dict, List, Optional

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.logging import LoggingIntegration

# Insert parent dir so sentry_scrub is importable from api/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from sentry_scrub import scrub_pii

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

sentry_sdk.init(
    dsn=os.environ.get('SENTRY_DSN_FORESIGHT'),
    environment=os.environ.get('RAILWAY_ENVIRONMENT', 'development'),
    release=os.environ.get('RAILWAY_GIT_COMMIT_SHA', 'local'),
    integrations=[
        FastApiIntegration(),
        LoggingIntegration(level=logging.WARNING, event_level=logging.ERROR),
    ],
    traces_sample_rate=0.1,
    before_send=scrub_pii,
)

log = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# SCHEMAS
# ─────────────────────────────────────────────────────────────────────────────

class PredictRequest(BaseModel):
    vehicle_id: str = Field(..., description="Vehicle ID to predict for")
    lookback_days: int = Field(
        default=7, ge=1, le=90,
        description="Days of sensor history to use for prediction"
    )


class SensorDetail(BaseModel):
    display_name: str
    contribution: float
    current_mean: Optional[float]
    status: str   # "nominal" | "degrading"


class FailureModeResult(BaseModel):
    mode: str
    display_name: str
    probability: float
    dtc_code: str
    repair_cost_oem: List[int]
    repair_cost_aftermarket: List[int]
    severity: str


class PredictResponse(BaseModel):
    vehicle_id: str
    predicted_at: str
    overall_failure_probability: float
    days_to_failure_estimate: Optional[int]
    severity: str   # "healthy" | "early" | "late" | "imminent"
    sensors: Dict[str, SensorDetail]
    top_failure_modes: List[FailureModeResult]
    model_version: str
    confidence: float
    lookback_days: int


class HealthResponse(BaseModel):
    status: str
    model: str
    model_version: str
    val_auc: Optional[float]
    uptime_seconds: float


class ModelInfoResponse(BaseModel):
    model_version: str
    saved_at: str
    val_auc: Optional[float]
    val_ap: Optional[float]
    n_train: Optional[int]
    n_features: Optional[int]
    optimized: bool
    n_optuna_trials: int


# ─────────────────────────────────────────────────────────────────────────────
# APPLICATION
# ─────────────────────────────────────────────────────────────────────────────

# Module-level state — loaded once at startup
_predictor = None
_demo_cache: dict = {}
_startup_time: datetime = datetime.utcnow()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model on startup, release on shutdown."""
    global _predictor, _demo_cache

    log.info("Foresight API starting — loading model...")
    try:
        from model.store import load_model, load_demo_predictions
        from model.predictor import ForesightPredictor

        model, feature_list, metadata = load_model()
        _predictor = ForesightPredictor(model, feature_list, metadata)
        _demo_cache = load_demo_predictions()

        if _demo_cache:
            log.info(f"Demo cache loaded: {list(_demo_cache.keys())}")
        else:
            log.warning("No demo predictions cached — run scripts/train.py to generate them")

    except Exception as e:
        log.error(f"Predictor load failed: {e}")
        sentry_sdk.capture_exception(e)
        # Allow startup to continue — /health will report model=missing
        _predictor = None

    yield

    log.info("Foresight API shutting down")


def create_app() -> FastAPI:
    app = FastAPI(
        title="ODIN AutoAlert — Foresight API",
        description="ML-powered vehicle failure prediction microservice",
        version="1.0.0",
        lifespan=lifespan,
    )

    # ── /health ──────────────────────────────────────────────────────────────

    @app.get("/health", response_model=HealthResponse)
    async def health():
        uptime = (datetime.utcnow() - _startup_time).total_seconds()
        if _predictor is None:
            return HealthResponse(
                status="degraded",
                model="missing",
                model_version="none",
                val_auc=None,
                uptime_seconds=uptime,
            )
        return HealthResponse(
            status="ok",
            model="loaded",
            model_version=_predictor.model_version,
            val_auc=_predictor.metadata.get("val_auc"),
            uptime_seconds=uptime,
        )

    # ── /model/info ──────────────────────────────────────────────────────────

    @app.get("/model/info", response_model=ModelInfoResponse)
    async def model_info():
        if _predictor is None:
            raise HTTPException(status_code=503, detail="Model not loaded")
        meta = _predictor.metadata
        return ModelInfoResponse(
            model_version=meta.get("model_version", "unknown"),
            saved_at=meta.get("saved_at", "unknown"),
            val_auc=meta.get("val_auc"),
            val_ap=meta.get("val_ap"),
            n_train=meta.get("n_train"),
            n_features=meta.get("n_features"),
            optimized=meta.get("optimized", False),
            n_optuna_trials=meta.get("n_optuna_trials", 0),
        )

    # ── POST /predict ─────────────────────────────────────────────────────────

    @app.post("/predict", response_model=PredictResponse)
    async def predict(req: PredictRequest):
        if _predictor is None:
            raise HTTPException(status_code=503, detail="Model not loaded. Run training first.")
        try:
            result = _predictor.predict(req.vehicle_id, req.lookback_days)
            return result
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
        except Exception as e:
            log.error(f"Prediction failed for {req.vehicle_id}: {e}")
            sentry_sdk.capture_exception(e)
            raise HTTPException(status_code=500, detail="Prediction error")

    # ── GET /predict/demo/{vehicle_id} ────────────────────────────────────────

    @app.get("/predict/demo/{vehicle_id}", response_model=PredictResponse)
    async def predict_demo(vehicle_id: str):
        """
        Returns pre-cached prediction for a demo vehicle.
        Used by Demo Mode in the app — no live DB query, instant response.
        Falls back to live prediction if cache is empty.
        """
        if vehicle_id in _demo_cache:
            return _demo_cache[vehicle_id]

        # Fallback to live prediction
        if _predictor is None:
            raise HTTPException(status_code=503, detail="Model not loaded")
        try:
            return _predictor.predict(vehicle_id, lookback_days=14)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    # ── GET /predict/demo (list all) ──────────────────────────────────────────

    @app.get("/predict/demo")
    async def list_demo_predictions():
        """List available cached demo vehicle predictions."""
        return {
            "cached_vehicles": list(_demo_cache.keys()),
            "count": len(_demo_cache),
        }

    return app


# Singleton app instance
app = create_app()
