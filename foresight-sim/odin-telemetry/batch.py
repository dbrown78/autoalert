"""
stream/batch.py + stream/buffer.py combined

BatchRunner: efficiently runs multiple vehicles in sequence, 
             streaming output to a callback (DB write, CSV, etc.)

RingBuffer: in-memory circular buffer for streaming mode —
            holds the last N readings per sensor per vehicle.
            Used by Demo Mode to serve live sensor data to the app.
"""

from __future__ import annotations
from collections import deque
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Tuple
import time

import numpy as np

from core.vehicle import VehicleProfile, make_vehicle_profile, ARCHETYPE_NAMES
from core.reading import TelemetryReading
from stream.generator import TelemetryGenerator


# ─────────────────────────────────────────────────────────────────────────────
# BATCH RUNNER
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class BatchJob:
    vehicle_id: str
    archetype: str
    seed: int
    n_days: int
    overrides: Optional[dict] = None   # Passed to VehicleProfile factory


class BatchRunner:
    """
    Runs a list of BatchJobs in sequence, streaming output via callback.
    
    on_batch:  called after each vehicle's day completes.
               signature: (vehicle_id, day, readings) → None
    on_finish: called after all vehicles complete.
               signature: (summary: dict) → None
    """

    def __init__(
        self,
        jobs: List[BatchJob],
        on_batch: Optional[Callable[[str, int, List[TelemetryReading]], None]] = None,
        on_finish: Optional[Callable[[dict], None]] = None,
        verbose: bool = False,
    ):
        self.jobs = jobs
        self.on_batch = on_batch
        self.on_finish = on_finish
        self.verbose = verbose
        self._results: List[dict] = []

    def run(self) -> List[dict]:
        """Execute all jobs. Returns a list of per-vehicle result summaries."""
        self._results = []
        total_start = time.perf_counter()

        for job_idx, job in enumerate(self.jobs):
            job_start = time.perf_counter()
            profile = make_vehicle_profile(job.vehicle_id, job.archetype, seed=job.seed)
            gen = TelemetryGenerator(profile)
            total_readings = 0

            if self.verbose:
                print(
                    f"[{job_idx+1}/{len(self.jobs)}] {job.vehicle_id} | "
                    f"{job.archetype} | {job.n_days} days"
                )

            def _day_cb(day: int, readings: List[TelemetryReading]):
                nonlocal total_readings
                total_readings += len(readings)
                if self.on_batch:
                    self.on_batch(job.vehicle_id, day, readings)
                if self.verbose:
                    print(f"  Day {day:3d} | {len(readings):>8,} readings | total={total_readings:>10,}")

            gen.run_days(job.n_days, on_day=_day_cb)

            elapsed = time.perf_counter() - job_start
            result = {
                "vehicle_id": job.vehicle_id,
                "archetype": job.archetype,
                "days": job.n_days,
                "total_readings": total_readings,
                "elapsed_sec": round(elapsed, 2),
                "rows_per_sec": round(total_readings / elapsed) if elapsed > 0 else 0,
            }
            self._results.append(result)

            if self.verbose:
                print(f"  ✓ {total_readings:,} readings in {elapsed:.2f}s ({result['rows_per_sec']:,} rows/sec)\n")

        total_elapsed = time.perf_counter() - total_start
        summary = {
            "vehicles": len(self.jobs),
            "total_readings": sum(r["total_readings"] for r in self._results),
            "total_elapsed_sec": round(total_elapsed, 2),
            "results": self._results,
        }

        if self.on_finish:
            self.on_finish(summary)

        return self._results


def make_random_jobs(
    n_vehicles: int,
    n_days: int,
    seed: int = 42,
    id_prefix: str = "SIM",
) -> List[BatchJob]:
    """
    Create N BatchJobs with randomly assigned archetypes.
    Reproducible given same seed.
    """
    rng = np.random.default_rng(seed)
    jobs = []
    for i in range(n_vehicles):
        archetype = str(rng.choice(ARCHETYPE_NAMES))
        vehicle_id = f"{id_prefix}-{str(i+1).zfill(4)}"
        job_seed = int(rng.integers(0, 2**31))
        jobs.append(BatchJob(
            vehicle_id=vehicle_id,
            archetype=archetype,
            seed=job_seed,
            n_days=n_days,
        ))
    return jobs


# ─────────────────────────────────────────────────────────────────────────────
# RING BUFFER — for Demo Mode live streaming
# ─────────────────────────────────────────────────────────────────────────────

class SensorRingBuffer:
    """
    In-memory circular buffer for one sensor on one vehicle.
    Holds the last `capacity` readings.
    Used by Demo Mode to serve a sliding window of live sensor history.
    """

    def __init__(self, sensor_name: str, capacity: int = 300):
        self.sensor_name = sensor_name
        self.capacity = capacity
        self._buffer: deque[Tuple[str, float]] = deque(maxlen=capacity)
        # Tuple: (iso_timestamp, value)

    def push(self, reading: TelemetryReading):
        if reading.sensor_name != self.sensor_name:
            raise ValueError(f"Expected {self.sensor_name}, got {reading.sensor_name}")
        self._buffer.append((reading.timestamp.isoformat(), reading.value))

    def latest(self) -> Optional[Tuple[str, float]]:
        """Return the most recent (timestamp, value) or None if empty."""
        return self._buffer[-1] if self._buffer else None

    def window(self, n: int = 60) -> List[Tuple[str, float]]:
        """Return the last n readings as (timestamp, value) pairs."""
        items = list(self._buffer)
        return items[-n:]

    def average(self, n: int = 60) -> Optional[float]:
        """Rolling average of last n readings."""
        window = self.window(n)
        if not window:
            return None
        return sum(v for _, v in window) / len(window)

    def __len__(self) -> int:
        return len(self._buffer)


class VehicleRingBuffer:
    """
    Manages SensorRingBuffers for all sensors of one vehicle.
    This is what Demo Mode uses to serve live data to the React Native frontend.
    """

    def __init__(self, vehicle_id: str, capacity_per_sensor: int = 300):
        from core.specs import SENSOR_NAMES
        self.vehicle_id = vehicle_id
        self._buffers: Dict[str, SensorRingBuffer] = {
            name: SensorRingBuffer(name, capacity_per_sensor)
            for name in SENSOR_NAMES
        }

    def push(self, reading: TelemetryReading):
        if reading.sensor_name in self._buffers:
            self._buffers[reading.sensor_name].push(reading)

    def push_batch(self, readings: List[TelemetryReading]):
        for r in readings:
            self.push(r)

    def get(self, sensor_name: str) -> SensorRingBuffer:
        if sensor_name not in self._buffers:
            raise KeyError(f"No buffer for sensor '{sensor_name}'")
        return self._buffers[sensor_name]

    def latest_all(self) -> Dict[str, Optional[Tuple[str, float]]]:
        """Return the latest reading for every sensor."""
        return {name: buf.latest() for name, buf in self._buffers.items()}

    def to_dashboard_payload(self) -> dict:
        """
        Return a JSON-serializable payload for the AutoAlert frontend.
        Matches the shape the useSensorStream hook expects.
        """
        payload = {"vehicle_id": self.vehicle_id, "sensors": {}}
        for name, buf in self._buffers.items():
            latest = buf.latest()
            payload["sensors"][name] = {
                "latest_value": latest[1] if latest else None,
                "latest_timestamp": latest[0] if latest else None,
                "rolling_avg_60s": buf.average(60),
                "history": buf.window(60),
            }
        return payload
