// OBD2 Protocol utilities for ELM327 BLE adapter

const PID_MAP = {
  ENGINE_RPM:        { pid: '010C', name: 'Engine RPM',        unit: 'rpm',  parse: d => ((d[2] * 256 + d[3]) / 4) },
  VEHICLE_SPEED:     { pid: '010D', name: 'Vehicle Speed',     unit: 'mph',  parse: d => d[2] * 0.621371 },
  COOLANT_TEMP:      { pid: '0105', name: 'Coolant Temp',      unit: '°F',   parse: d => (d[2] - 40) * 9/5 + 32 },
  ENGINE_LOAD:       { pid: '0104', name: 'Engine Load',       unit: '%',    parse: d => d[2] * 100 / 255 },
  THROTTLE_POS:      { pid: '0111', name: 'Throttle Position', unit: '%',    parse: d => d[2] * 100 / 255 },
  FUEL_LEVEL:        { pid: '012F', name: 'Fuel Level',        unit: '%',    parse: d => d[2] * 100 / 255 },
  INTAKE_AIR_TEMP:   { pid: '010F', name: 'Intake Air Temp',   unit: '°F',   parse: d => (d[2] - 40) * 9/5 + 32 },
  MAF_AIR_FLOW:      { pid: '0110', name: 'MAF Air Flow',      unit: 'g/s',  parse: d => (d[2] * 256 + d[3]) / 100 },
  O2_VOLTAGE:        { pid: '0114', name: 'O2 Sensor Voltage', unit: 'V',    parse: d => d[2] * 0.005 },
  BATTERY_VOLTAGE:   { pid: 'ATRV', name: 'Battery Voltage',   unit: 'V',    parse: null },
};

/**
 * Initialize ELM327 adapter with reset and protocol auto-detect
 */
export const initELM327 = async (sendCommand) => {
  try {
    await sendCommand('ATZ');    // Reset
    await sendCommand('ATE0');   // Echo off
    await sendCommand('ATL0');   // Linefeeds off
    await sendCommand('ATS0');   // Spaces off
    await sendCommand('ATSP0');  // Auto protocol
    return true;
  } catch (err) {
    console.error('[OBD2] Init failed:', err);
    return false;
  }
};

/**
 * Parse raw hex response bytes from ELM327
 */
const parseHexResponse = (response) => {
  if (!response || response.includes('NO DATA') || response.includes('ERROR')) return null;
  const clean = response.replace(/\s/g, '');
  const bytes = clean.match(/.{1,2}/g)?.map(b => parseInt(b, 16));
  return bytes || null;
};

/**
 * Poll a single PID and return parsed value
 */
export const pollPID = async (sendCommand, pidKey) => {
  const pidDef = PID_MAP[pidKey];
  if (!pidDef || !pidDef.parse) return null;

  try {
    const response = await sendCommand(pidDef.pid);
    const bytes = parseHexResponse(response);
    if (!bytes) return null;
    return {
      key: pidKey,
      name: pidDef.name,
      value: parseFloat(pidDef.parse(bytes).toFixed(2)),
      unit: pidDef.unit,
      timestamp: Date.now(),
    };
  } catch (err) {
    console.warn(`[OBD2] PID ${pidKey} failed:`, err);
    return null;
  }
};

/**
 * Poll all PIDs and return map of results
 */
export const pollAllPIDs = async (sendCommand, keys = Object.keys(PID_MAP)) => {
  const results = {};
  for (const key of keys) {
    if (key === 'BATTERY_VOLTAGE') continue;
    const result = await pollPID(sendCommand, key);
    if (result) results[key] = result;
  }
  return results;
};

/**
 * Get battery voltage via ATRV command
 */
export const getBatteryVoltage = async (sendCommand) => {
  try {
    const response = await sendCommand('ATRV');
    if (!response) return null;
    const voltage = parseFloat(response.replace(/[^0-9.]/g, ''));
    if (isNaN(voltage)) return null;
    return {
      key: 'BATTERY_VOLTAGE',
      name: 'Battery Voltage',
      value: voltage,
      unit: 'V',
      timestamp: Date.now(),
    };
  } catch (err) {
    console.warn('[OBD2] Battery voltage failed:', err);
    return null;
  }
};

export { PID_MAP };
