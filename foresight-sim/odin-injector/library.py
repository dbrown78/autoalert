"""
curves/library.py

The 10 FailureMode definitions. Each failure mode specifies:
  - Which sensors are affected
  - How each sensor's reading changes as degradation_factor increases
  - The DTC code that fires at threshold
  - Repair cost ranges (OEM vs aftermarket)

Effect function signature:
  (healthy_value: float, factor: float, rng: np.random.Generator) → float

Design rules:
  1. factor < 0.60 → effect function must return a value indistinguishable
     from healthy noise. The injector still calls it but the output must
     look clean. This is enforced by gating effects on factor >= 0.60.

  2. factor 0.60–0.80 → subtle drift. A trained eye might notice,
     a naive threshold would not. This is the "early detection" zone
     that Foresight is designed to catch.

  3. factor 0.80–0.95 → clearly abnormal. Performance symptoms visible.
     Short-term fuel trim spikes, RPM instability, etc.

  4. factor >= 0.95 → DTC zone. Reading is consistently out of spec.

  5. Effect functions must never produce values outside the sensor's
     critical_range. The injector clips outputs, but effects should be
     physically realistic, not wrap-around.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Tuple

import numpy as np


# Type alias for effect functions
EffectFn = Callable[[float, float, np.random.Generator], float]


@dataclass
class SensorEffect:
    sensor_name: str
    effect_fn: EffectFn
    description: str


@dataclass
class FailureMode:
    name: str
    display_name: str
    dtc_code: str
    dtc_description: str
    affected_sensors: List[SensorEffect]
    typical_progression_days: int
    severity: str                        # "low" | "medium" | "high" | "critical"
    repair_cost_oem: Tuple[int, int]     # (min, max) USD
    repair_cost_aftermarket: Tuple[int, int]
    default_curve: str = "sigmoid"

    def sensor_names(self) -> list[str]:
        return [e.sensor_name for e in self.affected_sensors]

    def get_effect(self, sensor_name: str) -> SensorEffect | None:
        for e in self.affected_sensors:
            if e.sensor_name == sensor_name:
                return e
        return None


# ── Shared helper functions ───────────────────────────────────────────────────

def _gate(factor: float, threshold: float = 0.60) -> float:
    """Return 0 if factor < threshold, else normalized progress past threshold."""
    if factor < threshold:
        return 0.0
    return (factor - threshold) / (1.0 - threshold)


def _sigmoid_blend(healthy: float, target: float, factor: float, steepness: float = 8.0) -> float:
    """Smoothly push value from healthy toward target as factor increases."""
    blend = 1.0 / (1.0 + np.exp(-steepness * (factor - 0.7)))
    return healthy + (target - healthy) * blend


def _erratic(value: float, factor: float, scale: float, rng: np.random.Generator,
             onset: float = 0.75) -> float:
    """Add increasingly erratic noise past onset factor."""
    if factor < onset:
        return value
    intensity = ((factor - onset) / (1.0 - onset)) ** 2
    return value + rng.normal(0, scale * intensity)


# ── FAILURE MODE 1: O2 Sensor (Upstream) ─────────────────────────────────────
# Upstream O2 oscillates 0.1V–0.9V in a healthy engine (closed-loop switching).
# Failing sensor: oscillation narrows toward a fixed midpoint (~0.45V), then flatlines.

def _o2_b1s1(healthy: float, factor: float, rng: np.random.Generator) -> float:
    g = _gate(factor)
    if g == 0.0:
        return healthy
    midpoint = 0.45
    narrowing = max(0.0, 1.0 - g * 1.2)
    drifted = midpoint + (healthy - midpoint) * narrowing
    return _erratic(drifted, factor, 0.04, rng)


def _short_trim_lean(healthy: float, factor: float, rng: np.random.Generator) -> float:
    """Fuel trim spikes as ECU compensates for bad O2 signal."""
    g = _gate(factor)
    return healthy + _sigmoid_blend(0, 18.0, factor) * g + rng.normal(0, 1.5 * max(g, 0.1))


def _long_trim_drift(healthy: float, factor: float, rng: np.random.Generator) -> float:
    g = _gate(factor)
    return healthy + _sigmoid_blend(0, 14.0, factor) * g


FAILURE_MODES: Dict[str, FailureMode] = {}

FAILURE_MODES["o2_sensor"] = FailureMode(
    name="o2_sensor",
    display_name="Oxygen Sensor (Upstream)",
    dtc_code="P0130",
    dtc_description="O2 Sensor Circuit Malfunction — Bank 1, Sensor 1",
    affected_sensors=[
        SensorEffect("o2_voltage_b1s1", _o2_b1s1,
                     "Voltage oscillation narrows then flatlines"),
        SensorEffect("short_fuel_trim", _short_trim_lean,
                     "Trim spikes as ECU compensates for bad signal"),
        SensorEffect("long_fuel_trim", _long_trim_drift,
                     "Long-term trim drifts positive"),
    ],
    typical_progression_days=60,
    severity="medium",
    repair_cost_oem=(150, 350),
    repair_cost_aftermarket=(60, 130),
)


# ── FAILURE MODE 2: Coolant Temperature Sensor ────────────────────────────────
# Stuck-hot is the most common failure mode — sensor reads high regardless of actual temp.
# ECU thinks engine is overheating → over-compensates → rich mixture.

def _coolant_stuck_hot(healthy: float, factor: float, rng: np.random.Generator) -> float:
    g = _gate(factor)
    if g == 0.0:
        return healthy
    drifted = _sigmoid_blend(healthy, 125.0, factor)
    return _erratic(drifted, factor, 6.0, rng)


def _short_trim_rich(healthy: float, factor: float, rng: np.random.Generator) -> float:
    g = _gate(factor)
    return healthy + _sigmoid_blend(0, 20.0, factor) * g + rng.normal(0, 2.0 * max(g, 0.1))


FAILURE_MODES["coolant_temp_sensor"] = FailureMode(
    name="coolant_temp_sensor",
    display_name="Coolant Temperature Sensor",
    dtc_code="P0116",
    dtc_description="Engine Coolant Temperature Circuit Range/Performance",
    affected_sensors=[
        SensorEffect("coolant_temp", _coolant_stuck_hot,
                     "Reading drifts toward stuck-hot (~125°C)"),
        SensorEffect("short_fuel_trim", _short_trim_rich,
                     "ECU over-enriching fuel mix in response"),
        SensorEffect("long_fuel_trim", _long_trim_drift,
                     "Persistent rich trim accumulates"),
    ],
    typical_progression_days=45,
    severity="medium",
    repair_cost_oem=(80, 200),
    repair_cost_aftermarket=(20, 60),
)


# ── FAILURE MODE 3: MAF Sensor ────────────────────────────────────────────────
# Contaminated MAF element reads low airflow → ECU over-fuels.
# RPM becomes rough at idle as fuel mixture goes rich.

def _maf_reads_low(healthy: float, factor: float, rng: np.random.Generator) -> float:
    g = _gate(factor)
    if g == 0.0:
        return healthy
    drifted = _sigmoid_blend(healthy, healthy * 0.35, factor)
    return _erratic(drifted, factor, 1.8, rng)


def _rpm_rough_idle(healthy: float, factor: float, rng: np.random.Generator) -> float:
    return _erratic(healthy, factor, 180.0, rng, onset=0.70)


FAILURE_MODES["maf_sensor"] = FailureMode(
    name="maf_sensor",
    display_name="Mass Air Flow Sensor",
    dtc_code="P0101",
    dtc_description="Mass Air Flow Circuit Range/Performance",
    affected_sensors=[
        SensorEffect("maf", _maf_reads_low,
                     "MAF reading drops as element contaminates"),
        SensorEffect("rpm", _rpm_rough_idle,
                     "RPM roughness at idle from rich mixture"),
        SensorEffect("long_fuel_trim", lambda h, f, rng:
                     h + _sigmoid_blend(0, 22.0, f) * _gate(f),
                     "Trim climbs as ECU compensates for low MAF"),
    ],
    typical_progression_days=90,
    severity="medium",
    repair_cost_oem=(200, 400),
    repair_cost_aftermarket=(50, 150),
)


# ── FAILURE MODE 4: Catalytic Converter ───────────────────────────────────────
# Healthy cat stores oxygen → downstream O2 is stable.
# Failing cat loses storage capacity → downstream O2 starts mirroring upstream.

def _cat_downstream_mirrors_upstream(healthy: float, factor: float,
                                      rng: np.random.Generator) -> float:
    g = _gate(factor)
    if g == 0.0:
        return healthy
    oscillation_amplitude = _sigmoid_blend(0, 0.38, factor) * g
    phase = rng.uniform(0, 2 * np.pi)
    return healthy + oscillation_amplitude * np.sin(phase) + rng.normal(0, 0.015)


def _cat_temp_high(healthy: float, factor: float, rng: np.random.Generator) -> float:
    g = _gate(factor)
    return healthy + _sigmoid_blend(0, 180.0, factor) * g + rng.normal(0, 8.0)


FAILURE_MODES["catalytic_converter"] = FailureMode(
    name="catalytic_converter",
    display_name="Catalytic Converter",
    dtc_code="P0420",
    dtc_description="Catalyst System Efficiency Below Threshold — Bank 1",
    affected_sensors=[
        SensorEffect("o2_voltage_b1s2", _cat_downstream_mirrors_upstream,
                     "Downstream O2 starts oscillating like upstream — cat can't store O2"),
        SensorEffect("catalyst_temp", _cat_temp_high,
                     "Cat runs hotter as efficiency drops"),
    ],
    typical_progression_days=180,
    severity="high",
    repair_cost_oem=(1200, 2500),
    repair_cost_aftermarket=(250, 600),
    default_curve="exponential",   # Cat degradation is gradual then accelerates
)


# ── FAILURE MODE 5: Throttle Position Sensor ─────────────────────────────────
# TPS glitches to 0% or 100% intermittently — engine stumbles, RPM spikes.

def _tps_glitch(healthy: float, factor: float, rng: np.random.Generator) -> float:
    g = _gate(factor, threshold=0.65)
    if g == 0.0:
        return healthy
    glitch_prob = g * 0.45
    if rng.random() < glitch_prob:
        return float(rng.choice([0.0, 100.0]))
    return _erratic(healthy, factor, 9.0, rng, onset=0.72)


def _rpm_stumble(healthy: float, factor: float, rng: np.random.Generator) -> float:
    return _erratic(healthy, factor, 320.0, rng, onset=0.68)


FAILURE_MODES["throttle_position_sensor"] = FailureMode(
    name="throttle_position_sensor",
    display_name="Throttle Position Sensor",
    dtc_code="P0122",
    dtc_description="Throttle/Pedal Position Sensor Circuit Low",
    affected_sensors=[
        SensorEffect("throttle_position", _tps_glitch,
                     "TPS glitches to 0% or 100% intermittently"),
        SensorEffect("rpm", _rpm_stumble,
                     "Engine stumbles when TPS drops signal"),
        SensorEffect("maf", lambda h, f, rng:
                     _erratic(h, f, 2.5, rng, onset=0.70),
                     "MAF fluctuates with TPS errors"),
    ],
    typical_progression_days=30,
    severity="high",
    repair_cost_oem=(150, 300),
    repair_cost_aftermarket=(40, 100),
)


# ── FAILURE MODE 6: Spark Plugs ───────────────────────────────────────────────
# Worn plugs cause intermittent misfires → RPM dips, O2 swings lean on unburned fuel.

def _spark_misfire_rpm(healthy: float, factor: float, rng: np.random.Generator) -> float:
    g = _gate(factor)
    if g == 0.0:
        return healthy
    if rng.random() < g * 0.28:
        return healthy - rng.uniform(120, 500)
    return healthy + rng.normal(0, 30)


def _o2_misfire_swing(healthy: float, factor: float, rng: np.random.Generator) -> float:
    return _erratic(healthy, factor, 0.09, rng, onset=0.65)


FAILURE_MODES["spark_plugs"] = FailureMode(
    name="spark_plugs",
    display_name="Spark Plugs",
    dtc_code="P0300",
    dtc_description="Random/Multiple Cylinder Misfire Detected",
    affected_sensors=[
        SensorEffect("rpm", _spark_misfire_rpm,
                     "Periodic RPM dips from misfire events"),
        SensorEffect("o2_voltage_b1s1", _o2_misfire_swing,
                     "O2 swings lean from unburned fuel on misfire"),
        SensorEffect("short_fuel_trim", lambda h, f, rng:
                     h + _sigmoid_blend(0, -12.0, f) * _gate(f),
                     "ECU trims back fuel in response to rich O2 spikes"),
    ],
    typical_progression_days=120,
    severity="medium",
    repair_cost_oem=(100, 250),
    repair_cost_aftermarket=(30, 80),
)


# ── FAILURE MODE 7: Battery / Alternator ─────────────────────────────────────
# Charging system weakens → voltage sags under load → ECU behavior erratic.

def _battery_voltage_sag(healthy: float, factor: float, rng: np.random.Generator) -> float:
    g = _gate(factor)
    if g == 0.0:
        return healthy
    sag = _sigmoid_blend(0, 3.2, factor) * g
    return _erratic(healthy - sag, factor, 0.35, rng)


def _rpm_low_voltage(healthy: float, factor: float, rng: np.random.Generator) -> float:
    g = _gate(factor)
    drop = _sigmoid_blend(0, 130.0, factor) * g
    return healthy - drop + rng.normal(0, 25)


FAILURE_MODES["battery_alternator"] = FailureMode(
    name="battery_alternator",
    display_name="Battery / Alternator",
    dtc_code="P0562",
    dtc_description="System Voltage Low",
    affected_sensors=[
        SensorEffect("battery_voltage", _battery_voltage_sag,
                     "Voltage sags under load as charging system weakens"),
        SensorEffect("rpm", _rpm_low_voltage,
                     "Idle drops as charging system loses capacity"),
    ],
    typical_progression_days=60,
    severity="high",
    repair_cost_oem=(200, 600),
    repair_cost_aftermarket=(80, 250),
)


# ── FAILURE MODE 8: EGR Valve ─────────────────────────────────────────────────
# Stuck open: excessive exhaust gas recirculation → rough idle, hot intake air.

def _egr_rpm_rough(healthy: float, factor: float, rng: np.random.Generator) -> float:
    g = _gate(factor, 0.65)
    drop = _sigmoid_blend(0, 220.0, factor) * g
    return healthy - drop + _erratic(0, factor, 110.0, rng, onset=0.72)


def _intake_temp_hot(healthy: float, factor: float, rng: np.random.Generator) -> float:
    g = _gate(factor)
    return healthy + _sigmoid_blend(0, 22.0, factor) * g


def _maf_displaced(healthy: float, factor: float, rng: np.random.Generator) -> float:
    g = _gate(factor)
    return healthy - _sigmoid_blend(0, 3.5, factor) * g


FAILURE_MODES["egr_valve"] = FailureMode(
    name="egr_valve",
    display_name="EGR Valve",
    dtc_code="P0401",
    dtc_description="Exhaust Gas Recirculation Flow Insufficient Detected",
    affected_sensors=[
        SensorEffect("rpm", _egr_rpm_rough,
                     "Rough idle as recirculated exhaust disrupts combustion"),
        SensorEffect("intake_air_temp", _intake_temp_hot,
                     "IAT rises as hot exhaust mixes into intake"),
        SensorEffect("maf", _maf_displaced,
                     "MAF reads low as EGR displaces fresh air"),
    ],
    typical_progression_days=90,
    severity="medium",
    repair_cost_oem=(300, 700),
    repair_cost_aftermarket=(80, 200),
)


# ── FAILURE MODE 9: Fuel Injector ─────────────────────────────────────────────
# Clogged injector delivers less fuel → lean condition → ECU enriches long-term trim.

def _lean_o2(healthy: float, factor: float, rng: np.random.Generator) -> float:
    g = _gate(factor)
    if g == 0.0:
        return healthy
    return _sigmoid_blend(healthy, 0.12, factor) + rng.normal(0, 0.02)


def _long_trim_compensate(healthy: float, factor: float, rng: np.random.Generator) -> float:
    g = _gate(factor)
    return healthy + _sigmoid_blend(0, 24.0, factor) * g + rng.normal(0, 1.2)


FAILURE_MODES["fuel_injector"] = FailureMode(
    name="fuel_injector",
    display_name="Fuel Injector",
    dtc_code="P0200",
    dtc_description="Injector Circuit Malfunction",
    affected_sensors=[
        SensorEffect("o2_voltage_b1s1", _lean_o2,
                     "O2 swings lean as injector fails to deliver fuel"),
        SensorEffect("long_fuel_trim", _long_trim_compensate,
                     "Long-term trim climbs hard as ECU compensates for lean condition"),
        SensorEffect("short_fuel_trim", lambda h, f, rng:
                     h + _sigmoid_blend(0, 16.0, f) * _gate(f) + rng.normal(0, 2.5),
                     "Short-term trim spikes on throttle application"),
        SensorEffect("rpm", lambda h, f, rng:
                     _erratic(h, f, 90.0, rng, onset=0.75),
                     "Slight RPM roughness from lean misfire"),
    ],
    typical_progression_days=75,
    severity="high",
    repair_cost_oem=(200, 500),
    repair_cost_aftermarket=(50, 150),
)


# ── FAILURE MODE 10: Transmission (Overheating) ───────────────────────────────
# Slipping transmission under thermal stress → hunting RPM, lower vehicle speed,
# rising coolant temp as engine works harder.

def _trans_rpm_hunt(healthy: float, factor: float, rng: np.random.Generator) -> float:
    g = _gate(factor, 0.65)
    hunt = _sigmoid_blend(0, 240.0, factor) * g
    return healthy + hunt + _erratic(0, factor, 120.0, rng, onset=0.72)


def _speed_slip(healthy: float, factor: float, rng: np.random.Generator) -> float:
    g = _gate(factor)
    return healthy - _sigmoid_blend(0, 22.0, factor) * g + rng.normal(0, 3.0)


def _coolant_working_hard(healthy: float, factor: float, rng: np.random.Generator) -> float:
    g = _gate(factor)
    return healthy + _sigmoid_blend(0, 18.0, factor) * g


FAILURE_MODES["transmission_overheating"] = FailureMode(
    name="transmission_overheating",
    display_name="Transmission (Overheating)",
    dtc_code="P0218",
    dtc_description="Transmission Over Temperature Condition",
    affected_sensors=[
        SensorEffect("rpm", _trans_rpm_hunt,
                     "RPM hunts as transmission slips under thermal stress"),
        SensorEffect("vehicle_speed", _speed_slip,
                     "Speed drops slightly as transmission efficiency falls"),
        SensorEffect("coolant_temp", _coolant_working_hard,
                     "Coolant temp rises as engine compensates for transmission slip"),
    ],
    typical_progression_days=50,
    severity="critical",
    repair_cost_oem=(1500, 4000),
    repair_cost_aftermarket=(400, 1200),
    default_curve="exponential",
)


# ── Registry helpers ──────────────────────────────────────────────────────────

FAILURE_MODE_NAMES = list(FAILURE_MODES.keys())


def get_failure_mode(name: str) -> FailureMode:
    if name not in FAILURE_MODES:
        raise KeyError(
            f"Unknown failure mode '{name}'.\n"
            f"Available: {FAILURE_MODE_NAMES}"
        )
    return FAILURE_MODES[name]


def failure_mode_summary() -> str:
    lines = [
        f"{'Name':<30} {'DTC':<8} {'Days':<6} {'Severity':<10} {'OEM Cost'}",
        "─" * 75,
    ]
    for name, mode in FAILURE_MODES.items():
        cost = f"${mode.repair_cost_oem[0]}–${mode.repair_cost_oem[1]}"
        lines.append(
            f"{name:<30} {mode.dtc_code:<8} {mode.typical_progression_days:<6} "
            f"{mode.severity:<10} {cost}"
        )
    return "\n".join(lines)
