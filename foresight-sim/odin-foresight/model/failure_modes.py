"""
model/failure_modes.py

FailureMode definitions used by the Foresight predictor to map sensor
contributions back to human-readable failure categories with DTC codes
and repair cost estimates.

This is a self-contained copy of the relevant parts of odin-injector's
curves/library.py — only the data needed for inference (no effect functions).
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import List, Tuple


@dataclass
class FailureMode:
    name: str
    display_name: str
    dtc_code: str
    dtc_description: str
    affected_sensor_names: List[str]          # sensor names (no effect fns needed for inference)
    typical_progression_days: int
    severity: str                              # "low" | "medium" | "high" | "critical"
    repair_cost_oem: Tuple[int, int]           # (min, max) USD
    repair_cost_aftermarket: Tuple[int, int]
    default_curve: str = "sigmoid"

    def sensor_names(self) -> list[str]:
        return self.affected_sensor_names


FAILURE_MODES: dict[str, FailureMode] = {}

FAILURE_MODES["o2_sensor"] = FailureMode(
    name="o2_sensor",
    display_name="Oxygen Sensor (Upstream)",
    dtc_code="P0130",
    dtc_description="O2 Sensor Circuit Malfunction — Bank 1, Sensor 1",
    affected_sensor_names=["o2_voltage_b1s1", "short_fuel_trim", "long_fuel_trim"],
    typical_progression_days=60,
    severity="medium",
    repair_cost_oem=(150, 350),
    repair_cost_aftermarket=(60, 130),
)

FAILURE_MODES["coolant_temp_sensor"] = FailureMode(
    name="coolant_temp_sensor",
    display_name="Coolant Temperature Sensor",
    dtc_code="P0116",
    dtc_description="Engine Coolant Temperature Circuit Range/Performance",
    affected_sensor_names=["coolant_temp", "short_fuel_trim", "long_fuel_trim"],
    typical_progression_days=45,
    severity="medium",
    repair_cost_oem=(80, 200),
    repair_cost_aftermarket=(20, 60),
)

FAILURE_MODES["maf_sensor"] = FailureMode(
    name="maf_sensor",
    display_name="Mass Air Flow Sensor",
    dtc_code="P0101",
    dtc_description="Mass Air Flow Circuit Range/Performance",
    affected_sensor_names=["maf", "rpm", "long_fuel_trim"],
    typical_progression_days=90,
    severity="medium",
    repair_cost_oem=(200, 400),
    repair_cost_aftermarket=(50, 150),
)

FAILURE_MODES["catalytic_converter"] = FailureMode(
    name="catalytic_converter",
    display_name="Catalytic Converter",
    dtc_code="P0420",
    dtc_description="Catalyst System Efficiency Below Threshold — Bank 1",
    affected_sensor_names=["o2_voltage_b1s2", "catalyst_temp"],
    typical_progression_days=180,
    severity="high",
    repair_cost_oem=(1200, 2500),
    repair_cost_aftermarket=(250, 600),
    default_curve="exponential",
)

FAILURE_MODES["throttle_position_sensor"] = FailureMode(
    name="throttle_position_sensor",
    display_name="Throttle Position Sensor",
    dtc_code="P0122",
    dtc_description="Throttle/Pedal Position Sensor Circuit Low",
    affected_sensor_names=["throttle_position", "rpm", "maf"],
    typical_progression_days=30,
    severity="high",
    repair_cost_oem=(150, 300),
    repair_cost_aftermarket=(40, 100),
)

FAILURE_MODES["spark_plugs"] = FailureMode(
    name="spark_plugs",
    display_name="Spark Plugs",
    dtc_code="P0300",
    dtc_description="Random/Multiple Cylinder Misfire Detected",
    affected_sensor_names=["rpm", "o2_voltage_b1s1", "short_fuel_trim"],
    typical_progression_days=120,
    severity="medium",
    repair_cost_oem=(100, 250),
    repair_cost_aftermarket=(30, 80),
)

FAILURE_MODES["battery_alternator"] = FailureMode(
    name="battery_alternator",
    display_name="Battery / Alternator",
    dtc_code="P0562",
    dtc_description="System Voltage Low",
    affected_sensor_names=["battery_voltage", "rpm"],
    typical_progression_days=60,
    severity="high",
    repair_cost_oem=(200, 600),
    repair_cost_aftermarket=(80, 250),
)

FAILURE_MODES["egr_valve"] = FailureMode(
    name="egr_valve",
    display_name="EGR Valve",
    dtc_code="P0401",
    dtc_description="Exhaust Gas Recirculation Flow Insufficient Detected",
    affected_sensor_names=["rpm", "intake_air_temp", "maf"],
    typical_progression_days=90,
    severity="medium",
    repair_cost_oem=(300, 700),
    repair_cost_aftermarket=(80, 200),
)

FAILURE_MODES["fuel_injector"] = FailureMode(
    name="fuel_injector",
    display_name="Fuel Injector",
    dtc_code="P0200",
    dtc_description="Injector Circuit Malfunction",
    affected_sensor_names=["o2_voltage_b1s1", "long_fuel_trim", "short_fuel_trim", "rpm"],
    typical_progression_days=75,
    severity="high",
    repair_cost_oem=(200, 500),
    repair_cost_aftermarket=(50, 150),
)

FAILURE_MODES["transmission_overheating"] = FailureMode(
    name="transmission_overheating",
    display_name="Transmission (Overheating)",
    dtc_code="P0218",
    dtc_description="Transmission Over Temperature Condition",
    affected_sensor_names=["rpm", "vehicle_speed", "coolant_temp"],
    typical_progression_days=50,
    severity="critical",
    repair_cost_oem=(1500, 4000),
    repair_cost_aftermarket=(400, 1200),
    default_curve="exponential",
)
