"""
pipeline/runner.py

End-to-end pipeline: TelemetryGenerator → FailureInjector → PostgreSQL.

PipelineRunner orchestrates one vehicle at a time:
  1. Create VehicleProfile from archetype
  2. Upsert vehicle into sim_vehicles
  3. Create TelemetryGenerator
  4. Optionally wrap with FailureInjector
  5. Run N days, streaming readings to DB day-by-day
  6. Write FailureLabels to sim_day_labels
  7. Write DTCEvent to sim_failure_events

FleetRunner runs multiple PipelineRunners in sequence,
reporting throughput and progress.
"""

from __future__ import annotations
import time
import logging
from dataclasses import dataclass
from typing import List, Optional

import numpy as np

from core.config import WriterConfig
from core.connection import init_pool
from writers.reading_writer import ReadingWriter
from writers.event_writer import EventWriter, LabelWriter, VehicleWriter

# odin-telemetry imports
from core.vehicle import make_vehicle_profile, ARCHETYPE_NAMES
from stream.generator import TelemetryGenerator

# odin-injector imports
from core.config import InjectionConfig
from engine.injector import FailureInjector
from curves.library import FAILURE_MODE_NAMES, FAILURE_MODES

log = logging.getLogger(__name__)


@dataclass
class VehicleJob:
    vehicle_id: str
    archetype: str
    seed: int
    n_days: int
    failure_mode: Optional[str] = None      # None = healthy vehicle
    failure_start_day: Optional[int] = None
    progression_scale: float = 1.0
    curve_shape: str = "sigmoid"
    is_demo: bool = False


@dataclass
class VehicleResult:
    vehicle_id: str
    archetype: str
    failure_mode: Optional[str]
    n_days: int
    readings_written: int
    labels_written: int
    dtc_fired: bool
    dtc_fire_day: Optional[int]
    elapsed_sec: float
    rows_per_sec: int
    error: Optional[str] = None


class PipelineRunner:
    """
    Runs the full sim → write pipeline for a single vehicle.
    Streams day-by-day to stay memory-bounded.
    """

    def __init__(self, config: WriterConfig = None):
        self.config = config or WriterConfig.default()
        self._reading_writer = ReadingWriter(config)
        self._event_writer = EventWriter()
        self._label_writer = LabelWriter(config)
        self._vehicle_writer = VehicleWriter()

    def run(self, job: VehicleJob, verbose: bool = False) -> VehicleResult:
        start = time.perf_counter()
        total_readings = 0
        total_labels = 0
        dtc_fired = False
        dtc_fire_day = None
        error = None

        try:
            # 1. Build vehicle profile
            profile = make_vehicle_profile(
                job.vehicle_id,
                job.archetype,
                seed=job.seed,
            )
            # Override is_demo if needed
            if job.is_demo:
                object.__setattr__(profile, '_is_demo_override', True)

            # 2. Upsert vehicle record
            self._vehicle_writer.write(profile, archetype=job.archetype)

            # 3. Build generator
            gen = TelemetryGenerator(profile)

            # 4. Optionally wrap with injector
            injector = None
            if job.failure_mode:
                mode = FAILURE_MODES[job.failure_mode]
                failure_start = job.failure_start_day or max(2, job.n_days // 6)
                inj_config = InjectionConfig(
                    failure_mode_name=job.failure_mode,
                    failure_start_day=failure_start,
                    progression_days=max(1, int(
                        mode.typical_progression_days * job.progression_scale
                    )),
                    curve_shape=job.curve_shape,
                )
                injector = FailureInjector(gen, inj_config)

            # 5. Run N days, streaming to DB
            day_labels = []

            for day_idx in range(job.n_days):
                day_readings = []

                if injector:
                    label = injector.advance_day(
                        on_readings=lambda r: day_readings.extend(r)
                    )
                    day_labels.append(label)
                else:
                    # Healthy vehicle — generator only
                    from core.event import FailureLabel
                    day_readings = gen.run_day()
                    day_labels.append(FailureLabel.healthy(job.vehicle_id, day_idx))

                # Write readings immediately — discard after write
                n = self._reading_writer.write_batch(day_readings)
                total_readings += n
                day_readings.clear()

                if verbose and day_idx % 10 == 0:
                    factor = injector.current_factor if injector else 0.0
                    log.info(
                        f"  {job.vehicle_id} | Day {day_idx:3d}/{job.n_days} | "
                        f"readings={total_readings:,} | factor={factor:.3f}"
                    )

            # 6. Write labels
            if day_labels:
                total_labels = self._label_writer.write_batch(day_labels)

            # 7. Write failure event
            if injector:
                dtc_fired = injector.dtc_fired
                dtc_fire_day = injector.dtc_event.fire_day if injector.dtc_event else None
                self._event_writer.write_dtc_event(
                    vehicle_id=job.vehicle_id,
                    injector_summary=injector.summary(),
                    total_sim_days=job.n_days,
                )

        except Exception as e:
            error = str(e)
            log.error(f"PipelineRunner failed for {job.vehicle_id}: {e}")

        elapsed = time.perf_counter() - start
        rows_per_sec = int(total_readings / elapsed) if elapsed > 0 else 0

        return VehicleResult(
            vehicle_id=job.vehicle_id,
            archetype=job.archetype,
            failure_mode=job.failure_mode,
            n_days=job.n_days,
            readings_written=total_readings,
            labels_written=total_labels,
            dtc_fired=dtc_fired,
            dtc_fire_day=dtc_fire_day,
            elapsed_sec=round(elapsed, 2),
            rows_per_sec=rows_per_sec,
            error=error,
        )


class FleetRunner:
    """
    Runs PipelineRunner for a list of VehicleJobs in sequence.
    Reports throughput, progress, and a final summary.
    """

    def __init__(self, config: WriterConfig = None, verbose: bool = True):
        self.config = config or WriterConfig.default()
        self.verbose = verbose
        self._runner = PipelineRunner(config)
        init_pool(config.pool_min if config else 2, config.pool_max if config else 10)

    def run(self, jobs: List[VehicleJob]) -> List[VehicleResult]:
        results = []
        total_start = time.perf_counter()

        for i, job in enumerate(jobs):
            if self.verbose:
                failure_label = job.failure_mode or "healthy"
                print(
                    f"[{i+1:>3}/{len(jobs)}] {job.vehicle_id:<20} "
                    f"{job.archetype:<25} {failure_label}"
                )

            result = self._runner.run(job, verbose=self.verbose)
            results.append(result)

            if self.verbose:
                status = "✓" if not result.error else "✗"
                dtc = f"DTC day {result.dtc_fire_day}" if result.dtc_fired else "no DTC"
                print(
                    f"  {status} {result.readings_written:>10,} readings | "
                    f"{result.rows_per_sec:>8,} rows/sec | "
                    f"{result.elapsed_sec:.1f}s | {dtc}"
                )
                if result.error:
                    print(f"  ERROR: {result.error}")

        total_elapsed = time.perf_counter() - total_start
        total_readings = sum(r.readings_written for r in results)
        errors = [r for r in results if r.error]

        if self.verbose:
            print(f"\n{'═'*65}")
            print(f"  Fleet complete: {len(jobs)} vehicles | "
                  f"{total_readings:,} readings | "
                  f"{total_elapsed:.1f}s")
            if errors:
                print(f"  Errors: {len(errors)} vehicles failed")
            print(f"{'═'*65}\n")

        return results


def make_random_jobs(
    n_vehicles: int,
    n_days: int,
    failure_rate: float = 0.6,
    seed: int = 42,
    id_prefix: str = "SIM",
) -> List[VehicleJob]:
    """Generate N VehicleJobs with random archetypes and failure assignments."""
    rng = np.random.default_rng(seed)
    jobs = []

    for i in range(n_vehicles):
        vehicle_id = f"{id_prefix}-{str(i+1).zfill(4)}"
        archetype = str(rng.choice(ARCHETYPE_NAMES))
        vehicle_seed = int(rng.integers(0, 2**31))
        inject = rng.random() < failure_rate
        failure_mode = str(rng.choice(FAILURE_MODE_NAMES)) if inject else None
        failure_start = int(rng.integers(2, max(3, n_days // 4))) if inject else None

        jobs.append(VehicleJob(
            vehicle_id=vehicle_id,
            archetype=archetype,
            seed=vehicle_seed,
            n_days=n_days,
            failure_mode=failure_mode,
            failure_start_day=failure_start,
        ))

    return jobs
