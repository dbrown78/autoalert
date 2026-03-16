"""
stream/generator.py

TelemetryGenerator is the core of the simulation engine.
It produces a stream of TelemetryReadings, one tick at a time.

Architecture:
  - Each tick = 1 second of simulated time
  - Only sensors due at this tick (per sample_rate_hz) produce readings
  - Driving profile switches automatically based on time of day
  - Per-vehicle personality is applied before clipping
  - The Injector layer sits above this and overrides specific sensor values

Usage (direct):
    profile = make_vehicle_profile("SIM-001", "sedan_low_mileage", seed=42)
    gen = TelemetryGenerator(profile)
    
    # Single tick
    readings = gen.tick()
    
    # Full day
    readings = gen.run_day()
    
    # N days with streaming callback
    gen.run_days(30, on_day=lambda day, readings: write_to_db(readings))

Integration with Injector:
    # Injector calls gen.tick(overrides={"o2_voltage_b1s1": 0.42})
    # Generator applies the override AFTER personality, BEFORE clipping
    # The injector is responsible for setting is_healthy and degradation_factor
    # on the returned readings.
"""

from __future__ import annotations
from datetime import datetime, timedelta
from typing import Callable, Dict, List, Optional

import numpy as np

from core.specs import SENSOR_REGISTRY, sensors_due_at_tick, get_sensor
from core.reading import TelemetryReading
from core.vehicle import VehicleProfile
from profiles.driving import get_profile_range, profile_for_time
from profiles.personality import generate_personality, PersonalityProfile


# Simulation starts at 07:00 on day 0 by default
DEFAULT_START_HOUR = 7
SECONDS_PER_DAY = 86_400


class TelemetryGenerator:
    """
    Generates a deterministic, realistic OBD-II telemetry stream for one vehicle.
    
    All randomness is controlled by VehicleProfile.seed.
    Same seed → identical output on every run.
    """

    def __init__(
        self,
        profile: VehicleProfile,
        start_time: Optional[datetime] = None,
    ):
        self.profile = profile
        self.personality: PersonalityProfile = generate_personality(
            vehicle_id=profile.vehicle_id,
            seed=profile.seed,
            health=profile.base_health,
        )

        # RNG — seeded separately from personality so they don't interfere
        self._rng = np.random.default_rng(profile.seed ^ 0xDEADBEEF)

        # Simulation clock
        self._start_time = start_time or datetime(2024, 1, 1, DEFAULT_START_HOUR, 0, 0)
        self._current_time: datetime = self._start_time
        self._global_tick: int = 0      # Total ticks since simulation start
        self._tick_of_day: int = 0      # Ticks since start of current day
        self._day: int = 0              # Current simulation day (0-indexed)

    # ── Public properties ──────────────────────────────────────────────────

    @property
    def current_time(self) -> datetime:
        return self._current_time

    @property
    def day(self) -> int:
        return self._day

    @property
    def global_tick(self) -> int:
        return self._global_tick

    # ── Core tick method ───────────────────────────────────────────────────

    def tick(self, overrides: Optional[Dict[str, float]] = None) -> List[TelemetryReading]:
        """
        Advance simulation by one second.
        Returns a list of TelemetryReadings for all sensors due this tick.
        
        overrides: dict of sensor_name → value. If provided, the override value
                   replaces the generated value for that sensor. The Injector uses
                   this to insert degraded readings without replacing the generator.
        """
        readings: List[TelemetryReading] = []
        due_sensors = sensors_due_at_tick(self._global_tick)

        current_profile = profile_for_time(
            hour=self._current_time.hour,
            minute=self._current_time.minute,
            default_profile=self.profile.driving_profile,
            tick_of_day=self._tick_of_day,
        )

        for sensor_name in due_sensors:
            spec = get_sensor(sensor_name)
            pers = self.personality.get(sensor_name)

            if overrides and sensor_name in overrides:
                # Injector-supplied value — trust it, just clip to critical range
                raw_value = overrides[sensor_name]
            else:
                # Generate healthy reading
                lo, hi = get_profile_range(current_profile, sensor_name, spec.healthy_range)
                base = self._rng.uniform(lo, hi)

                # Apply personality bias (permanent offset for this vehicle)
                base += pers.bias

                # Apply sensor noise (Gaussian, scaled by personality and health)
                effective_noise = spec.noise_std * pers.noise_scale
                noise = self._rng.normal(0, effective_noise)
                raw_value = base + noise

            # Clip to physical limits
            value = spec.clip(raw_value)

            readings.append(TelemetryReading(
                vehicle_id=self.profile.vehicle_id,
                timestamp=self._current_time,
                day=self._day,
                tick=self._tick_of_day,
                sensor_name=sensor_name,
                value=round(value, 5),
                unit=spec.unit,
                is_healthy=True,        # Always True here; Injector overrides
                degradation_factor=0.0, # Always 0.0 here; Injector overrides
                source="sim",
            ))

        # Advance clock
        self._global_tick += 1
        self._tick_of_day += 1
        self._current_time += timedelta(seconds=1)

        # Day rollover
        if self._tick_of_day >= SECONDS_PER_DAY:
            self._tick_of_day = 0
            self._day += 1

        return readings

    # ── Batch methods ──────────────────────────────────────────────────────

    def run_day(self, override_fn: Optional[Callable] = None) -> List[TelemetryReading]:
        """
        Run one full simulated day (86,400 ticks).
        
        override_fn: optional callable(tick, sensor_name) → float | None
                     If it returns a value, that value is used as the override.
                     If it returns None, the generator produces the normal value.
        """
        day_readings: List[TelemetryReading] = []

        for _ in range(SECONDS_PER_DAY):
            overrides = None
            if override_fn:
                tick = self._tick_of_day
                overrides = {}
                for sensor_name in sensors_due_at_tick(self._global_tick):
                    val = override_fn(tick, sensor_name)
                    if val is not None:
                        overrides[sensor_name] = val
                if not overrides:
                    overrides = None

            day_readings.extend(self.tick(overrides=overrides))

        return day_readings

    def run_days(
        self,
        n_days: int,
        on_day: Optional[Callable[[int, List[TelemetryReading]], None]] = None,
        collect: bool = True,
    ) -> Optional[List[TelemetryReading]]:
        """
        Run N days of simulation.
        
        on_day:  callback(day_index, readings) — called after each day.
                 Use for streaming to DB to avoid holding all readings in memory.
        collect: if True (and no on_day), return all readings in one list.
                 if False, readings are discarded after on_day callback (saves RAM).
        
        Returns all readings if collect=True and on_day is None.
        Returns None otherwise.
        """
        all_readings: List[TelemetryReading] = []

        for day_index in range(n_days):
            day_readings = self.run_day()

            if on_day:
                on_day(day_index, day_readings)
            elif collect:
                all_readings.extend(day_readings)

        return all_readings if collect and not on_day else None

    def reset(self, start_time: Optional[datetime] = None):
        """Reset the generator to its initial state. Same seed = same output."""
        self._rng = np.random.default_rng(self.profile.seed ^ 0xDEADBEEF)
        self._current_time = start_time or datetime(2024, 1, 1, DEFAULT_START_HOUR, 0, 0)
        self._global_tick = 0
        self._tick_of_day = 0
        self._day = 0

    def __repr__(self) -> str:
        return (
            f"TelemetryGenerator("
            f"vehicle={self.profile.vehicle_id}, "
            f"day={self._day}, "
            f"tick={self._tick_of_day}, "
            f"time={self._current_time.strftime('%H:%M:%S')})"
        )
