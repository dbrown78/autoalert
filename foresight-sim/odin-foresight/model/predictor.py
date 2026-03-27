"""
model/predictor.py

ForesightPredictor: given a vehicle_id, pulls the last N days of sensor
readings from PostgreSQL, engineers features, and returns failure
probability scores.

This is what the FastAPI /predict endpoint uses internally.
It is also used by the demo prediction cache generator.

Inference pipeline:
  1. Pull last lookback_days of sensor readings for vehicle_id
  2. Aggregate to per-day stats (SQL-side)
  3. Build wide DataFrame (pivot sensors)
  4. Engineer features (same pipeline as training)
  5. Align to trained feature_list (add missing cols as 0, drop extras)
  6. Run LightGBM predict → probability
  7. Map back to human-readable response shape

The final prediction day is the most recent day in the DB.
Probability reflects the state of the vehicle as of that day.
"""

from __future__ import annotations
import logging
from datetime import datetime
from typing import Optional

import lightgbm as lgb
import numpy as np
import pandas as pd
import psycopg2

from features.engineer import build_feature_matrix, get_feature_columns
from data.loader import pivot_sensors, _get_conn
from model.failure_modes import FAILURE_MODES

log = logging.getLogger(__name__)

# Probability thresholds for severity classification
SEVERITY_THRESHOLDS = {
    "healthy":  (0.00, 0.30),
    "early":    (0.30, 0.55),
    "late":     (0.55, 0.75),
    "imminent": (0.75, 1.01),
}

# Sensor display names for API response
SENSOR_DISPLAY = {
    "rpm":               "Engine RPM",
    "coolant_temp":      "Coolant Temperature",
    "intake_air_temp":   "Intake Air Temperature",
    "maf":               "Mass Air Flow",
    "throttle_position": "Throttle Position",
    "o2_voltage_b1s1":   "O2 Sensor (Upstream)",
    "o2_voltage_b1s2":   "O2 Sensor (Downstream)",
    "catalyst_temp":     "Catalyst Temperature",
    "battery_voltage":   "Battery Voltage",
    "vehicle_speed":     "Vehicle Speed",
    "short_fuel_trim":   "Short-Term Fuel Trim",
    "long_fuel_trim":    "Long-Term Fuel Trim",
}

VEHICLE_SENSOR_QUERY = """
SELECT
    vehicle_id,
    day,
    sensor_name,
    AVG(value)    AS mean_val,
    STDDEV(value) AS std_val,
    MIN(value)    AS min_val,
    MAX(value)    AS max_val,
    COUNT(*)      AS sample_count
FROM sim_sensor_readings
WHERE vehicle_id = %s
  AND day >= (
      SELECT MAX(day) - %s FROM sim_sensor_readings WHERE vehicle_id = %s
  )
GROUP BY vehicle_id, day, sensor_name
ORDER BY vehicle_id, day, sensor_name
"""

VEHICLE_META_QUERY = """
SELECT vehicle_id, make_model, year, mileage_km, base_health, archetype, is_demo
FROM sim_vehicles
WHERE vehicle_id = %s
"""


class ForesightPredictor:
    """
    Loads a trained Foresight model and serves predictions.
    Designed to be instantiated once at API startup and reused.
    """

    def __init__(
        self,
        model: lgb.Booster,
        feature_list: list[str],
        metadata: dict,
    ):
        self.model = model
        self.feature_list = feature_list
        self.metadata = metadata
        self.model_version = metadata.get("model_version", "unknown")
        log.info(f"ForesightPredictor ready | version={self.model_version} | "
                 f"AUC={metadata.get('val_auc', '?')}")

    def _load_vehicle_data(self, vehicle_id: str, lookback_days: int) -> pd.DataFrame:
        """Pull and pivot sensor data for one vehicle."""
        conn = _get_conn()
        try:
            sensor_df = pd.read_sql(
                VEHICLE_SENSOR_QUERY, conn,
                params=(vehicle_id, lookback_days, vehicle_id)
            )
            meta_df = pd.read_sql(VEHICLE_META_QUERY, conn, params=(vehicle_id,))
        finally:
            conn.close()

        if sensor_df.empty:
            raise ValueError(f"No sim data found for vehicle_id='{vehicle_id}'")

        wide = pivot_sensors(sensor_df)
        if not meta_df.empty:
            wide = wide.merge(meta_df, on="vehicle_id", how="left")

        return wide

    def _build_features(self, wide: pd.DataFrame) -> pd.DataFrame:
        """Run feature engineering pipeline."""
        # Add placeholder labels (not used for inference)
        if "label_binary" not in wide.columns:
            wide["label_binary"] = 0
        if "label_severity" not in wide.columns:
            wide["label_severity"] = "healthy"

        return build_feature_matrix(wide)

    def _align_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Align feature DataFrame to the trained feature_list.
        - Missing columns → filled with 0
        - Extra columns → dropped
        Returns DataFrame with exactly feature_list columns in order.
        """
        for col in self.feature_list:
            if col not in df.columns:
                df[col] = 0.0
        return df[self.feature_list].fillna(0)

    def _probability_to_severity(self, prob: float) -> str:
        for severity, (lo, hi) in SEVERITY_THRESHOLDS.items():
            if lo <= prob < hi:
                return severity
        return "imminent"

    def _estimate_days_to_failure(self, prob: float) -> Optional[int]:
        """Rough estimate based on probability level. Real estimate needs time-series."""
        if prob < 0.30:
            return None
        if prob < 0.55:
            return 45
        if prob < 0.75:
            return 14
        return 3

    def _get_sensor_contributions(
        self, X_aligned: pd.DataFrame, prob: float
    ) -> dict:
        """
        Estimate per-sensor contribution to the failure probability.
        Uses SHAP-free approximation: feature importance × feature deviation from baseline.
        Returns dict of sensor_name → contribution info.
        """
        importances = dict(zip(
            self.feature_list,
            self.model.feature_importance(importance_type="gain"),
        ))

        # Group by sensor name
        sensor_scores = {}
        for feat, importance in importances.items():
            for sensor in SENSOR_DISPLAY:
                sensor_parts = sensor.split("_")
                if all(p in feat for p in sensor_parts):
                    if sensor not in sensor_scores:
                        sensor_scores[sensor] = 0.0
                    sensor_scores[sensor] += float(importance)
                    break

        if not sensor_scores:
            return {}

        total = sum(sensor_scores.values()) or 1.0
        result = {}
        for sensor, score in sorted(sensor_scores.items(), key=lambda x: -x[1])[:8]:
            mean_col = f"{sensor}_mean"
            current_mean = float(X_aligned[mean_col].iloc[-1]) if mean_col in X_aligned.columns else None
            result[sensor] = {
                "display_name": SENSOR_DISPLAY.get(sensor, sensor),
                "contribution": round(score / total, 3),
                "current_mean": round(current_mean, 3) if current_mean is not None else None,
                "status": "degrading" if (score / total) > 0.15 and prob > 0.5 else "nominal",
            }
        return result

    def _top_failure_modes(self, prob: float, sensor_contributions: dict) -> list:
        """
        Map high-contribution sensors to likely failure modes.
        Returns top 3 failure modes with estimated probabilities.
        """
        mode_scores = {}

        for mode_name, mode in FAILURE_MODES.items():
            affected = mode.sensor_names()
            overlap = sum(
                sensor_contributions.get(s, {}).get("contribution", 0)
                for s in affected
                if s in sensor_contributions
            )
            if overlap > 0:
                mode_scores[mode_name] = overlap

        total = sum(mode_scores.values()) or 1.0
        top = sorted(mode_scores.items(), key=lambda x: -x[1])[:3]

        return [
            {
                "mode": name,
                "display_name": FAILURE_MODES[name].display_name,
                "probability": round((score / total) * prob, 3),
                "dtc_code": FAILURE_MODES[name].dtc_code,
                "repair_cost_oem": FAILURE_MODES[name].repair_cost_oem,
                "repair_cost_aftermarket": FAILURE_MODES[name].repair_cost_aftermarket,
                "severity": FAILURE_MODES[name].severity,
            }
            for name, score in top
        ]

    def predict(self, vehicle_id: str, lookback_days: int = 7) -> dict:
        """
        Full prediction pipeline for one vehicle.
        Returns a dict matching the API response schema.
        """
        wide = self._load_vehicle_data(vehicle_id, lookback_days)
        featured = self._build_features(wide)
        X = self._align_features(featured.copy())

        probs = self.model.predict(X)
        # Use the most recent day's prediction
        prob = float(probs[-1]) if len(probs) > 0 else 0.0
        confidence = float(np.std(probs[-min(3, len(probs)):]))
        confidence_score = round(max(0.0, min(1.0, 1.0 - confidence * 4)), 2)

        severity = self._probability_to_severity(prob)
        days_estimate = self._estimate_days_to_failure(prob)
        sensor_contribs = self._get_sensor_contributions(X, prob)
        top_modes = self._top_failure_modes(prob, sensor_contribs)

        return {
            "vehicle_id": vehicle_id,
            "predicted_at": datetime.utcnow().isoformat(),
            "overall_failure_probability": round(prob, 4),
            "days_to_failure_estimate": days_estimate,
            "severity": severity,
            "sensors": sensor_contribs,
            "top_failure_modes": top_modes,
            "model_version": self.model_version,
            "confidence": confidence_score,
            "lookback_days": lookback_days,
        }


def precompute_demo_predictions(predictor: ForesightPredictor) -> dict:
    """
    Pre-compute predictions for all 5 demo vehicles.
    Called once after training and saved to demo_predictions.json.
    """
    demo_ids = ["DEMO-001", "DEMO-002", "DEMO-003", "DEMO-004", "DEMO-005"]
    results = {}

    for vid in demo_ids:
        try:
            pred = predictor.predict(vid, lookback_days=14)
            results[vid] = pred
            log.info(f"  {vid}: prob={pred['overall_failure_probability']:.3f} "
                     f"severity={pred['severity']}")
        except Exception as e:
            log.warning(f"  {vid}: failed — {e}")

    return results
