"""
scripts/benchmark.py
Throughput benchmark — how many rows/sec can the generator produce?
Target: >500,000 rows/sec on Mac Mini hardware.

Usage:
    python scripts/benchmark.py --vehicles 10 --days 1
    python scripts/benchmark.py --vehicles 1 --days 7 --profile highway
"""

import sys, os, argparse, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.vehicle import make_vehicle_profile, ARCHETYPE_NAMES
from stream.generator import TelemetryGenerator
from stream.batch import make_random_jobs, BatchRunner
import numpy as np


def benchmark_single(archetype: str, n_days: int, seed: int):
    profile = make_vehicle_profile("BENCH-001", archetype, seed=seed)
    gen = TelemetryGenerator(profile)

    print(f"\nBenchmark: single vehicle | {archetype} | {n_days} day(s)")
    print(f"{'─'*50}")

    start = time.perf_counter()
    total = 0

    def on_day(day, readings):
        nonlocal total
        total += len(readings)

    gen.run_days(n_days, on_day=on_day)
    elapsed = time.perf_counter() - start

    rows_per_sec = int(total / elapsed) if elapsed > 0 else 0
    print(f"  Readings:     {total:>12,}")
    print(f"  Elapsed:      {elapsed:>12.3f}s")
    print(f"  Throughput:   {rows_per_sec:>12,} rows/sec")

    target = 500_000
    status = "✓ PASS" if rows_per_sec >= target else "✗ BELOW TARGET"
    print(f"  Target:       {target:>12,} rows/sec  [{status}]")

    return rows_per_sec


def benchmark_fleet(n_vehicles: int, n_days: int, seed: int):
    jobs = make_random_jobs(n_vehicles, n_days, seed=seed)

    print(f"\nBenchmark: {n_vehicles} vehicles | {n_days} day(s) each")
    print(f"{'─'*50}")

    total_readings = 0
    start = time.perf_counter()

    def on_batch(vehicle_id, day, readings):
        nonlocal total_readings
        total_readings += len(readings)

    runner = BatchRunner(jobs, on_batch=on_batch, verbose=False)
    runner.run()

    elapsed = time.perf_counter() - start
    rows_per_sec = int(total_readings / elapsed) if elapsed > 0 else 0

    print(f"  Total readings: {total_readings:>10,}")
    print(f"  Elapsed:        {elapsed:>10.3f}s")
    print(f"  Throughput:     {rows_per_sec:>10,} rows/sec")

    target = 500_000
    status = "✓ PASS" if rows_per_sec >= target else "✗ BELOW TARGET"
    print(f"  Target:         {target:>10,} rows/sec  [{status}]\n")

    return rows_per_sec


def main():
    parser = argparse.ArgumentParser(description="Telemetry Generator Benchmark")
    parser.add_argument("--vehicles", type=int, default=1)
    parser.add_argument("--days", type=int, default=1)
    parser.add_argument("--archetype", type=str, default="mixed")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    print("\n" + "═" * 50)
    print("  ODIN Telemetry Generator — Performance Benchmark")
    print("═" * 50)

    if args.vehicles == 1:
        benchmark_single(args.archetype, args.days, args.seed)
    else:
        benchmark_fleet(args.vehicles, args.days, args.seed)


if __name__ == "__main__":
    main()
