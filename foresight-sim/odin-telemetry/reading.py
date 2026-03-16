"""
core/reading.py

TelemetryReading is the atomic output unit of the telemetry generator.
Every sensor firing at every tick produces exactly one TelemetryReading.

Fields map 1:1 to the sensor_readings PostgreSQL table.
The generator always sets is_healthy=True and degradation_factor=0.0.
The Injector layer overrides these when failure is active.
"""

from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Optional
import csv
import io


@dataclass
class TelemetryReading:
    # Identity
    vehicle_id: str
    timestamp: datetime
    day: int                          # Simulation day (0-indexed)
    tick: int                         # Simulation tick within day (0 = start of day)

    # Sensor data
    sensor_name: str
    value: float
    unit: str

    # Health metadata (generator always healthy; injector overrides)
    is_healthy: bool = True
    degradation_factor: float = 0.0   # 0.0 = perfect health, 1.0 = failure

    # Provenance
    source: str = "sim"               # 'sim' | 'sim_dtc_PXXXX' | 'real'

    def to_dict(self) -> dict:
        d = asdict(self)
        d["timestamp"] = self.timestamp.isoformat()
        return d

    def to_csv_row(self) -> list:
        return [
            self.vehicle_id,
            self.timestamp.isoformat(),
            self.day,
            self.tick,
            self.sensor_name,
            self.value,
            self.unit,
            self.is_healthy,
            self.degradation_factor,
            self.source,
        ]

    @classmethod
    def csv_headers(cls) -> list[str]:
        return [
            "vehicle_id", "timestamp", "day", "tick",
            "sensor_name", "value", "unit",
            "is_healthy", "degradation_factor", "source",
        ]

    def __repr__(self) -> str:
        health = "✓" if self.is_healthy else f"⚠ df={self.degradation_factor:.2f}"
        return (
            f"[{self.timestamp.strftime('%H:%M:%S')}] "
            f"{self.vehicle_id} | {self.sensor_name:<25} "
            f"{self.value:>10.4f} {self.unit:<6} {health}"
        )


def readings_to_csv(readings: list[TelemetryReading], path: str):
    """Write a list of readings to a CSV file."""
    with open(path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(TelemetryReading.csv_headers())
        for r in readings:
            writer.writerow(r.to_csv_row())


def readings_to_csv_string(readings: list[TelemetryReading]) -> str:
    """Return readings as a CSV string (for testing / streaming)."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(TelemetryReading.csv_headers())
    for r in readings:
        writer.writerow(r.to_csv_row())
    return buf.getvalue()
