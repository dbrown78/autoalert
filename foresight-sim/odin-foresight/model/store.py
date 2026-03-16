"""
model/store.py

Save and load trained Foresight models.

Each model is saved as a versioned directory:
  model/saved/foresight_YYYYMMDD_HHMM/
    model.lgb           — LightGBM Booster (native format)
    feature_list.json   — ordered feature column names
    metadata.json       — AUC, params, dataset stats, timestamp
    demo_predictions.json — pre-cached predictions for DEMO-001..005

  model/saved/latest    — symlink to most recent model dir

The symlink means the API always loads the freshest model by reading
from model/saved/latest/ — no config change needed after retraining.
"""

from __future__ import annotations
import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

import lightgbm as lgb

log = logging.getLogger(__name__)

MODEL_DIR = Path(os.getenv("MODEL_DIR", "./model/saved"))
LATEST_LINK = MODEL_DIR / "latest"


def _version_dir() -> Path:
    ts = datetime.now().strftime("%Y%m%d_%H%M")
    return MODEL_DIR / f"foresight_{ts}"


def save_model(
    model: lgb.Booster,
    feature_list: list[str],
    metadata: dict,
    demo_predictions: Optional[dict] = None,
) -> Path:
    """
    Save model, feature list, and metadata to a versioned directory.
    Updates the 'latest' symlink.
    Returns the path to the saved model directory.
    """
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    version_dir = _version_dir()
    version_dir.mkdir(parents=True, exist_ok=True)

    # Save LightGBM model in native format
    model_path = version_dir / "model.lgb"
    model.save_model(str(model_path))
    log.info(f"Model saved: {model_path}")

    # Save feature list
    feature_path = version_dir / "feature_list.json"
    with open(feature_path, "w") as f:
        json.dump(feature_list, f, indent=2)

    # Enrich and save metadata
    metadata["saved_at"] = datetime.now().isoformat()
    metadata["model_version"] = version_dir.name
    metadata["model_path"] = str(model_path)
    meta_path = version_dir / "metadata.json"
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2, default=str)

    # Save pre-cached demo predictions
    if demo_predictions:
        demo_path = version_dir / "demo_predictions.json"
        with open(demo_path, "w") as f:
            json.dump(demo_predictions, f, indent=2, default=str)
        log.info(f"Demo predictions saved: {demo_path}")

    # Update latest symlink
    if LATEST_LINK.is_symlink():
        LATEST_LINK.unlink()
    LATEST_LINK.symlink_to(version_dir.resolve())
    log.info(f"Latest symlink → {version_dir.name}")

    return version_dir


def load_model(model_dir: Optional[str] = None) -> tuple[lgb.Booster, list[str], dict]:
    """
    Load model, feature list, and metadata.
    If model_dir is None, loads from 'latest' symlink.
    Returns (booster, feature_list, metadata).
    """
    if model_dir is None or model_dir == "latest":
        target = LATEST_LINK
    else:
        target = Path(model_dir)

    if not target.exists():
        raise FileNotFoundError(
            f"No model found at {target}.\n"
            f"Run: python scripts/train.py to train a model first."
        )

    # Resolve symlink
    resolved = target.resolve() if target.is_symlink() else target

    model = lgb.Booster(model_file=str(resolved / "model.lgb"))

    with open(resolved / "feature_list.json") as f:
        feature_list = json.load(f)

    with open(resolved / "metadata.json") as f:
        metadata = json.load(f)

    log.info(f"Loaded model: {resolved.name} | AUC={metadata.get('val_auc', '?')}")
    return model, feature_list, metadata


def load_demo_predictions(model_dir: Optional[str] = None) -> dict:
    """Load pre-cached demo vehicle predictions."""
    if model_dir is None or model_dir == "latest":
        target = LATEST_LINK
    else:
        target = Path(model_dir)

    resolved = target.resolve() if target.is_symlink() else target
    demo_path = resolved / "demo_predictions.json"

    if not demo_path.exists():
        return {}

    with open(demo_path) as f:
        return json.load(f)


def list_models() -> list[dict]:
    """List all saved model versions with their metadata."""
    if not MODEL_DIR.exists():
        return []

    results = []
    for d in sorted(MODEL_DIR.iterdir()):
        if d.is_dir() and d.name.startswith("foresight_"):
            meta_path = d / "metadata.json"
            if meta_path.exists():
                with open(meta_path) as f:
                    meta = json.load(f)
                results.append({
                    "version": d.name,
                    "path": str(d),
                    "val_auc": meta.get("val_auc"),
                    "saved_at": meta.get("saved_at"),
                    "n_train": meta.get("n_train"),
                    "is_latest": (LATEST_LINK.resolve() == d.resolve()) if LATEST_LINK.exists() else False,
                })
    return results
