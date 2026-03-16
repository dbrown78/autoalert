"""
tests/test_profiles.py
Unit tests for profiles/driving.py and profiles/personality.py.
"""

import pytest
from profiles.driving import (
    PROFILES, PROFILE_NAMES, get_profile_range, profile_for_time, describe_profile
)
from profiles.personality import (
    generate_personality, PersonalityProfile, SensorPersonality, BIAS_SCALE, NOISE_SCALE_RANGE
)
from core.specs import SENSOR_REGISTRY, SENSOR_NAMES


# ── Driving profiles ──────────────────────────────────────────────────────────

class TestDrivingProfiles:

    def test_all_expected_profiles_exist(self):
        for name in ["city", "highway", "cold_start", "mixed", "idle"]:
            assert name in PROFILES, f"Missing profile: {name}"

    def test_profile_names_matches_profiles(self):
        assert set(PROFILE_NAMES) == set(PROFILES.keys())

    def test_all_sensor_overrides_reference_known_sensors(self):
        for profile_name, overrides in PROFILES.items():
            for sensor_name in overrides:
                assert sensor_name in SENSOR_REGISTRY, (
                    f"Profile '{profile_name}' references unknown sensor '{sensor_name}'"
                )

    def test_profile_ranges_have_width(self):
        for profile_name, overrides in PROFILES.items():
            for sensor_name, (lo, hi) in overrides.items():
                assert hi > lo, (
                    f"Profile '{profile_name}' sensor '{sensor_name}': "
                    f"range ({lo}, {hi}) has no width"
                )

    def test_profile_ranges_within_critical(self):
        for profile_name, overrides in PROFILES.items():
            for sensor_name, (lo, hi) in overrides.items():
                spec = SENSOR_REGISTRY[sensor_name]
                assert lo >= spec.critical_min, (
                    f"Profile '{profile_name}' sensor '{sensor_name}': "
                    f"lo={lo} < critical_min={spec.critical_min}"
                )
                assert hi <= spec.critical_max, (
                    f"Profile '{profile_name}' sensor '{sensor_name}': "
                    f"hi={hi} > critical_max={spec.critical_max}"
                )

    def test_get_profile_range_returns_override(self):
        lo, hi = get_profile_range("city", "rpm", (0, 9999))
        assert (lo, hi) == PROFILES["city"]["rpm"]

    def test_get_profile_range_falls_back_to_default(self):
        fallback = (1.0, 2.0)
        # intake_air_temp is not in any profile — should return fallback
        lo, hi = get_profile_range("city", "intake_air_temp", fallback)
        assert (lo, hi) == fallback

    def test_get_profile_range_unknown_profile_uses_mixed(self):
        # Unknown profile falls back to "mixed"
        fallback = (0.0, 1.0)
        lo, hi = get_profile_range("nonexistent", "rpm", fallback)
        assert (lo, hi) == PROFILES["mixed"]["rpm"]

    def test_describe_profile_returns_string(self):
        for name in PROFILE_NAMES:
            desc = describe_profile(name)
            assert isinstance(desc, str)
            assert len(desc) > 10

    def test_describe_unknown_profile(self):
        desc = describe_profile("nonexistent")
        assert "Unknown" in desc or "nonexistent" in desc


class TestProfileForTime:

    def test_cold_start_within_first_600_ticks(self):
        for tick in [0, 1, 100, 599]:
            result = profile_for_time(7, 0, "mixed", tick_of_day=tick)
            assert result == "cold_start", f"Expected cold_start at tick {tick}, got {result}"

    def test_no_cold_start_after_600_ticks(self):
        result = profile_for_time(7, 0, "mixed", tick_of_day=600)
        assert result != "cold_start"

    def test_morning_rush_is_city(self):
        for hour in [6, 7, 8]:
            result = profile_for_time(hour, 30, "mixed", tick_of_day=1000)
            assert result == "city", f"Expected city at hour {hour}, got {result}"

    def test_midday_uses_default_profile(self):
        for hour in [9, 11, 12, 15]:
            result = profile_for_time(hour, 0, "highway", tick_of_day=5000)
            assert result == "highway", f"Expected highway at hour {hour}, got {result}"

    def test_evening_rush_is_city(self):
        for hour in [16, 17, 18]:
            result = profile_for_time(hour, 0, "mixed", tick_of_day=5000)
            assert result == "city", f"Expected city at hour {hour}, got {result}"

    def test_post_rush_is_highway(self):
        for hour in [19, 20, 21]:
            result = profile_for_time(hour, 0, "mixed", tick_of_day=5000)
            assert result == "highway", f"Expected highway at hour {hour}, got {result}"

    def test_late_night_is_idle(self):
        for hour in [22, 23, 0, 1, 2, 3, 4, 5]:
            result = profile_for_time(hour, 0, "mixed", tick_of_day=5000)
            assert result == "idle", f"Expected idle at hour {hour}, got {result}"


# ── Personality profiles ───────────────────────────────────────────────────────

class TestPersonalityProfile:

    @pytest.fixture
    def healthy_personality(self):
        return generate_personality("TEST-001", seed=42, health=1.0)

    @pytest.fixture
    def worn_personality(self):
        return generate_personality("TEST-002", seed=42, health=0.42)

    def test_generates_all_sensors(self, healthy_personality):
        for name in SENSOR_NAMES:
            assert name in healthy_personality.sensors, f"Missing sensor personality: {name}"

    def test_sensor_personality_fields(self, healthy_personality):
        for name, p in healthy_personality.sensors.items():
            assert isinstance(p.bias, float)
            assert isinstance(p.noise_scale, float)
            assert p.sensor_name == name

    def test_bias_bounded_by_healthy_range(self, healthy_personality):
        for name, spec in SENSOR_REGISTRY.items():
            range_width = spec.healthy_max - spec.healthy_min
            max_bias = range_width * BIAS_SCALE * 2.5  # max health_factor headroom
            p = healthy_personality.sensors[name]
            assert abs(p.bias) <= max_bias + 1e-9, (
                f"{name}: bias {p.bias:.4f} exceeds max allowed {max_bias:.4f}"
            )

    def test_noise_scale_within_range(self, healthy_personality):
        for name, p in healthy_personality.sensors.items():
            assert 0.5 <= p.noise_scale <= 3.0, (
                f"{name}: noise_scale {p.noise_scale:.4f} out of clipped range [0.5, 3.0]"
            )

    def test_worn_vehicle_has_larger_extremes(self):
        """Lower health → on average larger absolute biases than healthy vehicle."""
        healthy = generate_personality("H", seed=99, health=1.0)
        worn = generate_personality("W", seed=99, health=0.42)

        healthy_avg_bias = sum(abs(p.bias) for p in healthy.sensors.values()) / len(healthy.sensors)
        worn_avg_bias = sum(abs(p.bias) for p in worn.sensors.values()) / len(worn.sensors)
        assert worn_avg_bias >= healthy_avg_bias, (
            f"Worn vehicle avg bias {worn_avg_bias:.4f} not >= healthy {healthy_avg_bias:.4f}"
        )

    def test_same_seed_same_personality(self):
        p1 = generate_personality("V1", seed=7, health=0.8)
        p2 = generate_personality("V2", seed=7, health=0.8)
        for name in SENSOR_NAMES:
            assert p1.sensors[name].bias == p2.sensors[name].bias
            assert p1.sensors[name].noise_scale == p2.sensors[name].noise_scale

    def test_different_seeds_different_personality(self):
        p1 = generate_personality("V1", seed=1, health=0.8)
        p2 = generate_personality("V2", seed=2, health=0.8)
        biases_same = all(
            p1.sensors[n].bias == p2.sensors[n].bias
            for n in SENSOR_NAMES
        )
        assert not biases_same, "Different seeds produced identical personalities"

    def test_get_returns_neutral_for_unknown_sensor(self, healthy_personality):
        p = healthy_personality.get("nonexistent_sensor_xyz")
        assert p.bias == 0.0
        assert p.noise_scale == 1.0

    def test_bias_for_helper(self, healthy_personality):
        name = "rpm"
        assert healthy_personality.bias_for(name) == healthy_personality.sensors[name].bias

    def test_noise_scale_for_helper(self, healthy_personality):
        name = "coolant_temp"
        assert healthy_personality.noise_scale_for(name) == healthy_personality.sensors[name].noise_scale

    def test_summary_contains_all_sensors(self, healthy_personality):
        summary = healthy_personality.summary()
        for name in SENSOR_NAMES:
            assert name in summary, f"Missing {name} in personality summary"

    def test_personality_vehicle_id_stored(self):
        p = generate_personality("MY-VEHICLE", seed=1, health=0.9)
        assert p.vehicle_id == "MY-VEHICLE"
