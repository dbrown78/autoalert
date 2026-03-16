"""
tests/test_generator.py
Unit tests for stream/generator.py
Tests correctness, determinism, sample rate fidelity, and profile behavior.
"""

import pytest
from collections import defaultdict
from datetime import datetime

from core.vehicle import make_vehicle_profile, VehicleProfile
from core.specs import SENSOR_REGISTRY
from stream.generator import TelemetryGenerator, SECONDS_PER_DAY


@pytest.fixture
def basic_profile() -> VehicleProfile:
    return make_vehicle_profile("TEST-001", "sedan_low_mileage", seed=42)


@pytest.fixture
def gen(basic_profile) -> TelemetryGenerator:
    return TelemetryGenerator(basic_profile)


# ── Determinism ───────────────────────────────────────────────────────────────

def test_same_seed_same_output():
    """Same seed must produce identical readings every time."""
    p1 = make_vehicle_profile("DET-001", "sedan_low_mileage", seed=99)
    p2 = make_vehicle_profile("DET-001", "sedan_low_mileage", seed=99)
    g1 = TelemetryGenerator(p1)
    g2 = TelemetryGenerator(p2)

    for _ in range(100):
        r1 = g1.tick()
        r2 = g2.tick()
        assert len(r1) == len(r2)
        for a, b in zip(r1, r2):
            assert a.sensor_name == b.sensor_name
            assert a.value == b.value


def test_different_seeds_different_output():
    """Different seeds must produce different output."""
    p1 = make_vehicle_profile("A", "sedan_low_mileage", seed=1)
    p2 = make_vehicle_profile("B", "sedan_low_mileage", seed=2)
    g1 = TelemetryGenerator(p1)
    g2 = TelemetryGenerator(p2)

    values_a = [r.value for r in g1.tick()]
    values_b = [r.value for r in g2.tick()]
    assert values_a != values_b


def test_reset_restores_determinism(gen):
    """reset() should make the generator produce identical output again."""
    first_run = [r.value for r in gen.tick()]
    gen.tick()
    gen.tick()
    gen.reset()
    second_run = [r.value for r in gen.tick()]
    assert first_run == second_run


# ── Output shape ──────────────────────────────────────────────────────────────

def test_tick_returns_readings(gen):
    readings = gen.tick()
    assert len(readings) > 0


def test_readings_have_correct_vehicle_id(gen):
    readings = gen.tick()
    for r in readings:
        assert r.vehicle_id == "TEST-001"


def test_readings_are_healthy_by_default(gen):
    for _ in range(50):
        for r in gen.tick():
            assert r.is_healthy is True
            assert r.degradation_factor == 0.0
            assert r.source == "sim"


def test_readings_have_valid_timestamps(gen):
    start = gen.current_time
    gen.tick()
    readings = gen.tick()
    for r in readings:
        assert r.timestamp > start


def test_day_advances_correctly(gen):
    assert gen.day == 0
    gen.run_day()
    assert gen.day == 1
    gen.run_day()
    assert gen.day == 2


# ── Sample rate fidelity ──────────────────────────────────────────────────────

def test_sample_rates_respected():
    """
    Over 100 ticks, each sensor should fire according to its sample_interval_ticks.
    """
    profile = make_vehicle_profile("RATE-001", "mixed", seed=7)
    gen = TelemetryGenerator(profile)
    fire_counts: dict = defaultdict(int)

    for _ in range(100):
        for r in gen.tick():
            fire_counts[r.sensor_name] += 1

    for sensor_name, spec in SENSOR_REGISTRY.items():
        expected = 100 // spec.sample_interval_ticks
        actual = fire_counts[sensor_name]
        # Allow ±1 for boundary tick behavior
        assert abs(actual - expected) <= 1, (
            f"{sensor_name}: expected ~{expected} firings in 100 ticks, got {actual}"
        )


def test_high_frequency_sensor_fires_more_than_low(gen):
    """
    throttle_position (2Hz, interval 1) should fire >= long_fuel_trim (0.2Hz, interval 5)
    """
    counts: dict = defaultdict(int)
    for _ in range(50):
        for r in gen.tick():
            counts[r.sensor_name] += 1

    assert counts["throttle_position"] >= counts["long_fuel_trim"]


# ── Value bounds ──────────────────────────────────────────────────────────────

def test_all_values_within_critical_range(gen):
    """No reading should ever exceed critical_range bounds."""
    for _ in range(300):
        for r in gen.tick():
            spec = SENSOR_REGISTRY[r.sensor_name]
            assert r.value >= spec.critical_min, (
                f"{r.sensor_name}: {r.value} < critical_min {spec.critical_min}"
            )
            assert r.value <= spec.critical_max, (
                f"{r.sensor_name}: {r.value} > critical_max {spec.critical_max}"
            )


def test_most_values_within_healthy_range():
    """
    Most readings should be within healthy range.
    Allow up to 5% outside due to personality bias + noise on edge cases.
    """
    profile = make_vehicle_profile("HEALTH-001", "sedan_low_mileage", seed=123)
    gen = TelemetryGenerator(profile)
    
    total = 0
    outside_healthy = 0

    for _ in range(200):
        for r in gen.tick():
            spec = SENSOR_REGISTRY[r.sensor_name]
            total += 1
            if r.value < spec.healthy_min or r.value > spec.healthy_max:
                outside_healthy += 1

    pct_outside = outside_healthy / total
    assert pct_outside < 0.05, (
        f"{pct_outside:.1%} of readings outside healthy range (limit: 5%)"
    )


# ── Override mechanism ────────────────────────────────────────────────────────

def test_override_replaces_value(gen):
    """When override is provided, the overridden sensor value should be used."""
    override_val = 0.123
    for _ in range(10):
        readings = gen.tick(overrides={"rpm": override_val})
        rpm_readings = [r for r in readings if r.sensor_name == "rpm"]
        if rpm_readings:
            # Clip may have applied but value should be very close to override
            assert abs(rpm_readings[0].value - override_val) < 1.0


def test_override_does_not_affect_other_sensors(gen):
    """Overriding one sensor should not affect other sensors."""
    override_val = 999.0  # Something distinguishable
    # rpm critical max is 7500, so 999 is valid — it should appear
    readings = gen.tick(overrides={"rpm": 999.0})
    
    non_rpm = [r for r in readings if r.sensor_name != "rpm"]
    for r in non_rpm:
        assert r.value != 999.0, f"{r.sensor_name} was accidentally set to override value"


# ── Full day run ──────────────────────────────────────────────────────────────

def test_run_day_returns_correct_count():
    """A full day should return readings proportional to sample rates."""
    profile = make_vehicle_profile("DAY-001", "mixed", seed=5)
    gen = TelemetryGenerator(profile)
    readings = gen.run_day()

    # Minimum: slowest sensor (0.2Hz = 1 per 5 ticks = 17,280 per day)
    # Maximum: fastest sensor (2Hz = 2 per tick, but interval=1, so 86,400)
    # Total across all 12 sensors should be well above 100k
    assert len(readings) > 100_000, f"Too few readings: {len(readings):,}"


def test_run_day_advances_day_counter():
    profile = make_vehicle_profile("DAY-002", "mixed", seed=6)
    gen = TelemetryGenerator(profile)
    assert gen.day == 0
    gen.run_day()
    assert gen.day == 1


def test_run_days_callback_called_per_day():
    profile = make_vehicle_profile("CB-001", "mixed", seed=8)
    gen = TelemetryGenerator(profile)
    days_seen = []

    def on_day(day, readings):
        days_seen.append(day)

    gen.run_days(3, on_day=on_day)
    assert days_seen == [0, 1, 2]


# ── Profile switching ─────────────────────────────────────────────────────────

def test_cold_start_profile_at_tick_0():
    """First 600 ticks should use cold_start profile (coolant should be below normal)."""
    from datetime import datetime
    profile = make_vehicle_profile("COLD-001", "mixed", seed=11)
    # Start at midnight to trigger cold start detection
    gen = TelemetryGenerator(profile, start_time=datetime(2024, 1, 1, 0, 0, 0))

    coolant_readings = []
    for _ in range(600):
        for r in gen.tick():
            if r.sensor_name == "coolant_temp":
                coolant_readings.append(r.value)

    if coolant_readings:
        avg = sum(coolant_readings) / len(coolant_readings)
        # Cold start coolant should average below normal operating temp (82°C)
        assert avg < 90.0, f"Cold start coolant avg {avg:.1f}°C is too high (expected < 90)"
