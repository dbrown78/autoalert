"""tests/test_trainer.py — Unit tests for LightGBM trainer (no live DB needed)."""


class TestTrainer:
    def test_baseline_training_runs(self, synthetic_train_data):
        from training.trainer import ForesightTrainer
        X, y = synthetic_train_data
        X_train, y_train = X[:350], y[:350]
        X_val, y_val     = X[350:425], y[350:425]

        trainer = ForesightTrainer(seed=42)
        model, meta = trainer.train(X_train, y_train, X_val, y_val)
        assert model is not None
        assert "val_auc" in meta
        assert 0.0 <= meta["val_auc"] <= 1.0

    def test_evaluation_returns_required_keys(self, synthetic_train_data):
        from training.trainer import ForesightTrainer
        X, y = synthetic_train_data
        trainer = ForesightTrainer(seed=42)
        model, _ = trainer.train(X[:350], y[:350], X[350:425], y[350:425])
        results = trainer.evaluate(model, X[425:], y[425:])
        for key in ["test_auc", "test_ap", "confusion_matrix", "feature_importance"]:
            assert key in results, f"Missing key in eval results: {key}"

    def test_feature_importance_all_features_present(self, synthetic_train_data):
        from training.trainer import ForesightTrainer
        X, y = synthetic_train_data
        trainer = ForesightTrainer(seed=42)
        model, _ = trainer.train(X[:350], y[:350], X[350:425], y[350:425])
        results = trainer.evaluate(model, X[425:], y[425:])
        importance_features = {fi["feature"] for fi in results["feature_importance"]}
        for col in X.columns:
            assert col in importance_features, f"Feature '{col}' missing from importance"
