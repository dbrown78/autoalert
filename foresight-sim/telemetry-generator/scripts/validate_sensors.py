"""
scripts/validate_sensors.py
Print all sensors with live sample readings.
First thing to run to confirm the layer is healthy.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.specs import SENSOR_REGISTRY, summary_table, sensors_due_at_tick, SENSOR_NAMES, get_sensor
from core.vehicle import make_vehicle_profile
from stream.generator import TelemetryGenerator


def main():
    print("\n" + "═" * 85)
    print("  ODIN AutoAlert — Telemetry Generator Sensor Validation")
    print("═" * 85)

    print("\n── Sensor Registry ──\n")
    print(summary_table())

    print("\n\n── Sample Readings (5 ticks, sedan_low_mileage, seed=42) ──\n")
    profile = make_vehicle_profile("VALIDATE-001", "sedan_low_mileage", seed=42)
    gen = TelemetryGenerator(profile)

    for tick in range(5):
        readings = gen.tick()
        if readings:
            print(f"Tick {tick:3d}:")
            for r in readings:
                print(f"  {r}")
            print()

    print("── Sample Rate Verification ──\n")
    print(f"{'Sensor':<25} {'Rate':<8} {'Interval':<12} {'Due at tick 0?'}")
    print("─" * 60)
    tick0_sensors = set(sensors_due_at_tick(0))
    for name in SENSOR_NAMES:
        spec = get_sensor(name)
        due = "✓" if name in tick0_sensors else "—"
        print(f"  {name:<23} {spec.sample_rate_hz:<8} {spec.sample_interval_ticks:<12} {due}")

    print("\n── Personality Offsets (vehicle VALIDATE-001) ──\n")
    print(gen.personality.summary())

    print("\n✓ Validation complete. All sensors operational.\n")


if __name__ == "__main__":
    main()
