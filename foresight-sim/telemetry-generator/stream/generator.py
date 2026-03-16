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
from typing import Callable, Dict, List, Optional, Tuple

import numpy as np

from core.specs import SENSOR_REGISTRY, sensors_due_at_tick, get_sensor
from core.reading import TelemetryReading
from core.vehicle import VehicleProfile
from profiles.driving import get_profile_range, profile_for_time, PROFILES
from profiles.personality import generate_personality, PersonalityProfile


# Simulation starts at 07:00 on day 0 by default
DEFAULT_START_HOUR = 7
SECONDS_PER_DAY = 86_400

# Cached 1-second timedelta — avoids creating a new object every tick
_TD_1S = timedelta(seconds=1)

# LCM of all sample_interval_ticks values {1, 2, 5} = 10.
# The set of sensors due at any tick is fully determined by tick % 10.
_TICK_CYCLE = 10
_DUE_AT_TICK: Tuple[Tuple[str, ...], ...] = tuple(
    tuple(
        name for name, spec in SENSOR_REGISTRY.items()
        if tick % spec.sample_interval_ticks == 0
    )
    for tick in range(_TICK_CYCLE)
)


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

        # ── Per-sensor cache: (bias, effective_noise, c_min, c_max, unit) ──
        # Precomputed once at init; avoids dict lookups + attribute access per tick.
        self._sd: Dict[str, Tuple[float, float, float, float, str]] = {}
        for name, spec in SENSOR_REGISTRY.items():
            pers = self.personality.get(name)
            self._sd[name] = (
                pers.bias,
                spec.noise_std * pers.noise_scale,
                spec.critical_min,
                spec.critical_max,
                spec.unit,
            )

        # ── Per-profile, per-sensor (lo, hi) operating range cache ─────────
        # All 5 built-in profiles + the vehicle's own default (may overlap).
        all_profiles = set(PROFILES.keys()) | {profile.driving_profile}
        self._pr: Dict[str, Dict[str, Tuple[float, float]]] = {}
        for pname in all_profiles:
            self._pr[pname] = {
                name: get_profile_range(pname, name, spec.healthy_range)
                for name, spec in SENSOR_REGISTRY.items()
            }

        # ── Per-tick-of-day driving profile cache ───────────────────────────
        # profile_for_time() depends only on (hour, tick_of_day, default_profile),
        # all of which are known at init. Precompute to avoid datetime access per tick.
        start_sod = (
            self._start_time.hour * 3600
            + self._start_time.minute * 60
            + self._start_time.second
        )
        default = profile.driving_profile
        day_profiles: List[str] = []
        for tod in range(SECONDS_PER_DAY):
            if tod < 600:
                day_profiles.append("cold_start")
            else:
                sod = (start_sod + tod) % SECONDS_PER_DAY
                hour = sod // 3600
                if 6 <= hour < 9:
                    day_profiles.append("city")
                elif 9 <= hour < 16:
                    day_profiles.append(default)
                elif 16 <= hour < 19:
                    day_profiles.append("city")
                elif 19 <= hour < 22:
                    day_profiles.append("highway")
                else:
                    day_profiles.append("idle")
        self._day_profiles: Tuple[str, ...] = tuple(day_profiles)

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
        due_sensors = _DUE_AT_TICK[self._global_tick % _TICK_CYCLE]
        current_profile = self._day_profiles[self._tick_of_day]
        profile_ranges = self._pr[current_profile]
        sd = self._sd
        rng = self._rng

        # Cache frequently-accessed instance attributes as locals
        vid = self.profile.vehicle_id
        ts = self._current_time
        day = self._day
        tod = self._tick_of_day

        if overrides:
            # Override path: can't batch RNG because some sensors use override values
            readings: List[TelemetryReading] = []
            for name in due_sensors:
                bias, eff_noise, c_min, c_max, unit = sd[name]
                if name in overrides:
                    raw = overrides[name]
                else:
                    lo, hi = profile_ranges[name]
                    raw = rng.uniform(lo, hi) + bias + rng.normal(0, eff_noise)
                value = round(max(c_min, min(c_max, raw)), 5)
                readings.append(TelemetryReading(
                    vehicle_id=vid,
                    timestamp=ts,
                    day=day,
                    tick=tod,
                    sensor_name=name,
                    value=value,
                    unit=unit,
                    is_healthy=True,
                    degradation_factor=0.0,
                    source="sim",
                ))
        else:
            # Fast path: batch all RNG calls for this tick into two array draws.
            # rng.uniform(0,1,n) + rng.standard_normal(n) replaces 2n individual calls,
            # cutting numpy function-call overhead from 2×n to 2 per tick.
            n = len(due_sensors)
            raw_u = rng.uniform(0.0, 1.0, n)
            raw_n = rng.standard_normal(n)
            readings = []
            for i, name in enumerate(due_sensors):
                lo, hi = profile_ranges[name]
                bias, eff_noise, c_min, c_max, unit = sd[name]
                raw = lo + raw_u[i] * (hi - lo) + bias + raw_n[i] * eff_noise
                value = round(max(c_min, min(c_max, raw)), 5)
                readings.append(TelemetryReading(
                    vehicle_id=vid,
                    timestamp=ts,
                    day=day,
                    tick=tod,
                    sensor_name=name,
                    value=value,
                    unit=unit,
                    is_healthy=True,
                    degradation_factor=0.0,
                    source="sim",
                ))

        # Advance clock (use cached timedelta constant)
        self._global_tick += 1
        self._tick_of_day += 1
        self._current_time += _TD_1S

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
        self._current_time = start_time or self._start_time
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
