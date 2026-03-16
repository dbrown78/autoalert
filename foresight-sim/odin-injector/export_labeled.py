"""
scripts/export_labeled.py
Export a labeled training dataset to CSV for ML inspection.
Produces one row per (vehicle, day) with full label columns.

Usage:
    python scripts/export_labeled.py --vehicles 10 --days 60 --failure-rate 0.7 --out ./output/labeled.csv
"""

import sys, os, argparse, csv, random
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from pathlib import Path
import numpy as np

from core.config import InjectionConfig
from core.event import FailureLabel
from core.vehicle import make_vehicle_profile, ARCHETYPE_NAMES
from engine.injector import FailureInjector
from engine.scheduler import FailureLabeler
from curves.library import FAILURE_MODE_NAMES, FAILURE_MODES
from stream.generator import TelemetryGenerator


def export_fleet(n_vehicles: int, n_days: int, failure_rate: float, seed: int, out_path: str):
    rng = np.random.default_rng(seed)
    labeler = FailureLabeler()
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    print(f"\nExporting labeled dataset: {n_vehicles} vehicles × {n_days} days")
    print(f"Failure rate: {failure_rate:.0%} | Seed: {seed}\n")

    rows = []

    for i in range(n_vehicles):
        vehicle_id = f"LABELED-{str(i+1).zfill(4)}"
        archetype = str(rng.choice(ARCHETYPE_NAMES))
        vehicle_seed = int(rng.integers(0, 2**31))
        inject = rng.random() < failure_rate

        profile = make_vehicle_profile(vehicle_id, archetype, seed=vehicle_seed)
        gen = TelemetryGenerator(profile)

        if inject:
            failure_name = str(rng.choice(FAILURE_MODE_NAMES))
            failure_start = int(rng.integers(2, max(3, n_days // 4)))
            config = InjectionConfig.from_failure_mode(failure_name, failure_start_day=failure_start)
            inj = FailureInjector(gen, config)

            for day in range(n_days):
                label = inj.advance_day()
                labeler.record(label)
                rows.append(label.to_csv_row())

            dtc_status = f"DTC fired Day {inj.dtc_event.fire_day}" if inj.dtc_fired else "DTC not fired"
            print(f"  [{i+1:>3}/{n_vehicles}] {vehicle_id} | {failure_name:<30} | {dtc_status}")
        else:
            for day in range(n_days):
                label = FailureLabel.healthy(vehicle_id, day)
                labeler.record_healthy_day(vehicle_id, day)
                rows.append(label.to_csv_row())
            print(f"  [{i+1:>3}/{n_vehicles}] {vehicle_id} | {'healthy':<30}")

    # Write CSV
    with open(out, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(FailureLabel.csv_headers())
        writer.writerows(rows)

    dist = labeler.distribution_summary()
    print(f"\n{'─'*55}")
    print(f"  Output:         {out}")
    print(f"  Total rows:     {dist['total_days']:,}")
    print(f"  Positive (pre-failure): {dist['positive']:,} ({dist['positive_rate']:.1%})")
    print(f"  Negative (healthy):     {dist['negative']:,}")
    print(f"  By severity:    {dist['by_severity']}")
    print()


def main():
    parser = argparse.ArgumentParser(description="Export labeled Foresight training data")
    parser.add_argument("--vehicles", type=int, default=10)
    parser.add_argument("--days", type=int, default=60)
    parser.add_argument("--failure-rate", type=float, default=0.7)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", type=str, default="./output/labeled.csv")
    args = parser.parse_args()

    export_fleet(args.vehicles, args.days, args.failure_rate, args.seed, args.out)


if __name__ == "__main__":
    main()
