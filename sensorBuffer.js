// backend/sensorBuffer.js
// Batches incoming sensor readings and flushes to PostgreSQL
// Decouples the OBD2 stream from DB writes to avoid hammering Postgres on every tick

const db = require('./db'); // your existing pg pool

const FLUSH_INTERVAL_MS = 5000;  // flush every 5 seconds
const MAX_BUFFER_SIZE   = 500;   // flush early if buffer gets large

class SensorBuffer {
  constructor() {
    this._buffer = [];
    this._flushInterval = null;
    this._flushing = false;
  }

  start() {
    if (this._flushInterval) return;
    this._flushInterval = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
    console.log('[SensorBuffer] Started. Flushing every', FLUSH_INTERVAL_MS, 'ms');
  }

  stop() {
    if (this._flushInterval) {
      clearInterval(this._flushInterval);
      this._flushInterval = null;
    }
  }

  push(readings) {
    this._buffer.push(...readings);
    if (this._buffer.length >= MAX_BUFFER_SIZE) {
      this.flush(); // eager flush
    }
  }

  async flush() {
    if (this._flushing || this._buffer.length === 0) return;
    this._flushing = true;

    const batch = this._buffer.splice(0, this._buffer.length);

    try {
      // Build a single multi-row INSERT for efficiency
      const values = [];
      const params = [];
      let i = 1;

      for (const r of batch) {
        values.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
        params.push(r.vehicle_id, r.sensor_type, r.value, r.unit, r.recorded_at);
      }

      const sql = `
        INSERT INTO sensor_readings (vehicle_id, sensor_type, value, unit, recorded_at)
        VALUES ${values.join(', ')}
        ON CONFLICT DO NOTHING
      `;

      await db.query(sql, params);
      console.log(`[SensorBuffer] Flushed ${batch.length} readings`);
    } catch (err) {
      console.error('[SensorBuffer] Flush error:', err.message);
      // Re-queue failed batch (prepend so they go out next flush)
      this._buffer.unshift(...batch);
    } finally {
      this._flushing = false;
    }
  }

  get size() {
    return this._buffer.length;
  }
}

module.exports = new SensorBuffer(); // singleton
