"""
sim/pipeline.py
Master CLI entry point for the ODIN Foresight Simulation Environment.
Ties together generator → injector → db writer with a single command.

Examples:
    # Single vehicle, 30 days, specific failure
    python sim/pipeline.py --vehicles 1 --days 30 --failure o2_sensor --verbose

    # Full fleet bootstrap with random failures
    python sim/pipeline.py --vehicles 50 --days 90 --random-failures --seed 42

    # Generate Demo Mode vehicles only
    python sim/pipeline.py --demo

    # List available failure modes
    python sim/pipeline.py --list-failures

    # Show DB stats after run
    python sim/pipeline.py --stats
"""

import argparse
import sys
from sim.degradation import FAILURE_MODES
from sim.bootstrap import bootstrap_fleet
from sim.db import count_sim_readings, run_migrations


def main():
    parser = argparse.ArgumentParser(
        description="ODIN AutoAlert — Foresight Simulation Pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    parser.add_argument("--vehicles", type=int, default=1, help="Number of vehicles to simulate")
    parser.add_argument("--days", type=int, default=60, help="Days of telemetry per vehicle")
    parser.add_argument("--failure", type=str, default=None, help="Specific failure mode to inject (see --list-failures)")
    parser.add_argument("--random-failures", action="store_true", help="Randomly assign failures at --failure-rate")
    parser.add_argument("--failure-rate", type=float, default=0.6, help="Fraction of vehicles with injected failure (default 0.6)")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility")
    parser.add_argument("--demo", action="store_true", help="Generate Demo Mode vehicles (DEMO-001 through DEMO-005)")
    parser.add_argument("--migrate", action="store_true", help="Run DB migrations only")
    parser.add_argument("--stats", action="store_true", help="Show DB stats and exit")
    parser.add_argument("--list-failures", action="store_true", help="List available failure modes")
    parser.add_argument("--verbose", action="store_true", help="Print per-day progress")

    args = parser.parse_args()

    # Info commands
    if args.list_failures:
        print("\nAvailable failure modes:\n")
        for name, mode in FAILURE_MODES.items():
            print(f"  {name:<30} {mode.dtc_code}  {mode.display_name}")
            print(f"  {'':30} Severity: {mode.severity} | Typical: {mode.typical_progression_days} days")
            print(f"  {'':30} OEM repair: ${mode.repair_cost_oem[0]}–${mode.repair_cost_oem[1]}")
            print()
        return

    if args.migrate:
        run_migrations()
        return

    if args.stats:
        stats = count_sim_readings()
        print(f"\nSim DB Stats:")
        print(f"  Total readings:  {stats['total_readings']:,}")
        print(f"  Unique vehicles: {stats['vehicles']}")
        print(f"  Failure events:  {stats['failure_events']}")
        return

    # Validate failure mode if specified
    if args.failure and args.failure not in FAILURE_MODES:
        print(f"ERROR: Unknown failure mode '{args.failure}'")
        print(f"Run with --list-failures to see options.")
        sys.exit(1)

    # Determine failure rate
    if args.failure and not args.random_failures:
        # Single specified failure, apply to all vehicles
        failure_rate = 1.0
    elif args.random_failures:
        failure_rate = args.failure_rate
    else:
        failure_rate = 0.0  # Healthy only if no failure specified

    # If a specific failure is set but random-failures is also on, the specific
    # one overrides random selection — handled in bootstrap_fleet via override
    # For now, just pass failure_rate and let bootstrap handle archetype selection

    summaries = bootstrap_fleet(
        n_vehicles=args.vehicles,
        n_days=args.days,
        failure_rate=failure_rate,
        seed=args.seed,
        verbose=args.verbose,
        demo_mode=args.demo,
    )

    # Post-run stats
    stats = count_sim_readings()
    print(f"DB now contains {stats['total_readings']:,} sim readings across {stats['vehicles']} vehicles.")


if __name__ == "__main__":
    main()
