"""
tests/test_writers.py
Unit and integration tests for the PostgreSQL writer layer.

Unit tests mock the DB — no live connection required.
Integration tests (marked @pytest.mark.integration) require DATABASE_URL.

Run unit tests only:
    pytest tests/test_writers.py -v -m "not integration"

Run all tests (requires live DB):
    pytest tests/test_writers.py -v
"""

import pytest
from unittest.mock import MagicMock, patch, call
from datetime import datetime

# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def mock_readings():
    """Generate a small batch of fake TelemetryReading-like objects."""
    class FakeReading:
        def __init__(self, i):
            self.vehicle_id = "TEST-001"
            self.timestamp = datetime(2024, 1, 1, 7, 0, i % 60)
            self.day = i // 86400
            self.tick = i % 86400
            self.sensor_name = "rpm"
            self.value = 1200.0 + i
            self.unit = "rpm"
            self.is_healthy = True
            self.degradation_factor = 0.0
            self.source = "sim"
    return [FakeReading(i) for i in range(100)]


@pytest.fixture
def mock_labels():
    from core.event import FailureLabel
    return [
        FailureLabel(
            vehicle_id="TEST-001",
            day=i,
            failure_mode="o2_sensor",
            dtc_code="P0130",
            degradation_factor=0.0 + i * 0.02,
            days_to_dtc=30 - i if i < 30 else None,
        )
        for i in range(5)
    ]


@pytest.fixture
def mock_profile():
    class FakeProfile:
        vehicle_id = "TEST-001"
        make_model = "Toyota Camry"
        year = 2020
        mileage_km = 50000
        driving_profile = "mixed"
        base_health = 0.9
        seed = 42
        is_demo = False
    return FakeProfile()


# ── WriterConfig tests ────────────────────────────────────────────────────────

def test_writer_config_defaults():
    from core.config import WriterConfig
    config = WriterConfig.default()
    assert config.batch_size == 5000
    assert config.max_retries == 3
    assert config.pool_min == 2
    assert config.pool_max == 10


def test_writer_config_fast():
    from core.config import WriterConfig
    config = WriterConfig.fast()
    assert config.batch_size > 5000


def test_writer_config_from_env(monkeypatch):
    from core.config import WriterConfig
    monkeypatch.setenv("WRITER_BATCH_SIZE", "8000")
    monkeypatch.setenv("WRITER_MAX_RETRIES", "5")
    config = WriterConfig.from_env()
    assert config.batch_size == 8000
    assert config.max_retries == 5


# ── Schema tests ──────────────────────────────────────────────────────────────

def test_schema_migration_steps_complete():
    from core.schema import MIGRATION_STEPS, TABLE_NAMES
    step_names = [name for name, _ in MIGRATION_STEPS]
    for table in TABLE_NAMES:
        assert any(table in name for name in step_names), \
            f"No migration step for table: {table}"


def test_schema_clear_queries_only_sim():
    from core.schema import CLEAR_QUERIES
    for sql in CLEAR_QUERIES:
        # All clear queries must either target sim-specific tables
        # or include a WHERE source LIKE 'sim%' guard
        is_sim_table = any(t in sql for t in ["sim_vehicles", "sim_failure_events", "sim_day_labels"])
        is_guarded = "source LIKE 'sim%'" in sql
        assert is_sim_table or is_guarded, \
            f"Clear query lacks sim guard: {sql}"


def test_schema_has_all_indexes():
    from core.schema import MIGRATION_STEPS
    index_steps = [(n, s) for n, s in MIGRATION_STEPS if "INDEX" in s.upper()]
    assert len(index_steps) >= 5, f"Expected >= 5 indexes, got {len(index_steps)}"


# ── ReadingWriter unit tests ──────────────────────────────────────────────────

def test_reading_writer_empty_batch():
    from writers.reading_writer import ReadingWriter
    writer = ReadingWriter()
    with patch("writers.reading_writer.get_conn") as mock_conn:
        result = writer.write_batch([])
    assert result == 0
    mock_conn.assert_not_called()


def test_reading_writer_tracks_total(mock_readings):
    from writers.reading_writer import ReadingWriter
    writer = ReadingWriter()
    with patch("writers.reading_writer.get_conn") as mock_ctx:
        mock_conn = MagicMock()
        mock_ctx.return_value.__enter__ = MagicMock(return_value=mock_conn)
        mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
        mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=MagicMock())
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

        with patch("writers.reading_writer.psycopg2.extras.execute_values"):
            writer.write_batch(mock_readings)
            writer.write_batch(mock_readings)

    assert writer.total_written == len(mock_readings) * 2


def test_reading_writer_reset_counter(mock_readings):
    from writers.reading_writer import ReadingWriter
    writer = ReadingWriter()
    with patch("writers.reading_writer.get_conn"), \
         patch("writers.reading_writer.psycopg2.extras.execute_values"):
        writer.write_batch(mock_readings)

    writer.reset_counter()
    assert writer.total_written == 0


# ── FailureLabel tests ────────────────────────────────────────────────────────

def test_failure_label_binary_threshold():
    from core.event import FailureLabel
    label_healthy = FailureLabel("V1", 0, None, None, 0.40, None)
    label_positive = FailureLabel("V1", 1, "o2_sensor", "P0130", 0.65, 20)
    assert label_healthy.label_binary == 0
    assert label_positive.label_binary == 1


def test_failure_label_severity_transitions():
    from core.event import FailureLabel
    cases = [
        (0.0,  "healthy"),
        (0.59, "healthy"),
        (0.60, "early"),
        (0.79, "early"),
        (0.80, "late"),
        (0.94, "late"),
        (0.95, "imminent"),
        (1.00, "imminent"),
    ]
    for factor, expected in cases:
        label = FailureLabel("V", 0, "o2_sensor", "P0130", factor, None)
        assert label.label_severity == expected, \
            f"factor={factor}: expected '{expected}', got '{label.label_severity}'"


def test_failure_label_healthy_constructor():
    from core.event import FailureLabel
    label = FailureLabel.healthy("V-001", 5)
    assert label.failure_mode is None
    assert label.degradation_factor == 0.0
    assert label.label_binary == 0
    assert label.label_severity == "healthy"


def test_failure_label_csv_row_length():
    from core.event import FailureLabel
    label = FailureLabel("V", 0, "o2_sensor", "P0130", 0.75, 10)
    row = label.to_csv_row()
    headers = FailureLabel.csv_headers()
    assert len(row) == len(headers), \
        f"CSV row length {len(row)} != header length {len(headers)}"


# ── DTCEvent tests ────────────────────────────────────────────────────────────

def test_dtc_event_to_dict():
    from core.event import DTCEvent
    event = DTCEvent(
        vehicle_id="TEST-001",
        failure_mode_name="o2_sensor",
        dtc_code="P0130",
        dtc_description="O2 Sensor Circuit",
        fire_day=25,
        fire_timestamp=datetime(2024, 2, 25, 14, 30),
        degradation_factor_at_fire=0.96,
    )
    d = event.to_dict()
    assert d["vehicle_id"] == "TEST-001"
    assert d["dtc_code"] == "P0130"
    assert d["fire_day"] == 25
    assert d["degradation_factor_at_fire"] >= 0.95


# ── VehicleJob tests ──────────────────────────────────────────────────────────

def test_make_random_jobs_count():
    from pipeline.runner import make_random_jobs
    jobs = make_random_jobs(n_vehicles=10, n_days=30, seed=42)
    assert len(jobs) == 10


def test_make_random_jobs_reproducible():
    from pipeline.runner import make_random_jobs
    jobs_a = make_random_jobs(n_vehicles=5, n_days=30, seed=99)
    jobs_b = make_random_jobs(n_vehicles=5, n_days=30, seed=99)
    for a, b in zip(jobs_a, jobs_b):
        assert a.vehicle_id == b.vehicle_id
        assert a.archetype == b.archetype
        assert a.failure_mode == b.failure_mode


def test_make_random_jobs_failure_rate():
    from pipeline.runner import make_random_jobs
    jobs = make_random_jobs(n_vehicles=100, n_days=30, failure_rate=0.0, seed=1)
    assert all(j.failure_mode is None for j in jobs), "failure_rate=0 should produce healthy vehicles"

    jobs = make_random_jobs(n_vehicles=100, n_days=30, failure_rate=1.0, seed=1)
    assert all(j.failure_mode is not None for j in jobs), "failure_rate=1.0 should inject all"


# ── Integration tests (require live DB) ───────────────────────────────────────

@pytest.mark.integration
def test_ping_live_db():
    from core.connection import ping, init_pool
    init_pool()
    assert ping(), "Database ping failed — check DATABASE_URL"


@pytest.mark.integration
def test_migrations_idempotent():
    """Running migrations twice should not raise errors."""
    from core.connection import get_conn, init_pool
    from core.schema import MIGRATION_STEPS
    init_pool()
    with get_conn() as conn:
        with conn.cursor() as cur:
            for name, sql in MIGRATION_STEPS:
                cur.execute(sql)  # First run
    with get_conn() as conn:
        with conn.cursor() as cur:
            for name, sql in MIGRATION_STEPS:
                cur.execute(sql)  # Second run — must not raise


@pytest.mark.integration
def test_full_pipeline_smoke():
    """End-to-end: write 1 vehicle, 1 day, 1 failure to live DB."""
    from core.connection import init_pool
    from core.config import WriterConfig
    from pipeline.runner import PipelineRunner, VehicleJob
    init_pool()
    runner = PipelineRunner(WriterConfig.default())
    job = VehicleJob(
        vehicle_id="PYTEST-SMOKE",
        archetype="sedan_low_mileage",
        seed=999,
        n_days=1,
        failure_mode="battery_alternator",
        failure_start_day=0,
    )
    result = runner.run(job)
    assert result.error is None, f"Pipeline error: {result.error}"
    assert result.readings_written > 0
    assert result.labels_written == 1
