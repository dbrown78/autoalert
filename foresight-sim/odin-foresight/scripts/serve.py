"""scripts/serve.py — Start the Foresight FastAPI server."""

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv; load_dotenv()

import uvicorn
import logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")

PORT = int(os.getenv("API_PORT", "8001"))
HOST = os.getenv("API_HOST", "0.0.0.0")

if __name__ == "__main__":
    print(f"\nStarting Foresight API on http://{HOST}:{PORT}")
    print(f"  /health                    — health check")
    print(f"  /predict                   — POST vehicle prediction")
    print(f"  /predict/demo/DEMO-001     — demo vehicle (cached, instant)")
    print(f"  /model/info                — model metadata")
    print(f"  /docs                      — Swagger UI\n")
    uvicorn.run(
        "api.app:app",
        host=HOST,
        port=PORT,
        reload=False,
        log_level="info",
    )
