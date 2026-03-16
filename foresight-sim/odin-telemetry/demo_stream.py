"""
scripts/demo_stream.py
Stream sensor readings to the terminal in real time.
Good for visually confirming the generator feels realistic.

Usage:
    python scripts/demo_stream.py --vehicle SIM-001 --archetype sedan_low_mileage --seconds 30
    python scripts/demo_stream.py --demo DEMO-001 --seconds 60
"""

import sys, os, time, argparse
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from core.vehicle import make_vehicle_profile, make_demo_vehicle
from core.specs import SENSOR_REGISTRY
from stream.generator import TelemetryGenerator


WATCH_SENSORS = [
    "rpm", "vehicle_speed", "coolant_temp", "throttle_position",
    "o2_voltage_b1s1", "maf", "short_fuel_trim", "battery_voltage",
]


def color_value(sensor_name: str, value: float) -> str:
    spec = SENSOR_REGISTRY[sensor_name]
    if spec.is_healthy_value(value):
        return f"\033[32m{value:>10.3f}\033[0m"   # Green
    elif spec.critical_min <= value <= spec.critical_max:
        return f"\033[33m{value:>10.3f}\033[0m"   # Yellow (outside healthy but not critical)
    else:
        return f"\033[31m{value:>10.3f}\033[0m"   # Red


def main():
    parser = argparse.ArgumentParser(description="ODIN Live Sensor Stream Demo")
    parser.add_argument("--vehicle", type=str, default="SIM-001")
    parser.add_argument("--archetype", type=str, default="sedan_low_mileage")
    parser.add_argument("--demo", type=str, default=None, help="Use a fixed demo vehicle (e.g. DEMO-001)")
    parser.add_argument("--seconds", type=int, default=30)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--realtime", action="store_true", help="Slow down to 1 tick/sec for visual effect")
    args = parser.parse_args()

    if args.demo:
        profile = make_demo_vehicle(args.demo)
    else:
        profile = make_vehicle_profile(args.vehicle, args.archetype, seed=args.seed)

    gen = TelemetryGenerator(profile)

    print(f"\n\033[1mODIN AutoAlert — Live Sensor Stream\033[0m")
    print(f"Vehicle:  {profile}")
    print(f"Duration: {args.seconds} seconds")
    print(f"─" * 70)
    print(f"{'Sensor':<25} {'Value':>10} {'Unit':<8} {'Time'}")
    print(f"─" * 70)

    latest: dict = {}
    tick = 0

    while tick < args.seconds:
        readings = gen.tick()
        for r in readings:
            if r.sensor_name in WATCH_SENSORS:
                latest[r.sensor_name] = r

        # Refresh display every tick
        print(f"\033[{len(WATCH_SENSORS)+1}A", end="")  # Move cursor up
        for sensor_name in WATCH_SENSORS:
            if sensor_name in latest:
                r = latest[sensor_name]
                colored = color_value(sensor_name, r.value)
                spec = SENSOR_REGISTRY[sensor_name]
                print(f"  {sensor_name:<23} {colored} {spec.unit:<8} {r.timestamp.strftime('%H:%M:%S')}")
            else:
                print(f"  {sensor_name:<23} {'—':>10}")

        print(f"  Tick: {tick:5d} | Day: {gen.day} | Profile: {gen._current_time.hour:02d}:00")

        tick += 1
        if args.realtime:
            time.sleep(1)

    print(f"\n✓ Stream complete. {tick} ticks generated.\n")


if __name__ == "__main__":
    main()
