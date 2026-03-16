"""
core/specs.py

Single source of truth for all OBD-II sensor definitions used in the simulation.
Every sensor has:
  - pid:            OBD-II PID hex code
  - name:           Human-readable label
  - unit:           Unit of measurement
  - healthy_range:  (min, max) — normal operating values
  - critical_range: (min, max) — physical limits; readings clipped here
  - noise_std:      Gaussian noise standard deviation for realism
  - sample_rate_hz: How often this sensor fires per second

Design note:
  healthy_range != safe_range. A coolant temp of 108°C is technically within
  critical_range but above healthy_range — that's the degradation signal space.
  The generator operates within healthy_range. The injector pushes into the gap.

Sources:
  - SAE J1979 (OBD-II standard)
  - ELM327 PID reference
  - Real-world OBD-II logging datasets (open source)
"""

from dataclasses import dataclass
from typing import Dict, Tuple


@dataclass(frozen=True)
class SensorSpec:
    pid: str
    name: str
    unit: str
    healthy_range: Tuple[float, float]
    critical_range: Tuple[float, float]
    noise_std: float
    sample_rate_hz: float

    @property
    def healthy_min(self) -> float:
        return self.healthy_range[0]

    @property
    def healthy_max(self) -> float:
        return self.healthy_range[1]

    @property
    def critical_min(self) -> float:
        return self.critical_range[0]

    @property
    def critical_max(self) -> float:
        return self.critical_range[1]

    @property
    def healthy_midpoint(self) -> float:
        return (self.healthy_range[0] + self.healthy_range[1]) / 2

    @property
    def sample_interval_ticks(self) -> int:
        """How many 1-second ticks between samples (at 1 tick = 1 second)."""
        return max(1, round(1.0 / self.sample_rate_hz))

    def clip(self, value: float) -> float:
        return max(self.critical_min, min(self.critical_max, value))

    def is_healthy_value(self, value: float) -> bool:
        return self.healthy_min <= value <= self.healthy_max


# ─────────────────────────────────────────────────────────────────────────────
# SENSOR REGISTRY
# Order matters for display purposes (dashboard ordering).
# ─────────────────────────────────────────────────────────────────────────────

SENSOR_REGISTRY: Dict[str, SensorSpec] = {

    # ── Engine ────────────────────────────────────────────────────────────
    "rpm": SensorSpec(
        pid="010C",
        name="Engine RPM",
        unit="rpm",
        healthy_range=(650, 3800),
        critical_range=(300, 7500),
        noise_std=22.0,
        sample_rate_hz=1.0,
    ),

    "coolant_temp": SensorSpec(
        pid="0105",
        name="Engine Coolant Temperature",
        unit="°C",
        healthy_range=(82, 108),
        critical_range=(−40, 140),
        noise_std=0.4,
        sample_rate_hz=0.5,       # Reads every 2 seconds
    ),

    "intake_air_temp": SensorSpec(
        pid="010F",
        name="Intake Air Temperature",
        unit="°C",
        healthy_range=(10, 55),
        critical_range=(−40, 100),
        noise_std=1.2,
        sample_rate_hz=0.5,
    ),

    "maf": SensorSpec(
        pid="0110",
        name="Mass Air Flow",
        unit="g/s",
        healthy_range=(2.5, 28.0),
        critical_range=(0.0, 65.0),
        noise_std=0.4,
        sample_rate_hz=1.0,
    ),

    "throttle_position": SensorSpec(
        pid="0111",
        name="Throttle Position",
        unit="%",
        healthy_range=(0.0, 100.0),
        critical_range=(0.0, 100.0),
        noise_std=0.6,
        sample_rate_hz=2.0,       # Higher rate — responsive to pedal input
    ),

    # ── Fuel & Emissions ──────────────────────────────────────────────────
    "o2_voltage_b1s1": SensorSpec(
        pid="0114",
        name="O2 Sensor Voltage — Bank 1, Sensor 1 (Upstream)",
        unit="V",
        healthy_range=(0.08, 0.92),
        critical_range=(0.0, 1.275),
        noise_std=0.018,
        sample_rate_hz=2.0,       # Upstream O2 oscillates fast in closed-loop
    ),

    "o2_voltage_b1s2": SensorSpec(
        pid="0115",
        name="O2 Sensor Voltage — Bank 1, Sensor 2 (Downstream)",
        unit="V",
        healthy_range=(0.55, 0.80),  # Downstream is stable when cat is healthy
        critical_range=(0.0, 1.275),
        noise_std=0.008,
        sample_rate_hz=1.0,
    ),

    "short_fuel_trim": SensorSpec(
        pid="0106",
        name="Short Term Fuel Trim — Bank 1",
        unit="%",
        healthy_range=(−10.0, 10.0),
        critical_range=(−30.0, 30.0),
        noise_std=1.2,
        sample_rate_hz=1.0,
    ),

    "long_fuel_trim": SensorSpec(
        pid="0107",
        name="Long Term Fuel Trim — Bank 1",
        unit="%",
        healthy_range=(−10.0, 10.0),
        critical_range=(−30.0, 30.0),
        noise_std=0.25,
        sample_rate_hz=0.2,       # Updates slowly — ECU learns over time
    ),

    "catalyst_temp": SensorSpec(
        pid="013C",
        name="Catalyst Temperature — Bank 1, Sensor 1",
        unit="°C",
        healthy_range=(420, 820),
        critical_range=(100, 1150),
        noise_std=6.0,
        sample_rate_hz=0.2,
    ),

    # ── Vehicle & Electrical ──────────────────────────────────────────────
    "vehicle_speed": SensorSpec(
        pid="010D",
        name="Vehicle Speed",
        unit="km/h",
        healthy_range=(0, 145),
        critical_range=(0, 280),
        noise_std=0.8,
        sample_rate_hz=1.0,
    ),

    "battery_voltage": SensorSpec(
        pid="0142",
        name="Control Module Voltage",
        unit="V",
        healthy_range=(13.4, 14.8),
        critical_range=(10.5, 16.5),
        noise_std=0.04,
        sample_rate_hz=0.5,
    ),
}


# Ordered list for consistent output / display
SENSOR_NAMES = list(SENSOR_REGISTRY.keys())


def get_sensor(name: str) -> SensorSpec:
    if name not in SENSOR_REGISTRY:
        raise KeyError(
            f"Unknown sensor '{name}'.\n"
            f"Available sensors: {SENSOR_NAMES}"
        )
    return SENSOR_REGISTRY[name]


def sensors_due_at_tick(tick: int) -> list[str]:
    """
    Return names of sensors whose sample interval fires at this tick.
    tick is 0-indexed (tick 0 = first second of simulation).
    """
    due = []
    for name, spec in SENSOR_REGISTRY.items():
        interval = spec.sample_interval_ticks
        if tick % interval == 0:
            due.append(name)
    return due


def summary_table() -> str:
    """Return a formatted table of all sensors for logging/debug."""
    lines = [
        f"{'Sensor':<25} {'PID':<8} {'Unit':<8} {'Healthy Range':<22} {'Hz':<6} {'Noise σ'}",
        "─" * 85,
    ]
    for name, spec in SENSOR_REGISTRY.items():
        rng = f"{spec.healthy_min} → {spec.healthy_max}"
        lines.append(
            f"{name:<25} {spec.pid:<8} {spec.unit:<8} {rng:<22} {spec.sample_rate_hz:<6} {spec.noise_std}"
        )
    return "\n".join(lines)
