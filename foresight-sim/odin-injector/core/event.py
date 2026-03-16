"""
core/event.py

DTCEvent: records the moment a DTC code fires during a simulation.
FailureLabel: per-reading ML training label attached to TelemetryReadings.

These are the ground truth outputs that make Foresight trainable.
Without labels, we have sensor data. With labels, we have training data.

Label schema (matches CLAUDE.md spec):
  failure_mode     — which failure was injected (None = healthy vehicle)
  dtc_code         — OBD-II code that would fire (None = healthy)
  degradation_factor — 0.0–1.0 (from the injector)
  days_to_dtc      — countdown to DTC fire day (None = healthy or DTC already fired)
  label_binary     — 1 if factor > 0.6 else 0  (pre-failure = positive class)
  label_severity   — "healthy" / "early" / "late" / "imminent"
"""

from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime
from typing import Optional


@dataclass
class DTCEvent:
    """Records when a DTC fires during a simulation run."""
    vehicle_id: str
    failure_mode_name: str
    dtc_code: str
    dtc_description: str
    fire_day: int
    fire_timestamp: datetime
    degradation_factor_at_fire: float   # Should be >= dtc_threshold (0.95)

    def to_dict(self) -> dict:
        return {
            "vehicle_id": self.vehicle_id,
            "failure_mode": self.failure_mode_name,
            "dtc_code": self.dtc_code,
            "dtc_description": self.dtc_description,
            "fire_day": self.fire_day,
            "fire_timestamp": self.fire_timestamp.isoformat(),
            "degradation_factor_at_fire": round(self.degradation_factor_at_fire, 4),
        }


# Phase boundaries — must match CLAUDE.md spec exactly
PHASE_HEALTHY_MAX = 0.60
PHASE_EARLY_MAX = 0.80
PHASE_LATE_MAX = 0.95
# >= PHASE_LATE_MAX → "imminent"


def factor_to_severity(factor: float) -> str:
    if factor < PHASE_HEALTHY_MAX:
        return "healthy"
    elif factor < PHASE_EARLY_MAX:
        return "early"
    elif factor < PHASE_LATE_MAX:
        return "late"
    else:
        return "imminent"


@dataclass
class FailureLabel:
    """
    ML training label for one simulated day of one vehicle.
    Attached to TelemetryReadings during the export pipeline.
    """
    vehicle_id: str
    day: int

    # None on healthy vehicles
    failure_mode: Optional[str]
    dtc_code: Optional[str]

    degradation_factor: float

    # None if no failure injected, or if DTC has already fired
    days_to_dtc: Optional[int]

    @property
    def label_binary(self) -> int:
        """1 = pre-failure (positive class), 0 = healthy (negative class)."""
        return 1 if self.degradation_factor >= PHASE_HEALTHY_MAX else 0

    @property
    def label_severity(self) -> str:
        return factor_to_severity(self.degradation_factor)

    def to_dict(self) -> dict:
        return {
            "vehicle_id": self.vehicle_id,
            "day": self.day,
            "failure_mode": self.failure_mode,
            "dtc_code": self.dtc_code,
            "degradation_factor": round(self.degradation_factor, 5),
            "days_to_dtc": self.days_to_dtc,
            "label_binary": self.label_binary,
            "label_severity": self.label_severity,
        }

    @classmethod
    def healthy(cls, vehicle_id: str, day: int) -> "FailureLabel":
        """Convenience constructor for a fully healthy day label."""
        return cls(
            vehicle_id=vehicle_id,
            day=day,
            failure_mode=None,
            dtc_code=None,
            degradation_factor=0.0,
            days_to_dtc=None,
        )

    @classmethod
    def csv_headers(cls) -> list[str]:
        return [
            "vehicle_id", "day", "failure_mode", "dtc_code",
            "degradation_factor", "days_to_dtc", "label_binary", "label_severity",
        ]

    def to_csv_row(self) -> list:
        return [
            self.vehicle_id,
            self.day,
            self.failure_mode,
            self.dtc_code,
            round(self.degradation_factor, 5),
            self.days_to_dtc,
            self.label_binary,
            self.label_severity,
        ]
