"""
features/registry.py

Registry of all feature definitions used in the Foresight model.
Documents what each feature is, how it's computed, and which failure modes it signals.

This is a reference document — not executed during training.
The actual computation is in features/engineer.py.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import List


@dataclass
class FeatureDefinition:
    name: str
    description: str
    source: str          # "sensor_stat" | "derived" | "vehicle_meta" | "temporal" | "lag"
    sensors: List[str]   # which raw sensors contribute
    failure_modes: List[str]  # which failure modes this feature flags


# ── Vehicle metadata features ─────────────────────────────────────────────────

VEHICLE_FEATURES = [
    FeatureDefinition(
        name="vehicle_age_years",
        description="Vehicle age in years (CURRENT_YEAR - manufacture year). Older = higher base failure risk.",
        source="vehicle_meta",
        sensors=[],
        failure_modes=["all"],
    ),
    FeatureDefinition(
        name="mileage_km_norm",
        description="Odometer normalized to 0-1 range (÷300,000 km). High mileage correlates with wear.",
        source="vehicle_meta",
        sensors=[],
        failure_modes=["all"],
    ),
    FeatureDefinition(
        name="base_health_inv",
        description="Inverted VehicleProfile base_health (1 - health). Higher value = worse starting condition.",
        source="vehicle_meta",
        sensors=[],
        failure_modes=["all"],
    ),
]

# ── Temporal features ─────────────────────────────────────────────────────────

TEMPORAL_FEATURES = [
    FeatureDefinition(
        name="day_normalized",
        description="Simulation day normalized to 0-1. Controls for burn-in period at start of sim.",
        source="temporal",
        sensors=[],
        failure_modes=[],
    ),
]

# ── Derived sensor combination features ──────────────────────────────────────

DERIVED_FEATURES = [
    FeatureDefinition(
        name="rpm_to_maf_ratio",
        description=(
            "Engine RPM ÷ mass air flow. Proxy for engine load efficiency. "
            "High ratio = engine working hard per unit air = potential injector or intake issue."
        ),
        source="derived",
        sensors=["rpm", "maf"],
        failure_modes=["fuel_injector", "maf_sensor"],
    ),
    FeatureDefinition(
        name="fuel_trim_delta",
        description=(
            "Long-term fuel trim − short-term fuel trim. "
            "Large positive delta: ECU compensating for sustained lean condition = O2/injector issue."
        ),
        source="derived",
        sensors=["long_fuel_trim", "short_fuel_trim"],
        failure_modes=["o2_sensor", "fuel_injector"],
    ),
    FeatureDefinition(
        name="o2_b1s1_range",
        description=(
            "Upstream O2 sensor oscillation range (max − min over the day). "
            "Healthy O2 oscillates 0.1–0.9V. Failing: range narrows to <0.3V."
        ),
        source="derived",
        sensors=["o2_voltage_b1s1"],
        failure_modes=["o2_sensor", "catalytic_converter"],
    ),
    FeatureDefinition(
        name="o2_b1s2_instability",
        description=(
            "Downstream O2 sensor std dev. "
            "Healthy downstream is stable. Cat failing: std rises as it mirrors upstream."
        ),
        source="derived",
        sensors=["o2_voltage_b1s2"],
        failure_modes=["catalytic_converter"],
    ),
    FeatureDefinition(
        name="coolant_variability",
        description=(
            "Coolant temperature std dev. High variance = thermostat sticking or temperature sensor drift."
        ),
        source="derived",
        sensors=["coolant_temp"],
        failure_modes=["thermostat", "coolant_temp_sensor"],
    ),
    FeatureDefinition(
        name="battery_headroom",
        description=(
            "Minimum battery voltage − 10.5V floor, clipped 0–6. "
            "Low headroom = alternator or battery approaching failure."
        ),
        source="derived",
        sensors=["battery_voltage"],
        failure_modes=["battery"],
    ),
    FeatureDefinition(
        name="cat_temp_per_rpm",
        description=(
            "Catalyst temperature ÷ RPM. Cat running disproportionately hot = "
            "misfiring or rich condition overloading the cat."
        ),
        source="derived",
        sensors=["catalyst_temp", "rpm"],
        failure_modes=["catalytic_converter", "misfire"],
    ),
]

# ── Sensor stat features (auto-generated in engineer.py) ─────────────────────
# Per sensor × {mean, std, min, max} = 4 stats × 12 sensors = 48 base features
# Per sensor mean × {lag3d, delta3d, lag7d, delta7d} = 4 lag × 12 sensors = 48 lag features
# Total sensor features: 48 + 48 = 96 (plus ~8 derived + 3 vehicle + 1 temporal = ~108 total)

SENSOR_NAMES = [
    "rpm",
    "coolant_temp",
    "intake_air_temp",
    "maf",
    "throttle_position",
    "o2_voltage_b1s1",
    "o2_voltage_b1s2",
    "catalyst_temp",
    "battery_voltage",
    "vehicle_speed",
    "short_fuel_trim",
    "long_fuel_trim",
]

ALL_FEATURES = VEHICLE_FEATURES + TEMPORAL_FEATURES + DERIVED_FEATURES
