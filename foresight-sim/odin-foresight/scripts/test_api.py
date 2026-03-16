"""
scripts/test_api.py — Live smoke test against a running Foresight API server.

Usage:
    python scripts/test_api.py                       # Tests DEMO-001
    python scripts/test_api.py --vehicle DEMO-002
    python scripts/test_api.py --vehicle V-001 --lookback 14
"""

import sys, os, argparse, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import urllib.request
import urllib.error

BASE = os.getenv("FORESIGHT_URL", "http://localhost:8001")


def call(method, path, body=None):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={"Content-Type": "application/json"} if data else {}
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def main():
    parser = argparse.ArgumentParser(description="Test Foresight API endpoints")
    parser.add_argument("--vehicle",  type=str, default="DEMO-001")
    parser.add_argument("--lookback", type=int, default=7)
    args = parser.parse_args()

    print(f"\n── Testing Foresight API at {BASE} ──\n")

    # Health check
    print("GET /health")
    h = call("GET", "/health")
    print(f"  status={h['status']}  model={h['model']}  version={h['model_version']}")
    assert h["status"] in ("ok", "degraded"), "Unexpected health status"
    print("  ✓\n")

    # Model info
    print("GET /model/info")
    try:
        info = call("GET", "/model/info")
        print(f"  version={info['model_version']}  AUC={info['val_auc']}  features={info['n_features']}")
        print("  ✓\n")
    except Exception as e:
        print(f"  ✗ {e}\n")

    # Demo prediction (cached — should be fast)
    print(f"GET /predict/demo/{args.vehicle}")
    try:
        demo = call("GET", f"/predict/demo/{args.vehicle}")
        print(f"  prob={demo['overall_failure_probability']:.3f}  severity={demo['severity']}")
        print(f"  days_to_failure={demo.get('days_to_failure_estimate')}")
        print(f"  top_modes={[m['dtc_code'] for m in demo['top_failure_modes']]}")
        print("  ✓\n")
    except Exception as e:
        print(f"  ✗ {e}\n")

    # Live prediction
    print(f"POST /predict  vehicle_id={args.vehicle}  lookback={args.lookback}")
    try:
        pred = call("POST", "/predict", {
            "vehicle_id": args.vehicle,
            "lookback_days": args.lookback,
        })
        print(f"  prob={pred['overall_failure_probability']:.3f}  severity={pred['severity']}")
        print(f"  confidence={pred['confidence']}")
        print(f"  top sensors:")
        for sensor, detail in list(pred["sensors"].items())[:3]:
            print(f"    {sensor:<25} contribution={detail['contribution']:.3f}  status={detail['status']}")
        print("  ✓\n")
        print("Full response:")
        print(json.dumps(pred, indent=2))
    except Exception as e:
        print(f"  ✗ {e}\n")


if __name__ == "__main__":
    main()
