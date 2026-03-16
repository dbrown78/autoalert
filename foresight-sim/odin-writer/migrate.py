"""
scripts/migrate.py
Migration runner and schema verifier.

Usage:
    python scripts/migrate.py --run        # Apply all migrations
    python scripts/migrate.py --verify     # Show table counts
    python scripts/migrate.py --clear      # Clear all sim data (CAREFUL)
    python scripts/migrate.py --clear --vehicle SIM-0001  # Clear one vehicle
"""

import sys, os, argparse
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import logging
from dotenv import load_dotenv
load_dotenv()

from core.connection import init_pool, get_conn, ping
from core.schema import MIGRATION_STEPS, VERIFY_QUERIES, VERIFY_SIM_ONLY, CLEAR_QUERIES, CLEAR_VEHICLE_QUERIES

logging.basicConfig(level=logging.WARNING)


def run_migrations():
    print("\n── Running Migrations ──\n")
    if not ping():
        print("✗ Cannot reach database. Check DATABASE_URL in .env")
        sys.exit(1)

    with get_conn() as conn:
        with conn.cursor() as cur:
            for name, sql in MIGRATION_STEPS:
                cur.execute(sql)
                print(f"  ✓ {name}")

    print("\n✓ All migrations applied.\n")


def verify_schema():
    print("\n── Schema Verification ──\n")
    with get_conn() as conn:
        with conn.cursor() as cur:
            print(f"  {'Table':<35} {'Row Count':>12}")
            print(f"  {'─'*50}")
            for label, sql in {**VERIFY_QUERIES, **VERIFY_SIM_ONLY}.items():
                cur.execute(sql)
                count = cur.fetchone()[0]
                print(f"  {label:<35} {count:>12,}")

    print()


def clear_data(vehicle_id: str = None):
    if vehicle_id:
        confirm = input(f"Clear ALL sim data for vehicle '{vehicle_id}'? [y/N] ")
        if confirm.lower() != 'y':
            print("Aborted.")
            return
        with get_conn() as conn:
            with conn.cursor() as cur:
                for table, sql in CLEAR_VEHICLE_QUERIES:
                    cur.execute(sql, (vehicle_id,))
                    print(f"  ✓ Cleared {table} for {vehicle_id}")
    else:
        confirm = input("Clear ALL sim data from ALL tables? [y/N] ")
        if confirm.lower() != 'y':
            print("Aborted.")
            return
        with get_conn() as conn:
            with conn.cursor() as cur:
                for sql in CLEAR_QUERIES:
                    cur.execute(sql)
                    print(f"  ✓ {sql[:60]}...")

    print("\n✓ Clear complete.\n")


def main():
    init_pool()
    parser = argparse.ArgumentParser(description="ODIN DB Migration Tool")
    parser.add_argument("--run",     action="store_true", help="Run all migrations")
    parser.add_argument("--verify",  action="store_true", help="Show table counts")
    parser.add_argument("--clear",   action="store_true", help="Clear sim data")
    parser.add_argument("--vehicle", type=str,            help="Filter clear by vehicle_id")
    args = parser.parse_args()

    if args.run:
        run_migrations()
    if args.verify:
        verify_schema()
    if args.clear:
        clear_data(args.vehicle)
    if not any([args.run, args.verify, args.clear]):
        parser.print_help()


if __name__ == "__main__":
    main()
