"""Shared pytest fixtures for Foresight tests."""

import numpy as np
import pandas as pd
import pytest


@pytest.fixture
def sample_wide_df():
    """Minimal wide-format DataFrame mimicking loader output."""
    n = 30
    vehicles = ["V-001"] * 15 + ["V-002"] * 15
    days = list(range(15)) * 2

    data = {
        "vehicle_id": vehicles,
        "day": days,
        "rpm_mean": np.random.default_rng(1).uniform(800, 2000, n),
        "rpm_std": np.random.default_rng(2).uniform(50, 200, n),
        "rpm_min": np.random.default_rng(3).uniform(600, 800, n),
        "rpm_max": np.random.default_rng(4).uniform(2000, 4000, n),
        "coolant_temp_mean": np.random.default_rng(5).uniform(80, 100, n),
        "coolant_temp_std": np.random.default_rng(6).uniform(1, 5, n),
        "coolant_temp_min": np.random.default_rng(7).uniform(70, 85, n),
        "coolant_temp_max": np.random.default_rng(8).uniform(100, 115, n),
        "maf_mean": np.random.default_rng(9).uniform(5, 25, n),
        "maf_std": np.random.default_rng(10).uniform(0.5, 3, n),
        "maf_min": np.random.default_rng(11).uniform(3, 8, n),
        "maf_max": np.random.default_rng(12).uniform(20, 35, n),
        "o2_voltage_b1s1_mean": np.random.default_rng(13).uniform(0.1, 0.9, n),
        "o2_voltage_b1s1_std": np.random.default_rng(14).uniform(0.05, 0.2, n),
        "o2_voltage_b1s1_min": np.random.default_rng(15).uniform(0.05, 0.2, n),
        "o2_voltage_b1s1_max": np.random.default_rng(16).uniform(0.7, 0.95, n),
        "o2_voltage_b1s2_mean": np.random.default_rng(17).uniform(0.4, 0.6, n),
        "o2_voltage_b1s2_std": np.random.default_rng(18).uniform(0.01, 0.05, n),
        "battery_voltage_mean": np.random.default_rng(19).uniform(13.5, 14.5, n),
        "battery_voltage_min": np.random.default_rng(20).uniform(12.0, 13.5, n),
        "long_fuel_trim_mean": np.random.default_rng(21).uniform(-5, 5, n),
        "short_fuel_trim_mean": np.random.default_rng(22).uniform(-3, 3, n),
        "year": [2018] * n,
        "mileage_km": [120000] * n,
        "base_health": [0.8] * n,
        "label_binary": ([0] * 10 + [1] * 5) * 2,
        "label_severity": (["healthy"] * 10 + ["early"] * 5) * 2,
    }
    return pd.DataFrame(data)


@pytest.fixture
def split_df():
    rng = np.random.default_rng(42)
    n_vehicles = 20
    days = 30
    rows = []
    for v in range(n_vehicles):
        has_failure = v < 12  # 12 failure, 8 healthy
        for d in range(days):
            rows.append({
                "vehicle_id": f"V-{v:03d}",
                "day": d,
                "label_binary": 1 if (has_failure and d > 15) else 0,
                "label_severity": "early" if (has_failure and d > 15) else "healthy",
            })
    return pd.DataFrame(rows)


@pytest.fixture
def synthetic_train_data():
    rng = np.random.default_rng(42)
    n = 500
    X = pd.DataFrame({
        "rpm_mean": rng.uniform(800, 2000, n),
        "coolant_temp_mean": rng.uniform(70, 110, n),
        "o2_b1s1_range": rng.uniform(0.1, 0.9, n),
        "fuel_trim_delta": rng.uniform(-10, 25, n),
        "vehicle_age_years": rng.uniform(1, 15, n),
    })
    y = pd.Series((X["o2_b1s1_range"] < 0.4).astype(int))
    return X, y
