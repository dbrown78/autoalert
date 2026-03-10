// backend/routes/sensors.js
// Endpoints:
//   POST   /api/sensors/stream/start       — start mock stream for a vehicle
//   POST   /api/sensors/stream/stop        — stop stream for a vehicle
//   GET    /api/sensors/stream/active      — list vehicles currently streaming
//   POST   /api/sensors/ingest             — manual batch ingest (for real adapter later)
//   GET    /api/sensors/:vehicleId/history — rolling trend data
//   GET    /api/sensors/:vehicleId/latest  — most recent reading per sensor type

const express  = require('express');
const router   = express.Router();
const db       = require('../db');
const mockStream  = require('../mockOBD2Stream');
const sensorBuffer = require('../sensorBuffer');
const { authenticateToken } = require('../middleware/auth'); // your existing auth middleware

// Wire mock stream → buffer (only once on module load)
mockStream.on('readings', (readings) => {
  sensorBuffer.push(readings);
});
sensorBuffer.start();

// ─────────────────────────────────────────────────────────────────────────────
// STREAM CONTROL
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/sensors/stream/start
// Body: { vehicle_id, interval_ms? }
router.post('/stream/start', authenticateToken, async (req, res) => {
  const { vehicle_id, interval_ms = 2000 } = req.body;

  if (!vehicle_id) {
    return res.status(400).json({ error: 'vehicle_id required' });
  }

  // Verify vehicle belongs to user
  const { rows } = await db.query(
    'SELECT id FROM vehicles WHERE id = $1 AND user_id = $2',
    [vehicle_id, req.user.id]
  );
  if (!rows.length) {
    return res.status(404).json({ error: 'Vehicle not found' });
  }

  mockStream.startStream(parseInt(vehicle_id), interval_ms);
  res.json({ status: 'streaming', vehicle_id, interval_ms });
});

// POST /api/sensors/stream/stop
// Body: { vehicle_id }
router.post('/stream/stop', authenticateToken, async (req, res) => {
  const { vehicle_id } = req.body;
  if (!vehicle_id) return res.status(400).json({ error: 'vehicle_id required' });

  mockStream.stopStream(parseInt(vehicle_id));
  await sensorBuffer.flush(); // flush any remaining readings before stopping
  res.json({ status: 'stopped', vehicle_id });
});

// GET /api/sensors/stream/active
router.get('/stream/active', authenticateToken, (req, res) => {
  res.json({ active_vehicles: mockStream.activeVehicles });
});

// ─────────────────────────────────────────────────────────────────────────────
// MANUAL INGEST (for real OBD2 adapter later — same contract)
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/sensors/ingest
// Body: { vehicle_id, readings: [{ sensor_type, value, unit, recorded_at? }] }
router.post('/ingest', authenticateToken, async (req, res) => {
  const { vehicle_id, readings } = req.body;

  if (!vehicle_id || !Array.isArray(readings) || !readings.length) {
    return res.status(400).json({ error: 'vehicle_id and readings[] required' });
  }

  const now = new Date().toISOString();
  const normalized = readings.map(r => ({
    vehicle_id,
    sensor_type: r.sensor_type,
    value: r.value,
    unit: r.unit,
    recorded_at: r.recorded_at || now,
  }));

  sensorBuffer.push(normalized);
  res.json({ status: 'queued', count: normalized.length });
});

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY / TREND QUERIES
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/sensors/:vehicleId/history?sensor=coolant_temp&window=1h
// window options: 1h, 6h, 24h, 7d, 30d
router.get('/:vehicleId/history', authenticateToken, async (req, res) => {
  const { vehicleId } = req.params;
  const { sensor, window = '24h' } = req.query;

  const windowMap = {
    '1h':  '1 hour',
    '6h':  '6 hours',
    '24h': '24 hours',
    '7d':  '7 days',
    '30d': '30 days',
  };

  const interval = windowMap[window];
  if (!interval) {
    return res.status(400).json({ error: `Invalid window. Use: ${Object.keys(windowMap).join(', ')}` });
  }

  let sql = `
    SELECT sensor_type, value, unit, recorded_at
    FROM sensor_readings
    WHERE vehicle_id = $1
      AND recorded_at > NOW() - INTERVAL '${interval}'
  `;
  const params = [vehicleId];

  if (sensor) {
    sql += ' AND sensor_type = $2';
    params.push(sensor);
  }

  sql += ' ORDER BY recorded_at ASC';

  // Optional: downsample for large windows to keep response lean
  // For 7d+ consider AVG bucketing by minute

  try {
    const { rows } = await db.query(sql, params);
    res.json({ vehicle_id: vehicleId, window, sensor: sensor || 'all', count: rows.length, readings: rows });
  } catch (err) {
    console.error('[Sensors] History query error:', err.message);
    res.status(500).json({ error: 'Failed to fetch sensor history' });
  }
});

// GET /api/sensors/:vehicleId/latest
// Returns most recent reading per sensor type
router.get('/:vehicleId/latest', authenticateToken, async (req, res) => {
  const { vehicleId } = req.params;

  try {
    const { rows } = await db.query(`
      SELECT DISTINCT ON (sensor_type)
        sensor_type, value, unit, recorded_at
      FROM sensor_readings
      WHERE vehicle_id = $1
      ORDER BY sensor_type, recorded_at DESC
    `, [vehicleId]);

    // Shape into a map for easy frontend consumption
    const latest = {};
    for (const row of rows) {
      latest[row.sensor_type] = {
        value: parseFloat(row.value),
        unit: row.unit,
        recorded_at: row.recorded_at,
      };
    }

    res.json({ vehicle_id: vehicleId, sensors: latest });
  } catch (err) {
    console.error('[Sensors] Latest query error:', err.message);
    res.status(500).json({ error: 'Failed to fetch latest readings' });
  }
});

module.exports = router;
