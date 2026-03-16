"""
sim/generator.py
Generates a realistic OBD-II telemetry stream for a single vehicle.
Returns readings timestep by timestep. No failure injection here — 
pure healthy baseline generation. Injector wraps this.
"""

import numpy as np
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, Iterator, Optional
from sim.sensors import SENSORS, DRIVING_PROFILES, healthy_reading


@dataclass
class VehicleProfile:
    vehicle_id: str
    make_model: str
    year: int
    mileage: int
    driving_profile: str       # city | highway | cold_start | mixed
    base_health: float         # 0.0 → 1.0 (affects noise floor)
    ambient_temp_c: float = 20.0
    seed: Optional[int] = None


@dataclass
class TelemetryReading:
    vehicle_id: str
    timestamp: datetime
    day: int
    sensor_name: str
    value: float
    unit: str
    is_healthy: bool = True
    degradation_factor: float = 0.0
    source: str = "sim"        # Always "sim" — distinguishes from real user data


class TelemetryGenerator:
    """
    Generates a continuous stream of OBD-II sensor readings for a vehicle.
    Call next() to advance one timestep (1 second of simulated time).
    Readings per call = one reading per active sensor.
    """

    def __init__(self, profile: VehicleProfile, start_time: Optional[datetime] = None):
        self.profile = profile
        self.rng = np.random.default_rng(profile.seed)
        self.current_time = start_time or datetime(2024, 1, 1, 7, 0, 0)
        self.current_day = 0
        self.tick = 0  # Seconds elapsed
        self._sensor_names = list(SENSORS.keys())

        # Introduce slight per-vehicle personality offsets
        # (some cars run a bit hot, some idle a bit high)
        self._personality = {
            name: self.rng.normal(0, SENSORS[name].noise_std * 0.3)
            for name in self._sensor_names
        }

    def _driving_profile_for_time(self) -> str:
        """Switch profile based on simulated time of day."""
        hour = self.current_time.hour
        if 6 <= hour < 9 or 16 <= hour < 19:
            return "city"    # Rush hour
        elif 9 <= hour < 16:
            return self.profile.driving_profile
        elif hour < 6:
            return "cold_start" if self.tick % 86400 < 600 else "city"
        else:
            return "mixed"

    def _should_sample(self, sensor_name: str) -> bool:
        """Respect each sensor's sample rate."""
        rate = SENSORS[sensor_name].sample_rate_hz
        interval_ticks = int(1.0 / rate)
        return self.tick % max(interval_ticks, 1) == 0

    def step(self, override_sensors: Optional[Dict[str, float]] = None) -> list[TelemetryReading]:
        """
        Advance one second of simulation time.
        Returns a list of TelemetryReadings for sensors due to sample this tick.
        override_sensors: dict of sensor_name → value (used by Injector to insert degraded values)
        """
        readings = []
        profile_key = self._driving_profile_for_time()

        for sensor_name in self._sensor_names:
            if not self._should_sample(sensor_name):
                continue

            if override_sensors and sensor_name in override_sensors:
                value = override_sensors[sensor_name]
            else:
                value = healthy_reading(sensor_name, profile_key, self.rng)
                value += self._personality[sensor_name]
                # Health degradation adds baseline noise for older/worse-health vehicles
                health_noise = (1.0 - self.profile.base_health) * SENSORS[sensor_name].noise_std
                value += self.rng.normal(0, health_noise)

            spec = SENSORS[sensor_name]
            value = float(np.clip(value, spec.critical_range[0], spec.critical_range[1]))

            readings.append(TelemetryReading(
                vehicle_id=self.profile.vehicle_id,
                timestamp=self.current_time,
                day=self.current_day,
                sensor_name=sensor_name,
                value=round(value, 4),
                unit=spec.unit,
                source="sim",
            ))

        # Advance time
        self.tick += 1
        self.current_time += timedelta(seconds=1)
        if self.tick % 86400 == 0:
            self.current_day += 1

        return readings

    def run_day(self, override_fn=None) -> list[TelemetryReading]:
        """
        Run a full simulated day (86400 ticks).
        override_fn: optional callable(sensor_name, healthy_value, day) → value
        Returns all readings for the day.
        """
        all_readings = []
        seconds_in_day = 86400
        for _ in range(seconds_in_day):
            readings = self.step()
            all_readings.extend(readings)
        return all_readings

    def run_days(self, n_days: int, callback=None) -> list[TelemetryReading]:
        """
        Run N days of simulation.
        callback: optional fn(day, readings) for streaming to DB.
        """
        all_readings = []
        for day in range(n_days):
            day_readings = self.run_day()
            if callback:
                callback(day, day_readings)
            else:
                all_readings.extend(day_readings)
        return all_readings


def make_vehicle_profile(
    vehicle_id: str,
    archetype: str = "sedan_low_mileage",
    seed: Optional[int] = None,
    rng: Optional[np.random.Generator] = None,
) -> VehicleProfile:
    """
    Create a VehicleProfile from an archetype template with randomized specifics.
    """
    from sim.sensors import VEHICLE_ARCHETYPES
    import random

    if rng is None:
        rng = np.random.default_rng(seed)

    arch = VEHICLE_ARCHETYPES[archetype]
    mileage = int(rng.integers(arch["mileage_range"][0], arch["mileage_range"][1]))
    age = int(rng.integers(arch["age_years"][0], arch["age_years"][1]))
    make_model = rng.choice(arch["make_models"])
    year = 2024 - age
    health_jitter = rng.normal(0, 0.05)
    base_health = float(np.clip(arch["base_health"] + health_jitter, 0.3, 1.0))

    return VehicleProfile(
        vehicle_id=vehicle_id,
        make_model=make_model,
        year=year,
        mileage=mileage,
        driving_profile=arch["preferred_profile"],
        base_health=base_health,
        ambient_temp_c=float(rng.uniform(5, 35)),
        seed=int(rng.integers(0, 99999)) if seed is None else seed,
    )
