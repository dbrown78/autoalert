/**
 * sensorThresholds.js
 * Shared sensor metadata, thresholds, and validation.
 * Imported by useDriveSafety and TelemetryScreen.
 */

export const SENSOR_META = {
  coolant_temp:      { label: 'COOLANT TEMP',       unit: '°C',  normalRange: [75,  95]   },
  rpm:               { label: 'ENGINE RPM',          unit: 'rpm', normalRange: [600, 3000] },
  voltage:           { label: 'BATTERY VOLTAGE',    unit: 'V',   normalRange: [12,  14.7] },
  o2_sensor:         { label: 'O2 SENSOR',          unit: 'V',   normalRange: [0.1, 0.9]  },
  fuel_trim:         { label: 'FUEL TRIM',          unit: '%',   normalRange: [-5,  5]    },
  engine_load:       { label: 'ENGINE LOAD',        unit: '%',   normalRange: [10,  70]   },
  // intake_temp matches OBD2Protocol INTAKE_TEMP PID (010F, IAT in °C)
  intake_temp:       { label: 'INTAKE TEMP',        unit: '°C',  normalRange: [20,  50]   },
  // Display-only sensors — polled but evaluated for safety
  speed:             { label: 'VEHICLE SPEED',      unit: 'km/h',normalRange: [0,   130]  },
  throttle:          { label: 'THROTTLE',           unit: '%',   normalRange: [0,   80]   },
  fuel_level:        { label: 'FUEL LEVEL',         unit: '%',   normalRange: [15,  100]  },
  // Transmission sensors (TCM module — ATSH7E1)
  trans_fluid_temp:  { label: 'TRANS FLUID TEMP',   unit: '°C',  normalRange: [60,  90]   },
  slip_rpm:          { label: 'SLIP RPM',           unit: 'rpm', normalRange: [0,   100]  },
  line_pressure:     { label: 'LINE PRESSURE',      unit: 'psi', normalRange: [60,  150]  },
  // ABS sensors (ABS module — ATSH760)
  // abs_active is event-based — evaluated separately, not via getSensorStatus
  brake_pressure:    { label: 'BRAKE PRESSURE',     unit: '%',   normalRange: [0,   70]   },
  // Derived virtual sensor — max(wheel speeds) − min(wheel speeds)
  wheel_speed_delta: { label: 'WHEEL SPEED DELTA',  unit: 'km/h',normalRange: [0,   3]    },
};

export const SENSOR_KEYS = Object.keys(SENSOR_META);

export const THRESHOLDS = {
  coolant_temp:      { warnHigh: 95,   critHigh: 105                              },
  rpm:               { warnHigh: 5500, critHigh: 6500                             },
  voltage:           { warnLow: 11.8,  critLow: 10.5                              },
  o2_sensor:         { warnHigh: 1.2,  critHigh: 1.5,  warnLow: 0.05, critLow: 0 },
  fuel_trim:         { warnHigh: 10,   critHigh: 20,   warnLow: -10,  critLow: -20 },
  engine_load:       { warnHigh: 80,   critHigh: 95                               },
  intake_temp:       { warnHigh: 55,   critHigh: 65                               },
  // speed: no safety alert — display only (would need context like road type)
  speed:             {},
  // throttle: no alert threshold — Foresight feature context only
  throttle:          {},
  // fuel_level: warn when low, no critHigh
  fuel_level:        { warnLow: 15,    critLow: 7                                 },
  // Transmission
  trans_fluid_temp:  { warnHigh: 93,   critHigh: 110                              },
  slip_rpm:          { warnHigh: 200,  critHigh: 500                              },
  line_pressure:     { warnLow: 50,    critLow: 35                                },
  // ABS
  brake_pressure:    { warnHigh: 80,   critHigh: 95                               },
  // Derived: inter-wheel speed spread — high delta indicates spin/skid
  wheel_speed_delta: { warnHigh: 5,    critHigh: 15                               },
};

const SENSOR_BOUNDS = {
  coolant_temp:      { min: -50, max: 150  },
  rpm:               { min: 0,   max: 10000},
  voltage:           { min: 5,   max: 20   },
  o2_sensor:         { min: 0,   max: 5    },
  fuel_trim:         { min: -50, max: 50   },
  engine_load:       { min: 0,   max: 100  },
  intake_temp:       { min: -50, max: 150  },
  speed:             { min: 0,   max: 400  },
  throttle:          { min: 0,   max: 100  },
  fuel_level:        { min: 0,   max: 100  },
  trans_fluid_temp:  { min: -30, max: 200  },
  slip_rpm:          { min: 0,   max: 2000 },
  line_pressure:     { min: 0,   max: 250  },
  brake_pressure:    { min: 0,   max: 100  },
  wheel_speed_delta: { min: 0,   max: 200  },
};

/**
 * Returns false for null, undefined, -999, NaN, or out-of-bounds values.
 */
export function isValidReading(key, value) {
  if (value == null || value === -999 || typeof value !== 'number' || isNaN(value)) return false;
  const bounds = SENSOR_BOUNDS[key];
  if (!bounds) return true;
  return value >= bounds.min && value <= bounds.max;
}

/**
 * Returns 'critical' | 'warn' | 'normal' | 'unknown'.
 */
export function getSensorStatus(key, value) {
  if (!isValidReading(key, value)) return 'unknown';
  const t = THRESHOLDS[key];
  if (!t) return 'unknown';
  if (t.critHigh != null && value >= t.critHigh) return 'critical';
  if (t.critLow  != null && value <= t.critLow)  return 'critical';
  if (t.warnHigh != null && value >= t.warnHigh) return 'warn';
  if (t.warnLow  != null && value <= t.warnLow)  return 'warn';
  return 'normal';
}

export function statusColor(status) {
  if (status === 'critical') return '#D0453A';
  if (status === 'warn')     return '#C08B30';
  if (status === 'normal')   return '#4CAF82';
  return '#777777';
}

/**
 * Returns a 0–1 fill ratio for sensor bar display.
 * Low-side sensors (voltage, fuel_level) fill from critLow → normalRange[1].
 * Bidirectional sensors (fuel_trim, o2_sensor) center-anchor at midpoint.
 * High-side sensors fill normalRange[0] → normalRange[1].
 */
export function barFillPct(key, value) {
  const meta = SENSOR_META[key];
  if (!meta || value == null) return 0;
  const [lo, hi] = meta.normalRange;
  const t = THRESHOLDS[key] ?? {};

  // Bidirectional: has both warnLow and warnHigh — center-anchor at midpoint
  if (t.warnLow != null && t.warnHigh != null) {
    const mid = (lo + hi) / 2;
    const halfRange = (hi - lo) / 2;
    return Math.max(0, Math.min(1, (value - mid) / halfRange * 0.5 + 0.5));
  }

  // Low-side only: fill from absolute floor up to hi
  if (t.warnLow != null && t.warnHigh == null) {
    const floor = t.critLow ?? 0;
    return Math.max(0, Math.min(1, (value - floor) / (hi - floor)));
  }

  // High-side only (default): fill from lo to hi
  return Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
}
