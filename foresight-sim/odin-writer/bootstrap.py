"""
scripts/bootstrap.py
Full fleet bootstrap CLI — generates N vehicles and writes to PostgreSQL.

Usage:
    # 50 vehicles, 90 days, 60% failure rate
    python scripts/bootstrap.py --vehicles 50 --days 90 --failure-rate 0.6 --seed 42

    # Demo Mode only
    python scripts/bootstrap.py --demo

    # List available failure modes
    python scripts/bootstrap.py --list-failures
"""

import sys, os, argparse
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from dotenv import load_dotenv
load_dotenv()

import logging
from core.connection import init_pool, ping
from core.config import WriterConfig
from pipeline.runner import FleetRunner, make_random_jobs
from pipeline.demo import generate_demo_vehicles
from curves.library import FAILURE_MODES, failure_mode_summary

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)


def main():
    parser = argparse.ArgumentParser(description="ODIN Foresight Fleet Bootstrap")
    parser.add_argument("--vehicles",     type=int,   default=10)
    parser.add_argument("--days",         type=int,   default=60)
    parser.add_argument("--failure-rate", type=float, default=0.6)
    parser.add_argument("--seed",         type=int,   default=42)
    parser.add_argument("--demo",         action="store_true", help="Generate Demo Mode vehicles")
    parser.add_argument("--fast",         action="store_true", help="Use fast writer config (larger batches)")
    parser.add_argument("--list-failures",action="store_true")
    parser.add_argument("--verbose",      action="store_true", default=True)
    args = parser.parse_args()

    if args.list_failures:
        print("\n" + failure_mode_summary())
        return

    if not ping():
        print("✗ Database unreachable. Check DATABASE_URL in .env")
        sys.exit(1)

    config = WriterConfig.fast() if args.fast else WriterConfig.default()
    init_pool(config.pool_min, config.pool_max)

    if args.demo:
        generate_demo_vehicles(config=config, verbose=args.verbose)
        return

    print(f"\nBootstrap: {args.vehicles} vehicles × {args.days} days "
          f"| failure_rate={args.failure_rate:.0%} | seed={args.seed}\n")

    jobs = make_random_jobs(
        n_vehicles=args.vehicles,
        n_days=args.days,
        failure_rate=args.failure_rate,
        seed=args.seed,
    )

    runner = FleetRunner(config=config, verbose=args.verbose)
    results = runner.run(jobs)

    total_readings = sum(r.readings_written for r in results)
    errors = [r for r in results if r.error]
    dtc_fired = sum(1 for r in results if r.dtc_fired)

    print(f"Bootstrap complete.")
    print(f"  Vehicles:       {len(results)}")
    print(f"  DTC events:     {dtc_fired}")
    print(f"  Total readings: {total_readings:,}")
    if errors:
        print(f"  Errors:         {len(errors)}")
        for r in errors:
            print(f"    {r.vehicle_id}: {r.error}")


if __name__ == "__main__":
    main()
