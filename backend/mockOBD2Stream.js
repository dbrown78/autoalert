'use strict';

/**
 * mockOBD2Stream.js — Singleton mock OBD2 adapter.
 *
 * Emits a 'reading' event every 2 s for each active vehicle stream.
 * Swap this module for a real BLE/USB adapter without touching routes/sensors.js.
 *
 * Event payload:
 *   { vehicleId: number, timestamp: Date, sensors: { [sensorType]: number } }
 */

const EventEmitter = require('events');

const TICK_MS = 2000;

// Sensor baseline and jitter range — all within SENSOR_CONFIG valid ranges
const SENSOR_PROFILES = {
  coolant_temp:  { base: 90,   range: 8    },
  rpm:           { base: 1800, range: 400  },
  voltage:       { base: 14.2, range: 0.4  },
  o2_sensor:     { base: 0.45, range: 0.1  },
  fuel_trim:     { base: 2,    range: 5    },
  engine_load:   { base: 45,   range: 15   },
  intake_temp:   { base: 35,   range: 5    },
};

function jitter(base, range) {
  return +(base + (Math.random() * range * 2 - range)).toFixed(2);
}

class MockOBD2Stream extends EventEmitter {
  constructor() {
    super();
    this._timers = new Map(); // vehicleId (number) -> NodeJS.Timeout
  }

  /**
   * Start emitting readings for a vehicle. No-op if already running.
   */
  start(vehicleId) {
    if (this._timers.has(vehicleId)) return;

    const timer = setInterval(() => {
      const sensors = {};
      for (const [type, { base, range }] of Object.entries(SENSOR_PROFILES)) {
        sensors[type] = jitter(base, range);
      }
      this.emit('reading', { vehicleId, timestamp: new Date(), sensors });
    }, TICK_MS);

    this._timers.set(vehicleId, timer);
  }

  /**
   * Stop emitting readings for a vehicle.
   */
  stop(vehicleId) {
    const timer = this._timers.get(vehicleId);
    if (timer) {
      clearInterval(timer);
      this._timers.delete(vehicleId);
    }
  }

  /**
   * Stop all active streams (called on graceful shutdown).
   */
  stopAll() {
    for (const vehicleId of [...this._timers.keys()]) {
      this.stop(vehicleId);
    }
  }

  /**
   * Returns array of vehicle IDs currently streaming.
   */
  activeVehicleIds() {
    return [...this._timers.keys()];
  }
}

module.exports = new MockOBD2Stream();
