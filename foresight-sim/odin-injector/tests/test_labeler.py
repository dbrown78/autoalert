"""
tests/test_labeler.py
Unit tests for engine/scheduler.py FailureLabeler and core/event.py FailureLabel.
"""

import pytest
from core.event import FailureLabel, PHASE_HEALTHY_MAX, factor_to_severity
from engine.scheduler import FailureLabeler


# ── FailureLabel unit tests ────────────────────────────────────────────────────

def test_healthy_label_has_zero_factor():
    label = FailureLabel.healthy("V-001", day=0)
    assert label.degradation_factor == 0.0
    assert label.failure_mode is None
    assert label.dtc_code is None
    assert label.days_to_dtc is None


def test_healthy_label_binary_is_zero():
    label = FailureLabel.healthy("V-001", day=0)
    assert label.label_binary == 0


def test_label_binary_one_at_threshold():
    """label_binary must be 1 when factor equals PHASE_HEALTHY_MAX exactly."""
    label = FailureLabel(
        vehicle_id="V-001", day=5,
        failure_mode="o2_sensor", dtc_code="P0130",
        degradation_factor=PHASE_HEALTHY_MAX,
        days_to_dtc=10,
    )
    assert label.label_binary == 1


def test_label_binary_zero_below_threshold():
    label = FailureLabel(
        vehicle_id="V-001", day=3,
        failure_mode="o2_sensor", dtc_code="P0130",
        degradation_factor=PHASE_HEALTHY_MAX - 0.01,
        days_to_dtc=20,
    )
    assert label.label_binary == 0


def test_label_severity_phases():
    """Severity must transition at the documented phase boundaries."""
    cases = [
        (0.0,  "healthy"),
        (0.30, "healthy"),
        (0.59, "healthy"),
        (0.60, "early"),
        (0.70, "early"),
        (0.79, "early"),
        (0.80, "late"),
        (0.90, "late"),
        (0.94, "late"),
        (0.95, "imminent"),
        (1.00, "imminent"),
    ]
    for factor, expected in cases:
        assert factor_to_severity(factor) == expected, (
            f"factor={factor} → expected '{expected}', got '{factor_to_severity(factor)}'"
        )


def test_label_severity_property_matches_factor_to_severity():
    for factor in [0.0, 0.50, 0.65, 0.82, 0.97]:
        label = FailureLabel(
            vehicle_id="V-X", day=0,
            failure_mode="spark_plugs", dtc_code="P0300",
            degradation_factor=factor,
            days_to_dtc=None,
        )
        assert label.label_severity == factor_to_severity(factor)


def test_to_dict_has_all_required_columns():
    label = FailureLabel(
        vehicle_id="V-001", day=10,
        failure_mode="maf_sensor", dtc_code="P0101",
        degradation_factor=0.75,
        days_to_dtc=8,
    )
    d = label.to_dict()
    required = ["vehicle_id", "day", "failure_mode", "dtc_code",
                "degradation_factor", "days_to_dtc", "label_binary", "label_severity"]
    for col in required:
        assert col in d, f"to_dict() missing column: {col}"


def test_to_csv_row_matches_csv_headers():
    label = FailureLabel(
        vehicle_id="V-001", day=5,
        failure_mode="egr_valve", dtc_code="P0401",
        degradation_factor=0.85,
        days_to_dtc=3,
    )
    headers = FailureLabel.csv_headers()
    row = label.to_csv_row()
    assert len(row) == len(headers), (
        f"csv_headers has {len(headers)} columns but to_csv_row has {len(row)} values"
    )


def test_same_seed_healthy_label_is_consistent():
    """healthy() is a pure constructor — same args = same result."""
    a = FailureLabel.healthy("V-999", day=7)
    b = FailureLabel.healthy("V-999", day=7)
    assert a.to_dict() == b.to_dict()


# ── FailureLabeler unit tests ─────────────────────────────────────────────────

@pytest.fixture
def labeler():
    return FailureLabeler()


def test_record_and_retrieve(labeler):
    label = FailureLabel(
        vehicle_id="V-001", day=3,
        failure_mode="o2_sensor", dtc_code="P0130",
        degradation_factor=0.70,
        days_to_dtc=15,
    )
    labeler.record(label)
    retrieved = labeler.get("V-001", 3)
    assert retrieved is not None
    assert retrieved.degradation_factor == 0.70


def test_record_healthy_day(labeler):
    labeler.record_healthy_day("V-002", day=0)
    label = labeler.get("V-002", 0)
    assert label is not None
    assert label.label_binary == 0
    assert label.failure_mode is None


def test_most_severe_label_wins(labeler):
    """When two labels recorded for same (vehicle, day), higher factor wins."""
    low = FailureLabel(
        vehicle_id="V-003", day=5,
        failure_mode="spark_plugs", dtc_code="P0300",
        degradation_factor=0.62,
        days_to_dtc=20,
    )
    high = FailureLabel(
        vehicle_id="V-003", day=5,
        failure_mode="maf_sensor", dtc_code="P0101",
        degradation_factor=0.88,
        days_to_dtc=5,
    )
    labeler.record(low)
    labeler.record(high)
    result = labeler.get("V-003", 5)
    assert result.degradation_factor == 0.88


def test_healthy_day_not_overwritten_by_later_healthy_call(labeler):
    labeler.record_healthy_day("V-004", day=0)
    labeler.record_healthy_day("V-004", day=0)  # Second call — should not error
    label = labeler.get("V-004", 0)
    assert label is not None


def test_all_labels_sorted(labeler):
    """all_labels() must be sorted by (vehicle_id, day)."""
    labeler.record_healthy_day("V-B", day=3)
    labeler.record_healthy_day("V-A", day=5)
    labeler.record_healthy_day("V-A", day=1)
    labeler.record_healthy_day("V-B", day=0)

    labels = labeler.all_labels()
    keys = [(l.vehicle_id, l.day) for l in labels]
    assert keys == sorted(keys), "all_labels() not sorted by (vehicle_id, day)"


def test_distribution_summary_counts(labeler):
    # 3 healthy days
    for day in range(3):
        labeler.record_healthy_day("HEALTHY-V", day=day)

    # 2 pre-failure days (factor >= 0.6)
    for day in range(2):
        labeler.record(FailureLabel(
            vehicle_id="FAIL-V", day=day,
            failure_mode="coolant_temp_sensor", dtc_code="P0116",
            degradation_factor=0.75,
            days_to_dtc=5,
        ))

    dist = labeler.distribution_summary()
    assert dist["total_days"] == 5
    assert dist["negative"] == 3
    assert dist["positive"] == 2
    assert dist["positive_rate"] == 0.4


def test_distribution_summary_by_severity(labeler):
    labeler.record(FailureLabel(
        vehicle_id="V-X", day=0,
        failure_mode="battery_alternator", dtc_code="P0562",
        degradation_factor=0.97,
        days_to_dtc=None,
    ))
    labeler.record_healthy_day("V-Y", day=0)

    dist = labeler.distribution_summary()
    assert "imminent" in dist["by_severity"]
    assert "healthy" in dist["by_severity"]
    assert dist["by_severity"]["imminent"] == 1
    assert dist["by_severity"]["healthy"] == 1


def test_get_unknown_vehicle_returns_none(labeler):
    assert labeler.get("NONEXISTENT", day=0) is None


def test_get_unknown_day_returns_none(labeler):
    labeler.record_healthy_day("V-001", day=0)
    assert labeler.get("V-001", day=99) is None
