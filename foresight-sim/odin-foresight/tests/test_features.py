"""tests/test_features.py — Unit tests for feature engineering."""

import numpy as np
import pandas as pd
import pytest


class TestVehicleFeatures:
    def test_vehicle_age_computed(self, sample_wide_df):
        from features.engineer import add_vehicle_features
        result = add_vehicle_features(sample_wide_df)
        assert "vehicle_age_years" in result.columns
        assert (result["vehicle_age_years"] == 2024 - 2018).all()

    def test_mileage_normalized(self, sample_wide_df):
        from features.engineer import add_vehicle_features
        result = add_vehicle_features(sample_wide_df)
        assert "mileage_km_norm" in result.columns
        assert result["mileage_km_norm"].between(0, 1).all()

    def test_health_inverted(self, sample_wide_df):
        from features.engineer import add_vehicle_features
        result = add_vehicle_features(sample_wide_df)
        assert "base_health_inv" in result.columns
        expected = 1.0 - 0.8
        assert abs(result["base_health_inv"].iloc[0] - expected) < 1e-6


class TestDerivedFeatures:
    def test_rpm_to_maf_ratio(self, sample_wide_df):
        from features.engineer import add_derived_sensor_features
        result = add_derived_sensor_features(sample_wide_df)
        assert "rpm_to_maf_ratio" in result.columns
        assert (result["rpm_to_maf_ratio"] >= 0).all()

    def test_fuel_trim_delta(self, sample_wide_df):
        from features.engineer import add_derived_sensor_features
        result = add_derived_sensor_features(sample_wide_df)
        assert "fuel_trim_delta" in result.columns
        expected = sample_wide_df["long_fuel_trim_mean"] - sample_wide_df["short_fuel_trim_mean"]
        pd.testing.assert_series_equal(
            result["fuel_trim_delta"].reset_index(drop=True),
            expected.reset_index(drop=True),
            check_names=False,
        )

    def test_o2_range(self, sample_wide_df):
        from features.engineer import add_derived_sensor_features
        result = add_derived_sensor_features(sample_wide_df)
        assert "o2_b1s1_range" in result.columns
        assert (result["o2_b1s1_range"] >= 0).all()

    def test_battery_headroom(self, sample_wide_df):
        from features.engineer import add_derived_sensor_features
        result = add_derived_sensor_features(sample_wide_df)
        assert "battery_headroom" in result.columns
        assert (result["battery_headroom"] >= 0).all()


class TestLagFeatures:
    def test_lag_columns_created(self, sample_wide_df):
        from features.engineer import add_lag_features
        result = add_lag_features(sample_wide_df, ["rpm_mean"], lag_days=3)
        assert "rpm_mean_lag3d" in result.columns
        assert "rpm_mean_delta3d" in result.columns

    def test_lag_nan_for_first_days(self, sample_wide_df):
        from features.engineer import add_lag_features
        result = add_lag_features(sample_wide_df.copy(), ["coolant_temp_mean"], lag_days=3)
        v1 = result[result["vehicle_id"] == "V-001"].sort_values("day")
        assert v1["coolant_temp_mean_lag3d"].iloc[:3].isna().all()

    def test_lag_correct_value(self, sample_wide_df):
        from features.engineer import add_lag_features
        df = sample_wide_df[sample_wide_df["vehicle_id"] == "V-001"].copy()
        result = add_lag_features(df, ["rpm_mean"], lag_days=2)
        result = result.sort_values("day").reset_index(drop=True)
        assert abs(result.loc[5, "rpm_mean_lag2d"] - result.loc[3, "rpm_mean"]) < 1e-9


class TestFeatureMatrix:
    def test_no_nans_after_build(self, sample_wide_df):
        from features.engineer import build_feature_matrix, get_feature_columns
        result = build_feature_matrix(sample_wide_df)
        feat_cols = get_feature_columns(result)
        assert result[feat_cols].isna().sum().sum() == 0, "NaNs found in feature matrix"

    def test_feature_count_reasonable(self, sample_wide_df):
        from features.engineer import build_feature_matrix, get_feature_columns
        result = build_feature_matrix(sample_wide_df)
        feat_cols = get_feature_columns(result)
        assert len(feat_cols) >= 20, f"Expected ≥20 features, got {len(feat_cols)}"

    def test_label_cols_excluded(self, sample_wide_df):
        from features.engineer import build_feature_matrix, get_feature_columns
        result = build_feature_matrix(sample_wide_df)
        feat_cols = get_feature_columns(result)
        for excluded in ["label_binary", "label_severity", "vehicle_id", "day"]:
            assert excluded not in feat_cols, f"'{excluded}' should not be a feature"
