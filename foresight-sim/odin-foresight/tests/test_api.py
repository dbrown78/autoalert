"""tests/test_api.py — FastAPI schema and model store unit tests (no live server needed)."""

import pandas as pd
import pytest


class TestAPISchemas:
    def test_predict_request_validation(self):
        from api.app import PredictRequest
        req = PredictRequest(vehicle_id="DEMO-001", lookback_days=7)
        assert req.vehicle_id == "DEMO-001"
        assert req.lookback_days == 7

    def test_predict_request_defaults(self):
        from api.app import PredictRequest
        req = PredictRequest(vehicle_id="V-001")
        assert req.lookback_days == 7

    def test_predict_request_bounds(self):
        from api.app import PredictRequest
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            PredictRequest(vehicle_id="V-001", lookback_days=0)
        with pytest.raises(ValidationError):
            PredictRequest(vehicle_id="V-001", lookback_days=91)


class TestModelStore:
    def test_list_models_empty_dir(self, tmp_path, monkeypatch):
        import model.store as store
        monkeypatch.setattr(store, "MODEL_DIR", tmp_path)
        monkeypatch.setattr(store, "LATEST_LINK", tmp_path / "latest")
        result = store.list_models()
        assert result == []

    def test_save_and_load_model(self, tmp_path, monkeypatch):
        import model.store as store
        import lightgbm as lgb
        import json
        monkeypatch.setattr(store, "MODEL_DIR", tmp_path)
        monkeypatch.setattr(store, "LATEST_LINK", tmp_path / "latest")

        X = pd.DataFrame({"a": [1.0, 2.0, 3.0, 4.0, 5.0]})
        y = [0, 0, 1, 1, 0]
        ds = lgb.Dataset(X, label=y)
        params = {"objective": "binary", "verbosity": -1, "num_leaves": 4}
        booster = lgb.train(params, ds, num_boost_round=5)

        feature_list = ["a"]
        metadata = {"val_auc": 0.75, "val_ap": 0.70, "n_train": 3}

        version_dir = store.save_model(booster, feature_list, metadata)
        assert (version_dir / "model.lgb").exists()
        assert (version_dir / "feature_list.json").exists()
        assert (version_dir / "metadata.json").exists()

        loaded_model, loaded_features, loaded_meta = store.load_model()
        assert loaded_features == feature_list
        assert loaded_meta["val_auc"] == 0.75
