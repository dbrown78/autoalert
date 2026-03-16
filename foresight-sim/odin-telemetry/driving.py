"""
profiles/driving.py

Driving profiles define how sensor operating ranges shift under
different driving conditions. Each profile is a dict of:
    sensor_name → (lo, hi) override of the healthy_range

If a sensor isn't listed in the profile, it uses its spec's healthy_range.

Time-of-day switching:
    06:00–08:59  → city       (morning rush)
    09:00–11:59  → vehicle's default profile
    12:00–15:59  → vehicle's default profile
    16:00–18:59  → city       (evening rush)
    19:00–21:59  → highway    (open road post-rush)
    22:00–05:59  → cold_start for first 10 min, then city
"""

from typing import Dict, Optional, Tuple
from datetime import datetime


# Profile definitions: sensor_name → (lo, hi) operating range
# Ranges are a subset of the sensor's healthy_range from specs.py
PROFILES: Dict[str, Dict[str, Tuple[float, float]]] = {

    "city": {
        # Stop-and-go, lots of idle, low speed
        "rpm":               (650,  2400),
        "vehicle_speed":     (0,    55),
        "throttle_position": (0,    38),
        "maf":               (2.5,  11.0),
        "coolant_temp":      (82,   102),
        "catalyst_temp":     (420,  650),
        "short_fuel_trim":   (−6,   8),
    },

    "highway": {
        # Sustained speed, higher load, stable temps
        "rpm":               (1800, 3200),
        "vehicle_speed":     (90,   145),
        "throttle_position": (18,   65),
        "maf":               (10.0, 28.0),
        "coolant_temp":      (88,   105),
        "catalyst_temp":     (560,  820),
        "short_fuel_trim":   (−5,   6),
        "battery_voltage":   (13.6, 14.8),
    },

    "cold_start": {
        # Engine warming up — low speed, rising temps, rich mixture
        "rpm":               (900,  1500),    # High cold idle
        "vehicle_speed":     (0,    25),
        "throttle_position": (0,    12),
        "maf":               (2.5,  7.0),
        "coolant_temp":      (20,   82),      # Below normal — engine warming
        "short_fuel_trim":   (−15,  −2),      # Rich mixture while cold
        "long_fuel_trim":    (−8,   5),
        "o2_voltage_b1s1":   (0.08, 0.60),   # O2 unreliable until warm
        "catalyst_temp":     (100,  450),     # Cat heating up
    },

    "mixed": {
        # Typical daily driving — blend of all modes
        "rpm":               (650,  3200),
        "vehicle_speed":     (0,    110),
        "throttle_position": (0,    65),
        "maf":               (2.5,  22.0),
        "coolant_temp":      (82,   106),
        "catalyst_temp":     (420,  780),
        "short_fuel_trim":   (−8,   8),
    },

    "idle": {
        # Sitting in traffic or parked with engine on
        "rpm":               (650,  900),
        "vehicle_speed":     (0,    2),
        "throttle_position": (0,    5),
        "maf":               (2.5,  4.5),
        "coolant_temp":      (88,   108),
        "catalyst_temp":     (420,  560),
        "short_fuel_trim":   (−5,   8),
        "battery_voltage":   (13.4, 14.4),
    },
}

PROFILE_NAMES = list(PROFILES.keys())


def get_profile_range(profile: str, sensor_name: str, fallback: Tuple[float, float]) -> Tuple[float, float]:
    """
    Return the operating range for a sensor under a given driving profile.
    Falls back to the spec's healthy_range if the profile doesn't specify it.
    """
    profile_data = PROFILES.get(profile, PROFILES["mixed"])
    return profile_data.get(sensor_name, fallback)


def profile_for_time(hour: int, minute: int, default_profile: str, tick_of_day: int = 0) -> str:
    """
    Select driving profile based on time of day.
    
    hour:            0–23
    minute:          0–59
    default_profile: vehicle's preferred profile (from VehicleProfile)
    tick_of_day:     seconds elapsed since midnight (for cold start detection)
    """
    # Cold start window: first 10 minutes of simulation day
    if tick_of_day < 600:
        return "cold_start"

    if 6 <= hour < 9:
        return "city"           # Morning rush
    elif 9 <= hour < 16:
        return default_profile  # Mid-day — vehicle's character
    elif 16 <= hour < 19:
        return "city"           # Evening rush
    elif 19 <= hour < 22:
        return "highway"        # Post-rush open road
    else:
        return "idle"           # Late night / overnight idle or parked


def describe_profile(profile: str) -> str:
    descriptions = {
        "city":       "Stop-and-go urban driving — low speed, frequent idle",
        "highway":    "Sustained highway speed — high load, stable temperature",
        "cold_start": "Engine warming up from cold — rich mixture, rising temps",
        "mixed":      "Typical daily driving — blend of urban and highway",
        "idle":       "Sitting still with engine running",
    }
    return descriptions.get(profile, f"Unknown profile: {profile}")
