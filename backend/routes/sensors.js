'use strict';

const express = require('express');
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');
const mockStream = require('../mockOBD2Stream');
const sensorBuffer = require('../sensorBuffer');

const router = express.Router();

// vehicleId -> userId map so the stream listener can associate readings with a user
const _streamUsers = new Map();

// Wire the mock stream → buffer (module-level, runs once on require)
mockStream.on('reading', ({ vehicleId, timestamp, sensors }) => {
  const userId = _streamUsers.get(vehicleId);
  if (!userId) return;
  for (const [sensorType, value] of Object.entries(sensors)) {
    sensorBuffer.add({ vehicleId, userId, sensorType, value, recordedAt: timestamp });
  }
});

// Map user-supplied window strings to safe SQL INTERVAL literals
const WINDOW_MAP = {
  '1h':  '1 hour',
  '6h':  '6 hours',
  '24h': '24 hours',
  '7d':  '7 days',
};

function windowToInterval(w) {
  return WINDOW_MAP[w] || '1 hour';
}

// ---------------------------------------------------------------------------
// POST /api/sensors/stream/start
// Body: { vehicle_id }
// ---------------------------------------------------------------------------
router.post('/stream/start', authenticateToken, (req, res) => {
  const vehicleId = parseInt(req.body.vehicle_id, 10);
  if (isNaN(vehicleId)) return res.status(400).json({ message: 'vehicle_id is required' });

  _streamUsers.set(vehicleId, req.userId);
  mockStream.start(vehicleId);
  res.json({ streaming: true, vehicle_id: vehicleId });
});

// ---------------------------------------------------------------------------
// POST /api/sensors/stream/stop
// Body: { vehicle_id }
// ---------------------------------------------------------------------------
router.post('/stream/stop', authenticateToken, (req, res) => {
  const vehicleId = parseInt(req.body.vehicle_id, 10);
  if (isNaN(vehicleId)) return res.status(400).json({ message: 'vehicle_id is required' });

  mockStream.stop(vehicleId);
  _streamUsers.delete(vehicleId);
  res.json({ streaming: false, vehicle_id: vehicleId });
});

// ---------------------------------------------------------------------------
// GET /api/sensors/stream/active
// ---------------------------------------------------------------------------
router.get('/stream/active', authenticateToken, (req, res) => {
  res.json({ active_vehicle_ids: mockStream.activeVehicleIds() });
});

// ---------------------------------------------------------------------------
// POST /api/sensors/:vehicleId/readings
// Body: { readings: [{ sensor_type, value, unit, timestamp }] }
// ---------------------------------------------------------------------------
router.post('/:vehicleId/readings', authenticateToken, async (req, res) => {
  const vehicleId = parseInt(req.params.vehicleId, 10);
  if (isNaN(vehicleId)) return res.status(400).json({ error: 'Invalid vehicle_id' });

  const { readings } = req.body;
  if (!Array.isArray(readings) || readings.length === 0) {
    return res.status(400).json({ error: 'readings array required' });
  }

  try {
    const values = readings.map((r, i) => {
      const base = i * 5;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    });
    const params = readings.flatMap(r => [
      vehicleId,
      r.sensor_type,
      r.value,
      r.unit || null,
      r.timestamp ? new Date(r.timestamp) : new Date(),
    ]);
    await pool.query(
      `INSERT INTO sensor_readings (vehicle_id, sensor_type, value, unit, recorded_at)
       VALUES ${values.join(', ')}
       ON CONFLICT DO NOTHING`,
      params
    );
    res.json({ inserted: readings.length });
  } catch (err) {
    console.error('[sensors] POST readings error:', err);
    res.status(500).json({ error: 'Failed to save readings' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/sensors/:vehicle_id/latest
// Returns in-memory latest reading per sensor (no DB query)
// ---------------------------------------------------------------------------
router.get('/:vehicle_id/latest', authenticateToken, (req, res) => {
  const vehicleId = parseInt(req.params.vehicle_id, 10);
  if (isNaN(vehicleId)) return res.status(400).json({ message: 'Invalid vehicle_id' });

  const sensors = sensorBuffer.getLatest(vehicleId);
  res.json({ vehicle_id: vehicleId, sensors });
});

// ---------------------------------------------------------------------------
// GET /api/sensors/:vehicle_id/history?window=1h&sensor=coolant_temp
// ---------------------------------------------------------------------------
router.get('/:vehicle_id/history', authenticateToken, async (req, res) => {
  const vehicleId = parseInt(req.params.vehicle_id, 10);
  if (isNaN(vehicleId)) return res.status(400).json({ message: 'Invalid vehicle_id' });

  const { window = '1h', sensor } = req.query;
  const interval = windowToInterval(window); // whitelisted — safe to interpolate

  try {
    let rows;
    if (sensor) {
      ({ rows } = await pool.query(
        `SELECT sensor_type, value, recorded_at
         FROM sensor_readings
         WHERE user_id = $1 AND vehicle_id = $2 AND sensor_type = $3
           AND recorded_at > NOW() - INTERVAL '${interval}'
         ORDER BY recorded_at DESC
         LIMIT 500`,
        [req.userId, vehicleId, sensor]
      ));
    } else {
      ({ rows } = await pool.query(
        `SELECT sensor_type, value, recorded_at
         FROM sensor_readings
         WHERE user_id = $1 AND vehicle_id = $2
           AND recorded_at > NOW() - INTERVAL '${interval}'
         ORDER BY recorded_at DESC
         LIMIT 1000`,
        [req.userId, vehicleId]
      ));
    }

    res.json({ vehicle_id: vehicleId, window, readings: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
