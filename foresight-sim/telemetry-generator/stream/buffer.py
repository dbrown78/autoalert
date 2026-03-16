"""
stream/buffer.py

In-memory circular buffer for streaming mode —
holds the last N readings per sensor per vehicle.
Used by Demo Mode to serve live sensor data to the app.
"""

from __future__ import annotations
from collections import deque
from typing import Dict, List, Optional, Tuple

from core.reading import TelemetryReading


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
