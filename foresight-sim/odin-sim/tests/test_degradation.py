"""
tests/test_degradation.py
Unit tests for degradation curves and failure mode definitions.
"""

import pytest
import numpy as np
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from degradation import (
    FAILURE_MODES,
    compute_degradation_factor,
    sigmoid_drift,
    add_erratic_noise,
    get_failure_mode,
    make_wheel_dropout_mode,
    _WHEEL_SPEED_NAMES,
    _WHEEL_SPECIFIC_DTCS,
)
from sensors import SENSORS


# ─────────────────────────────────────────────
# sigmoid_drift
# ─────────────────────────────────────────────

class TestSigmoidDrift:
    def test_zero_factor_returns_original(self):
        result = sigmoid_drift(100.0, 200.0, factor=0.0)
        assert result == pytest.approx(100.0, abs=2.0)

    def test_full_factor_approaches_target(self):
        # sigmoid steepness=8.0 at factor=1.0 gives blend ~0.917, not 1.0
        result = sigmoid_drift(100.0, 200.0, factor=1.0)
        assert result == pytest.approx(200.0, abs=15.0)

    def test_midpoint_factor_is_intermediate(self):
        result = sigmoid_drift(0.0, 100.0, factor=0.7)
        assert 40.0 < result < 80.0

    def test_direction_can_be_negative(self):
        result = sigmoid_drift(14.0, 11.0, factor=1.0)
        assert result < 14.0


# ─────────────────────────────────────────────
# add_erratic_noise
# ─────────────────────────────────────────────

class TestErraticNoise:
    def test_no_noise_below_threshold(self):
        rng = np.random.default_rng(42)
        for _ in range(100):
            result = add_erratic_noise(50.0, factor=0.5, scale=10.0, rng=rng)
            assert result == 50.0

    def test_noise_added_above_threshold(self):
        rng = np.random.default_rng(42)
        results = [add_erratic_noise(50.0, factor=1.0, scale=5.0, rng=rng) for _ in range(200)]
        assert any(r != 50.0 for r in results)

    def test_noise_magnitude_increases_with_factor(self):
        rng = np.random.default_rng(0)
        std_low = np.std([add_erratic_noise(50.0, factor=0.8, scale=10.0, rng=rng) for _ in range(300)])
        rng = np.random.default_rng(0)
        std_high = np.std([add_erratic_noise(50.0, factor=1.0, scale=10.0, rng=rng) for _ in range(300)])
        assert std_high > std_low


# ─────────────────────────────────────────────
# compute_degradation_factor
# ─────────────────────────────────────────────

class TestComputeDegradationFactor:
    def test_before_start_day_is_zero(self):
        factor = compute_degradation_factor(current_day=5, total_days=60, failure_start_day=10)
        assert factor == 0.0

    def test_on_start_day_is_near_zero(self):
        factor = compute_degradation_factor(current_day=10, total_days=60, failure_start_day=10)
        assert factor < 0.1

    def test_monotonically_increasing(self):
        factors = [
            compute_degradation_factor(d, 60, 10)
            for d in range(10, 71)
        ]
        assert all(factors[i] <= factors[i+1] for i in range(len(factors)-1))

    def test_approaches_one_near_end(self):
        factor = compute_degradation_factor(current_day=70, total_days=60, failure_start_day=10)
        assert factor >= 0.95

    def test_linear_curve(self):
        factor = compute_degradation_factor(30, 60, 0, curve="linear")
        assert factor == pytest.approx(0.5, abs=0.01)

    def test_exponential_curve_slower_start(self):
        sig = compute_degradation_factor(30, 60, 0, curve="sigmoid")
        exp = compute_degradation_factor(30, 60, 0, curve="exponential")
        # Exponential is 0.25 at midpoint; sigmoid is ~0.5
        assert exp < sig


# ─────────────────────────────────────────────
# FAILURE_MODES registry
# ─────────────────────────────────────────────

class TestFailureModes:
    EXPECTED_MODES = [
        "o2_sensor", "coolant_temp_sensor", "maf_sensor", "catalytic_converter",
        "throttle_position_sensor", "spark_plugs", "battery_alternator",
        "egr_valve", "fuel_injector", "transmission_temp",
        "transmission_overheat", "wheel_speed_sensor_dropout",
    ]

    def test_all_modes_registered(self):
        for mode in self.EXPECTED_MODES:
            assert mode in FAILURE_MODES, f"Missing failure mode: {mode}"

    def test_exactly_twelve_modes(self):
        assert len(FAILURE_MODES) == 12

    def test_each_mode_has_dtc_code(self):
        # Allow SAE powertrain (P), chassis (C), body (B), and network (U) codes
        for name, mode in FAILURE_MODES.items():
            assert mode.dtc_code[0] in {"P", "C", "B", "U"}, \
                f"{name}: invalid DTC code {mode.dtc_code}"

    def test_severity_is_valid(self):
        valid = {"low", "medium", "high", "critical"}
        for name, mode in FAILURE_MODES.items():
            assert mode.severity in valid, f"{name}: invalid severity {mode.severity}"

    def test_repair_costs_are_positive(self):
        for name, mode in FAILURE_MODES.items():
            assert mode.repair_cost_oem[0] > 0
            assert mode.repair_cost_oem[1] >= mode.repair_cost_oem[0]
            assert mode.repair_cost_aftermarket[0] > 0
            assert mode.repair_cost_aftermarket[1] >= mode.repair_cost_aftermarket[0]

    def test_oem_cost_exceeds_aftermarket(self):
        for name, mode in FAILURE_MODES.items():
            assert mode.repair_cost_oem[0] >= mode.repair_cost_aftermarket[0], \
                f"{name}: OEM min should be >= aftermarket min"

    def test_affected_sensors_are_known(self):
        for name, mode in FAILURE_MODES.items():
            for effect in mode.affected_sensors:
                assert effect.sensor_name in SENSORS, \
                    f"{name}: unknown sensor '{effect.sensor_name}'"

    def test_get_failure_mode_returns_correct_object(self):
        mode = get_failure_mode("o2_sensor")
        assert mode.dtc_code == "P0130"

    def test_get_failure_mode_raises_on_unknown(self):
        with pytest.raises(ValueError, match="Unknown failure mode"):
            get_failure_mode("nonexistent_mode")


# ─────────────────────────────────────────────
# Degradation effect functions
# ─────────────────────────────────────────────

class TestFailureEffects:
    """Verify that each failure mode's effect functions produce expected sensor behavior."""

    def _run_effects(self, mode_name: str, factor: float, n: int = 100) -> dict[str, list]:
        rng = np.random.default_rng(42)
        mode = FAILURE_MODES[mode_name]
        results = {e.sensor_name: [] for e in mode.affected_sensors}
        for e in mode.affected_sensors:
            spec = SENSORS.get(e.sensor_name)
            if spec is None:
                continue
            mid = (spec.healthy_range[0] + spec.healthy_range[1]) / 2
            for _ in range(n):
                results[e.sensor_name].append(e.effect_fn(mid, factor, rng))
        return results

    def test_o2_sensor_healthy_phase_unchanged(self):
        results = self._run_effects("o2_sensor", factor=0.3)
        # At factor < 0.6, o2 should be near healthy midpoint (~0.5V)
        vals = results["o2_voltage_b1s1"]
        assert np.mean(vals) == pytest.approx(0.5, abs=0.05)

    def test_o2_sensor_late_decay_drifts(self):
        results = self._run_effects("o2_sensor", factor=0.9)
        vals = results["o2_voltage_b1s1"]
        # At high factor, voltage should be pulled toward 0.45V flatline
        assert np.mean(vals) == pytest.approx(0.45, abs=0.15)

    def test_battery_voltage_sags_at_high_factor(self):
        results = self._run_effects("battery_alternator", factor=0.95)
        vals = results["battery_voltage"]
        # Healthy midpoint is ~14.1V; should sag toward ~11.6V
        healthy_mid = (13.5 + 14.7) / 2
        assert np.mean(vals) < healthy_mid

    def test_maf_reads_low_when_degraded(self):
        results = self._run_effects("maf_sensor", factor=0.9)
        vals = results["maf"]
        healthy_mid = (2.0 + 25.0) / 2
        assert np.mean(vals) < healthy_mid * 0.7

    def test_coolant_sensor_drifts_hot(self):
        results = self._run_effects("coolant_temp_sensor", factor=0.95)
        vals = results["coolant_temp"]
        healthy_mid = (85 + 105) / 2
        assert np.mean(vals) > healthy_mid

    def test_tps_glitches_at_high_factor(self):
        rng = np.random.default_rng(42)
        mode = FAILURE_MODES["throttle_position_sensor"]
        effect_fn = mode.affected_sensors[0].effect_fn  # TPS effect
        # With high factor, should occasionally return 0 or 100
        results = [effect_fn(30.0, 0.95, rng) for _ in range(200)]
        extremes = [r for r in results if r == 0.0 or r == 100.0]
        assert len(extremes) > 5, "TPS should glitch to extremes at high degradation"

    def test_all_effect_functions_return_float(self):
        rng = np.random.default_rng(0)
        for mode_name, mode in FAILURE_MODES.items():
            for effect in mode.affected_sensors:
                spec = SENSORS.get(effect.sensor_name)
                if spec is None:
                    continue
                mid = (spec.healthy_range[0] + spec.healthy_range[1]) / 2
                result = effect.effect_fn(mid, 0.5, rng)
                assert isinstance(result, (int, float)), \
                    f"{mode_name}/{effect.sensor_name}: expected float, got {type(result)}"

    def test_effect_values_within_critical_range(self):
        """Injector clips to critical_range; raw effects should be within a generous 3x window."""
        rng = np.random.default_rng(42)
        for mode_name, mode in FAILURE_MODES.items():
            for effect in mode.affected_sensors:
                spec = SENSORS.get(effect.sensor_name)
                if spec is None:
                    continue
                mid = (spec.healthy_range[0] + spec.healthy_range[1]) / 2
                clo, chi = spec.critical_range
                margin = (chi - clo)
                for factor in [0.0, 0.5, 0.85, 1.0]:
                    val = effect.effect_fn(mid, factor, rng)
                    assert (clo - margin) <= val <= (chi + margin), \
                        f"{mode_name}/{effect.sensor_name} at factor={factor}: {val} wildly out of range"


# ─────────────────────────────────────────────
# Transmission Overheat
# ─────────────────────────────────────────────

class TestTransmissionOverheat:
    """Verify trans_fluid_temp, slip_rpm, and line_pressure hit correct thresholds."""

    def _run_effect(self, sensor_name: str, factor: float, n: int = 200) -> list:
        rng = np.random.default_rng(42)
        mode = FAILURE_MODES["transmission_overheat"]
        effect = next(e for e in mode.affected_sensors if e.sensor_name == sensor_name)
        spec = SENSORS[sensor_name]
        mid = (spec.healthy_range[0] + spec.healthy_range[1]) / 2
        return [effect.effect_fn(mid, factor, rng) for _ in range(n)]

    def test_trans_fluid_temp_healthy_phase_stable(self):
        vals = self._run_effect("trans_fluid_temp", factor=0.1)
        # Healthy mid is ~80°C; should stay close
        assert np.mean(vals) == pytest.approx(80.0, abs=5.0)

    def test_trans_fluid_temp_warn_threshold_at_forty_percent(self):
        # warnHigh = 93°C should be exceeded at factor ~0.40 (custom sigmoid center=0.50)
        vals = self._run_effect("trans_fluid_temp", factor=0.42)
        assert np.mean(vals) > 93.0, "Mean should exceed warnHigh (93°C) by factor=0.42"

    def test_trans_fluid_temp_crit_threshold_at_eighty_five_percent(self):
        # critHigh = 110°C should be exceeded at factor ~0.85 (custom sigmoid center=0.50)
        vals = self._run_effect("trans_fluid_temp", factor=0.87)
        assert np.mean(vals) > 110.0, "Mean should exceed critHigh (110°C) by factor=0.87"

    def test_trans_fluid_temp_within_sensor_bounds(self):
        spec = SENSORS["trans_fluid_temp"]
        clo, chi = spec.critical_range
        rng = np.random.default_rng(0)
        mode = FAILURE_MODES["transmission_overheat"]
        effect = next(e for e in mode.affected_sensors if e.sensor_name == "trans_fluid_temp")
        mid = (spec.healthy_range[0] + spec.healthy_range[1]) / 2
        margin = chi - clo
        for factor in [0.0, 0.3, 0.6, 0.85, 1.0]:
            for _ in range(50):
                val = effect.effect_fn(mid, factor, rng)
                assert (clo - margin) <= val <= (chi + margin), \
                    f"trans_fluid_temp at factor={factor}: {val} out of bounds"

    def test_slip_rpm_rises_above_warn_at_high_factor(self):
        # warnHigh = 200 rpm should be exceeded at high factor
        vals = self._run_effect("slip_rpm", factor=0.80)
        assert np.mean(vals) > 200.0, "Mean slip_rpm should exceed warnHigh (200) at factor=0.80"

    def test_slip_rpm_never_negative(self):
        rng = np.random.default_rng(7)
        mode = FAILURE_MODES["transmission_overheat"]
        effect = next(e for e in mode.affected_sensors if e.sensor_name == "slip_rpm")
        mid = (SENSORS["slip_rpm"].healthy_range[0] + SENSORS["slip_rpm"].healthy_range[1]) / 2
        for factor in [0.0, 0.5, 0.9, 1.0]:
            for _ in range(100):
                val = effect.effect_fn(mid, factor, rng)
                assert val >= 0.0, f"slip_rpm went negative ({val}) at factor={factor}"

    def test_line_pressure_drops_below_crit_at_end(self):
        # critLow = 35 psi should be breached at factor ~0.95 (custom sigmoid center=0.55)
        vals = self._run_effect("line_pressure", factor=0.96)
        assert np.mean(vals) < 35.0, "Mean line_pressure should drop below critLow (35 psi) at factor=0.96"

    def test_line_pressure_warn_at_mid_factor(self):
        # warnLow = 50 psi should be breached around factor=0.70 (custom sigmoid center=0.55)
        vals = self._run_effect("line_pressure", factor=0.72)
        assert np.mean(vals) < 50.0, "Mean line_pressure should be below warnLow (50 psi) at factor=0.72"

    def test_line_pressure_never_negative(self):
        rng = np.random.default_rng(3)
        mode = FAILURE_MODES["transmission_overheat"]
        effect = next(e for e in mode.affected_sensors if e.sensor_name == "line_pressure")
        mid = (SENSORS["line_pressure"].healthy_range[0] + SENSORS["line_pressure"].healthy_range[1]) / 2
        for factor in [0.0, 0.5, 0.9, 1.0]:
            for _ in range(100):
                val = effect.effect_fn(mid, factor, rng)
                assert val >= 0.0, f"line_pressure went negative ({val}) at factor={factor}"

    def test_dtc_code_is_p0218(self):
        assert FAILURE_MODES["transmission_overheat"].dtc_code == "P0218"


# ─────────────────────────────────────────────
# Wheel Speed Sensor Dropout
# ─────────────────────────────────────────────

class TestWheelSpeedDropout:
    """Verify dropout timing, delta behavior, and failing-wheel consistency."""

    # Default mode has wheel_speed_fl as the failing wheel
    MODE = FAILURE_MODES["wheel_speed_sensor_dropout"]

    def _failing_effect(self):
        return next(
            e for e in self.MODE.affected_sensors if e.sensor_name == "wheel_speed_fl"
        )

    def _good_effect(self, name="wheel_speed_fr"):
        return next(
            e for e in self.MODE.affected_sensors if e.sensor_name == name
        )

    # ── Phase 1: Healthy ─────────────────────────────────────────────────────

    def test_failing_wheel_healthy_at_low_factor(self):
        rng = np.random.default_rng(42)
        effect = self._failing_effect()
        mid = 95.0  # simulate highway speed
        vals = [effect.effect_fn(mid, 0.1, rng) for _ in range(200)]
        # All values should be close to vehicle speed, no zeros
        assert all(v > 50.0 for v in vals), "Failing wheel should not drop out at factor=0.10"
        assert np.mean(vals) == pytest.approx(95.0, abs=5.0)

    def test_good_wheels_always_track_speed(self):
        rng = np.random.default_rng(0)
        for wheel in ["wheel_speed_fr", "wheel_speed_rl", "wheel_speed_rr"]:
            effect = self._good_effect(wheel)
            vals = [effect.effect_fn(95.0, f, rng) for f in [0.1, 0.5, 0.9] for _ in range(50)]
            assert all(v > 50.0 for v in vals), f"{wheel} should never drop out"

    # ── Phase 2: Intermittent dropout ────────────────────────────────────────

    def test_dropouts_occur_in_degradation_phase(self):
        rng = np.random.default_rng(99)
        effect = self._failing_effect()
        vals = [effect.effect_fn(95.0, 0.50, rng) for _ in range(300)]
        zeros = [v for v in vals if v == 0.0]
        assert len(zeros) > 10, "Should have intermittent dropouts at factor=0.50"

    def test_dropout_frequency_increases_with_factor(self):
        rng_lo = np.random.default_rng(1)
        rng_hi = np.random.default_rng(1)
        effect = self._failing_effect()
        zeros_lo = sum(1 for _ in range(500) if effect.effect_fn(95.0, 0.35, rng_lo) == 0.0)
        zeros_hi = sum(1 for _ in range(500) if effect.effect_fn(95.0, 0.55, rng_hi) == 0.0)
        assert zeros_hi > zeros_lo, "Dropout frequency should increase with factor"

    # ── Phase 3: Failed — stuck at zero ──────────────────────────────────────

    def test_failing_wheel_stuck_at_zero_in_failed_phase(self):
        rng = np.random.default_rng(0)
        effect = self._failing_effect()
        vals = [effect.effect_fn(95.0, f, rng) for f in [0.60, 0.75, 0.90, 1.00] for _ in range(50)]
        assert all(v == 0.0 for v in vals), "Failing wheel must be 0 throughout failed phase"

    # ── Consistency: same wheel across full injection window ─────────────────

    def test_failing_wheel_is_consistent(self):
        """The same wheel (fl) should fail across the entire degradation window."""
        rng = np.random.default_rng(5)
        effect_fl = self._failing_effect()
        effect_fr = self._good_effect("wheel_speed_fr")
        # At failed phase, fl=0, fr≠0
        val_fl = effect_fl.effect_fn(95.0, 0.9, rng)
        val_fr = effect_fr.effect_fn(95.0, 0.9, rng)
        assert val_fl == 0.0
        assert val_fr > 0.0

    # ── wheel_speed_delta ─────────────────────────────────────────────────────

    def test_wheel_speed_delta_grows_in_failed_phase(self):
        """wheel_speed_delta = max(wheels) - min(wheels) should be ~95 when one wheel = 0."""
        rng = np.random.default_rng(7)
        effects = {e.sensor_name: e for e in self.MODE.affected_sensors}
        wheel_effects = [effects[w] for w in _WHEEL_SPEED_NAMES]

        healthy_speed = 95.0
        deltas_healthy = []
        deltas_failed = []

        for _ in range(100):
            speeds_h = [e.effect_fn(healthy_speed, 0.1, rng) for e in wheel_effects]
            speeds_f = [e.effect_fn(healthy_speed, 0.9, rng) for e in wheel_effects]
            deltas_healthy.append(max(speeds_h) - min(speeds_h))
            deltas_failed.append(max(speeds_f) - min(speeds_f))

        assert np.mean(deltas_healthy) < 5.0, "Delta should be near 0 in healthy phase"
        assert np.mean(deltas_failed) > 80.0, "Delta should be ~95 km/h in failed phase"

    # ── Factory ───────────────────────────────────────────────────────────────

    @pytest.mark.parametrize("wheel,expected_dtc", [
        ("wheel_speed_fl", "C0031"),
        ("wheel_speed_fr", "C0036"),
        ("wheel_speed_rl", "C0041"),
        ("wheel_speed_rr", "C0045"),
    ])
    def test_factory_produces_correct_wheel_specific_dtc(self, wheel, expected_dtc):
        mode = make_wheel_dropout_mode(wheel)
        assert expected_dtc in mode.dtc_description, \
            f"Expected {expected_dtc} in description for {wheel}"

    @pytest.mark.parametrize("wheel", _WHEEL_SPEED_NAMES)
    def test_factory_only_chosen_wheel_fails(self, wheel):
        rng = np.random.default_rng(42)
        mode = make_wheel_dropout_mode(wheel)
        effects = {e.sensor_name: e for e in mode.affected_sensors}
        # At failed phase: chosen wheel = 0, others ≠ 0
        val_failing = effects[wheel].effect_fn(95.0, 0.9, rng)
        assert val_failing == 0.0, f"{wheel} should be stuck at 0"
        for other in _WHEEL_SPEED_NAMES:
            if other != wheel:
                val = effects[other].effect_fn(95.0, 0.9, rng)
                assert val > 0.0, f"{other} should not fail when {wheel} is the target"

    def test_factory_raises_on_invalid_wheel(self):
        with pytest.raises(ValueError, match="Invalid wheel"):
            make_wheel_dropout_mode("wheel_speed_xx")

    def test_default_dtc_code_is_c0035(self):
        assert self.MODE.dtc_code == "C0035"

    def test_all_wheel_sensors_present_in_sensors_dict(self):
        for wheel in _WHEEL_SPEED_NAMES:
            assert wheel in SENSORS, f"{wheel} missing from SENSORS dict"
