'use strict';

/**
 * foresightClient.js
 *
 * HTTP client for the Foresight FastAPI microservice.
 *
 * Env vars:
 *   FORESIGHT_URL        – base URL of FastAPI (default: http://localhost:8001)
 *   FORESIGHT_API_URL    – alias accepted for backward compat
 *   FORESIGHT_API_KEY    – sent as X-API-Key if present; never logged or exposed
 *   FORESIGHT_TIMEOUT_MS – per-request timeout in ms (default: 10000)
 *
 * Demo vehicles (DEMO-001 … DEMO-005):
 *   1. Try FastAPI GET /predict/demo/{vehicle_id} (instant cached response)
 *   2. Fall back to the hardcoded fixture below if FastAPI is down
 */

const FORESIGHT_URL = process.env.FORESIGHT_URL
                   || process.env.FORESIGHT_API_URL
                   || 'http://localhost:8001';

const FORESIGHT_API_KEY = process.env.FORESIGHT_API_KEY;
const TIMEOUT_MS        = parseInt(process.env.FORESIGHT_TIMEOUT_MS, 10) || 10_000;

const DEMO_VEHICLE_IDS = new Set([
  'DEMO-001', 'DEMO-002', 'DEMO-003', 'DEMO-004', 'DEMO-005',
]);

const DEMO_FIXTURE = {
  overall_failure_probability: 0.62,
  days_to_failure_estimate:    18,
  severity:                    'late',
  confidence:                  0.78,
  lookback_days:               14,
  sensors: {},
  top_failure_modes: [
    {
      mode:                    'coolant_leak',
      display_name:            'Coolant System',
      probability:             0.72,
      dtc_code:                'P0217',
      repair_cost_oem:         [300, 600],
      repair_cost_aftermarket: [150, 350],
      severity:                'late',
    },
    {
      mode:                    'battery_drain',
      display_name:            'Battery / Charging',
      probability:             0.61,
      dtc_code:                'P0562',
      repair_cost_oem:         [200, 400],
      repair_cost_aftermarket: [100, 250],
      severity:                'early',
    },
  ],
  model_version: 'demo-v1.0',
  note: 'Demo prediction — connect OBD2 adapter for live ML analysis',
};

function _headers() {
  const h = { 'Content-Type': 'application/json' };
  if (FORESIGHT_API_KEY) h['X-API-Key'] = FORESIGHT_API_KEY;
  return h;
}

function _abort(ms) {
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(t) };
}

/**
 * Run a live prediction for a real vehicle via FastAPI POST /predict.
 */
async function predict(vehicleId, lookbackDays = 7) {
  if (DEMO_VEHICLE_IDS.has(vehicleId)) {
    return _predictDemo(vehicleId);
  }

  const { signal, clear } = _abort(TIMEOUT_MS);
  try {
    const res = await fetch(`${FORESIGHT_URL}/predict`, {
      method:  'POST',
      headers: _headers(),
      body:    JSON.stringify({ vehicle_id: vehicleId, lookback_days: lookbackDays }),
      signal,
    });

    if (res.status === 403) {
      console.error('[foresightClient] FastAPI returned 403 — verify FORESIGHT_API_KEY');
      const err = new Error('Foresight authentication failure');
      err.statusCode = 403;
      throw err;
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err  = new Error(body.detail || `Foresight error ${res.status}`);
      err.statusCode = res.status;
      throw err;
    }

    return await res.json();
  } finally {
    clear();
  }
}

async function _predictDemo(vehicleId) {
  const { signal, clear } = _abort(TIMEOUT_MS);
  try {
    const res = await fetch(`${FORESIGHT_URL}/predict/demo/${vehicleId}`, {
      headers: _headers(),
      signal,
    });
    if (res.ok) return await res.json();
  } catch {
    // Network / timeout — fall through to fixture
  } finally {
    clear();
  }

  return {
    vehicle_id:   vehicleId,
    predicted_at: new Date().toISOString(),
    ...DEMO_FIXTURE,
  };
}

/**
 * Proxy GET /health from FastAPI.
 */
async function healthCheck() {
  const { signal, clear } = _abort(5_000);
  try {
    const res = await fetch(`${FORESIGHT_URL}/health`, {
      headers: _headers(),
      signal,
    });
    if (!res.ok) throw new Error(`Foresight health returned ${res.status}`);
    return await res.json();
  } finally {
    clear();
  }
}

module.exports = { predict, healthCheck };
