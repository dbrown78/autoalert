"""
scripts/train.py
Full training pipeline CLI.

Usage:
    python scripts/train.py --no-optimize          # Baseline, fast
    python scripts/train.py --trials 50            # With Optuna HPO
    python scripts/train.py --trials 50 --seed 99  # Custom seed
"""

import sys, os, argparse, logging
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s — %(message)s",
)
log = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(description="Train the Foresight LightGBM model")
    parser.add_argument("--no-optimize",  action="store_true", help="Skip Optuna, use defaults")
    parser.add_argument("--trials",       type=int, default=50, help="Optuna trial count")
    parser.add_argument("--seed",         type=int, default=42)
    parser.add_argument("--train-frac",   type=float, default=0.70)
    parser.add_argument("--val-frac",     type=float, default=0.15)
    parser.add_argument("--demo-only",    action="store_true", help="Train on demo vehicles only")
    args = parser.parse_args()

    from data.loader import load_and_pivot, check_data_availability
    from data.splitter import vehicle_level_split, extract_xy
    from features.engineer import build_feature_matrix, get_feature_columns
    from training.trainer import ForesightTrainer
    from model.store import save_model
    from model.predictor import ForesightPredictor, precompute_demo_predictions

    # ── 1. Check data ─────────────────────────────────────────────────────────
    print("\n── Checking data availability ──")
    counts = check_data_availability()
    for k, v in counts.items():
        print(f"  {k:<25} {v:>10,}")

    if counts["day_labels"] == 0:
        print("\n✗ No sim data found. Run odin-writer bootstrap first:")
        print("  python scripts/bootstrap.py --vehicles 50 --days 90 --failure-rate 0.6")
        sys.exit(1)

    # ── 2. Load and engineer features ─────────────────────────────────────────
    print("\n── Loading and engineering features ──")
    merged, _ = load_and_pivot(demo_only=args.demo_only)
    featured   = build_feature_matrix(merged)
    feature_cols = get_feature_columns(featured)

    print(f"  Rows:     {len(featured):,}")
    print(f"  Features: {len(feature_cols)}")
    print(f"  Positive: {featured['label_binary'].mean():.1%}")

    # ── 3. Split ──────────────────────────────────────────────────────────────
    print("\n── Splitting dataset ──")
    train_df, val_df, test_df = vehicle_level_split(
        featured,
        train_frac=args.train_frac,
        val_frac=args.val_frac,
        seed=args.seed,
    )

    X_train, y_train = extract_xy(train_df, feature_cols)
    X_val,   y_val   = extract_xy(val_df,   feature_cols)
    X_test,  y_test  = extract_xy(test_df,  feature_cols)

    # ── 4. Train ──────────────────────────────────────────────────────────────
    trainer = ForesightTrainer(seed=args.seed)

    if not args.no_optimize:
        print(f"\n── Optuna HPO ({args.trials} trials) ──")
        best_params = trainer.optimize(X_train, y_train, X_val, y_val, n_trials=args.trials)
        print(f"  Best params: {best_params}")
    else:
        print("\n── Training with default params (no HPO) ──")

    print("\n── Training final model ──")
    model, train_meta = trainer.train(X_train, y_train, X_val, y_val)

    # ── 5. Evaluate ───────────────────────────────────────────────────────────
    print("\n── Evaluating on test set ──")
    eval_results = trainer.evaluate(model, X_test, y_test)
    trainer.print_evaluation(eval_results)

    train_meta["test_auc"] = eval_results["test_auc"]
    train_meta["test_ap"]  = eval_results["test_ap"]
    train_meta["feature_importance"] = eval_results["feature_importance"]

    # ── 6. Pre-compute demo predictions ───────────────────────────────────────
    print("── Pre-computing demo predictions ──")
    predictor = ForesightPredictor(model, feature_cols, train_meta)
    demo_preds = precompute_demo_predictions(predictor)
    print(f"  Cached {len(demo_preds)} demo predictions")

    # ── 7. Save ───────────────────────────────────────────────────────────────
    print("\n── Saving model ──")
    version_dir = save_model(
        model=model,
        feature_list=feature_cols,
        metadata=train_meta,
        demo_predictions=demo_preds,
    )
    print(f"  Saved to: {version_dir}")
    print(f"\n✓ Training complete.")
    print(f"  Val AUC:  {train_meta['val_auc']:.4f}")
    print(f"  Test AUC: {eval_results['test_auc']:.4f}")

    target = 0.88 if not args.no_optimize else 0.80
    if eval_results["test_auc"] >= target:
        print(f"  ✓ AUC target ({target}) met.\n")
    else:
        print(f"  ✗ AUC below target ({target}). Consider more sim data or more trials.\n")


if __name__ == "__main__":
    main()
