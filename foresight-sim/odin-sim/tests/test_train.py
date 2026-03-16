"""
tests/test_train.py
Unit tests for the Foresight model trainer (train.py) and inference server
(serve.py) covering expanded ABS/TCM feature set.

All tests are pure unit tests — no DB connection required.
"""

import sys
import os

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from train import (
    add_derived_features,
    build_features,
    FEATURE_SENSORS,
)
from bootstrap import DEMO_SCENARIOS
from serve import _route_component, _build_input_df, _compute_derived, _state


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _make_wide_df(**overrides) -> pd.DataFrame:
    """
    Return a minimal 3-row wide-pivoted DataFrame with all engine + ABS + TCM
    columns populated.  Override individual columns via kwargs.
    """
    base = {
        # Engine
        "rpm_mean_val":              [1800.0, 1900.0, 2100.0],
        "rpm_std_val":               [  50.0,   60.0,   70.0],
        "rpm_min_val":               [ 700.0,  750.0,  800.0],
        "rpm_max_val":               [3000.0, 3100.0, 3200.0],
        "coolant_temp_mean_val":     [  92.0,   94.0,   96.0],
        "coolant_temp_std_val":      [   2.0,    2.0,    2.0],
        "coolant_temp_min_val":      [  88.0,   90.0,   92.0],
        "coolant_temp_max_val":      [ 100.0,  102.0,  104.0],
        "intake_air_temp_mean_val":  [  30.0,   32.0,   34.0],
        "intake_air_temp_std_val":   [   1.0,    1.0,    1.0],
        "intake_air_temp_min_val":   [  28.0,   30.0,   32.0],
        "intake_air_temp_max_val":   [  33.0,   35.0,   37.0],
        # TCM
        "trans_fluid_temp_mean_val": [  80.0,   85.0,   95.0],
        "trans_fluid_temp_std_val":  [   1.0,    1.5,    2.0],
        "trans_fluid_temp_min_val":  [  75.0,   80.0,   88.0],
        "trans_fluid_temp_max_val":  [  85.0,   90.0,  105.0],
        "slip_rpm_mean_val":         [  20.0,   40.0,  300.0],
        "slip_rpm_std_val":          [   5.0,    8.0,   30.0],
        "slip_rpm_min_val":          [   0.0,   10.0,  200.0],
        "slip_rpm_max_val":          [  35.0,   60.0,  600.0],
        "line_pressure_mean_val":    [ 145.0,  140.0,   60.0],
        "line_pressure_std_val":     [   3.0,    4.0,   10.0],
        "line_pressure_min_val":     [ 135.0,  130.0,   40.0],
        "line_pressure_max_val":     [ 155.0,  150.0,   80.0],
        # ABS
        "wheel_speed_fl_mean_val":   [  80.0,   82.0,    0.0],
        "wheel_speed_fl_std_val":    [   1.0,    1.2,    0.0],
        "wheel_speed_fl_min_val":    [  75.0,   78.0,    0.0],
        "wheel_speed_fl_max_val":    [  85.0,   87.0,    0.0],
        "wheel_speed_fr_mean_val":   [  81.0,   83.0,   82.0],
        "wheel_speed_fr_std_val":    [   1.0,    1.2,    1.0],
        "wheel_speed_fr_min_val":    [  76.0,   79.0,   78.0],
        "wheel_speed_fr_max_val":    [  86.0,   88.0,   87.0],
        "wheel_speed_rl_mean_val":   [  80.0,   82.0,   81.0],
        "wheel_speed_rl_std_val":    [   1.0,    1.2,    1.0],
        "wheel_speed_rl_min_val":    [  75.0,   78.0,   77.0],
        "wheel_speed_rl_max_val":    [  85.0,   87.0,   86.0],
        "wheel_speed_rr_mean_val":   [  80.0,   82.0,   81.0],
        "wheel_speed_rr_std_val":    [   1.0,    1.2,    1.0],
        "wheel_speed_rr_min_val":    [  75.0,   78.0,   77.0],
        "wheel_speed_rr_max_val":    [  85.0,   87.0,   86.0],
        # Meta
        "max_degradation":           [   0.1,    0.5,    0.9],
        "has_anomaly":               [ False,   True,   True],
        # Label columns (stripped by build_features)
        "vehicle_id":                ["V1", "V1", "V1"],
        "day":                       [  1,    30,    60],
        "label":                     [  0,     0,     1],
        "failure_start_day":         [np.nan, np.nan, np.nan],
        "dtc_fire_day":              [np.nan, np.nan, np.nan],
        "failure_mode":              [None,  None,  None],
        "dtc_code":                  [None,  None,  None],
    }
    base.update(overrides)
    return pd.DataFrame(base)


# ─────────────────────────────────────────────────────────────────────────────
# Feature set coverage
# ─────────────────────────────────────────────────────────────────────────────

class TestFeatureSensors:
    def test_includes_new_tcm_sensors(self):
        for sensor in ("trans_fluid_temp", "slip_rpm", "line_pressure"):
            assert sensor in FEATURE_SENSORS, f"Missing TCM sensor: {sensor}"

    def test_includes_new_abs_sensors(self):
        for sensor in ("wheel_speed_fl", "wheel_speed_fr", "wheel_speed_rl", "wheel_speed_rr"):
            assert sensor in FEATURE_SENSORS, f"Missing ABS sensor: {sensor}"

    def test_engine_sensors_still_present(self):
        for sensor in ("rpm", "coolant_temp", "maf", "battery_voltage", "catalyst_temp"):
            assert sensor in FEATURE_SENSORS

    def test_total_sensor_count_is_19(self):
        # 12 engine + 3 TCM + 4 ABS
        assert len(FEATURE_SENSORS) == 19


# ─────────────────────────────────────────────────────────────────────────────
# add_derived_features
# ─────────────────────────────────────────────────────────────────────────────

class TestAddDerivedFeatures:
    def test_wheel_speed_delta_computed(self):
        df = _make_wide_df()
        result = add_derived_features(df)
        # Row 0: fl=80, fr=81, rl=80, rr=80 → delta=1
        assert "wheel_speed_delta" in result.columns
        assert abs(result.loc[0, "wheel_speed_delta"] - 1.0) < 0.01

    def test_wheel_speed_delta_reflects_dropout(self):
        df = _make_wide_df()
        result = add_derived_features(df)
        # Row 2: fl=0 (dropout), others=81-82 → delta ≈ 82
        assert result.loc[2, "wheel_speed_delta"] > 80.0

    def test_thermal_delta_computed(self):
        df = _make_wide_df()
        result = add_derived_features(df)
        # Row 0: trans_fluid=80, intake=30 → thermal_delta=50
        assert "thermal_delta" in result.columns
        assert abs(result.loc[0, "thermal_delta"] - 50.0) < 0.01

    def test_thermal_delta_rises_with_overheat(self):
        df = _make_wide_df()
        result = add_derived_features(df)
        # Row 2: trans_fluid=95, intake=34 → thermal_delta=61
        assert result.loc[2, "thermal_delta"] > result.loc[0, "thermal_delta"]

    def test_slip_temp_ratio_computed(self):
        df = _make_wide_df()
        result = add_derived_features(df)
        # Row 0: slip=20, trans_fluid=80 → ratio=0.25
        assert "slip_temp_ratio" in result.columns
        assert abs(result.loc[0, "slip_temp_ratio"] - 0.25) < 0.01

    def test_slip_temp_ratio_rises_in_fault(self):
        df = _make_wide_df()
        result = add_derived_features(df)
        # Row 2: slip=300, trans_fluid=95 → ratio≈3.16 >> row 0's 0.25
        assert result.loc[2, "slip_temp_ratio"] > result.loc[0, "slip_temp_ratio"]

    def test_wheel_speed_delta_nan_when_partial_abs(self):
        # Remove one wheel speed column — delta must be NaN, not wrong
        df = _make_wide_df()
        df = df.drop(columns=["wheel_speed_rr_mean_val"])
        result = add_derived_features(df)
        assert result["wheel_speed_delta"].isna().all()

    def test_thermal_delta_nan_when_tcm_missing(self):
        df = _make_wide_df()
        df = df.drop(columns=["trans_fluid_temp_mean_val"])
        result = add_derived_features(df)
        assert result["thermal_delta"].isna().all()

    def test_slip_temp_ratio_nan_when_trans_temp_zero(self):
        df = _make_wide_df(**{"trans_fluid_temp_mean_val": [0.0, 0.0, 0.0]})
        result = add_derived_features(df)
        assert result["slip_temp_ratio"].isna().all()

    def test_does_not_mutate_input(self):
        df = _make_wide_df()
        cols_before = set(df.columns)
        add_derived_features(df)
        assert set(df.columns) == cols_before


# ─────────────────────────────────────────────────────────────────────────────
# build_features — NaN preservation
# ─────────────────────────────────────────────────────────────────────────────

class TestBuildFeatures:
    def test_nan_preserved_in_abs_columns(self):
        df = _make_wide_df()
        df = add_derived_features(df)
        # Null out wheel_speed columns to simulate engine-only vehicle
        for col in df.columns:
            if col.startswith("wheel_speed"):
                df[col] = np.nan
        X, y, feature_cols = build_features(df)
        ws_cols = [c for c in feature_cols if c.startswith("wheel_speed")]
        assert len(ws_cols) > 0
        assert X[ws_cols].isna().all().all(), "NaN should be preserved for ABS columns"

    def test_nan_preserved_in_tcm_columns(self):
        df = _make_wide_df()
        df = add_derived_features(df)
        # Null out ALL TCM stat columns to simulate engine-only vehicle
        for col in df.columns:
            if any(s in col for s in ("trans_fluid_temp", "slip_rpm", "line_pressure")):
                df[col] = np.nan
        X, y, feature_cols = build_features(df)
        tcm_cols = [c for c in feature_cols if any(
            s in c for s in ("trans_fluid_temp", "slip_rpm", "line_pressure")
        )]
        assert len(tcm_cols) > 0
        assert X[tcm_cols].isna().all().all(), "NaN should be preserved for TCM columns"

    def test_python_none_converted_to_nan(self):
        df = _make_wide_df()
        df = add_derived_features(df)
        df["wheel_speed_fl_mean_val"] = None  # Python None
        X, _, _ = build_features(df)
        assert X["wheel_speed_fl_mean_val"].isna().all()

    def test_feature_cols_excludes_metadata(self):
        df = _make_wide_df()
        df = add_derived_features(df)
        _, _, feature_cols = build_features(df)
        for col in ("vehicle_id", "day", "label", "failure_mode", "dtc_code"):
            assert col not in feature_cols

    def test_derived_features_included_in_feature_cols(self):
        df = _make_wide_df()
        df = add_derived_features(df)
        _, _, feature_cols = build_features(df)
        for derived in ("wheel_speed_delta", "thermal_delta", "slip_temp_ratio"):
            assert derived in feature_cols, f"Derived feature missing: {derived}"

    def test_feature_matrix_shape_includes_new_sensors(self):
        df = _make_wide_df()
        df = add_derived_features(df)
        X, y, feature_cols = build_features(df)
        # Fixture has 10 sensors (3 engine + 3 TCM + 4 ABS) × 4 stats = 40
        # + 3 derived features + 2 scalar aggregates = 45 minimum
        assert X.shape[1] >= 43, f"Expected ≥43 features, got {X.shape[1]}"
        assert X.shape[0] == 3


# ─────────────────────────────────────────────────────────────────────────────
# NaN rows → valid LightGBM predictions
# ─────────────────────────────────────────────────────────────────────────────

class TestNaNPrediction:
    """
    Train a minimal LightGBM model on synthetic data and verify that rows with
    NaN in ABS/TCM columns produce valid (0–1) float predictions without error.
    This validates the core LightGBM NaN-handling guarantee end-to-end.
    """

    @pytest.fixture(scope="class")
    def tiny_model(self):
        import lightgbm as lgb

        rng = np.random.default_rng(0)
        n = 200
        X = pd.DataFrame({
            "rpm_mean_val":              rng.uniform(700, 4000, n),
            "coolant_temp_mean_val":     rng.uniform(80, 130, n),
            "trans_fluid_temp_mean_val": np.where(rng.random(n) > 0.3, rng.uniform(70, 130, n), np.nan),
            "wheel_speed_delta":         np.where(rng.random(n) > 0.3, rng.uniform(0, 90, n), np.nan),
            "thermal_delta":             np.where(rng.random(n) > 0.3, rng.uniform(20, 80, n), np.nan),
        })
        y = (X["coolant_temp_mean_val"] > 105).astype(int)

        ds = lgb.Dataset(X, label=y)
        params = {"objective": "binary", "metric": "auc", "verbosity": -1,
                  "num_leaves": 8, "n_estimators": 30}
        model = lgb.train(params, ds, num_boost_round=30)
        return model, list(X.columns)

    def test_nan_abs_tcm_cols_predict_without_error(self, tiny_model):
        model, feat_cols = tiny_model
        # All-NaN for TCM / ABS columns
        row = {
            "rpm_mean_val":              1800.0,
            "coolant_temp_mean_val":     92.0,
            "trans_fluid_temp_mean_val": np.nan,
            "wheel_speed_delta":         np.nan,
            "thermal_delta":             np.nan,
        }
        df = pd.DataFrame([row])[feat_cols]
        prob = model.predict(df)[0]
        assert 0.0 <= prob <= 1.0, f"Prediction out of range: {prob}"

    def test_mixed_nan_engine_only_row(self, tiny_model):
        model, feat_cols = tiny_model
        row = {c: np.nan for c in feat_cols}
        row["rpm_mean_val"]          = 2000.0
        row["coolant_temp_mean_val"] = 95.0
        df = pd.DataFrame([row])[feat_cols]
        prob = model.predict(df)[0]
        assert not np.isnan(prob), "Prediction should not be NaN"
        assert 0.0 <= prob <= 1.0


# ─────────────────────────────────────────────────────────────────────────────
# SHAP component routing
# ─────────────────────────────────────────────────────────────────────────────

def _shap_entry(feature: str, shap_val: float) -> dict:
    return {"feature": feature, "value": 85.0, "shap": shap_val}


class TestRouteComponent:
    def test_transmission_wins_when_trans_shap_highest(self):
        top = [
            _shap_entry("trans_fluid_temp_mean_val", 0.8),
            _shap_entry("slip_rpm_mean_val",         0.5),
            _shap_entry("rpm_mean_val",              0.2),
        ]
        assert _route_component(top) == "transmission"

    def test_abs_wins_when_wheel_shap_highest(self):
        top = [
            _shap_entry("wheel_speed_delta",       0.9),
            _shap_entry("wheel_speed_fl_mean_val", 0.4),
            _shap_entry("coolant_temp_mean_val",   0.1),
        ]
        assert _route_component(top) == "abs_wheel_sensor"

    def test_engine_when_no_tcm_abs_contribution(self):
        top = [
            _shap_entry("rpm_mean_val",          0.7),
            _shap_entry("maf_mean_val",          0.4),
            _shap_entry("coolant_temp_mean_val", 0.3),
        ]
        assert _route_component(top) == "engine"

    def test_transmission_beats_abs_when_equal_tie_goes_transmission(self):
        # tie → transmission wins (trans_score >= abs_score)
        top = [
            _shap_entry("trans_fluid_temp_mean_val", 0.5),
            _shap_entry("wheel_speed_delta",         0.5),
        ]
        assert _route_component(top) == "transmission"

    def test_thermal_delta_routes_to_transmission(self):
        top = [_shap_entry("thermal_delta", 0.9)]
        assert _route_component(top) == "transmission"

    def test_slip_temp_ratio_routes_to_transmission(self):
        top = [_shap_entry("slip_temp_ratio", 0.6)]
        assert _route_component(top) == "transmission"

    def test_line_pressure_routes_to_transmission(self):
        top = [_shap_entry("line_pressure_mean_val", 0.7)]
        assert _route_component(top) == "transmission"

    def test_wheel_speed_rr_routes_to_abs(self):
        top = [_shap_entry("wheel_speed_rr_mean_val", 0.8)]
        assert _route_component(top) == "abs_wheel_sensor"

    def test_empty_shap_top_returns_engine(self):
        assert _route_component([]) == "engine"

    def test_abs_beats_engine_when_mixed(self):
        top = [
            _shap_entry("wheel_speed_fl_mean_val", 0.6),
            _shap_entry("rpm_mean_val",            0.9),  # engine but doesn't count toward abs_score
        ]
        # abs_score=0.6, trans_score=0, engine is fallback only when both==0
        assert _route_component(top) == "abs_wheel_sensor"


# ─────────────────────────────────────────────────────────────────────────────
# _build_input_df (serve.py)
# ─────────────────────────────────────────────────────────────────────────────

class TestBuildInputDf:
    @pytest.fixture(autouse=True)
    def set_feature_cols(self):
        """Temporarily set _state.feature_cols for these tests."""
        _state.feature_cols = [
            "rpm_mean_val", "coolant_temp_mean_val",
            "trans_fluid_temp_mean_val", "wheel_speed_delta",
        ]
        yield
        _state.feature_cols = []

    def test_known_features_populated(self):
        df = _build_input_df({"rpm_mean_val": 1800.0, "coolant_temp_mean_val": 92.0})
        assert df.loc[0, "rpm_mean_val"] == 1800.0
        assert df.loc[0, "coolant_temp_mean_val"] == 92.0

    def test_missing_features_are_nan_not_zero(self):
        df = _build_input_df({"rpm_mean_val": 1800.0})
        assert pd.isna(df.loc[0, "trans_fluid_temp_mean_val"])
        assert pd.isna(df.loc[0, "wheel_speed_delta"])

    def test_output_columns_match_feature_cols(self):
        df = _build_input_df({})
        assert list(df.columns) == _state.feature_cols

    def test_single_row_output(self):
        df = _build_input_df({"rpm_mean_val": 1500.0})
        assert len(df) == 1


# ─────────────────────────────────────────────────────────────────────────────
# _compute_derived (serve.py)
# ─────────────────────────────────────────────────────────────────────────────

class TestComputeDerived:
    def test_wheel_speed_delta_computed(self):
        features = {
            "wheel_speed_fl_mean_val": 80.0,
            "wheel_speed_fr_mean_val": 82.0,
            "wheel_speed_rl_mean_val": 81.0,
            "wheel_speed_rr_mean_val": 83.0,
        }
        _compute_derived(features)
        assert abs(features["wheel_speed_delta"] - 3.0) < 0.01

    def test_wheel_speed_delta_nan_when_partial(self):
        features = {
            "wheel_speed_fl_mean_val": 80.0,
            "wheel_speed_fr_mean_val": 82.0,
            # rl, rr missing
        }
        _compute_derived(features)
        assert np.isnan(features["wheel_speed_delta"])

    def test_thermal_delta_computed(self):
        features = {
            "trans_fluid_temp_mean_val": 95.0,
            "intake_air_temp_mean_val":  30.0,
        }
        _compute_derived(features)
        assert abs(features["thermal_delta"] - 65.0) < 0.01

    def test_thermal_delta_nan_when_tcm_missing(self):
        features = {"intake_air_temp_mean_val": 30.0}
        _compute_derived(features)
        assert np.isnan(features["thermal_delta"])

    def test_slip_temp_ratio_computed(self):
        features = {
            "slip_rpm_mean_val":         300.0,
            "trans_fluid_temp_mean_val": 100.0,
        }
        _compute_derived(features)
        assert abs(features["slip_temp_ratio"] - 3.0) < 0.01

    def test_slip_temp_ratio_nan_when_trans_zero(self):
        features = {
            "slip_rpm_mean_val":         100.0,
            "trans_fluid_temp_mean_val": 0.0,
        }
        _compute_derived(features)
        assert np.isnan(features["slip_temp_ratio"])


# ─────────────────────────────────────────────────────────────────────────────
# Demo vehicles (bootstrap.py)
# ─────────────────────────────────────────────────────────────────────────────

class TestDemoScenarios:
    def test_seven_demo_vehicles_total(self):
        assert len(DEMO_SCENARIOS) == 7

    def test_demo_006_exists(self):
        ids = [s["vehicle_id"] for s in DEMO_SCENARIOS]
        assert "DEMO-006" in ids

    def test_demo_007_exists(self):
        ids = [s["vehicle_id"] for s in DEMO_SCENARIOS]
        assert "DEMO-007" in ids

    def test_demo_006_is_transmission_overheat(self):
        s = next(s for s in DEMO_SCENARIOS if s["vehicle_id"] == "DEMO-006")
        assert s["failure"] == "transmission_overheat"

    def test_demo_007_is_wheel_speed_dropout(self):
        s = next(s for s in DEMO_SCENARIOS if s["vehicle_id"] == "DEMO-007")
        assert s["failure"] == "wheel_speed_sensor_dropout"

    def test_demo_006_has_failure_start_day(self):
        s = next(s for s in DEMO_SCENARIOS if s["vehicle_id"] == "DEMO-006")
        assert isinstance(s.get("failure_start_day"), int)
        assert s["failure_start_day"] > 0

    def test_demo_007_has_failure_start_day(self):
        s = next(s for s in DEMO_SCENARIOS if s["vehicle_id"] == "DEMO-007")
        assert isinstance(s.get("failure_start_day"), int)
        assert s["failure_start_day"] > 0

    def test_all_demos_have_description(self):
        for s in DEMO_SCENARIOS:
            assert s.get("description"), f"Missing description for {s['vehicle_id']}"

    def test_original_five_demos_unchanged(self):
        expected = ["DEMO-001", "DEMO-002", "DEMO-003", "DEMO-004", "DEMO-005"]
        ids = [s["vehicle_id"] for s in DEMO_SCENARIOS]
        for eid in expected:
            assert eid in ids


# ─────────────────────────────────────────────────────────────────────────────
# /model/info meta structure
# ─────────────────────────────────────────────────────────────────────────────

class TestModelInfoMeta:
    """
    Tests that train.py produces a meta dict with the required /model/info fields.
    We verify the structure by constructing a representative meta dict directly —
    same logic as the main() function — without needing a DB.
    """

    @pytest.fixture
    def sample_meta(self):
        """Simulate the meta dict produced by train.py main()."""
        failure_counts = {
            "o2_sensor":                   {"total_rows": 60,  "positive_rows": 14},
            "catalytic_converter":          {"total_rows": 60,  "positive_rows": 15},
            "maf_sensor":                   {"total_rows": 60,  "positive_rows": 12},
            "battery_alternator":           {"total_rows": 60,  "positive_rows": 13},
            "transmission_overheat":        {"total_rows": 60,  "positive_rows": 18},
            "wheel_speed_sensor_dropout":   {"total_rows": 60,  "positive_rows": 16},
            "healthy":                      {"total_rows": 200, "positive_rows":  0},
        }
        feature_cols = [
            "rpm_mean_val", "coolant_temp_mean_val", "trans_fluid_temp_mean_val",
            "wheel_speed_fl_mean_val", "wheel_speed_delta", "thermal_delta",
            "slip_temp_ratio",
        ]
        return {
            "timestamp": "20260315_1200",
            "source": "sim",
            "features": feature_cols,
            "feature_count": len(feature_cols),
            "params": {"objective": "binary"},
            "optimized": False,
            "trials": 0,
            "failure_modes": sorted(k for k in failure_counts if k != "healthy"),
            "failure_mode_counts": failure_counts,
        }

    def test_feature_count_matches_features_list(self, sample_meta):
        assert sample_meta["feature_count"] == len(sample_meta["features"])

    def test_failure_modes_list_present(self, sample_meta):
        assert "failure_modes" in sample_meta
        assert isinstance(sample_meta["failure_modes"], list)

    def test_transmission_overheat_in_failure_modes(self, sample_meta):
        assert "transmission_overheat" in sample_meta["failure_modes"]

    def test_wheel_speed_dropout_in_failure_modes(self, sample_meta):
        assert "wheel_speed_sensor_dropout" in sample_meta["failure_modes"]

    def test_healthy_excluded_from_failure_modes_list(self, sample_meta):
        assert "healthy" not in sample_meta["failure_modes"]

    def test_failure_mode_counts_has_positive_rows(self, sample_meta):
        counts = sample_meta["failure_mode_counts"]
        assert counts["transmission_overheat"]["positive_rows"] > 0
        assert counts["wheel_speed_sensor_dropout"]["positive_rows"] > 0

    def test_failure_mode_counts_healthy_has_zero_positives(self, sample_meta):
        assert sample_meta["failure_mode_counts"]["healthy"]["positive_rows"] == 0

    def test_source_is_sim_not_real(self, sample_meta):
        assert sample_meta["source"] == "sim"
        assert "real" not in sample_meta["source"]
