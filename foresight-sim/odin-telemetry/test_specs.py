"""
tests/test_specs.py
Unit tests for core/specs.py — sensor definitions and helper functions.
"""

import pytest
from core.specs import (
    SENSOR_REGISTRY, SENSOR_NAMES, get_sensor, sensors_due_at_tick, summary_table
)


def test_all_sensors_present():
    required = [
        "rpm", "coolant_temp", "intake_air_temp", "maf", "throttle_position",
        "o2_voltage_b1s1", "o2_voltage_b1s2", "short_fuel_trim", "long_fuel_trim",
        "catalyst_temp", "vehicle_speed", "battery_voltage",
    ]
    for name in required:
        assert name in SENSOR_REGISTRY, f"Missing sensor: {name}"


def test_healthy_range_within_critical():
    for name, spec in SENSOR_REGISTRY.items():
        assert spec.healthy_min >= spec.critical_min, \
            f"{name}: healthy_min {spec.healthy_min} < critical_min {spec.critical_min}"
        assert spec.healthy_max <= spec.critical_max, \
            f"{name}: healthy_max {spec.healthy_max} > critical_max {spec.critical_max}"


def test_healthy_range_has_width():
    for name, spec in SENSOR_REGISTRY.items():
        assert spec.healthy_max > spec.healthy_min, \
            f"{name}: healthy_range has no width ({spec.healthy_min} → {spec.healthy_max})"


def test_noise_std_positive():
    for name, spec in SENSOR_REGISTRY.items():
        assert spec.noise_std > 0, f"{name}: noise_std must be > 0"


def test_sample_rates_positive():
    for name, spec in SENSOR_REGISTRY.items():
        assert spec.sample_rate_hz > 0, f"{name}: sample_rate_hz must be > 0"


def test_sample_interval_ticks():
    rpm = get_sensor("rpm")
    assert rpm.sample_interval_ticks == 1  # 1Hz = every tick

    coolant = get_sensor("coolant_temp")
    assert coolant.sample_interval_ticks == 2  # 0.5Hz = every 2 ticks

    o2 = get_sensor("o2_voltage_b1s1")
    assert o2.sample_interval_ticks == 1  # 2Hz rounds to 1 (fires every tick)

    long_ft = get_sensor("long_fuel_trim")
    assert long_ft.sample_interval_ticks == 5  # 0.2Hz = every 5 ticks


def test_clip_within_critical():
    spec = get_sensor("coolant_temp")
    assert spec.clip(1000.0) == spec.critical_max
    assert spec.clip(-999.0) == spec.critical_min
    assert spec.clip(95.0) == 95.0


def test_is_healthy_value():
    spec = get_sensor("battery_voltage")
    assert spec.is_healthy_value(14.0) is True
    assert spec.is_healthy_value(11.0) is False   # Below healthy_min
    assert spec.is_healthy_value(15.5) is False   # Above healthy_max


def test_sensors_due_at_tick():
    # Tick 0: all sensors should fire (everyone fires at tick 0)
    tick0 = sensors_due_at_tick(0)
    assert set(SENSOR_NAMES).issubset(set(tick0)), \
        f"Not all sensors fired at tick 0. Missing: {set(SENSOR_NAMES) - set(tick0)}"

    # Throttle (2Hz, interval=1) fires every tick
    assert "throttle_position" in sensors_due_at_tick(1)
    assert "throttle_position" in sensors_due_at_tick(2)

    # long_fuel_trim (0.2Hz, interval=5) should NOT fire at tick 1, 2, 3, 4
    for t in [1, 2, 3, 4]:
        assert "long_fuel_trim" not in sensors_due_at_tick(t), \
            f"long_fuel_trim should not fire at tick {t}"
    # Should fire at tick 5
    assert "long_fuel_trim" in sensors_due_at_tick(5)


def test_get_sensor_unknown_raises():
    with pytest.raises(KeyError, match="Unknown sensor"):
        get_sensor("nonexistent_sensor_xyz")


def test_summary_table_runs():
    table = summary_table()
    assert "rpm" in table
    assert "coolant_temp" in table
    assert len(table.split("\n")) >= len(SENSOR_REGISTRY) + 2
