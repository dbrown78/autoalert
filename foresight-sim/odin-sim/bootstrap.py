"""
sim/bootstrap.py
Community baseline bootstrapper. Generates a fleet of N synthetic vehicles,
assigns random archetypes, optionally injects failures, and writes everything
to PostgreSQL. This is how we pre-populate the k-anonymity community baseline
pool before real users exist.

Demo vehicles (DEMO-001 through DEMO-005) are always generated with specific
failure scenarios for use in the AutoAlert Demo Mode.
"""

import numpy as np
import random
import argparse
from datetime import datetime
from typing import Optional

from sim.sensors import VEHICLE_ARCHETYPES
from sim.degradation import FAILURE_MODES
from sim.generator import TelemetryGenerator, make_vehicle_profile
from sim.injector import FailureInjector, InjectionConfig
from sim.db import insert_vehicle, insert_readings_batch, insert_failure_event, run_migrations


DEMO_SCENARIOS = [
    {
        "vehicle_id": "DEMO-001",
        "archetype": "sedan_high_mileage",
        "failure": "o2_sensor",
        "failure_start_day": 10,
        "description": "2014 Honda Accord — O2 sensor degrading",
    },
    {
        "vehicle_id": "DEMO-002",
        "archetype": "truck_work",
        "failure": "catalytic_converter",
        "failure_start_day": 5,
        "description": "2018 Ford F-150 — Catalytic converter failing",
    },
    {
        "vehicle_id": "DEMO-003",
        "archetype": "economy_beater",
        "failure": "maf_sensor",
        "failure_start_day": 20,
        "description": "2009 Toyota Corolla — MAF sensor dirty",
    },
    {
        "vehicle_id": "DEMO-004",
        "archetype": "suv_family",
        "failure": "battery_alternator",
        "failure_start_day": 15,
        "description": "2020 Honda CR-V — Battery/alternator degrading",
    },
    {
        "vehicle_id": "DEMO-005",
        "archetype": "sedan_low_mileage",
        "failure": None,  # Healthy vehicle for contrast
        "description": "2022 Toyota Camry — Healthy baseline",
    },
    {
        "vehicle_id": "DEMO-006",
        "archetype": "truck_work",
        "failure": "transmission_overheat",
        "failure_start_day": 10,
        "description": "2019 Ford F-150 — Transmission overheating (TCM fault P0218)",
    },
    {
        "vehicle_id": "DEMO-007",
        "archetype": "sedan_high_mileage",
        "failure": "wheel_speed_sensor_dropout",
        "failure_start_day": 15,
        "description": "2015 Honda Accord — ABS wheel speed sensor dropout (C0035)",
    },
]

ARCHETYPES = list(VEHICLE_ARCHETYPES.keys())
FAILURE_NAMES = list(FAILURE_MODES.keys())


def run_vehicle(
    vehicle_id: str,
    archetype: str,
    n_days: int,
    failure_name: Optional[str],
    failure_start_day: Optional[int],
    seed: int,
    verbose: bool = False,
) -> dict:
    """
    Run simulation for a single vehicle and write to DB.
    Returns a summary dict.
    """
    rng = np.random.default_rng(seed)
    profile = make_vehicle_profile(vehicle_id, archetype=archetype, seed=seed, rng=rng)
    insert_vehicle(profile, archetype=archetype)

    gen = TelemetryGenerator(profile)

    if failure_name:
        failure_mode = FAILURE_MODES[failure_name]
        config = InjectionConfig(
            failure_mode_name=failure_name,
            failure_start_day=failure_start_day or max(1, n_days // 4),
            failure_window_days=failure_mode.typical_progression_days,
        )
        injector = FailureInjector(gen, config)
        total_readings = 0

        def day_callback(day, readings, factor, dtc_fired):
            nonlocal total_readings
            n = insert_readings_batch(readings)
            total_readings += n
            if verbose:
                status = f"[DTC FIRED]" if dtc_fired else f"factor={factor:.3f}"
                print(f"  {vehicle_id} | Day {day:3d} | {len(readings):,} readings | {status}")

        injector.run_days(n_days, callback=day_callback)
        summary = injector.summary()
        insert_failure_event(vehicle_id, summary, n_days)

        if verbose:
            print(f"  → DTC {summary['dtc_code']} fired on day {summary.get('dtc_fire_day', 'N/A')}")

        return {"vehicle_id": vehicle_id, "total_readings": total_readings, **summary}

    else:
        # Healthy vehicle — no injection
        total_readings = 0

        def day_callback_healthy(day, readings):
            nonlocal total_readings
            n = insert_readings_batch(readings)
            total_readings += n
            if verbose:
                print(f"  {vehicle_id} | Day {day:3d} | {len(readings):,} readings | healthy")

        gen.run_days(n_days, callback=day_callback_healthy)
        return {"vehicle_id": vehicle_id, "total_readings": total_readings, "failure_mode": None}


def bootstrap_fleet(
    n_vehicles: int,
    n_days: int,
    failure_rate: float = 0.6,
    seed: int = 42,
    verbose: bool = True,
    demo_mode: bool = False,
):
    """
    Generate a full fleet of synthetic vehicles and write to PostgreSQL.
    
    n_vehicles: total vehicles to simulate
    n_days: days of telemetry per vehicle
    failure_rate: fraction of vehicles that have an injected failure (0.0–1.0)
    seed: random seed for reproducibility
    demo_mode: if True, generate the fixed DEMO-001 through DEMO-005 scenarios
    """
    run_migrations()
    master_rng = np.random.default_rng(seed)
    summaries = []

    vehicles_to_run = []

    if demo_mode:
        print(f"\n⚡ Generating {len(DEMO_SCENARIOS)} Demo vehicles...\n")
        for i, scenario in enumerate(DEMO_SCENARIOS):
            vehicles_to_run.append({
                "vehicle_id": scenario["vehicle_id"],
                "archetype": scenario["archetype"],
                "failure": scenario.get("failure"),
                "failure_start_day": scenario.get("failure_start_day"),
                "seed": seed + i,
                "description": scenario["description"],
            })
    else:
        print(f"\n⚡ Bootstrapping {n_vehicles} vehicles × {n_days} days...\n")
        for i in range(n_vehicles):
            vid = f"SIM-{str(i+1).zfill(4)}"
            archetype = str(master_rng.choice(ARCHETYPES))
            inject_failure = master_rng.random() < failure_rate
            failure_name = str(master_rng.choice(FAILURE_NAMES)) if inject_failure else None
            failure_start_day = int(master_rng.integers(5, max(6, n_days // 3)))
            vehicles_to_run.append({
                "vehicle_id": vid,
                "archetype": archetype,
                "failure": failure_name,
                "failure_start_day": failure_start_day,
                "seed": seed + i,
                "description": None,
            })

    for idx, v in enumerate(vehicles_to_run):
        print(f"[{idx+1}/{len(vehicles_to_run)}] {v['vehicle_id']} | {v['archetype']} | failure={v['failure'] or 'none'}")
        if v.get("description"):
            print(f"        {v['description']}")

        summary = run_vehicle(
            vehicle_id=v["vehicle_id"],
            archetype=v["archetype"],
            n_days=n_days,
            failure_name=v["failure"],
            failure_start_day=v["failure_start_day"],
            seed=v["seed"],
            verbose=verbose,
        )
        summaries.append(summary)
        print(f"  ✓ {summary.get('total_readings', 0):,} readings written\n")

    total = sum(s.get("total_readings", 0) for s in summaries)
    failures = sum(1 for s in summaries if s.get("failure_mode"))
    print(f"\n{'='*50}")
    print(f"Bootstrap complete.")
    print(f"  Vehicles:       {len(summaries)}")
    print(f"  With failures:  {failures}")
    print(f"  Total readings: {total:,}")
    print(f"{'='*50}\n")
    return summaries


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ODIN Foresight Fleet Bootstrapper")
    parser.add_argument("--vehicles", type=int, default=10)
    parser.add_argument("--days", type=int, default=60)
    parser.add_argument("--failure-rate", type=float, default=0.6)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--demo", action="store_true", help="Generate Demo Mode vehicles")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    bootstrap_fleet(
        n_vehicles=args.vehicles,
        n_days=args.days,
        failure_rate=args.failure_rate,
        seed=args.seed,
        verbose=args.verbose,
        demo_mode=args.demo,
    )
