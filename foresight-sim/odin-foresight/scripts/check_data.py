"""scripts/check_data.py — Verify sim data exists in PostgreSQL."""

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv; load_dotenv()

from data.loader import check_data_availability


def main():
    print("\n── Foresight Sim Data Check ──\n")
    counts = check_data_availability()
    print(f"  {'Table':<30} {'Rows':>12}")
    print(f"  {'─'*45}")
    for k, v in counts.items():
        status = "✓" if v > 0 else "✗ EMPTY"
        print(f"  {k:<30} {v:>12,}  {status}")
    print()
    if counts["day_labels"] == 0:
        print("  No data found. Run the odin-writer bootstrap first:")
        print("  python scripts/bootstrap.py --vehicles 50 --days 90")
    else:
        print(f"  Ready to train on {counts['vehicles']} vehicles.")
    print()


if __name__ == "__main__":
    main()
