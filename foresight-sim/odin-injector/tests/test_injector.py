"""
tests/test_injector.py
Unit tests for engine/injector.py — correctness, DTC firing, label accuracy.
"""

import pytest
from core.config import InjectionConfig
from core.event import FailureLabel, PHASE_HEALTHY_MAX
from engine.injector import FailureInjector

# These imports assume odin-telemetry is on PYTHONPATH
from core.vehicle import make_vehicle_profile
from stream.generator import TelemetryGenerator


@pytest.fixture
def make_injector():
    def _make(failure_mode: str, failure_start_day: int = 5,
               progression_days: int = 40, curve: str = "sigmoid"):
        profile = make_vehicle_profile("INJ-001", "sedan_low_mileage", seed=42)
        gen = TelemetryGenerator(profile)
        config = InjectionConfig(
            failure_mode_name=failure_mode,
            failure_start_day=failure_start_day,
            progression_days=progression_days,
            curve_shape=curve,
        )
        return FailureInjector(gen, config)
    return _make


# ── Determinism ───────────────────────────────────────────────────────────────

def test_same_seed_same_injection_output():
    """Two injectors with same config and seed must produce identical output."""
    def make():
        profile = make_vehicle_profile("DET-INJ", "sedan_low_mileage", seed=77)
        gen = TelemetryGenerator(profile)
        config = InjectionConfig.from_failure_mode("o2_sensor", failure_start_day=3)
        return FailureInjector(gen, config)

    inj1, inj2 = make(), make()
    for _ in range(200):
        r1, l1 = inj1.tick()
        r2, l2 = inj2.tick()
        for a, b in zip(r1, r2):
            assert a.value == b.value
        assert l1.degradation_factor == l2.degradation_factor


# ── Healthy phase ─────────────────────────────────────────────────────────────

def test_readings_healthy_before_failure_start(make_injector):
    """All readings before failure_start_day must be healthy."""
    inj = make_injector("o2_sensor", failure_start_day=10, progression_days=50)
    for day in range(10):
        for _ in range(86400):
            readings, label = inj.tick()
            for r in readings:
                assert r.is_healthy is True, \
                    f"Reading marked unhealthy before failure start (day {day})"
                assert r.degradation_factor == 0.0


def test_factor_zero_before_failure_start(make_injector):
    inj = make_injector("maf_sensor", failure_start_day=5, progression_days=30)
    # Advance 4 days
    for _ in range(4 * 86400):
        _, label = inj.tick()
        assert label.degradation_factor == 0.0, \
            f"factor should be 0.0 before day 5, got {label.degradation_factor}"


# ── Degradation progression ───────────────────────────────────────────────────

def test_factor_increases_over_time(make_injector):
    """degradation_factor must increase monotonically after failure_start_day."""
    inj = make_injector("spark_plugs", failure_start_day=2, progression_days=30)
    prev_factor = 0.0

    for day in range(35):
        # Advance one full day
        for _ in range(86400):
            _, label = inj.tick()

        current_factor = inj.current_factor
        assert current_factor >= prev_factor - 1e-9, (
            f"factor decreased: day {day-1}={prev_factor:.5f} → day {day}={current_factor:.5f}"
        )
        prev_factor = current_factor


def test_affected_sensors_become_unhealthy(make_injector):
    """Sensors listed in failure mode must have is_healthy=False past phase 2."""
    inj = make_injector("battery_alternator", failure_start_day=1, progression_days=20)
    from curves.library import get_failure_mode
    affected = get_failure_mode("battery_alternator").sensor_names()

    found_unhealthy = set()

    for day in range(25):
        for _ in range(86400):
            readings, label = inj.tick()
            for r in readings:
                if not r.is_healthy and r.sensor_name in affected:
                    found_unhealthy.add(r.sensor_name)

    for sensor_name in affected:
        assert sensor_name in found_unhealthy, (
            f"{sensor_name} never marked unhealthy during battery_alternator injection"
        )


def test_unaffected_sensors_stay_healthy(make_injector):
    """Sensors NOT in the failure mode's affected list must stay healthy."""
    from curves.library import get_failure_mode
    mode = get_failure_mode("o2_sensor")
    affected = set(mode.sensor_names())

    inj = make_injector("o2_sensor", failure_start_day=1, progression_days=30)

    for _ in range(35 * 86400):
        readings, _ = inj.tick()
        for r in readings:
            if r.sensor_name not in affected:
                assert r.is_healthy is True, (
                    f"{r.sensor_name} was marked unhealthy but is not affected by o2_sensor failure"
                )


# ── DTC firing ────────────────────────────────────────────────────────────────

def test_dtc_fires_for_every_failure_mode():
    """Every failure mode must fire its DTC within the simulation window."""
    from curves.library import FAILURE_MODES

    for mode_name, mode in FAILURE_MODES.items():
        profile = make_vehicle_profile(f"DTC-{mode_name}", "sedan_low_mileage", seed=123)
        gen = TelemetryGenerator(profile)
        config = InjectionConfig(
            failure_mode_name=mode_name,
            failure_start_day=0,
            progression_days=mode.typical_progression_days,
            curve_shape="sigmoid",
        )
        inj = FailureInjector(gen, config)
        total_days = mode.typical_progression_days + 10

        for _ in range(total_days * 86400):
            inj.tick()

        assert inj.dtc_fired, (
            f"{mode_name}: DTC {mode.dtc_code} never fired in {total_days} days"
        )


def test_dtc_fires_only_once(make_injector):
    """DTC should fire exactly once — not re-fire on subsequent ticks."""
    inj = make_injector("coolant_temp_sensor", failure_start_day=0, progression_days=20)
    fire_count = 0
    was_fired = False

    for _ in range(30 * 86400):
        _, label = inj.tick()
        now_fired = inj.dtc_fired
        if now_fired and not was_fired:
            fire_count += 1
        was_fired = now_fired

    assert fire_count == 1, f"DTC fired {fire_count} times (expected exactly 1)"


def test_dtc_fire_day_is_set(make_injector):
    inj = make_injector("fuel_injector", failure_start_day=2, progression_days=30)
    for _ in range(40 * 86400):
        inj.tick()

    assert inj.dtc_event is not None
    assert inj.dtc_event.fire_day >= 2, "DTC fired before failure_start_day"
    assert inj.dtc_event.degradation_factor_at_fire >= 0.95


# ── Labels ────────────────────────────────────────────────────────────────────

def test_label_binary_matches_factor(make_injector):
    inj = make_injector("egr_valve", failure_start_day=3, progression_days=40)
    for _ in range(50 * 86400):
        _, label = inj.tick()
        expected_binary = 1 if label.degradation_factor >= PHASE_HEALTHY_MAX else 0
        assert label.label_binary == expected_binary, (
            f"label_binary={label.label_binary} but factor={label.degradation_factor:.3f}"
        )


def test_label_severity_healthy_before_start(make_injector):
    inj = make_injector("transmission_overheating", failure_start_day=10, progression_days=40)
    for _ in range(10 * 86400):
        _, label = inj.tick()
        assert label.label_severity == "healthy", (
            f"Expected 'healthy' severity before failure start, got '{label.label_severity}'"
        )


def test_days_to_dtc_counts_down(make_injector):
    """days_to_dtc should generally decrease as simulation progresses."""
    inj = make_injector("o2_sensor", failure_start_day=2, progression_days=40)
    dtc_estimates = []

    for day in range(25):
        for _ in range(86400):
            _, label = inj.tick()
        if label.days_to_dtc is not None:
            dtc_estimates.append((day, label.days_to_dtc))

    if len(dtc_estimates) >= 2:
        # Should trend downward
        first_estimate = dtc_estimates[0][1]
        last_estimate = dtc_estimates[-1][1]
        assert last_estimate <= first_estimate, (
            f"days_to_dtc should decrease: first={first_estimate}, last={last_estimate}"
        )


def test_days_to_dtc_none_after_dtc_fires(make_injector):
    inj = make_injector("maf_sensor", failure_start_day=0, progression_days=20)
    for _ in range(30 * 86400):
        _, label = inj.tick()

    # After DTC has fired, days_to_dtc should be None
    assert inj.dtc_fired
    _, final_label = inj.tick()
    assert final_label.days_to_dtc is None
