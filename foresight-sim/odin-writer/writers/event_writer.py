"""
writers/event_writer.py
Writer for DTCEvent → sim_failure_events table.
Writer for FailureLabel → sim_day_labels table.

writers/vehicle_writer.py (also in this file)
Writer for VehicleProfile → sim_vehicles table.
"""

from __future__ import annotations
import logging
from typing import List, Optional

import psycopg2.extras

from core.connection import get_conn, with_retry
from core.config import WriterConfig

log = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# VEHICLE WRITER
# ─────────────────────────────────────────────────────────────────────────────

VEHICLE_UPSERT = """
INSERT INTO sim_vehicles
    (vehicle_id, make_model, year, mileage_km, driving_profile,
     base_health, archetype, seed, is_demo)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (vehicle_id) DO UPDATE SET
    mileage_km      = EXCLUDED.mileage_km,
    base_health     = EXCLUDED.base_health,
    archetype       = EXCLUDED.archetype,
    is_demo         = EXCLUDED.is_demo;
"""


class VehicleWriter:

    @with_retry(max_retries=3)
    def write(self, profile, archetype: str = "unknown") -> None:
        """Upsert a VehicleProfile into sim_vehicles."""
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(VEHICLE_UPSERT, (
                    profile.vehicle_id,
                    profile.make_model,
                    profile.year,
                    profile.mileage_km,
                    profile.driving_profile,
                    profile.base_health,
                    archetype,
                    profile.seed,
                    profile.is_demo,
                ))
        log.debug(f"VehicleWriter: upserted {profile.vehicle_id}")

    @with_retry(max_retries=3)
    def write_many(self, profiles_with_archetypes: list) -> int:
        """
        Bulk upsert multiple VehicleProfiles.
        profiles_with_archetypes: list of (VehicleProfile, archetype_str) tuples
        """
        if not profiles_with_archetypes:
            return 0
        records = [
            (p.vehicle_id, p.make_model, p.year, p.mileage_km,
             p.driving_profile, p.base_health, arch, p.seed, p.is_demo)
            for p, arch in profiles_with_archetypes
        ]
        with get_conn() as conn:
            with conn.cursor() as cur:
                psycopg2.extras.execute_values(
                    cur, VEHICLE_UPSERT, records,
                    template="(%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                )
        log.info(f"VehicleWriter: upserted {len(records)} vehicles")
        return len(records)


# ─────────────────────────────────────────────────────────────────────────────
# FAILURE EVENT WRITER
# ─────────────────────────────────────────────────────────────────────────────

FAILURE_EVENT_INSERT = """
INSERT INTO sim_failure_events
    (vehicle_id, failure_mode, dtc_code, dtc_description,
     failure_start_day, dtc_fire_day, dtc_fired, total_sim_days,
     degradation_factor_at_fire,
     repair_cost_oem_min, repair_cost_oem_max,
     repair_cost_am_min, repair_cost_am_max,
     curve_shape)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT DO NOTHING;
"""


class EventWriter:

    @with_retry(max_retries=3)
    def write_dtc_event(
        self,
        vehicle_id: str,
        injector_summary: dict,
        total_sim_days: int,
    ) -> None:
        """
        Write a DTCEvent summary from FailureInjector.summary() to sim_failure_events.
        injector_summary is the dict returned by FailureInjector.summary().
        """
        s = injector_summary
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(FAILURE_EVENT_INSERT, (
                    vehicle_id,
                    s.get("failure_mode"),
                    s.get("dtc_code"),
                    s.get("dtc_description", ""),
                    s.get("failure_start_day"),
                    s.get("dtc_fire_day"),
                    s.get("dtc_fired", False),
                    total_sim_days,
                    s.get("degradation_factor_at_fire"),
                    s["repair_cost_oem"][0]  if "repair_cost_oem" in s else None,
                    s["repair_cost_oem"][1]  if "repair_cost_oem" in s else None,
                    s["repair_cost_aftermarket"][0] if "repair_cost_aftermarket" in s else None,
                    s["repair_cost_aftermarket"][1] if "repair_cost_aftermarket" in s else None,
                    s.get("curve_shape", "sigmoid"),
                ))
        log.debug(f"EventWriter: wrote failure event for {vehicle_id}")


# ─────────────────────────────────────────────────────────────────────────────
# DAY LABEL WRITER
# ─────────────────────────────────────────────────────────────────────────────

LABEL_UPSERT = """
INSERT INTO sim_day_labels
    (vehicle_id, day, failure_mode, dtc_code,
     degradation_factor, days_to_dtc, label_binary, label_severity)
VALUES %s
ON CONFLICT (vehicle_id, day) DO UPDATE SET
    degradation_factor = GREATEST(sim_day_labels.degradation_factor, EXCLUDED.degradation_factor),
    days_to_dtc        = EXCLUDED.days_to_dtc,
    label_binary       = EXCLUDED.label_binary,
    label_severity     = EXCLUDED.label_severity;
"""

LABEL_TEMPLATE = "(%s, %s, %s, %s, %s, %s, %s, %s)"


class LabelWriter:

    def __init__(self, config: WriterConfig = None):
        self.config = config or WriterConfig.default()
        self._total_written = 0

    @with_retry(max_retries=3)
    def write_batch(self, labels: list) -> int:
        """
        Upsert a list of FailureLabel objects to sim_day_labels.
        On conflict (same vehicle_id + day), keeps the highest degradation_factor
        — this handles multi-failure vehicles correctly.
        """
        if not labels:
            return 0

        records = [
            (
                l.vehicle_id,
                l.day,
                l.failure_mode,
                l.dtc_code,
                l.degradation_factor,
                l.days_to_dtc,
                l.label_binary,
                l.label_severity,
            )
            for l in labels
        ]

        with get_conn() as conn:
            with conn.cursor() as cur:
                psycopg2.extras.execute_values(
                    cur, LABEL_UPSERT, records,
                    template=LABEL_TEMPLATE,
                    page_size=self.config.batch_size,
                )

        self._total_written += len(records)
        log.debug(f"LabelWriter: wrote {len(records)} labels")
        return len(records)

    @property
    def total_written(self) -> int:
        return self._total_written
