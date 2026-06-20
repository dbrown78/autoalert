/**
 * routes/foresight.js
 *
 * Foresight ML prediction route for AutoAlert Express backend.
 * Drop this file into the existing routes/ directory.
 * Register in app.js: app.use('/api/foresight', require('./routes/foresight'));
 *
 * Add to .env:
 *   FORESIGHT_API_URL=http://localhost:8001
 *
 * For Railway deployment, set:
 *   FORESIGHT_API_URL=http://foresight.railway.internal:8001
 */

const express           = require('express');
const router            = express.Router();
const authenticateToken = require('../middleware/auth');
const { analyzeVehicle, getHealthScores } = require('../services/foresight');
const { dispatch } = require('../services/alertDispatcher');

const FORESIGHT_URL = process.env.FORESIGHT_API_URL || 'http://localhost:8001';
const TIMEOUT_MS    = 10_000;

/**
 * Thin fetch wrapper with timeout and error normalization.
 */
async function foresightFetch(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${FORESIGHT_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw Object.assign(new Error(body.detail || `Foresight error ${res.status}`), {
        statusCode: res.status,
      });
    }

    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /api/foresight/health
 * Proxy Foresight health check. Used by app startup to confirm ML is available.
 */
router.get('/health', async (req, res) => {
  try {
    const data = await foresightFetch('/health');
    res.json(data);
  } catch (err) {
    res.status(503).json({ status: 'unavailable', error: err.message });
  }
});

/**
 * GET /api/foresight/predict/:vehicleId
 * Fetch failure prediction for a real user vehicle.
 * Requires auth middleware (applied in app.js route registration).
 */
router.get('/predict/:vehicleId', authenticateToken, async (req, res) => {
  const { vehicleId } = req.params;
  const lookbackDays  = parseInt(req.query.days) || 7;

  try {
    const prediction = await foresightFetch('/predict', {
      method: 'POST',
      body: JSON.stringify({
        vehicle_id:    vehicleId,
        lookback_days: lookbackDays,
      }),
    });

    // Fire-and-forget: dispatch alerts after responding to client.
    // setImmediate ensures the response is sent first; dispatch errors
    // are caught and logged without affecting the predict response.
    const userId = req.userId;
    const vidInt = parseInt(vehicleId, 10);
    setImmediate(() => {
      dispatch(userId, vidInt, prediction).catch(err => {
        console.error('[foresight/predict] alertDispatcher error:', err.message);
      });
    });

    res.json(prediction);
  } catch (err) {
    const status = err.statusCode === 404 ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * GET /api/foresight/demo/:vehicleId
 * Pre-cached demo prediction — returns static payload when ML service is unavailable.
 * Replace with live foresightFetch call once FastAPI service is on Railway.
 */
router.get('/demo/:vehicleId', async (req, res) => {
  const { vehicleId } = req.params;

  res.json({
    vehicle_id:     vehicleId,
    model_version:  'demo-v1.0',
    predicted_at:   new Date().toISOString(),
    components: [
      { name: 'Coolant System',     probability: 0.72, severity: 'late',    days_to_failure: 18 },
      { name: 'Battery / Charging', probability: 0.61, severity: 'early',   days_to_failure: 34 },
      { name: 'Oil System',         probability: 0.12, severity: 'healthy', days_to_failure: null },
      { name: 'Brake System',       probability: 0.08, severity: 'healthy', days_to_failure: null },
    ],
    overall_health: 0.58,
    note: 'Demo prediction — connect OBD2 adapter for live ML analysis',
  });
});

/**
 * GET /api/foresight/model/info
 * Returns current model metadata — version, AUC, training date.
 * Used by admin/debug screens.
 */
router.get('/model/info', async (req, res) => {
  try {
    const info = await foresightFetch('/model/info');
    res.json(info);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

/**
 * GET /api/foresight/alerts?vehicle_id=X
 * Rule-based telemetry alerts (Phase 1). Requires auth.
 */
router.get('/alerts', authenticateToken, async (req, res) => {
  const vehicleId = parseInt(req.query.vehicle_id);
  if (!vehicleId) return res.status(400).json({ error: 'vehicle_id required' });

  try {
    const alerts = await analyzeVehicle(req.userId, vehicleId);
    res.json({ alerts });
  } catch (err) {
    console.error('[foresight/alerts]', err);
    res.status(500).json({ error: 'Could not analyze vehicle' });
  }
});

/**
 * GET /api/foresight/component-health?vehicle_id=X
 * Component health scores derived from active rule-based alerts. Requires auth.
 */
router.get('/component-health', authenticateToken, async (req, res) => {
  const vehicleId = parseInt(req.query.vehicle_id);
  if (!vehicleId) return res.status(400).json({ error: 'vehicle_id required' });

  try {
    const health = await getHealthScores(req.userId, vehicleId);
    res.json({ health });
  } catch (err) {
    console.error('[foresight/component-health]', err);
    res.status(500).json({ error: 'Could not fetch health scores' });
  }
});

module.exports = router;
