"""
scripts/inspect_features.py

Print a sample feature matrix to verify feature engineering output.

Usage:
    python scripts/inspect_features.py --limit 5
    python scripts/inspect_features.py --limit 5 --demo-only
"""

import sys, os, argparse
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv; load_dotenv()

import logging
logging.basicConfig(level=logging.INFO, format="%(levelname)s — %(message)s")


def main():
    parser = argparse.ArgumentParser(description="Inspect Foresight feature matrix")
    parser.add_argument("--limit",     type=int, default=5,    help="Rows to show per vehicle")
    parser.add_argument("--demo-only", action="store_true",    help="Only demo vehicles")
    args = parser.parse_args()

    from data.loader import load_and_pivot
    from features.engineer import build_feature_matrix, get_feature_columns, describe_features

    print("\n── Loading data ──")
    merged, _ = load_and_pivot(demo_only=args.demo_only)

    print(f"\n── Raw merged shape: {merged.shape} ──")
    print(f"  Vehicles: {merged['vehicle_id'].nunique()}")
    print(f"  Days:     {merged['day'].nunique()}")
    print(f"  Columns:  {merged.shape[1]}")
    print(f"  Positive: {merged['label_binary'].mean():.1%}\n")

    print("── Building features ──")
    featured = build_feature_matrix(merged)
    feature_cols = get_feature_columns(featured)

    print(f"\n── Feature matrix: {len(featured):,} rows × {len(feature_cols)} features ──")
    print(f"  NaN count: {featured[feature_cols].isna().sum().sum()}")
    print(f"  Positive rate: {featured['label_binary'].mean():.1%}\n")

    print("── Sample rows ──")
    sample = featured.head(args.limit)[["vehicle_id", "day", "label_binary"] + feature_cols[:10]]
    print(sample.to_string(index=False))

    print(f"\n── Feature statistics (all {len(feature_cols)} features) ──")
    print(describe_features(featured))


if __name__ == "__main__":
    main()
