"""
engine/injector.py

FailureInjector wraps a TelemetryGenerator and applies one FailureMode's
degradation curves to the affected sensors based on the current simulation day.

The generator produces healthy readings. The injector intercepts the output,
replaces affected sensor values with degraded ones, and attaches labels.

This keeps the generator completely unaware of failure logic — it only ever
produces healthy data. The injector is a transparent wrapper.

Flow per tick:
  1. Compute degradation_factor for current day
  2. Ask generator for healthy readings (via gen.tick())
  3. For each affected sensor in the readings:
       a. Retrieve the healthy value
       b. Pass to effect_fn(healthy, factor, rng) → degraded_value
       c. Replace the reading's value with the degraded value
       d. Update is_healthy and degradation_factor on the reading
  4. Check if DTC threshold crossed → emit DTCEvent
  5. Return modified readings + current FailureLabel
"""

from __future__ import annotations
from datetime import datetime
from typing import Dict, List, Optional, Tuple

import numpy as np

# These imports assume odin-telemetry is on PYTHONPATH
from core.reading import TelemetryReading
from stream.generator import TelemetryGenerator

from core.config import InjectionConfig
from core.event import DTCEvent, FailureLabel, factor_to_severity
from curves.base import get_curve, BaseCurve
from curves.library import FailureMode, get_failure_mode


class FailureInjector:
    """
    Wraps a TelemetryGenerator with a single FailureMode injection.
    
    Usage:
        gen = TelemetryGenerator(profile)
        config = InjectionConfig.from_failure_mode("o2_sensor", failure_start_day=10)
        injector = FailureInjector(gen, config)
        
        for day in range(60):
            label = injector.advance_day()   # Returns FailureLabel for this day
    
    Or tick-by-tick:
        readings, label = injector.tick()
    """

    def __init__(self, generator: TelemetryGenerator, config: InjectionConfig):
        self.gen = generator
        self.config = config
        self.failure_mode: FailureMode = get_failure_mode(config.failure_mode_name)
        self._curve: BaseCurve = get_curve(config.curve_shape)

        # Separate RNG for effect functions — seeded from vehicle seed + offset
        # so it's deterministic but different from generator's RNG
        self._rng = np.random.default_rng(
            generator.profile.seed ^ (config.seed_offset + 0xCAFEBABE)
        )

        # Build effect lookup: sensor_name → effect_fn
        self._effects: Dict = {
            e.sensor_name: e.effect_fn
            for e in self.failure_mode.affected_sensors
        }

        # State
        self._dtc_event: Optional[DTCEvent] = None
        self._dtc_fired: bool = False
        self._current_factor: float = 0.0
        self._cached_dtc_estimate: Dict = {}  # day → days_to_dtc (cache per day)

    # ── Properties ─────────────────────────────────────────────────────────

    @property
    def dtc_fired(self) -> bool:
        return self._dtc_fired

    @property
    def dtc_event(self) -> Optional[DTCEvent]:
        return self._dtc_event

    @property
    def current_factor(self) -> float:
        return self._current_factor

    # ── Core tick ──────────────────────────────────────────────────────────

    def tick(self) -> Tuple[List[TelemetryReading], FailureLabel]:
        """
        Advance simulation by one second.
        Returns (readings, label) where label reflects the current day's state.
        """
        day = self.gen.day
        factor = self._curve.factor(
            current_day=day,
            failure_start_day=self.config.failure_start_day,
            progression_days=self.config.progression_days,
        )
        self._current_factor = factor

        # Build overrides for affected sensors
        overrides: Dict[str, float] = {}
        if factor > 0.0:
            # We need to know which sensors will fire this tick
            from core.specs import sensors_due_at_tick
            due = sensors_due_at_tick(self.gen.global_tick)
            for sensor_name in due:
                if sensor_name in self._effects:
                    # Get healthy value by temporarily running generator peek
                    # We approximate healthy value from spec midpoint for the effect fn
                    # The effect fn blends from healthy → degraded, so approximation is fine
                    from core.specs import get_sensor
                    from profiles.driving import get_profile_range, profile_for_time
                    spec = get_sensor(sensor_name)
                    profile_key = profile_for_time(
                        self.gen.current_time.hour,
                        self.gen.current_time.minute,
                        self.gen.profile.driving_profile,
                        self.gen._tick_of_day,
                    )
                    lo, hi = get_profile_range(profile_key, sensor_name, spec.healthy_range)
                    healthy_approx = (lo + hi) / 2.0
                    effect_fn = self._effects[sensor_name]
                    degraded = effect_fn(healthy_approx, factor, self._rng)
                    degraded = spec.clip(degraded)
                    overrides[sensor_name] = degraded

        # Get readings from generator (with our overrides applied)
        readings = self.gen.tick(overrides=overrides if overrides else None)

        # Tag readings with injection metadata
        is_healthy_reading = factor < 0.60
        for r in readings:
            r.degradation_factor = round(factor, 5)
            if r.sensor_name in self._effects and factor >= 0.60:
                r.is_healthy = False
                if self._dtc_fired:
                    r.source = f"sim_dtc_{self.failure_mode.dtc_code}"

        # Check DTC threshold
        if factor >= self.config.dtc_threshold and not self._dtc_fired:
            self._dtc_fired = True
            self._dtc_event = DTCEvent(
                vehicle_id=self.gen.profile.vehicle_id,
                failure_mode_name=self.failure_mode.name,
                dtc_code=self.failure_mode.dtc_code,
                dtc_description=self.failure_mode.dtc_description,
                fire_day=day,
                fire_timestamp=self.gen.current_time,
                degradation_factor_at_fire=factor,
            )

        # Compute days_to_dtc — cached per day since factor is day-constant
        days_to_dtc = None
        if not self._dtc_fired and factor > 0.0:
            if day not in self._cached_dtc_estimate:
                self._cached_dtc_estimate[day] = self._estimate_days_to_dtc(day)
            days_to_dtc = self._cached_dtc_estimate[day]

        label = FailureLabel(
            vehicle_id=self.gen.profile.vehicle_id,
            day=day,
            failure_mode=self.failure_mode.name,
            dtc_code=self.failure_mode.dtc_code,
            degradation_factor=factor,
            days_to_dtc=days_to_dtc,
        )

        return readings, label

    def _estimate_days_to_dtc(self, current_day: int) -> Optional[int]:
        """Scan forward to find how many days until DTC threshold is reached."""
        for d in range(current_day, current_day + self.config.progression_days + 30):
            f = self._curve.factor(d, self.config.failure_start_day, self.config.progression_days)
            if f >= self.config.dtc_threshold:
                return d - current_day
        return None  # Threshold not reached in scan window

    # ── Day-level methods ──────────────────────────────────────────────────

    def advance_day(
        self,
        on_readings: Optional = None,
    ) -> FailureLabel:
        """
        Run one full day of injected simulation.
        on_readings: optional callback(readings) called after each tick.
        Returns the FailureLabel for this day (uses last tick's label).
        """
        from stream.generator import SECONDS_PER_DAY
        last_label = None

        for _ in range(SECONDS_PER_DAY):
            readings, label = self.tick()
            last_label = label
            if on_readings:
                on_readings(readings)

        return last_label

    def run_days(
        self,
        n_days: int,
        on_day: Optional = None,
    ) -> Tuple[List[FailureLabel], Optional[DTCEvent]]:
        """
        Run N days of injected simulation.
        on_day: callback(day_index, day_readings, label) → None
        Returns (list of daily labels, DTCEvent or None).
        """
        all_labels: List[FailureLabel] = []

        for day_index in range(n_days):
            day_readings: List[TelemetryReading] = []

            def collect(readings):
                day_readings.extend(readings)

            label = self.advance_day(on_readings=collect)
            all_labels.append(label)

            if on_day:
                on_day(day_index, day_readings, label)

        return all_labels, self._dtc_event

    def summary(self) -> dict:
        return {
            "vehicle_id": self.gen.profile.vehicle_id,
            "failure_mode": self.failure_mode.display_name,
            "dtc_code": self.failure_mode.dtc_code,
            "failure_start_day": self.config.failure_start_day,
            "progression_days": self.config.progression_days,
            "curve_shape": self.config.curve_shape,
            "dtc_fired": self._dtc_fired,
            "dtc_fire_day": self._dtc_event.fire_day if self._dtc_event else None,
            "repair_cost_oem": self.failure_mode.repair_cost_oem,
            "repair_cost_aftermarket": self.failure_mode.repair_cost_aftermarket,
            "severity": self.failure_mode.severity,
        }
