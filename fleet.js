// backend/routes/fleet.js
// Fleet tier endpoints — requires is_fleet subscription
// Covers: fleet CRUD, vehicle management, fleet-level Foresight summary

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const fetch   = require('node-fetch');
const { authenticateToken } = require('../middleware/auth');

const FORESIGHT_URL     = process.env.FORESIGHT_SERVICE_URL || 'http://localhost:8001';
const FORESIGHT_INT_KEY = process.env.FORESIGHT_INTERNAL_KEY || 'odin-internal-2024';

// ── Fleet gate middleware ─────────────────────────────────────────────────────

async function requireFleet(req, res, next) {
  const { rows } = await db.query(
    'SELECT is_fleet FROM users WHERE id = $1',
    [req.user.id]
  );
  if (!rows.length || !rows[0].is_fleet) {
    return res.status(403).json({
      error:   'fleet_required',
      message: 'Fleet management is a Fleet subscription feature.',
    });
  }
  next();
}

// ── Fleet CRUD ────────────────────────────────────────────────────────────────

// GET /api/fleet — list user's fleets
router.get('/', authenticateToken, requireFleet, async (req, res) => {
  const { rows } = await db.query(`
    SELECT fs.*, COUNT(fv.vehicle_id) AS vehicle_count
    FROM fleet_subscriptions fs
    LEFT JOIN fleet_vehicles fv ON fv.fleet_id = fs.id
    WHERE fs.user_id = $1 AND fs.is_active = TRUE
    GROUP BY fs.id
    ORDER BY fs.created_at DESC
  `, [req.user.id]);
  res.json({ fleets: rows });
});

// POST /api/fleet — create a new fleet
router.post('/', authenticateToken, requireFleet, async (req, res) => {
  const { fleet_name, max_vehicles = 25 } = req.body;
  if (!fleet_name) return res.status(400).json({ error: 'fleet_name required' });

  const { rows } = await db.query(`
    INSERT INTO fleet_subscriptions (user_id, fleet_name, max_vehicles)
    VALUES ($1, $2, $3)
    RETURNING *
  `, [req.user.id, fleet_name, max_vehicles]);
  res.status(201).json({ fleet: rows[0] });
});

// ── Fleet vehicle management ──────────────────────────────────────────────────

// GET /api/fleet/:fleetId/vehicles
router.get('/:fleetId/vehicles', authenticateToken, requireFleet, async (req, res) => {
  const { fleetId } = req.params;

  // Verify fleet belongs to user
  const { rows: fleets } = await db.query(
    'SELECT id FROM fleet_subscriptions WHERE id = $1 AND user_id = $2',
    [fleetId, req.user.id]
  );
  if (!fleets.length) return res.status(404).json({ error: 'Fleet not found' });

  const { rows } = await db.query(`
    SELECT v.*, fv.added_at,
           fp.maintenance_urgency, fp.maintenance_probability, fp.predicted_at
    FROM fleet_vehicles fv
    JOIN vehicles v ON v.id = fv.vehicle_id
    LEFT JOIN LATERAL (
      SELECT maintenance_urgency, maintenance_probability, predicted_at
      FROM foresight_predictions
      WHERE vehicle_id = v.id
      ORDER BY predicted_at DESC
      LIMIT 1
    ) fp ON TRUE
    WHERE fv.fleet_id = $1
    ORDER BY fp.maintenance_probability DESC NULLS LAST
  `, [fleetId]);

  res.json({ fleet_id: fleetId, vehicles: rows });
});

// POST /api/fleet/:fleetId/vehicles — add vehicle to fleet
router.post('/:fleetId/vehicles', authenticateToken, requireFleet, async (req, res) => {
  const { fleetId } = req.params;
  const { vehicle_id } = req.body;

  // Check vehicle limit
  const { rows: fleet } = await db.query(
    'SELECT max_vehicles FROM fleet_subscriptions WHERE id = $1 AND user_id = $2',
    [fleetId, req.user.id]
  );
  if (!fleet.length) return res.status(404).json({ error: 'Fleet not found' });

  const { rows: count } = await db.query(
    'SELECT COUNT(*) FROM fleet_vehicles WHERE fleet_id = $1',
    [fleetId]
  );
  if (parseInt(count[0].count) >= fleet[0].max_vehicles) {
    return res.status(400).json({ error: `Fleet limit of ${fleet[0].max_vehicles} vehicles reached` });
  }

  await db.query(
    'INSERT INTO fleet_vehicles (fleet_id, vehicle_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [fleetId, vehicle_id]
  );
  res.status(201).json({ status: 'added', fleet_id: fleetId, vehicle_id });
});

// DELETE /api/fleet/:fleetId/vehicles/:vehicleId
router.delete('/:fleetId/vehicles/:vehicleId', authenticateToken, requireFleet, async (req, res) => {
  const { fleetId, vehicleId } = req.params;
  await db.query(
    'DELETE FROM fleet_vehicles WHERE fleet_id = $1 AND vehicle_id = $2',
    [fleetId, vehicleId]
  );
  res.json({ status: 'removed' });
});

// ── Fleet Foresight summary ───────────────────────────────────────────────────

// GET /api/fleet/:fleetId/health — aggregate health across all fleet vehicles
router.get('/:fleetId/health', authenticateToken, requireFleet, async (req, res) => {
  const { fleetId } = req.params;

  const { rows } = await db.query(`
    SELECT
      COUNT(fv.vehicle_id)                                                AS total_vehicles,
      COUNT(fp.id)                                                        AS vehicles_with_predictions,
      AVG(fp.maintenance_probability)                                     AS avg_maintenance_probability,
      COUNT(CASE WHEN fp.maintenance_urgency = 'critical' THEN 1 END)    AS critical_count,
      COUNT(CASE WHEN fp.maintenance_urgency = 'soon'     THEN 1 END)    AS soon_count,
      COUNT(CASE WHEN fp.maintenance_urgency = 'watch'    THEN 1 END)    AS watch_count,
      COUNT(CASE WHEN fp.maintenance_urgency = 'normal'   THEN 1 END)    AS normal_count
    FROM fleet_vehicles fv
    JOIN fleet_subscriptions fs ON fs.id = fv.fleet_id AND fs.user_id = $2
    LEFT JOIN LATERAL (
      SELECT id, maintenance_probability, maintenance_urgency
      FROM foresight_predictions
      WHERE vehicle_id = fv.vehicle_id
      ORDER BY predicted_at DESC LIMIT 1
    ) fp ON TRUE
    WHERE fv.fleet_id = $1
  `, [fleetId, req.user.id]);

  const summary = rows[0];

  // Vehicles needing immediate attention
  const { rows: urgent } = await db.query(`
    SELECT v.id, v.year, v.make, v.model, v.vin,
           fp.maintenance_urgency, fp.maintenance_probability,
           fp.estimated_service_date, fp.part_scores
    FROM fleet_vehicles fv
    JOIN vehicles v ON v.id = fv.vehicle_id
    JOIN LATERAL (
      SELECT maintenance_urgency, maintenance_probability, estimated_service_date, part_scores
      FROM foresight_predictions
      WHERE vehicle_id = fv.vehicle_id
      ORDER BY predicted_at DESC LIMIT 1
    ) fp ON TRUE
    WHERE fv.fleet_id = $1
      AND fp.maintenance_urgency IN ('critical', 'soon')
    ORDER BY fp.maintenance_probability DESC
  `, [fleetId]);

  res.json({
    fleet_id:   fleetId,
    summary: {
      total_vehicles:             parseInt(summary.total_vehicles),
      vehicles_with_predictions:  parseInt(summary.vehicles_with_predictions),
      avg_maintenance_probability: parseFloat(summary.avg_maintenance_probability || 0).toFixed(3),
      urgency_breakdown: {
        critical: parseInt(summary.critical_count),
        soon:     parseInt(summary.soon_count),
        watch:    parseInt(summary.watch_count),
        normal:   parseInt(summary.normal_count),
      },
    },
    urgent_vehicles: urgent,
  });
});

module.exports = router;
