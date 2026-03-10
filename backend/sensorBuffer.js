'use strict';

/**
 * sensorBuffer.js — In-memory write buffer for sensor_readings.
 *
 * Batches individual sensor readings and flushes them to Postgres every
 * FLUSH_INTERVAL_MS to avoid a DB write on every 2-second OBD2 tick.
 *
 * Also maintains an in-memory "latest" map for instant /latest reads
 * without a DB round-trip.
 */

const pool = require('./config/db');

const FLUSH_INTERVAL_MS = 5000;

class SensorBuffer {
  constructor() {
    this._queue  = [];       // pending INSERT rows
    this._latest = new Map(); // vehicleId -> { sensorType -> { value, recorded_at } }
    this._timer  = null;
  }

  /**
   * Start the flush interval. Called once from server.js.
   */
  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this._flush(), FLUSH_INTERVAL_MS);
  }

  /**
   * Stop the flush interval and do a final flush. Called on graceful shutdown.
   */
  async stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    await this._flush();
  }

  /**
   * Add a single sensor reading to the buffer.
   * @param {{ vehicleId, userId, sensorType, value, recordedAt }} reading
   */
  add({ vehicleId, userId, sensorType, value, recordedAt }) {
    this._queue.push({ vehicleId, userId, sensorType, value, recordedAt });

    // Update in-memory latest
    if (!this._latest.has(vehicleId)) this._latest.set(vehicleId, {});
    this._latest.get(vehicleId)[sensorType] = { value, recorded_at: recordedAt };
  }

  /**
   * Return the latest reading per sensor for a vehicle (from memory, no DB).
   * @param {number} vehicleId
   * @returns {{ [sensorType]: { value: number, recorded_at: Date } }}
   */
  getLatest(vehicleId) {
    return this._latest.get(vehicleId) || {};
  }

  async _flush() {
    if (this._queue.length === 0) return;

    const batch = this._queue.splice(0); // drain queue atomically

    const valueClauses = [];
    const params = [];
    let i = 1;

    for (const r of batch) {
      valueClauses.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
      params.push(r.userId, r.vehicleId, r.sensorType, r.value, r.recordedAt);
    }

    try {
      await pool.query(
        `INSERT INTO sensor_readings (user_id, vehicle_id, sensor_type, value, recorded_at)
         VALUES ${valueClauses.join(', ')}`,
        params
      );
    } catch (err) {
      console.error(`[sensorBuffer] flush error (${batch.length} rows lost):`, err.message);
    }
  }
}

module.exports = new SensorBuffer();
