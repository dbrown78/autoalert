"""
sim/injector.py
Failure injection engine. Wraps TelemetryGenerator with a FailureMode,
activating degradation effects on the relevant sensors as the simulation
advances through the failure window.

Usage:
    injector = FailureInjector(
        generator=gen,
        failure_mode=FAILURE_MODES["o2_sensor"],
        failure_start_day=15,
        failure_window_days=45,
    )
    readings = injector.run_days(60)
    # Days 0–14: clean data
    # Days 15–60: degrading data with increasing severity
    # Day ~57+: DTC would trigger (factor ≥ 0.95)
"""

import numpy as np
from dataclasses import dataclass
from typing import Optional
from datetime import datetime

from sim.generator import TelemetryGenerator, VehicleProfile, TelemetryReading
from sim.degradation import FailureMode, compute_degradation_factor, get_failure_mode
from sim.sensors import SENSORS, healthy_reading


@dataclass
class InjectionConfig:
    failure_mode_name: str
    failure_start_day: int      # Which day degradation begins
    failure_window_days: int    # Days from start to reach factor=1.0
    curve: str = "sigmoid"      # sigmoid | linear | exponential
    dtc_threshold: float = 0.95 # degradation_factor at which DTC fires


class FailureInjector:
    """
    Wraps a TelemetryGenerator and applies failure degradation effects
    to the relevant sensors based on the current simulation day.
    """

    def __init__(
        self,
        generator: TelemetryGenerator,
        config: InjectionConfig,
    ):
        self.gen = generator
        self.config = config
        self.failure_mode: FailureMode = get_failure_mode(config.failure_mode_name)
        self._dtc_fired = False
        self._dtc_fire_day: Optional[int] = None

        # Build a quick lookup: sensor_name → effect_fn
        self._effect_map = {
            effect.sensor_name: effect.effect_fn
            for effect in self.failure_mode.affected_sensors
        }

    def _get_factor(self, day: int) -> float:
        return compute_degradation_factor(
            current_day=day,
            total_days=self.config.failure_window_days,
            failure_start_day=self.config.failure_start_day,
            curve=self.config.curve,
        )

    def step(self) -> list[TelemetryReading]:
        """
        Advance one second of sim time. If sensors are affected by the failure,
        compute degraded values and pass them as overrides to the generator.
        """
        day = self.gen.current_day
        factor = self._get_factor(day)

        # Check DTC trigger
        if factor >= self.config.dtc_threshold and not self._dtc_fired:
            self._dtc_fired = True
            self._dtc_fire_day = day

        # Build override dict for affected sensors due to sample this tick
        overrides = {}
        if factor > 0.0:
            for sensor_name, effect_fn in self._effect_map.items():
                if sensor_name not in SENSORS:
                    continue
                spec = SENSORS[sensor_name]
                # Generate what the healthy reading would be
                profile_key = self.gen._driving_profile_for_time()
                healthy = healthy_reading(sensor_name, profile_key, self.gen.rng)
                # Apply degradation effect
                degraded = effect_fn(healthy, factor, self.gen.rng)
                degraded = float(np.clip(degraded, spec.critical_range[0], spec.critical_range[1]))
                overrides[sensor_name] = degraded

        readings = self.gen.step(override_sensors=overrides if overrides else None)

        # Tag readings with degradation metadata
        for r in readings:
            r.degradation_factor = factor
            r.is_healthy = factor < 0.6
            if self._dtc_fired and r.sensor_name in self._effect_map:
                r.source = f"sim_dtc_{self.failure_mode.dtc_code}"

        return readings

    def run_days(self, n_days: int, callback=None) -> list[TelemetryReading]:
        """
        Run N days of injected simulation.
        callback(day, readings) → called after each day completes (use for streaming DB writes).
        """
        all_readings = []
        seconds_in_day = 86400

        for day in range(n_days):
            day_readings = []
            for _ in range(seconds_in_day):
                day_readings.extend(self.step())

            if callback:
                callback(day, day_readings, self._get_factor(day), self._dtc_fired)
            else:
                all_readings.extend(day_readings)

        return all_readings

    @property
    def dtc_fired(self) -> bool:
        return self._dtc_fired

    @property
    def dtc_fire_day(self) -> Optional[int]:
        return self._dtc_fire_day

    def summary(self) -> dict:
        return {
            "vehicle_id": self.gen.profile.vehicle_id,
            "failure_mode": self.failure_mode.display_name,
            "dtc_code": self.failure_mode.dtc_code,
            "failure_start_day": self.config.failure_start_day,
            "dtc_fired": self._dtc_fired,
            "dtc_fire_day": self._dtc_fire_day,
            "repair_cost_oem": self.failure_mode.repair_cost_oem,
            "repair_cost_aftermarket": self.failure_mode.repair_cost_aftermarket,
        }
