"""
scripts/evaluate.py — Evaluate a saved Foresight model on fresh test data.

Usage:
    python scripts/evaluate.py                  # Latest model
    python scripts/evaluate.py --model latest
    python scripts/evaluate.py --model foresight_20240115_1030
"""

import sys, os, argparse
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv; load_dotenv()

import logging
logging.basicConfig(level=logging.INFO, format="%(levelname)s — %(message)s")


def main():
    parser = argparse.ArgumentParser(description="Evaluate saved Foresight model")
    parser.add_argument("--model", type=str, default="latest")
    parser.add_argument("--seed",  type=int, default=42)
    args = parser.parse_args()

    from data.loader import load_and_pivot
    from data.splitter import vehicle_level_split, extract_xy
    from features.engineer import build_feature_matrix, get_feature_columns
    from model.store import load_model, list_models
    from training.trainer import ForesightTrainer

    print("\n── Available Models ──")
    for m in list_models():
        marker = " ← latest" if m["is_latest"] else ""
        print(f"  {m['version']}  AUC={m.get('val_auc', '?')}  saved={m.get('saved_at', '?')[:16]}{marker}")

    print(f"\n── Loading model: {args.model} ──")
    model, feature_list, metadata = load_model(None if args.model == "latest" else args.model)

    print("\n── Loading test data ──")
    merged, _ = load_and_pivot()
    featured = build_feature_matrix(merged)
    feature_cols = get_feature_columns(featured)
    _, _, test_df = vehicle_level_split(featured, seed=args.seed)
    X_test, y_test = extract_xy(test_df, feature_cols)

    # Align features
    for col in feature_list:
        if col not in X_test.columns:
            X_test[col] = 0.0
    X_test = X_test[feature_list].fillna(0)

    trainer = ForesightTrainer(seed=args.seed)
    results = trainer.evaluate(model, X_test, y_test)
    trainer.print_evaluation(results)


if __name__ == "__main__":
    main()
