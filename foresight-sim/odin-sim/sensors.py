"""
sim/sensors.py
OBD-II sensor definitions, healthy baseline ranges, and per-driving-profile modifiers.
All values derived from real OBD-II PID specifications.
"""

from dataclasses import dataclass, field
from typing import Tuple, Dict
import numpy as np


@dataclass
class SensorSpec:
    pid: str                          # OBD-II PID code
    name: str                         # Human-readable name
    unit: str                         # Unit of measurement
    healthy_range: Tuple[float, float]  # (min, max) under normal operation
    critical_range: Tuple[float, float] # (min, max) — outside = fault territory
    noise_std: float                  # Gaussian noise std dev for realism
    sample_rate_hz: float             # How often this sensor reports (per second)


# Core OBD-II sensors modeled in the simulation
SENSORS: Dict[str, SensorSpec] = {
    "rpm": SensorSpec(
        pid="010C",
        name="Engine RPM",
        unit="rpm",
        healthy_range=(700, 3500),
        critical_range=(500, 6500),
        noise_std=25.0,
        sample_rate_hz=1.0,
    ),
    "coolant_temp": SensorSpec(
        pid="0105",
        name="Coolant Temperature",
        unit="°C",
        healthy_range=(85, 105),
        critical_range=(50, 130),
        noise_std=0.5,
        sample_rate_hz=0.5,
    ),
    "o2_voltage_b1s1": SensorSpec(
        pid="0114",
        name="O2 Sensor Voltage (Bank 1, Sensor 1)",
        unit="V",
        healthy_range=(0.1, 0.9),
        critical_range=(0.0, 1.2),
        noise_std=0.02,
        sample_rate_hz=2.0,
    ),
    "o2_voltage_b1s2": SensorSpec(
        pid="0115",
        name="O2 Sensor Voltage (Bank 1, Sensor 2)",
        unit="V",
        healthy_range=(0.5, 0.8),   # Downstream — less oscillation than upstream
        critical_range=(0.0, 1.2),
        noise_std=0.01,
        sample_rate_hz=1.0,
    ),
    "maf": SensorSpec(
        pid="0110",
        name="Mass Air Flow",
        unit="g/s",
        healthy_range=(2.0, 25.0),
        critical_range=(0.5, 50.0),
        noise_std=0.3,
        sample_rate_hz=1.0,
    ),
    "throttle_position": SensorSpec(
        pid="0111",
        name="Throttle Position",
        unit="%",
        healthy_range=(0.0, 100.0),
        critical_range=(0.0, 100.0),
        noise_std=0.5,
        sample_rate_hz=2.0,
    ),
    "short_fuel_trim": SensorSpec(
        pid="0106",
        name="Short Term Fuel Trim (Bank 1)",
        unit="%",
        healthy_range=(-10.0, 10.0),
        critical_range=(-25.0, 25.0),
        noise_std=1.0,
        sample_rate_hz=1.0,
    ),
    "long_fuel_trim": SensorSpec(
        pid="0107",
        name="Long Term Fuel Trim (Bank 1)",
        unit="%",
        healthy_range=(-10.0, 10.0),
        critical_range=(-25.0, 25.0),
        noise_std=0.3,
        sample_rate_hz=0.2,
    ),
    "intake_air_temp": SensorSpec(
        pid="010F",
        name="Intake Air Temperature",
        unit="°C",
        healthy_range=(10, 60),
        critical_range=(-40, 100),
        noise_std=1.0,
        sample_rate_hz=0.5,
    ),
    "vehicle_speed": SensorSpec(
        pid="010D",
        name="Vehicle Speed",
        unit="km/h",
        healthy_range=(0, 130),
        critical_range=(0, 250),
        noise_std=1.0,
        sample_rate_hz=1.0,
    ),
    "battery_voltage": SensorSpec(
        pid="0142",
        name="Control Module Voltage",
        unit="V",
        healthy_range=(13.5, 14.7),
        critical_range=(11.0, 16.0),
        noise_std=0.05,
        sample_rate_hz=0.5,
    ),
    "catalyst_temp": SensorSpec(
        pid="013C",
        name="Catalyst Temperature (Bank 1, Sensor 1)",
        unit="°C",
        healthy_range=(400, 800),
        critical_range=(200, 1100),
        noise_std=5.0,
        sample_rate_hz=0.2,
    ),
    # ── Transmission sensors (TCM — accessed via ATSH7E1 / Mode 22) ───────────
    "trans_fluid_temp": SensorSpec(
        pid="2219F1",   # Mode 22 enhanced PID — common on GM/Ford platforms
        name="Transmission Fluid Temperature",
        unit="°C",
        healthy_range=(70, 90),
        critical_range=(-30, 150),
        noise_std=1.0,
        sample_rate_hz=0.5,
    ),
    "slip_rpm": SensorSpec(
        pid="2219F2",
        name="Transmission Slip RPM",
        unit="rpm",
        healthy_range=(0, 60),
        critical_range=(0, 2000),
        noise_std=5.0,
        sample_rate_hz=1.0,
    ),
    "line_pressure": SensorSpec(
        pid="2219F3",
        name="Transmission Line Pressure",
        unit="psi",
        healthy_range=(120, 160),
        critical_range=(0, 250),
        noise_std=2.0,
        sample_rate_hz=0.5,
    ),
    # ── ABS wheel speed sensors (ABS module — accessed via ATSH760) ───────────
    "wheel_speed_fl": SensorSpec(
        pid="C0001",
        name="Wheel Speed — Front Left",
        unit="km/h",
        healthy_range=(0, 130),
        critical_range=(0, 250),
        noise_std=1.0,
        sample_rate_hz=10.0,
    ),
    "wheel_speed_fr": SensorSpec(
        pid="C0002",
        name="Wheel Speed — Front Right",
        unit="km/h",
        healthy_range=(0, 130),
        critical_range=(0, 250),
        noise_std=1.0,
        sample_rate_hz=10.0,
    ),
    "wheel_speed_rl": SensorSpec(
        pid="C0003",
        name="Wheel Speed — Rear Left",
        unit="km/h",
        healthy_range=(0, 130),
        critical_range=(0, 250),
        noise_std=1.0,
        sample_rate_hz=10.0,
    ),
    "wheel_speed_rr": SensorSpec(
        pid="C0004",
        name="Wheel Speed — Rear Right",
        unit="km/h",
        healthy_range=(0, 130),
        critical_range=(0, 250),
        noise_std=1.0,
        sample_rate_hz=10.0,
    ),
}


# Driving profile modifiers — how each profile shifts baseline sensor values
DRIVING_PROFILES = {
    "city": {
        "rpm": (700, 2200),          # Lots of idle and low-speed
        "vehicle_speed": (0, 60),
        "throttle_position": (0, 40),
        "maf": (2.0, 12.0),
        "description": "Stop-and-go urban driving"
    },
    "highway": {
        "rpm": (1800, 3000),
        "vehicle_speed": (80, 130),
        "throttle_position": (20, 60),
        "maf": (8.0, 22.0),
        "description": "Sustained high-speed driving"
    },
    "cold_start": {
        "rpm": (900, 1400),          # High idle on cold start
        "vehicle_speed": (0, 20),
        "coolant_temp": (20, 85),    # Warming up
        "throttle_position": (0, 15),
        "maf": (2.0, 6.0),
        "description": "Engine warming up from cold"
    },
    "mixed": {
        "rpm": (700, 3000),
        "vehicle_speed": (0, 110),
        "throttle_position": (0, 70),
        "maf": (2.0, 20.0),
        "description": "Typical mixed daily driving"
    },
}


# Vehicle archetypes — different base health levels and mileage ranges
VEHICLE_ARCHETYPES = {
    "sedan_low_mileage": {
        "make_models": ["Toyota Camry", "Honda Accord", "Nissan Altima"],
        "mileage_range": (5000, 40000),
        "age_years": (0, 4),
        "base_health": 0.95,
        "preferred_profile": "mixed",
    },
    "sedan_high_mileage": {
        "make_models": ["Toyota Camry", "Honda Accord", "Nissan Altima"],
        "mileage_range": (80000, 180000),
        "age_years": (6, 15),
        "base_health": 0.70,
        "preferred_profile": "city",
    },
    "truck_work": {
        "make_models": ["Ford F-150", "Chevy Silverado", "RAM 1500"],
        "mileage_range": (40000, 150000),
        "age_years": (3, 10),
        "base_health": 0.80,
        "preferred_profile": "mixed",
    },
    "suv_family": {
        "make_models": ["Toyota RAV4", "Honda CR-V", "Ford Explorer"],
        "mileage_range": (20000, 100000),
        "age_years": (2, 8),
        "base_health": 0.85,
        "preferred_profile": "mixed",
    },
    "economy_beater": {
        "make_models": ["Honda Civic", "Toyota Corolla", "Hyundai Elantra"],
        "mileage_range": (100000, 220000),
        "age_years": (8, 18),
        "base_health": 0.60,
        "preferred_profile": "city",
    },
}


def get_sensor(name: str) -> SensorSpec:
    if name not in SENSORS:
        raise ValueError(f"Unknown sensor: {name}. Available: {list(SENSORS.keys())}")
    return SENSORS[name]


def healthy_reading(sensor_name: str, profile: str = "mixed", rng: np.random.Generator = None) -> float:
    """Generate a single healthy reading for a sensor under a given driving profile."""
    if rng is None:
        rng = np.random.default_rng()

    spec = get_sensor(sensor_name)
    profile_data = DRIVING_PROFILES.get(profile, DRIVING_PROFILES["mixed"])

    # Use profile-specific range if defined, else fall back to healthy_range
    if sensor_name in profile_data:
        lo, hi = profile_data[sensor_name]
    else:
        lo, hi = spec.healthy_range

    base = rng.uniform(lo, hi)
    noise = rng.normal(0, spec.noise_std)
    return float(np.clip(base + noise, spec.critical_range[0], spec.critical_range[1]))
