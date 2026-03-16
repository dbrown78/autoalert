"""
engine/scheduler.py

MultiFailureScheduler orchestrates multiple concurrent failures on one vehicle.
Real high-mileage vehicles often have several things failing at once.

When two failures affect the same sensor, the scheduler blends their effects:
  blended_value = weighted average of both effect outputs
  weight = each failure's degradation_factor (more degraded = more influence)

engine/labeler.py (also in this file)

FailureLabeler manages day-level label generation for a fleet of vehicles,
building the final training dataset with correct label distributions.
"""

from __future__ import annotations
from typing import Dict, List, Optional, Tuple

import numpy as np

from core.config import InjectionConfig
from core.event import DTCEvent, FailureLabel
from core.reading import TelemetryReading
from stream.generator import TelemetryGenerator
from engine.injector import FailureInjector
from curves.base import get_curve
from curves.library import get_failure_mode
from core.specs import sensors_due_at_tick, get_sensor
from profiles.driving import get_profile_range, profile_for_time


class MultiFailureScheduler:
    """
    Applies multiple failure injections to a single TelemetryGenerator.
    
    Usage:
        gen = TelemetryGenerator(profile)
        scheduler = MultiFailureScheduler(gen, [
            InjectionConfig.from_failure_mode("o2_sensor", failure_start_day=5),
            InjectionConfig.from_failure_mode("spark_plugs", failure_start_day=20),
        ])
        labels, dtc_events = scheduler.run_days(60)
    """

    def __init__(self, generator: TelemetryGenerator, configs: List[InjectionConfig]):
        self.gen = generator
        self.configs = configs

        # Build one curve and effect map per config
        self._injectors_data = []
        for i, config in enumerate(configs):
            mode = get_failure_mode(config.failure_mode_name)
            curve = get_curve(config.curve_shape)
            rng = np.random.default_rng(
                generator.profile.seed ^ (config.seed_offset + i * 0xDEAD + 0xCAFEBABE)
            )
            effects = {e.sensor_name: e.effect_fn for e in mode.affected_sensors}
            self._injectors_data.append({
                "config": config,
                "mode": mode,
                "curve": curve,
                "rng": rng,
                "effects": effects,
                "dtc_fired": False,
                "dtc_event": None,
            })

    def _compute_overrides(self, day: int, due_sensors: list) -> Dict[str, float]:
        """
        Compute blended override values for all due sensors across all active failures.
        When multiple failures affect the same sensor, blend by degradation_factor weight.
        """
        # Collect all effects: sensor_name → list of (degraded_value, factor)
        sensor_effects: Dict[str, List[Tuple[float, float]]] = {}

        for inj in self._injectors_data:
            config = inj["config"]
            factor = inj["curve"].factor(day, config.failure_start_day, config.progression_days)

            if factor <= 0.0:
                continue

            for sensor_name in due_sensors:
                if sensor_name not in inj["effects"]:
                    continue

                spec = get_sensor(sensor_name)
                profile_key = profile_for_time(
                    self.gen.current_time.hour,
                    self.gen.current_time.minute,
                    self.gen.profile.driving_profile,
                    self.gen._tick_of_day,
                )
                lo, hi = get_profile_range(profile_key, sensor_name, spec.healthy_range)
                healthy_approx = (lo + hi) / 2.0

                effect_fn = inj["effects"][sensor_name]
                degraded = effect_fn(healthy_approx, factor, inj["rng"])
                degraded = spec.clip(degraded)

                if sensor_name not in sensor_effects:
                    sensor_effects[sensor_name] = []
                sensor_effects[sensor_name].append((degraded, factor))

        # Blend: weighted average by factor
        overrides = {}
        for sensor_name, effect_list in sensor_effects.items():
            if len(effect_list) == 1:
                overrides[sensor_name] = effect_list[0][0]
            else:
                total_weight = sum(f for _, f in effect_list)
                blended = sum(v * f for v, f in effect_list) / total_weight
                overrides[sensor_name] = blended

        return overrides

    def tick(self) -> Tuple[List[TelemetryReading], List[FailureLabel]]:
        day = self.gen.day
        due_sensors = sensors_due_at_tick(self.gen.global_tick)

        overrides = self._compute_overrides(day, due_sensors)
        readings = self.gen.tick(overrides=overrides if overrides else None)

        # Tag readings
        labels = []
        for inj in self._injectors_data:
            config = inj["config"]
            factor = inj["curve"].factor(day, config.failure_start_day, config.progression_days)

            for r in readings:
                r.degradation_factor = max(r.degradation_factor, round(factor, 5))
                if r.sensor_name in inj["effects"] and factor >= 0.60:
                    r.is_healthy = False

            # DTC check
            if factor >= config.dtc_threshold and not inj["dtc_fired"]:
                inj["dtc_fired"] = True
                inj["dtc_event"] = DTCEvent(
                    vehicle_id=self.gen.profile.vehicle_id,
                    failure_mode_name=inj["mode"].name,
                    dtc_code=inj["mode"].dtc_code,
                    dtc_description=inj["mode"].dtc_description,
                    fire_day=day,
                    fire_timestamp=self.gen.current_time,
                    degradation_factor_at_fire=factor,
                )

            labels.append(FailureLabel(
                vehicle_id=self.gen.profile.vehicle_id,
                day=day,
                failure_mode=inj["mode"].name,
                dtc_code=inj["mode"].dtc_code,
                degradation_factor=factor,
                days_to_dtc=None,  # Simplified for multi-failure
            ))

        return readings, labels

    def run_days(
        self,
        n_days: int,
        on_day=None,
    ) -> Tuple[List[List[FailureLabel]], List[Optional[DTCEvent]]]:
        from stream.generator import SECONDS_PER_DAY
        all_day_labels = []

        for day_index in range(n_days):
            day_readings = []
            day_labels = None

            for _ in range(SECONDS_PER_DAY):
                readings, labels = self.tick()
                day_readings.extend(readings)
                day_labels = labels

            all_day_labels.append(day_labels)
            if on_day:
                on_day(day_index, day_readings, day_labels)

        dtc_events = [inj["dtc_event"] for inj in self._injectors_data]
        return all_day_labels, dtc_events


# ─────────────────────────────────────────────────────────────────────────────
# FAILURE LABELER — fleet-level training dataset builder
# ─────────────────────────────────────────────────────────────────────────────

class FailureLabeler:
    """
    Builds a labeled training dataset for Foresight ML.
    Manages a fleet of vehicles, some healthy, some with injected failures.
    
    Output: list of FailureLabel objects, one per (vehicle, day).
    These get joined with sensor readings in the export pipeline.
    """

    def __init__(self):
        self._labels: Dict[str, Dict[int, FailureLabel]] = {}
        # vehicle_id → {day → FailureLabel}

    def record(self, label: FailureLabel):
        if label.vehicle_id not in self._labels:
            self._labels[label.vehicle_id] = {}
        # Keep the most severe label for the day if multiple failures
        existing = self._labels[label.vehicle_id].get(label.day)
        if existing is None or label.degradation_factor > existing.degradation_factor:
            self._labels[label.vehicle_id][label.day] = label

    def record_healthy_day(self, vehicle_id: str, day: int):
        if vehicle_id not in self._labels:
            self._labels[vehicle_id] = {}
        if day not in self._labels[vehicle_id]:
            self._labels[vehicle_id][day] = FailureLabel.healthy(vehicle_id, day)

    def get(self, vehicle_id: str, day: int) -> Optional[FailureLabel]:
        return self._labels.get(vehicle_id, {}).get(day)

    def all_labels(self) -> List[FailureLabel]:
        result = []
        for vehicle_labels in self._labels.values():
            result.extend(vehicle_labels.values())
        return sorted(result, key=lambda l: (l.vehicle_id, l.day))

    def distribution_summary(self) -> dict:
        labels = self.all_labels()
        total = len(labels)
        positive = sum(1 for l in labels if l.label_binary == 1)
        by_severity = {}
        for l in labels:
            by_severity[l.label_severity] = by_severity.get(l.label_severity, 0) + 1
        return {
            "total_days": total,
            "positive": positive,
            "negative": total - positive,
            "positive_rate": round(positive / total, 3) if total else 0,
            "by_severity": by_severity,
        }
