// backend/mockOBD2Stream.js
// Simulates a real BLE OBD2 adapter data stream with natural variance + occasional anomalies
// Replace this module with real adapter SDK when hardware is ready

const EventEmitter = require('events');

// Sensor definitions: type, unit, baseline, variance, anomaly chance
const SENSOR_PROFILES = {
  coolant_temp: {
    unit: 'C',
    baseline: 90,
    variance: 5,
    min: 60,
    max: 130,
    anomalyChance: 0.02,   // 2% chance of a spike per reading
    anomalyMultiplier: 1.3,
  },
  battery_voltage: {
    unit: 'V',
    baseline: 14.2,
    variance: 0.3,
    min: 11.5,
    max: 15.5,
    anomalyChance: 0.015,
    anomalyMultiplier: 0.8,  // drop instead of spike
  },
  rpm: {
    unit: 'RPM',
    baseline: 800,
    variance: 150,
    min: 0,
    max: 7000,
    anomalyChance: 0.01,
    anomalyMultiplier: 2.5,
  },
  oil_temp: {
    unit: 'C',
    baseline: 100,
    variance: 8,
    min: 60,
    max: 150,
    anomalyChance: 0.02,
    anomalyMultiplier: 1.25,
  },
  intake_air_temp: {
    unit: 'C',
    baseline: 35,
    variance: 10,
    min: -10,
    max: 80,
    anomalyChance: 0.005,
    anomalyMultiplier: 1.5,
  },
  throttle_position: {
    unit: '%',
    baseline: 15,
    variance: 10,
    min: 0,
    max: 100,
    anomalyChance: 0,
    anomalyMultiplier: 1,
  },
  fuel_level: {
    unit: '%',
    baseline: 65,
    variance: 0.1,  // slow drain
    min: 0,
    max: 100,
    anomalyChance: 0,
    anomalyMultiplier: 1,
  },
};

class MockOBD2Stream extends EventEmitter {
  constructor() {
    super();
    this._intervals = new Map(); // vehicleId -> intervalId
    this._state = new Map();     // vehicleId -> current sensor values
  }

  // Seed initial state per vehicle
  _initVehicleState(vehicleId) {
    const state = {};
    for (const [type, profile] of Object.entries(SENSOR_PROFILES)) {
      state[type] = profile.baseline;
    }
    this._state.set(vehicleId, state);
  }

  // Generate the next value for a sensor using random walk
  _nextValue(type, currentValue) {
    const profile = SENSOR_PROFILES[type];
    const isAnomaly = Math.random() < profile.anomalyChance;

    let next;
    if (isAnomaly) {
      next = currentValue * profile.anomalyMultiplier;
    } else {
      const delta = (Math.random() - 0.5) * 2 * profile.variance;
      // Pull back toward baseline gently (mean reversion)
      const reversion = (profile.baseline - currentValue) * 0.05;
      next = currentValue + delta + reversion;
    }

    // Clamp to min/max
    return Math.max(profile.min, Math.min(profile.max, parseFloat(next.toFixed(4))));
  }

  // Start streaming for a vehicle
  startStream(vehicleId, intervalMs = 2000) {
    if (this._intervals.has(vehicleId)) return; // already streaming

    this._initVehicleState(vehicleId);
    console.log(`[MockOBD2] Starting stream for vehicle ${vehicleId} @ ${intervalMs}ms`);

    const id = setInterval(() => {
      const state = this._state.get(vehicleId);
      const readings = [];
      const now = new Date();

      for (const type of Object.keys(SENSOR_PROFILES)) {
        const newVal = this._nextValue(type, state[type]);
        state[type] = newVal;

        readings.push({
          vehicle_id: vehicleId,
          sensor_type: type,
          value: newVal,
          unit: SENSOR_PROFILES[type].unit,
          recorded_at: now.toISOString(),
        });
      }

      this._state.set(vehicleId, state);
      this.emit('readings', readings);
    }, intervalMs);

    this._intervals.set(vehicleId, id);
  }

  // Stop streaming for a vehicle
  stopStream(vehicleId) {
    const id = this._intervals.get(vehicleId);
    if (id) {
      clearInterval(id);
      this._intervals.delete(vehicleId);
      this._state.delete(vehicleId);
      console.log(`[MockOBD2] Stopped stream for vehicle ${vehicleId}`);
    }
  }

  // Stop all streams
  stopAll() {
    for (const vehicleId of this._intervals.keys()) {
      this.stopStream(vehicleId);
    }
  }

  get activeVehicles() {
    return Array.from(this._intervals.keys());
  }
}

module.exports = new MockOBD2Stream(); // singleton
