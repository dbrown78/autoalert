"""
scripts/export_csv.py
Export simulated telemetry to CSV for inspection in Excel / pandas.

Usage:
    python scripts/export_csv.py --vehicle SIM-001 --archetype truck_work --days 1 --out ./output/day1.csv
    python scripts/export_csv.py --vehicles 5 --days 7 --random-archetypes --seed 42 --out ./output/fleet.csv
"""

import sys, os, argparse
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import csv
from pathlib import Path

from core.vehicle import make_vehicle_profile, ARCHETYPE_NAMES
from core.reading import TelemetryReading
from stream.generator import TelemetryGenerator
from stream.batch import make_random_jobs, BatchRunner
import numpy as np


def export_single(vehicle_id: str, archetype: str, n_days: int, seed: int, out_path: str):
    profile = make_vehicle_profile(vehicle_id, archetype, seed=seed)
    gen = TelemetryGenerator(profile)

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    total = 0
    with open(out, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(TelemetryReading.csv_headers())

        def on_day(day, readings):
            nonlocal total
            for r in readings:
                writer.writerow(r.to_csv_row())
            total += len(readings)
            print(f"  Day {day:3d} | {len(readings):>8,} readings written | total={total:>10,}")

        gen.run_days(n_days, on_day=on_day)

    print(f"\n✓ Exported {total:,} readings → {out}\n")


def export_fleet(n_vehicles: int, n_days: int, seed: int, out_path: str):
    jobs = make_random_jobs(n_vehicles, n_days, seed=seed)
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    total = 0
    f = open(out, "w", newline="")
    writer = csv.writer(f)
    writer.writerow(TelemetryReading.csv_headers())

    def on_batch(vehicle_id, day, readings):
        nonlocal total
        for r in readings:
            writer.writerow(r.to_csv_row())
        total += len(readings)

    def on_finish(summary):
        f.close()
        print(f"\n✓ Fleet export complete:")
        print(f"  Vehicles:       {summary['vehicles']}")
        print(f"  Total readings: {summary['total_readings']:,}")
        print(f"  Elapsed:        {summary['total_elapsed_sec']:.1f}s")
        print(f"  Output:         {out}\n")

    runner = BatchRunner(jobs, on_batch=on_batch, on_finish=on_finish, verbose=True)
    runner.run()


def main():
    parser = argparse.ArgumentParser(description="Export telemetry to CSV")
    parser.add_argument("--vehicle", type=str, default="SIM-001")
    parser.add_argument("--archetype", type=str, default="sedan_low_mileage")
    parser.add_argument("--vehicles", type=int, default=None, help="Fleet mode: N vehicles")
    parser.add_argument("--days", type=int, default=1)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--random-archetypes", action="store_true")
    parser.add_argument("--out", type=str, default="./output/export.csv")
    args = parser.parse_args()

    if args.vehicles:
        export_fleet(args.vehicles, args.days, args.seed, args.out)
    else:
        export_single(args.vehicle, args.archetype, args.days, args.seed, args.out)


if __name__ == "__main__":
    main()
