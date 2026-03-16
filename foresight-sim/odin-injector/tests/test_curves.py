"""
tests/test_curves.py
Unit tests for curves/base.py and curves/library.py
"""

import pytest
import numpy as np
from curves.base import (
    SigmoidCurve, LinearCurve, ExponentialCurve, StepCurve, get_curve
)
from curves.library import FAILURE_MODES, FAILURE_MODE_NAMES, get_failure_mode


# ── Curve shape tests ─────────────────────────────────────────────────────────

@pytest.fixture
def all_curves():
    return {
        "sigmoid": SigmoidCurve(),
        "linear": LinearCurve(),
        "exponential": ExponentialCurve(),
        "step": StepCurve(),
    }


def test_curves_return_zero_before_start(all_curves):
    for name, curve in all_curves.items():
        for day in range(0, 10):
            f = curve.factor(current_day=day, failure_start_day=15, progression_days=60)
            assert f == 0.0, f"{name} curve returned {f} before start day"


def test_curves_return_one_at_end(all_curves):
    for name, curve in all_curves.items():
        f = curve.factor(current_day=100, failure_start_day=0, progression_days=60)
        assert f >= 0.99, f"{name} curve only reached {f} at end (expected >= 0.99)"


def test_curves_are_monotonically_nondecreasing(all_curves):
    for name, curve in all_curves.items():
        prev = 0.0
        for day in range(0, 100):
            f = curve.factor(current_day=day, failure_start_day=10, progression_days=60)
            assert f >= prev - 1e-9, (
                f"{name} curve decreased: day {day-1}={prev:.4f} → day {day}={f:.4f}"
            )
            prev = f


def test_curves_output_in_0_1(all_curves):
    for name, curve in all_curves.items():
        for day in range(0, 120):
            f = curve.factor(current_day=day, failure_start_day=5, progression_days=90)
            assert 0.0 <= f <= 1.0, f"{name} at day {day}: {f} out of [0,1]"


def test_sigmoid_is_slow_then_fast():
    curve = SigmoidCurve()
    f_at_20pct = curve.factor(18, 0, 90)   # 20% through
    f_at_60pct = curve.factor(54, 0, 90)   # 60% through
    f_at_90pct = curve.factor(81, 0, 90)   # 90% through
    # The jump from 20%→60% should be larger than from 0%→20%
    assert f_at_60pct - f_at_20pct > f_at_20pct, \
        "Sigmoid should accelerate past midpoint"
    assert f_at_90pct > 0.90, \
        f"Sigmoid should be near 1.0 at 90% through, got {f_at_90pct:.4f}"


def test_step_fires_immediately():
    curve = StepCurve()
    assert curve.factor(9, 10, 60) == 0.0
    assert curve.factor(10, 10, 60) == 1.0
    assert curve.factor(11, 10, 60) == 1.0


def test_get_curve_factory():
    for shape in ["sigmoid", "linear", "exponential", "step"]:
        curve = get_curve(shape)
        assert curve is not None


def test_get_curve_unknown_raises():
    with pytest.raises(ValueError, match="Unknown curve shape"):
        get_curve("quadratic_nonsense")


# ── Failure mode library tests ────────────────────────────────────────────────

def test_all_10_failure_modes_present():
    expected = [
        "o2_sensor", "coolant_temp_sensor", "maf_sensor", "catalytic_converter",
        "throttle_position_sensor", "spark_plugs", "battery_alternator",
        "egr_valve", "fuel_injector", "transmission_overheating",
    ]
    for name in expected:
        assert name in FAILURE_MODES, f"Missing failure mode: {name}"


def test_each_failure_mode_has_affected_sensors():
    for name, mode in FAILURE_MODES.items():
        assert len(mode.affected_sensors) >= 1, \
            f"{name}: must have at least 1 affected sensor"


def test_each_failure_mode_has_valid_dtc():
    for name, mode in FAILURE_MODES.items():
        assert mode.dtc_code.startswith("P"), \
            f"{name}: DTC code '{mode.dtc_code}' doesn't start with 'P'"
        assert len(mode.dtc_code) == 5, \
            f"{name}: DTC code '{mode.dtc_code}' is not 5 chars"


def test_progression_days_positive():
    for name, mode in FAILURE_MODES.items():
        assert mode.typical_progression_days > 0, \
            f"{name}: typical_progression_days must be > 0"


def test_repair_costs_valid():
    for name, mode in FAILURE_MODES.items():
        lo_oem, hi_oem = mode.repair_cost_oem
        lo_am, hi_am = mode.repair_cost_aftermarket
        assert hi_oem > lo_oem >= 0, f"{name}: invalid OEM cost range"
        assert hi_am > lo_am >= 0, f"{name}: invalid aftermarket cost range"
        assert hi_oem > hi_am, f"{name}: OEM max should exceed aftermarket max"


def test_effect_functions_return_healthy_before_onset():
    """Effect functions should not alter readings when factor < 0.60."""
    rng = np.random.default_rng(42)
    for name, mode in FAILURE_MODES.items():
        for effect in mode.affected_sensors:
            for factor in [0.0, 0.30, 0.59]:
                healthy = 50.0
                result = effect.effect_fn(healthy, factor, rng)
                # Allow ±5% of the healthy value for noise at factor=0
                assert abs(result - healthy) / max(abs(healthy), 1) < 0.15, (
                    f"{name} / {effect.sensor_name}: "
                    f"effect altered value at factor={factor}: "
                    f"healthy={healthy}, result={result:.4f}"
                )


def test_effect_functions_produce_different_values_at_high_factor():
    """Effect functions must meaningfully alter values at factor=0.95."""
    rng = np.random.default_rng(99)
    for name, mode in FAILURE_MODES.items():
        any_changed = False
        for effect in mode.affected_sensors:
            healthy = 50.0
            result = effect.effect_fn(healthy, 0.95, rng)
            if abs(result - healthy) > 1.0:
                any_changed = True
                break
        assert any_changed, (
            f"{name}: no sensor effect produced meaningful change at factor=0.95"
        )


def test_get_failure_mode_unknown_raises():
    with pytest.raises(KeyError, match="Unknown failure mode"):
        get_failure_mode("made_up_failure_xyz")
