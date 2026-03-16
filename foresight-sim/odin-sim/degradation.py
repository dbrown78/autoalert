"""
sim/degradation.py
Degradation curve library for the 10 most common vehicle failure modes.

Each failure mode defines:
  - Which sensors are affected
  - How each sensor drifts as degradation_factor moves 0.0 → 1.0
    (0.0 = perfectly healthy, 1.0 = full failure / fault code)
  - The degradation curve shape (sigmoid by default, with configurable steepness)
  - DTC code that gets thrown at threshold (0.95+)

Degradation phases:
  [0.00 - 0.60] Healthy       — normal noise only
  [0.60 - 0.80] Early decay   — subtle drift, unlikely to notice
  [0.80 - 0.95] Late decay    — erratic readings, performance issues
  [0.95 - 1.00] Imminent fail — DTC triggered
"""

import numpy as np
from dataclasses import dataclass, field
from typing import Dict, List, Callable, Optional


@dataclass
class SensorEffect:
    """How a single sensor is affected at a given degradation factor."""
    sensor_name: str
    # Function: (healthy_value, degradation_factor, rng) -> degraded_value
    effect_fn: Callable[[float, float, np.random.Generator], float]
    description: str


@dataclass
class FailureMode:
    name: str
    display_name: str
    dtc_code: str
    dtc_description: str
    affected_sensors: List[SensorEffect]
    # How fast degradation progresses (days to go from 0 → 1 at normal rate)
    typical_progression_days: int
    severity: str  # "low" | "medium" | "high" | "critical"
    repair_cost_oem: tuple   # (min, max) USD
    repair_cost_aftermarket: tuple


def sigmoid_drift(value: float, target: float, factor: float, steepness: float = 8.0) -> float:
    """
    Smoothly push a sensor value from its healthy reading toward a target value.
    factor: 0.0 = no drift, 1.0 = fully at target
    steepness: how sharply the drift accelerates in the late phase
    """
    # Sigmoid maps factor → blend weight, accelerating past 0.6
    blend = 1 / (1 + np.exp(-steepness * (factor - 0.7)))
    return value + (target - value) * blend


def add_erratic_noise(value: float, factor: float, scale: float, rng: np.random.Generator) -> float:
    """Add increasingly erratic noise as degradation advances past 0.75."""
    if factor < 0.75:
        return value
    noise_scale = scale * ((factor - 0.75) / 0.25) ** 2
    return value + rng.normal(0, noise_scale)


# ─────────────────────────────────────────────
# FAILURE MODE DEFINITIONS
# ─────────────────────────────────────────────

FAILURE_MODES: Dict[str, FailureMode] = {}


# 1. O2 Sensor (Upstream) Failure
# Upstream O2 oscillates rapidly in a healthy engine. Failing: voltage narrows, then flatlines.
def _o2_b1s1_effect(healthy: float, factor: float, rng: np.random.Generator) -> float:
    if factor < 0.6:
        return healthy
    # Oscillation amplitude narrows toward a fixed midpoint (~0.45V)
    midpoint = 0.45
    narrowing = 1.0 - (factor - 0.6) / 0.4   # 1.0 → 0.0 as factor 0.6→1.0
    amplitude = (healthy - midpoint) * max(narrowing, 0.0)
    drifted = midpoint + amplitude
    return add_erratic_noise(drifted, factor, 0.05, rng)

FAILURE_MODES["o2_sensor"] = FailureMode(
    name="o2_sensor",
    display_name="Oxygen Sensor (Upstream)",
    dtc_code="P0130",
    dtc_description="O2 Sensor Circuit Malfunction (Bank 1, Sensor 1)",
    affected_sensors=[
        SensorEffect("o2_voltage_b1s1", _o2_b1s1_effect, "Voltage oscillation narrows then flatlines"),
        SensorEffect("short_fuel_trim", lambda h, f, rng: h + sigmoid_drift(0, 15, f) + rng.normal(0, 1.5 * max(f - 0.7, 0)), "Fuel trim spikes as ECU compensates"),
        SensorEffect("long_fuel_trim", lambda h, f, rng: h + sigmoid_drift(0, 12, f), "Long-term trim drifts positive"),
    ],
    typical_progression_days=60,
    severity="medium",
    repair_cost_oem=(150, 350),
    repair_cost_aftermarket=(60, 130),
)


# 2. Coolant Temperature Sensor Failure
# Failing sensor reports increasingly incorrect temps. ECU runs rich, fuel trim rises.
def _coolant_temp_effect(healthy: float, factor: float, rng: np.random.Generator) -> float:
    if factor < 0.6:
        return healthy
    # Drifts toward extremes — either stuck cold or stuck hot depending on failure type
    target = 120.0  # Stuck hot is most common
    drifted = sigmoid_drift(healthy, target, factor)
    return add_erratic_noise(drifted, factor, 5.0, rng)

FAILURE_MODES["coolant_temp_sensor"] = FailureMode(
    name="coolant_temp_sensor",
    display_name="Coolant Temperature Sensor",
    dtc_code="P0116",
    dtc_description="Engine Coolant Temperature Circuit Range/Performance",
    affected_sensors=[
        SensorEffect("coolant_temp", _coolant_temp_effect, "Temp reading drifts toward stuck-hot"),
        SensorEffect("short_fuel_trim", lambda h, f, rng: h + sigmoid_drift(0, 18, f), "ECU over-enriching fuel mix"),
        SensorEffect("long_fuel_trim", lambda h, f, rng: h + sigmoid_drift(0, 14, f), "Persistent rich trim"),
    ],
    typical_progression_days=45,
    severity="medium",
    repair_cost_oem=(80, 200),
    repair_cost_aftermarket=(20, 60),
)


# 3. MAF Sensor Failure
# MAF reports low airflow, ECU over-fuels. RPM becomes unstable.
def _maf_effect(healthy: float, factor: float, rng: np.random.Generator) -> float:
    if factor < 0.6:
        return healthy
    # Drifts toward reading too low (contaminated element)
    drifted = sigmoid_drift(healthy, healthy * 0.4, factor)
    return add_erratic_noise(drifted, factor, 1.5, rng)

FAILURE_MODES["maf_sensor"] = FailureMode(
    name="maf_sensor",
    display_name="Mass Air Flow Sensor",
    dtc_code="P0101",
    dtc_description="Mass or Volume Air Flow Circuit Range/Performance",
    affected_sensors=[
        SensorEffect("maf", _maf_effect, "MAF reading drops as element contaminates"),
        SensorEffect("rpm", lambda h, f, rng: h + add_erratic_noise(0, f, 150, rng), "RPM becomes unstable at idle"),
        SensorEffect("long_fuel_trim", lambda h, f, rng: h + sigmoid_drift(0, 20, f), "Trim climbs as ECU compensates for low MAF reading"),
    ],
    typical_progression_days=90,
    severity="medium",
    repair_cost_oem=(200, 400),
    repair_cost_aftermarket=(50, 150),
)


# 4. Catalytic Converter Degradation
# Downstream O2 starts oscillating like upstream — converter no longer storing oxygen
def _cat_downstream_effect(healthy: float, factor: float, rng: np.random.Generator) -> float:
    if factor < 0.6:
        return healthy
    # Healthy downstream is stable ~0.6-0.7V. Failing: starts oscillating like upstream
    oscillation_amplitude = sigmoid_drift(0, 0.35, factor)
    phase = rng.uniform(0, 2 * np.pi)
    return healthy + oscillation_amplitude * np.sin(phase) + rng.normal(0, 0.02)

FAILURE_MODES["catalytic_converter"] = FailureMode(
    name="catalytic_converter",
    display_name="Catalytic Converter",
    dtc_code="P0420",
    dtc_description="Catalyst System Efficiency Below Threshold (Bank 1)",
    affected_sensors=[
        SensorEffect("o2_voltage_b1s2", _cat_downstream_effect, "Downstream O2 starts mirroring upstream — converter no longer storing oxygen"),
        SensorEffect("catalyst_temp", lambda h, f, rng: h + sigmoid_drift(0, 150, f) + rng.normal(0, 10), "Cat temp runs hotter as efficiency drops"),
    ],
    typical_progression_days=180,
    severity="high",
    repair_cost_oem=(1200, 2500),
    repair_cost_aftermarket=(250, 600),
)


# 5. Throttle Position Sensor Failure
# TPS sends erratic signals — engine stumbles, RPM spikes
def _tps_effect(healthy: float, factor: float, rng: np.random.Generator) -> float:
    if factor < 0.65:
        return healthy
    # Glitches — random spikes to 0 or 100
    if rng.random() < (factor - 0.65) * 0.4:
        return rng.choice([0.0, 100.0])
    return add_erratic_noise(healthy, factor, 8.0, rng)

FAILURE_MODES["throttle_position_sensor"] = FailureMode(
    name="throttle_position_sensor",
    display_name="Throttle Position Sensor",
    dtc_code="P0122",
    dtc_description="Throttle/Pedal Position Sensor Circuit Low",
    affected_sensors=[
        SensorEffect("throttle_position", _tps_effect, "TPS glitches to extremes intermittently"),
        SensorEffect("rpm", lambda h, f, rng: h + add_erratic_noise(0, f, 300, rng), "RPM stumbles when TPS glitches"),
        SensorEffect("maf", lambda h, f, rng: h + add_erratic_noise(0, f, 2.0, rng), "MAF fluctuates with TPS errors"),
    ],
    typical_progression_days=30,
    severity="high",
    repair_cost_oem=(150, 300),
    repair_cost_aftermarket=(40, 100),
)


# 6. Spark Plug Degradation
# Misfires cause RPM dips, O2 fluctuation, fuel trim adjustments
def _spark_rpm_effect(healthy: float, factor: float, rng: np.random.Generator) -> float:
    if factor < 0.6:
        return healthy
    # Periodic dips mimicking misfire events
    if rng.random() < (factor - 0.6) * 0.3:
        return healthy - rng.uniform(100, 400)
    return healthy + rng.normal(0, 30)

FAILURE_MODES["spark_plugs"] = FailureMode(
    name="spark_plugs",
    display_name="Spark Plugs",
    dtc_code="P0300",
    dtc_description="Random/Multiple Cylinder Misfire Detected",
    affected_sensors=[
        SensorEffect("rpm", _spark_rpm_effect, "Periodic RPM dips from misfire events"),
        SensorEffect("o2_voltage_b1s1", lambda h, f, rng: add_erratic_noise(h, f, 0.08, rng), "O2 fluctuates from unburned fuel on misfire"),
        SensorEffect("short_fuel_trim", lambda h, f, rng: h + sigmoid_drift(0, -10, f), "ECU trims fuel back in response to rich spikes"),
    ],
    typical_progression_days=120,
    severity="medium",
    repair_cost_oem=(100, 250),
    repair_cost_aftermarket=(30, 80),
)


# 7. Battery / Alternator Degradation
# Voltage drops under load, ECU starts behaving erratically
def _battery_voltage_effect(healthy: float, factor: float, rng: np.random.Generator) -> float:
    if factor < 0.6:
        return healthy
    # Voltage sags under load
    sag = sigmoid_drift(0, 2.5, factor)
    return healthy - sag + add_erratic_noise(0, factor, 0.3, rng)

FAILURE_MODES["battery_alternator"] = FailureMode(
    name="battery_alternator",
    display_name="Battery / Alternator",
    dtc_code="P0562",
    dtc_description="System Voltage Low",
    affected_sensors=[
        SensorEffect("battery_voltage", _battery_voltage_effect, "Voltage sags under load as battery/alternator weakens"),
        SensorEffect("rpm", lambda h, f, rng: h + sigmoid_drift(0, -100, f) + rng.normal(0, 20), "Idle drops as charging system loses capacity"),
    ],
    typical_progression_days=60,
    severity="high",
    repair_cost_oem=(200, 600),
    repair_cost_aftermarket=(80, 250),
)


# 8. EGR Valve Failure
# Stuck open: too much exhaust gas recirculated → rough idle, RPM instability
def _egr_rpm_effect(healthy: float, factor: float, rng: np.random.Generator) -> float:
    if factor < 0.65:
        return healthy
    base_drop = sigmoid_drift(0, 200, factor)
    return healthy - base_drop + add_erratic_noise(0, factor, 100, rng)

FAILURE_MODES["egr_valve"] = FailureMode(
    name="egr_valve",
    display_name="EGR Valve",
    dtc_code="P0401",
    dtc_description="Exhaust Gas Recirculation Flow Insufficient",
    affected_sensors=[
        SensorEffect("rpm", _egr_rpm_effect, "Rough idle as EGR disrupts combustion mix"),
        SensorEffect("intake_air_temp", lambda h, f, rng: h + sigmoid_drift(0, 20, f), "IAT rises as hot exhaust gases mix into intake"),
        SensorEffect("maf", lambda h, f, rng: h - sigmoid_drift(0, 3.0, f), "MAF reads low as EGR displaces fresh air"),
    ],
    typical_progression_days=90,
    severity="medium",
    repair_cost_oem=(300, 700),
    repair_cost_aftermarket=(80, 200),
)


# 9. Fuel Injector Degradation
# Clogged injector delivers less fuel → lean condition, rich trim compensation
def _injector_fuel_trim_effect(healthy: float, factor: float, rng: np.random.Generator) -> float:
    if factor < 0.6:
        return healthy
    # Long-term trim climbs as ECU tries to compensate for lean condition
    return healthy + sigmoid_drift(0, 22, factor) + rng.normal(0, 1.0)

FAILURE_MODES["fuel_injector"] = FailureMode(
    name="fuel_injector",
    display_name="Fuel Injector",
    dtc_code="P0200",
    dtc_description="Injector Circuit Malfunction",
    affected_sensors=[
        SensorEffect("long_fuel_trim", _injector_fuel_trim_effect, "Long-term trim climbs as ECU compensates for clogged injector"),
        SensorEffect("short_fuel_trim", lambda h, f, rng: h + sigmoid_drift(0, 15, f) + rng.normal(0, 2.0), "Short-term trim spikes on throttle"),
        SensorEffect("rpm", lambda h, f, rng: h + add_erratic_noise(0, f, 80, rng), "Slight RPM roughness from lean misfire"),
        SensorEffect("o2_voltage_b1s1", lambda h, f, rng: sigmoid_drift(h, 0.15, f, 6.0), "O2 swings lean as injector fails to deliver"),
    ],
    typical_progression_days=75,
    severity="high",
    repair_cost_oem=(200, 500),
    repair_cost_aftermarket=(50, 150),
)


# 10. Transmission Temperature (Auto Transmission Overheating)
# Not a standard OBD PID on all cars but widely supported via mode 22
def _trans_temp_effect(healthy: float, factor: float, rng: np.random.Generator) -> float:
    # Note: trans temp is not in our core sensor set, this affects RPM behavior
    return healthy

FAILURE_MODES["transmission_temp"] = FailureMode(
    name="transmission_temp",
    display_name="Transmission (Overheating)",
    dtc_code="P0218",
    dtc_description="Transmission Over Temperature Condition",
    affected_sensors=[
        SensorEffect("rpm", lambda h, f, rng: h + sigmoid_drift(0, 200, f) + add_erratic_noise(0, f, 100, rng), "RPM hunts as transmission slips under heat"),
        SensorEffect("vehicle_speed", lambda h, f, rng: h - sigmoid_drift(0, 20, f) + rng.normal(0, 3), "Speed drops slightly as trans efficiency falls"),
        SensorEffect("coolant_temp", lambda h, f, rng: h + sigmoid_drift(0, 15, f), "Coolant temp rises as engine works harder under slip"),
    ],
    typical_progression_days=50,
    severity="critical",
    repair_cost_oem=(1500, 4000),
    repair_cost_aftermarket=(400, 1200),
)


# 11. Transmission Overheat (full TCM sensor modeling)
# Trans fluid heats up → slip RPM rises → line pressure drops → gearbox cooks.
# Replaces placeholder "transmission_temp" with full TCM sensor coverage.
# warnHigh on trans_fluid_temp (93°C) crossed at ~factor 0.40,
# critHigh (110°C) crossed at ~factor 0.85.
def _trans_fluid_temp_overheat_effect(healthy: float, factor: float, rng: np.random.Generator) -> float:
    if factor < 0.3:
        return healthy + rng.normal(0, 1.0)
    # Custom sigmoid centered at 0.50 (earlier than default 0.70) with steepness 5.2.
    # With healthy_mid=80°C and target=115°C this crosses:
    #   warnHigh  93°C  at factor ≈ 0.40  (blend ≈ 0.37 → 80 + 35*0.37 = 93.0)
    #   critHigh 110°C  at factor ≈ 0.85  (blend ≈ 0.86 → 80 + 35*0.86 = 110.1)
    blend = 1.0 / (1.0 + np.exp(-5.2 * (factor - 0.50)))
    drifted = healthy + (115.0 - healthy) * blend
    return drifted + add_erratic_noise(0, factor, 3.0, rng)


def _slip_rpm_overheat_effect(healthy: float, factor: float, rng: np.random.Generator) -> float:
    if factor < 0.3:
        return healthy + rng.normal(0, 5.0)
    # Rises toward 550 rpm proportionally with overheating
    drifted = sigmoid_drift(healthy, 550.0, factor, steepness=6.0)
    return max(0.0, drifted + rng.normal(0, 10.0 * max(factor - 0.3, 0)))


def _line_pressure_overheat_effect(healthy: float, factor: float, rng: np.random.Generator) -> float:
    if factor < 0.3:
        return healthy + rng.normal(0, 2.0)
    # Custom sigmoid centered at 0.55, steepness 10 — sharper drop.
    # With healthy_mid=140 psi and target=30 psi this crosses:
    #   warnLow  50 psi  at factor ≈ 0.70  (blend ≈ 0.82 → 140 - 110*0.82 = 49.8)
    #   critLow  35 psi  at factor ≈ 0.95  (blend ≈ 0.98 → 140 - 110*0.98 = 32.2)
    blend = 1.0 / (1.0 + np.exp(-10.0 * (factor - 0.55)))
    drifted = healthy + (30.0 - healthy) * blend
    return max(0.0, drifted + add_erratic_noise(0, factor, 5.0, rng))


FAILURE_MODES["transmission_overheat"] = FailureMode(
    name="transmission_overheat",
    display_name="Transmission Overheat (TCM)",
    dtc_code="P0218",
    dtc_description="Transmission Over Temperature Condition",
    affected_sensors=[
        SensorEffect("trans_fluid_temp", _trans_fluid_temp_overheat_effect,
                     "Fluid temp ramps 80→115°C; warns at 93, critical at 110"),
        SensorEffect("slip_rpm", _slip_rpm_overheat_effect,
                     "Slip RPM rises 30→550 rpm as fluid thins and clutch packs slip"),
        SensorEffect("line_pressure", _line_pressure_overheat_effect,
                     "Hydraulic line pressure drops 140→30 psi as fluid degrades"),
        SensorEffect("rpm", lambda h, f, rng: h + sigmoid_drift(0, 180, f) + add_erratic_noise(0, f, 80, rng),
                     "RPM hunts as transmission slips under heat load"),
        SensorEffect("coolant_temp", lambda h, f, rng: h + sigmoid_drift(0, 12, f),
                     "Coolant temp rises as engine works harder under trans slip"),
    ],
    typical_progression_days=50,
    severity="critical",
    repair_cost_oem=(1500, 4000),
    repair_cost_aftermarket=(400, 1200),
)


# 12. Wheel Speed Sensor Dropout (ABS module)
# One wheel sensor fails — healthy → intermittent → stuck at 0.
# Wheel-to-wheel delta (wheel_speed_delta) grows as the failing wheel reads 0 at speed.
#
# Phase thresholds (degradation factor):
#   [0.00 – 0.30]  Healthy: all four wheels track vehicle speed ± 1 km/h
#   [0.30 – 0.60]  Degradation: intermittent dropouts, probability rises 0→80%
#   [0.60 – 1.00]  Failed: failing wheel stuck at 0.0 km/h
#
# DTC schedule (set InjectionConfig.dtc_threshold accordingly):
#   factor ≥ 0.30  C0035 — Generic wheel speed sensor circuit
#   factor ≥ 0.60  Wheel-specific: C0031(FL) C0036(FR) C0041(RL) C0045(RR)
#
# FAILURE_MODES["wheel_speed_sensor_dropout"] uses front-left as the default
# failing wheel.  Use make_wheel_dropout_mode() to target a specific wheel.

_WHEEL_SPEED_NAMES = ["wheel_speed_fl", "wheel_speed_fr", "wheel_speed_rl", "wheel_speed_rr"]

_WHEEL_SPECIFIC_DTCS = {
    "wheel_speed_fl": "C0031",
    "wheel_speed_fr": "C0036",
    "wheel_speed_rl": "C0041",
    "wheel_speed_rr": "C0045",
}


def make_wheel_dropout_mode(failing_wheel: str = "wheel_speed_fl") -> FailureMode:
    """
    Return a FailureMode for a wheel-speed-sensor dropout targeting a specific wheel.
    failing_wheel must be one of: wheel_speed_fl, wheel_speed_fr, wheel_speed_rl, wheel_speed_rr.
    """
    if failing_wheel not in _WHEEL_SPEED_NAMES:
        raise ValueError(f"Invalid wheel: {failing_wheel}. Must be one of {_WHEEL_SPEED_NAMES}")

    # Capture failing_wheel in closure — consistent for entire injection window
    def _failing_effect(healthy: float, factor: float, rng: np.random.Generator) -> float:
        if factor < 0.3:
            return healthy + rng.normal(0, 1.0)
        if factor < 0.6:
            # Dropout probability rises linearly: 0% at factor=0.30 → 80% at factor=0.60
            dropout_prob = (factor - 0.3) / 0.3 * 0.8
            if rng.random() < dropout_prob:
                return 0.0
            return healthy + rng.normal(0, 1.0)
        # Failed phase: stuck at 0
        return 0.0

    def _healthy_wheel_effect(healthy: float, factor: float, rng: np.random.Generator) -> float:
        return healthy + rng.normal(0, 1.0)

    effects = []
    for wheel in _WHEEL_SPEED_NAMES:
        fn = _failing_effect if wheel == failing_wheel else _healthy_wheel_effect
        desc = (
            f"Failing sensor: intermittent dropout then stuck at 0 km/h"
            if wheel == failing_wheel else
            "Healthy wheel: nominal speed with Gaussian noise"
        )
        effects.append(SensorEffect(wheel, fn, desc))

    # Vehicle speed held at highway cruise (~95 km/h) so delta is meaningful
    effects.append(SensorEffect(
        "vehicle_speed",
        lambda h, f, rng: 95.0 + rng.normal(0, 2.0),
        "Vehicle speed fixed at ~95 km/h (highway) to make wheel delta observable",
    ))

    wheel_dtc = _WHEEL_SPECIFIC_DTCS[failing_wheel]
    return FailureMode(
        name="wheel_speed_sensor_dropout",
        display_name=f"Wheel Speed Sensor Dropout ({failing_wheel})",
        dtc_code="C0035",   # Generic at onset; wheel-specific DTC is wheel_dtc at factor≥0.60
        dtc_description=(
            f"Wheel Speed Sensor Circuit Malfunction — generic C0035 at onset, "
            f"escalates to {wheel_dtc} ({failing_wheel}) at failed phase"
        ),
        affected_sensors=effects,
        typical_progression_days=30,
        severity="high",
        repair_cost_oem=(200, 500),
        repair_cost_aftermarket=(60, 180),
    )


FAILURE_MODES["wheel_speed_sensor_dropout"] = make_wheel_dropout_mode("wheel_speed_fl")


def get_failure_mode(name: str) -> FailureMode:
    if name not in FAILURE_MODES:
        raise ValueError(f"Unknown failure mode: {name}. Available: {list(FAILURE_MODES.keys())}")
    return FAILURE_MODES[name]


def compute_degradation_factor(
    current_day: int,
    total_days: int,
    failure_start_day: int,
    curve: str = "sigmoid"
) -> float:
    """
    Compute where a vehicle is on the degradation curve [0.0, 1.0].
    
    current_day: day number in the simulation
    total_days: total simulation window
    failure_start_day: day on which failure degradation begins
    curve: "sigmoid" | "linear" | "exponential"
    """
    if current_day < failure_start_day:
        return 0.0

    elapsed = current_day - failure_start_day
    progression = min(elapsed / total_days, 1.0)

    if curve == "linear":
        return progression
    elif curve == "exponential":
        return progression ** 2
    else:  # sigmoid — default
        # Slow start, accelerating finish
        return float(1 / (1 + np.exp(-10 * (progression - 0.5))))
