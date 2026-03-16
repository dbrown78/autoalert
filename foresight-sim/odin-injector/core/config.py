"""
core/config.py

InjectionConfig holds all parameters for a single failure injection run.
One config = one failure on one vehicle.

For multi-failure vehicles, the Scheduler holds a list of InjectionConfigs
and applies them all to the same TelemetryGenerator.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal, Optional


CurveShape = Literal["sigmoid", "linear", "exponential", "step"]


@dataclass
class InjectionConfig:
    # Which failure mode to inject (must be a key in curves/library.py FAILURE_MODES)
    failure_mode_name: str

    # Day on which degradation begins (0-indexed, matches TelemetryGenerator.day)
    failure_start_day: int

    # Days from failure_start_day for degradation_factor to reach 1.0
    # Set to failure_mode.typical_progression_days by default in factory
    progression_days: int

    # Shape of the degradation curve
    curve_shape: CurveShape = "sigmoid"

    # degradation_factor at which the DTC event fires
    # 0.95 matches real-world behavior: OBD systems trip when signal is
    # consistently abnormal, not at first deviation
    dtc_threshold: float = 0.95

    # Seed offset — added to the vehicle seed to vary the exact noise pattern
    # during degradation (so two vehicles with the same failure look slightly different)
    seed_offset: int = 0

    def validate(self):
        if self.failure_start_day < 0:
            raise ValueError(f"failure_start_day must be >= 0, got {self.failure_start_day}")
        if self.progression_days <= 0:
            raise ValueError(f"progression_days must be > 0, got {self.progression_days}")
        if not 0.0 < self.dtc_threshold <= 1.0:
            raise ValueError(f"dtc_threshold must be in (0, 1], got {self.dtc_threshold}")

    def __post_init__(self):
        self.validate()

    @classmethod
    def from_failure_mode(
        cls,
        failure_mode_name: str,
        failure_start_day: int,
        curve_shape: CurveShape = "sigmoid",
        progression_scale: float = 1.0,
        seed_offset: int = 0,
    ) -> "InjectionConfig":
        """
        Create an InjectionConfig using the failure mode's typical_progression_days.
        progression_scale: multiplier on typical_progression_days (0.5 = faster, 2.0 = slower)
        """
        from curves.library import get_failure_mode
        mode = get_failure_mode(failure_mode_name)
        return cls(
            failure_mode_name=failure_mode_name,
            failure_start_day=failure_start_day,
            progression_days=max(1, int(mode.typical_progression_days * progression_scale)),
            curve_shape=curve_shape,
            seed_offset=seed_offset,
        )


# ── Writer config (PostgreSQL batch writer) ───────────────────────────────────

import os as _os


@dataclass(frozen=True)
class WriterConfig:
    batch_size: int        # Rows per execute_values call
    max_retries: int       # Retry attempts on OperationalError
    log_level: str         # DEBUG | INFO | WARNING
    pool_min: int          # Min connections in pool
    pool_max: int          # Max connections in pool

    @classmethod
    def from_env(cls) -> "WriterConfig":
        return cls(
            batch_size=int(_os.getenv("WRITER_BATCH_SIZE", "5000")),
            max_retries=int(_os.getenv("WRITER_MAX_RETRIES", "3")),
            log_level=_os.getenv("WRITER_LOG_LEVEL", "INFO"),
            pool_min=int(_os.getenv("WRITER_POOL_MIN", "2")),
            pool_max=int(_os.getenv("WRITER_POOL_MAX", "10")),
        )

    @classmethod
    def default(cls) -> "WriterConfig":
        return cls(
            batch_size=5000,
            max_retries=3,
            log_level="INFO",
            pool_min=2,
            pool_max=10,
        )

    @classmethod
    def fast(cls) -> "WriterConfig":
        """Aggressive settings for bulk bootstrap. Higher batch size, fewer retries."""
        return cls(
            batch_size=10_000,
            max_retries=2,
            log_level="WARNING",
            pool_min=2,
            pool_max=10,
        )
