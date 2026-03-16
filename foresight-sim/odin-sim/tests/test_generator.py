"""
tests/test_generator.py
Unit tests for the telemetry generator and failure injector.
"""

import pytest
import numpy as np
import sys
import os
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sensors import SENSORS, DRIVING_PROFILES, healthy_reading
from generator import TelemetryGenerator, VehicleProfile, TelemetryReading, make_vehicle_profile
from injector import FailureInjector, InjectionConfig
from degradation import FAILURE_MODES


# ─────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────

@pytest.fixture
def basic_profile():
    return VehicleProfile(
        vehicle_id="TEST-001",
        make_model="Toyota Camry",
        year=2020,
        mileage=50000,
        driving_profile="mixed",
        base_health=0.9,
        seed=42,
    )


@pytest.fixture
def generator(basic_profile):
    return TelemetryGenerator(basic_profile)


# ─────────────────────────────────────────────
# healthy_reading
# ─────────────────────────────────────────────

class TestHealthyReading:
    def test_returns_float(self):
        rng = np.random.default_rng(0)
        val = healthy_reading("rpm", "mixed", rng)
        assert isinstance(val, float)

    def test_within_critical_range(self):
        rng = np.random.default_rng(0)
        spec = SENSORS["rpm"]
        for _ in range(1000):
            val = healthy_reading("rpm", "mixed", rng)
            assert spec.critical_range[0] <= val <= spec.critical_range[1]

    def test_all_sensors_generate_readings(self):
        rng = np.random.default_rng(7)
        for sensor_name in SENSORS:
            val = healthy_reading(sensor_name, "mixed", rng)
            assert val is not None

    def test_profile_shapes_output(self):
        rng_city = np.random.default_rng(42)
        rng_hwy = np.random.default_rng(42)
        city_speeds = [healthy_reading("vehicle_speed", "city", rng_city) for _ in range(200)]
        hwy_speeds = [healthy_reading("vehicle_speed", "highway", rng_hwy) for _ in range(200)]
        assert np.mean(hwy_speeds) > np.mean(city_speeds)

    def test_unknown_sensor_raises(self):
        with pytest.raises(ValueError, match="Unknown sensor"):
            healthy_reading("nonexistent_sensor", "mixed")

    def test_unknown_profile_falls_back_to_mixed(self):
        rng = np.random.default_rng(0)
        val = healthy_reading("rpm", "totally_fake_profile", rng)
        assert isinstance(val, float)


# ─────────────────────────────────────────────
# VehicleProfile / make_vehicle_profile
# ─────────────────────────────────────────────

class TestVehicleProfile:
    def test_make_vehicle_profile_returns_profile(self):
        p = make_vehicle_profile("VH-001", archetype="sedan_low_mileage", seed=0)
        assert isinstance(p, VehicleProfile)
        assert p.vehicle_id == "VH-001"

    def test_make_vehicle_profile_archetype_bounds(self):
        for archetype in ["sedan_low_mileage", "sedan_high_mileage", "truck_work", "suv_family", "economy_beater"]:
            p = make_vehicle_profile("X", archetype=archetype, seed=1)
            assert 0.3 <= p.base_health <= 1.0
            assert p.year >= 2006  # At least 18 years ago max
            assert p.mileage >= 5000

    def test_seeded_profile_is_reproducible(self):
        p1 = make_vehicle_profile("A", seed=99)
        p2 = make_vehicle_profile("A", seed=99)
        assert p1.mileage == p2.mileage
        assert p1.make_model == p2.make_model

    def test_different_seeds_differ(self):
        p1 = make_vehicle_profile("A", seed=1)
        p2 = make_vehicle_profile("A", seed=2)
        # Very likely to differ on at least one field
        assert not (p1.mileage == p2.mileage and p1.year == p2.year)


# ─────────────────────────────────────────────
# TelemetryGenerator
# ─────────────────────────────────────────────

class TestTelemetryGenerator:
    def test_step_returns_readings(self, generator):
        readings = generator.step()
        assert len(readings) > 0
        assert all(isinstance(r, TelemetryReading) for r in readings)

    def test_readings_have_vehicle_id(self, generator, basic_profile):
        readings = generator.step()
        for r in readings:
            assert r.vehicle_id == basic_profile.vehicle_id

    def test_readings_are_within_critical_range(self, generator):
        for _ in range(100):
            for r in generator.step():
                spec = SENSORS[r.sensor_name]
                assert spec.critical_range[0] <= r.value <= spec.critical_range[1], \
                    f"{r.sensor_name}={r.value} outside critical range {spec.critical_range}"

    def test_readings_have_correct_units(self, generator):
        readings = generator.step()
        for r in readings:
            assert r.unit == SENSORS[r.sensor_name].unit

    def test_time_advances_each_step(self, generator):
        t0 = generator.current_time
        generator.step()
        assert generator.current_time > t0

    def test_day_advances_after_86400_steps(self, basic_profile):
        gen = TelemetryGenerator(basic_profile)
        assert gen.current_day == 0
        for _ in range(86400):
            gen.step()
        assert gen.current_day == 1

    def test_source_is_sim(self, generator):
        readings = generator.step()
        for r in readings:
            assert r.source == "sim"

    def test_seeded_generator_is_reproducible(self, basic_profile):
        gen1 = TelemetryGenerator(basic_profile)
        gen2 = TelemetryGenerator(basic_profile)
        r1 = [r.value for r in gen1.step()]
        r2 = [r.value for r in gen2.step()]
        assert r1 == r2

    def test_run_day_returns_many_readings(self, basic_profile):
        gen = TelemetryGenerator(basic_profile)
        readings = gen.run_day()
        # 86400 ticks * ~12 sensors at varying sample rates → at least a few thousand
        assert len(readings) > 5000

    def test_sensor_sample_rates_respected(self, basic_profile):
        """Sensors with lower sample rates should produce fewer readings per day."""
        gen = TelemetryGenerator(basic_profile)
        readings = gen.run_day()
        by_sensor = {}
        for r in readings:
            by_sensor.setdefault(r.sensor_name, 0)
            by_sensor[r.sensor_name] += 1

        # RPM (1Hz) should have ~86400 readings; catalyst_temp (0.2Hz) ~17280
        rpm_count = by_sensor.get("rpm", 0)
        cat_count = by_sensor.get("catalyst_temp", 0)
        assert rpm_count > cat_count * 3

    def test_override_sensors_applied(self, generator):
        readings = generator.step(override_sensors={"rpm": 9999.0})
        rpm_readings = [r for r in readings if r.sensor_name == "rpm"]
        # RPM might not sample on this exact tick, but if it does, override applies
        for r in rpm_readings:
            assert r.value == pytest.approx(
                float(np.clip(9999.0, SENSORS["rpm"].critical_range[0], SENSORS["rpm"].critical_range[1])),
                abs=0.01
            )

    def test_personality_offsets_differ_by_seed(self):
        p1 = VehicleProfile("A", "Toyota", 2020, 50000, "mixed", 0.9, seed=1)
        p2 = VehicleProfile("B", "Toyota", 2020, 50000, "mixed", 0.9, seed=2)
        g1, g2 = TelemetryGenerator(p1), TelemetryGenerator(p2)
        assert g1._personality != g2._personality


# ─────────────────────────────────────────────
# FailureInjector
# ─────────────────────────────────────────────

class TestFailureInjector:
    def _make_injector(self, failure_mode: str, failure_start_day: int = 5,
                       failure_window_days: int = 30, seed: int = 42):
        profile = VehicleProfile(
            vehicle_id="INJ-001",
            make_model="Honda Civic",
            year=2018,
            mileage=80000,
            driving_profile="mixed",
            base_health=0.75,
            seed=seed,
        )
        gen = TelemetryGenerator(profile)
        config = InjectionConfig(
            failure_mode_name=failure_mode,
            failure_start_day=failure_start_day,
            failure_window_days=failure_window_days,
        )
        return FailureInjector(gen, config)

    def test_step_returns_readings(self):
        inj = self._make_injector("o2_sensor")
        readings = inj.step()
        assert len(readings) > 0

    def test_healthy_phase_is_healthy(self):
        inj = self._make_injector("o2_sensor", failure_start_day=50)
        # Day 0–4 is pre-failure
        for _ in range(100):
            for r in inj.step():
                assert r.is_healthy

    def test_degradation_factor_increases(self):
        inj = self._make_injector("o2_sensor", failure_start_day=0, failure_window_days=30)
        factors = set()
        # Fast-forward through a day to get non-zero factor
        for day in range(10):
            for _ in range(86400):
                readings = inj.step()
            factors.add(readings[0].degradation_factor)
        assert len(factors) > 1  # Factor changed over time

    def test_dtc_fires_eventually(self):
        inj = self._make_injector("battery_alternator", failure_start_day=0, failure_window_days=10)
        fired = False
        for _ in range(86400 * 15):  # 15 days
            inj.step()
            if inj.dtc_fired:
                fired = True
                break
        assert fired, "DTC should fire within 15 days when failure_window_days=10"

    def test_dtc_fire_day_recorded(self):
        inj = self._make_injector("spark_plugs", failure_start_day=0, failure_window_days=5)
        for _ in range(86400 * 7):
            inj.step()
        if inj.dtc_fired:
            assert inj.dtc_fire_day is not None
            assert inj.dtc_fire_day >= 0

    def test_source_tagged_after_dtc(self):
        inj = self._make_injector("o2_sensor", failure_start_day=0, failure_window_days=5)
        for _ in range(86400 * 8):
            readings = inj.step()

        if inj.dtc_fired:
            affected = {e.sensor_name for e in FAILURE_MODES["o2_sensor"].affected_sensors}
            for r in readings:
                if r.sensor_name in affected:
                    assert r.source.startswith("sim_dtc_")

    def test_summary_contains_expected_keys(self):
        inj = self._make_injector("maf_sensor")
        s = inj.summary()
        assert "vehicle_id" in s
        assert "failure_mode" in s
        assert "dtc_code" in s
        assert "failure_start_day" in s
        assert "repair_cost_oem" in s

    def test_all_failure_modes_can_be_injected(self):
        for mode_name in FAILURE_MODES:
            inj = self._make_injector(mode_name, failure_start_day=0, failure_window_days=60)
            # Just verify it runs without error for 10 ticks
            for _ in range(10):
                inj.step()

    def test_run_days_callback_invoked(self):
        inj = self._make_injector("egr_valve", failure_start_day=2, failure_window_days=20)
        called_days = []

        def cb(day, readings, factor, dtc_fired):
            called_days.append(day)

        inj.run_days(3, callback=cb)
        assert called_days == [0, 1, 2]

    def test_run_days_no_callback_accumulates(self):
        inj = self._make_injector("coolant_temp_sensor", failure_start_day=5, failure_window_days=20)
        readings = inj.run_days(2)
        assert len(readings) > 1000  # 2 days worth of readings
