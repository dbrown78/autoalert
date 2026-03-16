"""
pipeline/demo.py

Generates the 5 fixed Demo Mode vehicles (DEMO-001 through DEMO-005).
These power the Demo Mode in the AutoAlert app — pre-loaded vehicles
with interesting failure scenarios that new users can explore before
connecting their own OBD-II adapter.

Demo vehicles are always regenerated from scratch to ensure consistency.
They are tagged is_demo=TRUE in sim_vehicles.
"""

from __future__ import annotations
from pipeline.runner import PipelineRunner, VehicleJob, FleetRunner, VehicleResult
from core.config import WriterConfig
from core.connection import init_pool, get_conn
from curves.library import FAILURE_MODES
import logging

log = logging.getLogger(__name__)

# Fixed demo scenarios — these never change
# Each has a specific failure that tells a good story for a first-time user
DEMO_JOBS = [
    VehicleJob(
        vehicle_id="DEMO-001",
        archetype="sedan_high_mileage",
        seed=1001,
        n_days=60,
        failure_mode="o2_sensor",
        failure_start_day=10,
        curve_shape="sigmoid",
        is_demo=True,
        # Story: 2014 Honda Accord, 185k km, O2 sensor degrading
        # Foresight shows: 73% failure probability, ~18 days to DTC
    ),
    VehicleJob(
        vehicle_id="DEMO-002",
        archetype="truck_work",
        seed=1002,
        n_days=60,
        failure_mode="catalytic_converter",
        failure_start_day=5,
        curve_shape="exponential",
        is_demo=True,
        # Story: 2018 Ford F-150, 98k km, cat degrading fast
        # Foresight shows: 89% failure probability, high repair cost warning
    ),
    VehicleJob(
        vehicle_id="DEMO-003",
        archetype="economy_beater",
        seed=1003,
        n_days=60,
        failure_mode="maf_sensor",
        failure_start_day=20,
        curve_shape="sigmoid",
        is_demo=True,
        # Story: 2009 Toyota Corolla, 261k km, dirty MAF
        # Foresight shows: early detection — 42% probability, still early phase
    ),
    VehicleJob(
        vehicle_id="DEMO-004",
        archetype="suv_family",
        seed=1004,
        n_days=60,
        failure_mode="battery_alternator",
        failure_start_day=15,
        curve_shape="sigmoid",
        is_demo=True,
        # Story: 2020 Honda CR-V, 44k km, charging system weakening
        # Foresight shows: medium probability, critical severity flag
    ),
    VehicleJob(
        vehicle_id="DEMO-005",
        archetype="sedan_low_mileage",
        seed=1005,
        n_days=60,
        failure_mode=None,       # Healthy — contrast vehicle
        is_demo=True,
        # Story: 2022 Toyota Camry, 21k km — everything looks good
        # Foresight shows: <5% probability, all sensors nominal
    ),
]


def clear_demo_vehicles() -> None:
    """Remove existing demo data before regenerating."""
    from core.schema import CLEAR_VEHICLE_QUERIES
    with get_conn() as conn:
        with conn.cursor() as cur:
            for demo_job in DEMO_JOBS:
                vid = demo_job.vehicle_id
                for table, sql in CLEAR_VEHICLE_QUERIES:
                    cur.execute(sql, (vid,))
    log.info("Demo vehicles cleared")


def generate_demo_vehicles(
    config: WriterConfig = None,
    verbose: bool = True,
) -> list[VehicleResult]:
    """
    Generate all 5 demo vehicles and write to PostgreSQL.
    Clears existing demo data first to ensure fresh generation.
    """
    config = config or WriterConfig.default()
    init_pool(config.pool_min, config.pool_max)

    if verbose:
        print("\n" + "═" * 65)
        print("  Generating ODIN AutoAlert Demo Mode Vehicles")
        print("═" * 65)
        for job in DEMO_JOBS:
            mode_name = job.failure_mode or "healthy"
            mode_display = FAILURE_MODES[job.failure_mode].display_name if job.failure_mode else "Healthy"
            print(f"  {job.vehicle_id}  {job.archetype:<25}  {mode_display}")
        print()

    clear_demo_vehicles()
    runner = FleetRunner(config=config, verbose=verbose)
    results = runner.run(DEMO_JOBS)

    if verbose:
        print("Demo Mode vehicles ready.")
        print("These vehicles are now available in the AutoAlert app Demo Mode.\n")

    return results
