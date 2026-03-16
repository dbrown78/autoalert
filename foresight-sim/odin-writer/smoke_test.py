"""
scripts/smoke_test.py
Quick end-to-end smoke test: 1 vehicle, N days, 1 failure.
Confirms the full pipeline works before running a large bootstrap.

Usage:
    python scripts/smoke_test.py --days 3 --failure o2_sensor
    python scripts/smoke_test.py --days 1 --healthy
"""

import sys, os, argparse, time
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from dotenv import load_dotenv
load_dotenv()

from core.connection import init_pool, ping
from core.config import WriterConfig
from pipeline.runner import PipelineRunner, VehicleJob
from curves.library import FAILURE_MODE_NAMES


def main():
    parser = argparse.ArgumentParser(description="ODIN Writer Smoke Test")
    parser.add_argument("--days",    type=int, default=3)
    parser.add_argument("--failure", type=str, default="o2_sensor")
    parser.add_argument("--healthy", action="store_true", help="Run healthy vehicle (no failure)")
    parser.add_argument("--seed",    type=int, default=42)
    args = parser.parse_args()

    print("\n── ODIN Writer Smoke Test ──\n")

    if not ping():
        print("✗ Database unreachable. Check DATABASE_URL in .env")
        sys.exit(1)
    print("✓ Database connection OK\n")

    if args.healthy:
        failure = None
    else:
        if args.failure not in FAILURE_MODE_NAMES:
            print(f"Unknown failure: {args.failure}")
            print(f"Available: {FAILURE_MODE_NAMES}")
            sys.exit(1)
        failure = args.failure

    init_pool()
    config = WriterConfig.default()
    runner = PipelineRunner(config)

    job = VehicleJob(
        vehicle_id="SMOKE-001",
        archetype="sedan_low_mileage",
        seed=args.seed,
        n_days=args.days,
        failure_mode=failure,
        failure_start_day=1 if failure else None,
    )

    print(f"Running: {job.vehicle_id} | {job.archetype} | "
          f"failure={failure or 'none'} | {args.days} day(s)\n")

    start = time.perf_counter()
    result = runner.run(job, verbose=True)
    elapsed = time.perf_counter() - start

    print(f"\n── Results ──")
    print(f"  Readings written: {result.readings_written:,}")
    print(f"  Labels written:   {result.labels_written:,}")
    print(f"  DTC fired:        {result.dtc_fired}")
    if result.dtc_fire_day is not None:
        print(f"  DTC fire day:     {result.dtc_fire_day}")
    print(f"  Elapsed:          {elapsed:.2f}s")
    print(f"  Throughput:       {result.rows_per_sec:,} rows/sec")

    target = 100_000
    status = "✓ PASS" if result.rows_per_sec >= target else "✗ BELOW TARGET"
    print(f"  Target:           {target:,} rows/sec  [{status}]")

    if result.error:
        print(f"\n✗ ERROR: {result.error}")
        sys.exit(1)
    else:
        print(f"\n✓ Smoke test passed.\n")


if __name__ == "__main__":
    main()
