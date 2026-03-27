import { useState, useEffect, useMemo } from 'react';
import client from '../api/client';
import useSensorStream from './useSensorStream';
import useBLEManager from './useBLEManager';
import { SENSOR_META, SENSOR_KEYS, getSensorStatus } from '../utils/sensorThresholds';

/**
 * useDriveSafety — unified Drive Safety hook.
 *
 * Merges three truth sources with explicit priority:
 *   1. Live sensor thresholds (highest priority)
 *      — engine sensors + ABS (wheel_speed_delta, brake_pressure, abs_active)
 *        + transmission (trans_fluid_temp, slip_rpm, line_pressure)
 *   2. Foresight ML alerts (probability > 0.80 or severity === 'critical')
 *   3. DTC-level drive_safety from active scans
 *   4. All clear (lowest priority)
 *
 * ABS / TCM module gating: useBLEManager does not expose probeABSModule() or
 * probeTCMModule(), so all new sensor keys are evaluated unconditionally.
 * hasABS / hasTCM are derived from whether sensor data for those modules has
 * been received (useful for DSI screen to know which cards to render).
 *
 * @param {number|null} vehicleId
 * @returns {{ status, reason, source, sensors, isLive, hasABS, hasTCM }}
 *   status:  'yes' | 'caution' | 'no' | null
 *   reason:  string | null
 *   source:  'sensor' | 'foresight' | 'dtc' | 'clear' | null
 *   sensors: Array<{ name, value, unit, status }>
 *   isLive:  boolean
 *   hasABS:  boolean — true when ABS module sensor data has been seen
 *   hasTCM:  boolean — true when TCM sensor data has been seen
 */
export default function useDriveSafety(vehicleId, { bleEnabled = false } = {}) {
  const { sensorData: streamSensors, isStreaming: streaming } = useSensorStream({ enabled: bleEnabled });
  const { bleState, sensors: bleSensors } = useBLEManager({ enabled: bleEnabled });
  const bleConnected = bleState === 'connected';

  const [foresightAlerts, setForesightAlerts] = useState([]);
  const [dtcScans, setDtcScans] = useState([]);

  // Merge BLE values over mock-stream values when BLE is connected
  const sensors = useMemo(() => {
    if (!bleConnected || !Object.keys(bleSensors).length) return streamSensors;
    const now = new Date().toISOString();
    const bleWrapped = Object.fromEntries(
      Object.entries(bleSensors).map(([k, v]) => [k, { value: v, recorded_at: now }])
    );
    return { ...streamSensors, ...bleWrapped };
  }, [bleConnected, bleSensors, streamSensors]);

  // Derive wheel_speed_delta from the four wheel speed PIDs and inject as a
  // virtual sensor so the evaluation loop can treat it like any other key.
  // Only valid when all four readings are present.
  const sensorsAugmented = useMemo(() => {
    const wfl = sensors.wheel_speed_fl?.value ?? null;
    const wfr = sensors.wheel_speed_fr?.value ?? null;
    const wrl = sensors.wheel_speed_rl?.value ?? null;
    const wrr = sensors.wheel_speed_rr?.value ?? null;
    const speeds = [wfl, wfr, wrl, wrr].filter(v => v !== null);
    const wheelSpeedDelta = speeds.length === 4
      ? Math.max(...speeds) - Math.min(...speeds)
      : null;
    if (wheelSpeedDelta === null) return sensors;
    const now = new Date().toISOString();
    return { ...sensors, wheel_speed_delta: { value: wheelSpeedDelta, recorded_at: now } };
  }, [sensors]);

  const isLive = bleConnected || streaming;

  // Module detection: derived from sensor data presence (no probe API available)
  const hasABS = useMemo(() => (
    bleSensors.wheel_speed_fl !== undefined ||
    bleSensors.abs_active     !== undefined ||
    bleSensors.brake_pressure !== undefined
  ), [bleSensors]);

  const hasTCM = useMemo(() => (
    bleSensors.trans_fluid_temp !== undefined ||
    bleSensors.slip_rpm         !== undefined ||
    bleSensors.line_pressure    !== undefined
  ), [bleSensors]);

  // Fetch foresight alerts for this vehicle
  useEffect(() => {
    if (!vehicleId) { setForesightAlerts([]); return; }
    let cancelled = false;
    client.get(`/foresight/${vehicleId}/alerts`)
      .then(({ data }) => { if (!cancelled) setForesightAlerts(data.alerts ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [vehicleId]);

  // Fetch active DTC scans (deduped by dtc_code, most recent per code)
  useEffect(() => {
    let cancelled = false;
    client.get('/scans')
      .then(({ data }) => {
        if (!cancelled) {
          const seen = new Set();
          const unique = (data.scans ?? []).filter(s => {
            if (seen.has(s.dtc_code)) return false;
            seen.add(s.dtc_code);
            return true;
          });
          setDtcScans(unique);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Sensors array for display consumers (e.g. TelemetryScreen grid).
  // SENSOR_KEYS now includes trans_fluid_temp, slip_rpm, line_pressure,
  // brake_pressure, and wheel_speed_delta via SENSOR_META additions.
  // sensorsAugmented is used so wheel_speed_delta (derived) has a value.
  const sensorsArray = useMemo(() =>
    SENSOR_KEYS.map(key => ({
      name:   key,
      value:  sensorsAugmented[key]?.value ?? null,
      unit:   SENSOR_META[key]?.unit ?? '',
      status: getSensorStatus(key, sensorsAugmented[key]?.value ?? null),
    }))
  , [sensorsAugmented]);

  // Unified drive safety computation
  const result = useMemo(() => {
    // ── Priority 1: Live sensor thresholds ───────────────────────────────────
    if (isLive && Object.keys(sensorsAugmented).length > 0) {
      let worstLevel = 0; // 0=normal, 1=warn, 2=critical
      let worstKey   = null;

      // Threshold-based evaluation: engine + ABS + TCM keys all live in SENSOR_KEYS
      for (const key of SENSOR_KEYS) {
        const value  = sensorsAugmented[key]?.value ?? null;
        const status = getSensorStatus(key, value);
        if (status === 'critical' && worstLevel < 2) { worstLevel = 2; worstKey = key; }
        else if (status === 'warn' && worstLevel < 1) { worstLevel = 1; worstKey = key; }
      }

      // ABS active: event-based flag, not a threshold PID.
      // Contributes 'warn' (caution) only — never escalates to 'critical' alone.
      const absActive = sensorsAugmented.abs_active?.value;
      const speed     = sensorsAugmented.speed?.value ?? 0;
      if (absActive === true && speed > 5 && worstLevel < 1) {
        worstLevel = 1;
        worstKey   = '__abs_active__';
      }

      if (worstLevel === 2) {
        const meta = SENSOR_META[worstKey];
        const val  = Number(sensorsAugmented[worstKey].value).toFixed(1);
        return {
          status: 'no',
          reason: `${meta?.label ?? worstKey} is critical (${val}${meta?.unit ?? ''}) — stop driving immediately`,
          source: 'sensor',
        };
      }
      if (worstLevel === 1) {
        if (worstKey === '__abs_active__') {
          return {
            status: 'caution',
            reason: 'ABS actively engaging — slippery surface detected',
            source: 'sensor',
          };
        }
        const meta = SENSOR_META[worstKey];
        const val  = Number(sensorsAugmented[worstKey].value).toFixed(1);
        return {
          status: 'caution',
          reason: `${meta?.label ?? worstKey} outside normal range (${val}${meta?.unit ?? ''})`,
          source: 'sensor',
        };
      }
    }

    // ── Priority 2: Foresight ML alerts ─────────────────────────────────────
    const criticalAlert = foresightAlerts.find(
      a => (a.probability ?? 0) > 0.80 || a.severity === 'critical'
    );
    if (criticalAlert) {
      return {
        status: 'no',
        reason: `ML: ${criticalAlert.label ?? criticalAlert.sensor} — imminent failure predicted`,
        source: 'foresight',
      };
    }
    const warnAlert = foresightAlerts.find(
      a => (a.probability ?? 0) > 0.50 || a.severity === 'high'
    );
    if (warnAlert) {
      return {
        status: 'caution',
        reason: `ML: ${warnAlert.label ?? warnAlert.sensor} — elevated failure risk`,
        source: 'foresight',
      };
    }

    // ── Priority 3: DTC-level drive_safety ──────────────────────────────────
    if (dtcScans.length > 0) {
      const PRIORITY = { no: 3, caution: 2, yes: 1 };
      let worst = null;
      let worstPriority = 0;
      for (const s of dtcScans) {
        const p = PRIORITY[s.drive_safety] ?? 0;
        if (p > worstPriority) { worstPriority = p; worst = s; }
      }
      if (worst?.drive_safety) {
        return {
          status: worst.drive_safety,
          reason: worst.drive_safety_reason ?? `${worst.dtc_code}: active fault code`,
          source: 'dtc',
        };
      }
    }

    // ── Priority 4: All clear ────────────────────────────────────────────────
    if (isLive) {
      return { status: 'yes', reason: 'All sensors within normal operating range', source: 'clear' };
    }

    return null;
  }, [sensorsAugmented, isLive, foresightAlerts, dtcScans]);

  return {
    status:  result?.status  ?? null,
    reason:  result?.reason  ?? null,
    source:  result?.source  ?? null,
    sensors: sensorsArray,
    isLive,
    hasABS,
    hasTCM,
  };
}
