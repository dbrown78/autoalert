"""
core/vehicle.py

VehicleProfile holds all fixed characteristics of a simulated vehicle.
Created once at simulation start, never mutated.

Archetypes are templates representing real-world vehicle segments.
The factory adds calibrated random variation within archetype bounds
so every vehicle feels distinct while staying in its class.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional, Dict, Tuple
import numpy as np


@dataclass(frozen=True)
class VehicleProfile:
    vehicle_id: str
    make_model: str
    year: int
    mileage_km: int
    base_health: float        # 0.0 (junk) → 1.0 (new). Scales noise floor.
    driving_profile: str      # Default profile key: city|highway|cold_start|mixed
    ambient_temp_c: float     # Ambient temperature at simulation start
    seed: int                 # RNG seed — same seed = identical stream

    @property
    def age_years(self) -> int:
        return 2025 - self.year

    @property
    def is_demo(self) -> bool:
        return self.vehicle_id.startswith("DEMO-")

    def __str__(self) -> str:
        return (
            f"{self.vehicle_id} | {self.year} {self.make_model} | "
            f"{self.mileage_km:,} km | health={self.base_health:.2f} | "
            f"profile={self.driving_profile}"
        )


# ─────────────────────────────────────────────────────────────────────────────
# ARCHETYPE DEFINITIONS
# Each archetype defines the population a vehicle is drawn from.
# All numeric ranges are (min, max) — uniform random within range.
# ─────────────────────────────────────────────────────────────────────────────

ARCHETYPES: Dict[str, dict] = {

    "sedan_low_mileage": {
        "make_models": ["Toyota Camry", "Honda Accord", "Nissan Altima", "Mazda 6"],
        "year_range": (2020, 2024),
        "mileage_km_range": (5_000, 55_000),
        "base_health_range": (0.90, 0.99),
        "driving_profile": "mixed",
        "ambient_temp_range": (5.0, 30.0),
        "description": "Well-maintained modern sedan, low mileage",
    },

    "sedan_high_mileage": {
        "make_models": ["Toyota Camry", "Honda Accord", "Nissan Altima"],
        "year_range": (2010, 2018),
        "mileage_km_range": (120_000, 250_000),
        "base_health_range": (0.58, 0.78),
        "driving_profile": "city",
        "ambient_temp_range": (5.0, 35.0),
        "description": "Aging sedan, high mileage, showing wear",
    },

    "truck_work": {
        "make_models": ["Ford F-150", "Chevrolet Silverado 1500", "RAM 1500", "GMC Sierra"],
        "year_range": (2016, 2023),
        "mileage_km_range": (50_000, 200_000),
        "base_health_range": (0.70, 0.88),
        "driving_profile": "mixed",
        "ambient_temp_range": (-5.0, 40.0),
        "description": "Work truck, moderate to high mileage",
    },

    "suv_family": {
        "make_models": ["Toyota RAV4", "Honda CR-V", "Ford Explorer", "Chevrolet Equinox"],
        "year_range": (2018, 2024),
        "mileage_km_range": (20_000, 130_000),
        "base_health_range": (0.80, 0.96),
        "driving_profile": "mixed",
        "ambient_temp_range": (0.0, 35.0),
        "description": "Family SUV, typical suburban use",
    },

    "economy_beater": {
        "make_models": ["Honda Civic", "Toyota Corolla", "Hyundai Elantra", "Kia Forte"],
        "year_range": (2005, 2015),
        "mileage_km_range": (140_000, 320_000),
        "base_health_range": (0.42, 0.68),
        "driving_profile": "city",
        "ambient_temp_range": (5.0, 35.0),
        "description": "Old economy car, very high mileage, rough shape",
    },

    "performance_low_miles": {
        "make_models": ["Ford Mustang GT", "Chevrolet Camaro SS", "Dodge Charger R/T"],
        "year_range": (2018, 2024),
        "mileage_km_range": (5_000, 40_000),
        "base_health_range": (0.88, 0.99),
        "driving_profile": "highway",
        "ambient_temp_range": (10.0, 35.0),
        "description": "Modern performance car, low miles, highway profile",
    },

    "luxury_midrange": {
        "make_models": ["BMW 3 Series", "Mercedes C-Class", "Audi A4", "Lexus IS"],
        "year_range": (2016, 2023),
        "mileage_km_range": (30_000, 120_000),
        "base_health_range": (0.72, 0.92),
        "driving_profile": "mixed",
        "ambient_temp_range": (5.0, 30.0),
        "description": "Luxury midrange, higher maintenance costs",
    },
}

ARCHETYPE_NAMES = list(ARCHETYPES.keys())


def make_vehicle_profile(
    vehicle_id: str,
    archetype: str,
    seed: Optional[int] = None,
    overrides: Optional[dict] = None,
) -> VehicleProfile:
    """
    Create a VehicleProfile from an archetype with calibrated randomization.
    
    vehicle_id: unique identifier string
    archetype:  key from ARCHETYPES dict
    seed:       RNG seed (None = random)
    overrides:  dict of field overrides (e.g. {"driving_profile": "highway"})
    """
    if archetype not in ARCHETYPES:
        raise ValueError(
            f"Unknown archetype '{archetype}'.\n"
            f"Available: {ARCHETYPE_NAMES}"
        )

    arch = ARCHETYPES[archetype]
    rng = np.random.default_rng(seed)

    year = int(rng.integers(arch["year_range"][0], arch["year_range"][1] + 1))
    mileage = int(rng.integers(arch["mileage_km_range"][0], arch["mileage_km_range"][1]))
    
    health_lo, health_hi = arch["base_health_range"]
    # Slight skew: older/higher-mileage archetypes get health concentrated at lower end
    health = float(rng.beta(2, 3) * (health_hi - health_lo) + health_lo)
    
    make_model = str(rng.choice(arch["make_models"]))
    ambient_lo, ambient_hi = arch["ambient_temp_range"]
    ambient = float(rng.uniform(ambient_lo, ambient_hi))

    kwargs = dict(
        vehicle_id=vehicle_id,
        make_model=make_model,
        year=year,
        mileage_km=mileage,
        base_health=round(health, 4),
        driving_profile=arch["driving_profile"],
        ambient_temp_c=round(ambient, 1),
        seed=int(seed) if seed is not None else int(rng.integers(0, 2**31)),
    )

    if overrides:
        kwargs.update(overrides)

    return VehicleProfile(**kwargs)


def make_demo_vehicle(demo_id: str) -> VehicleProfile:
    """
    Return a fixed demo vehicle profile for Demo Mode.
    These are hardcoded so they're always the same in the app.
    """
    demos = {
        "DEMO-001": VehicleProfile(
            vehicle_id="DEMO-001",
            make_model="Honda Accord",
            year=2014,
            mileage_km=185_000,
            base_health=0.65,
            driving_profile="city",
            ambient_temp_c=18.0,
            seed=1001,
        ),
        "DEMO-002": VehicleProfile(
            vehicle_id="DEMO-002",
            make_model="Ford F-150",
            year=2018,
            mileage_km=98_000,
            base_health=0.78,
            driving_profile="mixed",
            ambient_temp_c=22.0,
            seed=1002,
        ),
        "DEMO-003": VehicleProfile(
            vehicle_id="DEMO-003",
            make_model="Toyota Corolla",
            year=2009,
            mileage_km=261_000,
            base_health=0.52,
            driving_profile="city",
            ambient_temp_c=20.0,
            seed=1003,
        ),
        "DEMO-004": VehicleProfile(
            vehicle_id="DEMO-004",
            make_model="Honda CR-V",
            year=2020,
            mileage_km=44_000,
            base_health=0.91,
            driving_profile="mixed",
            ambient_temp_c=16.0,
            seed=1004,
        ),
        "DEMO-005": VehicleProfile(
            vehicle_id="DEMO-005",
            make_model="Toyota Camry",
            year=2022,
            mileage_km=21_000,
            base_health=0.97,
            driving_profile="mixed",
            ambient_temp_c=20.0,
            seed=1005,
        ),
    }

    if demo_id not in demos:
        raise ValueError(f"Unknown demo vehicle '{demo_id}'. Available: {list(demos.keys())}")
    return demos[demo_id]
