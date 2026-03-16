"""
writers/reading_writer.py

Batch writer for TelemetryReading objects → sensor_readings table.

Uses psycopg2.extras.execute_values for bulk inserts.
Readings are chunked into batches of BATCH_SIZE before each DB call.

The writer is stateless — call write_batch() as many times as needed.
The pipeline calls it once per day per vehicle to stay memory-bounded.
"""

from __future__ import annotations
import logging
from typing import List

import psycopg2.extras

from core.connection import get_conn, with_retry
from core.config import WriterConfig

log = logging.getLogger(__name__)

INSERT_SQL = """
INSERT INTO sensor_readings
    (vehicle_id, timestamp, day, tick, sensor_name, value, unit,
     is_healthy, degradation_factor, source)
VALUES %s
ON CONFLICT DO NOTHING
"""

# Template matches column order above
ROW_TEMPLATE = "(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"


class ReadingWriter:

    def __init__(self, config: WriterConfig = None):
        self.config = config or WriterConfig.default()
        self._total_written = 0

    @property
    def total_written(self) -> int:
        return self._total_written

    @with_retry(max_retries=3)
    def write_batch(self, readings: list) -> int:
        """
        Write a list of TelemetryReading objects to sensor_readings.
        Returns the number of rows written.
        Chunks into batches of config.batch_size.
        """
        if not readings:
            return 0

        batch_size = self.config.batch_size
        total = 0

        with get_conn() as conn:
            with conn.cursor() as cur:
                for i in range(0, len(readings), batch_size):
                    chunk = readings[i:i + batch_size]
                    records = [
                        (
                            r.vehicle_id,
                            r.timestamp,
                            r.day,
                            r.tick,
                            r.sensor_name,
                            r.value,
                            r.unit,
                            r.is_healthy,
                            r.degradation_factor,
                            r.source,
                        )
                        for r in chunk
                    ]
                    psycopg2.extras.execute_values(
                        cur,
                        INSERT_SQL,
                        records,
                        template=ROW_TEMPLATE,
                        page_size=batch_size,
                    )
                    total += len(chunk)

        self._total_written += total
        log.debug(f"ReadingWriter: wrote {total:,} readings (total={self._total_written:,})")
        return total

    def reset_counter(self):
        self._total_written = 0
