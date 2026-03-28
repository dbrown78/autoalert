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

  // Extended Mode 01 PIDs
  ENGINE_RUN_TIME:   { pid: '011F', name: 'Engine Run Time',    unit: 's',    parse: d => d[2] * 256 + d[3] },
  DISTANCE_MIL_ON:   { pid: '0121', name: 'Distance (MIL on)', unit: 'km',   parse: d => d[2] * 256 + d[3] },
  FUEL_RAIL_PRESS:   { pid: '0123', name: 'Fuel Rail Pressure', unit: 'kPa', parse: d => (d[2] * 256 + d[3]) * 10 },
  AMBIENT_AIR_TEMP:  { pid: '0146', name: 'Ambient Air Temp',  unit: '°F',   parse: d => (d[2] - 40) * 9/5 + 32 },
  FUEL_TYPE:         { pid: '0151', name: 'Fuel Type',          unit: '',     parse: d => d[2] },

  // Transmission / chassis (Mode 01 extended)
  TRANS_FLUID_TEMP:  { pid: '0188', name: 'Trans Fluid Temp',  unit: '°F',   parse: d => ((d[2] * 256 + d[3]) / 10 - 40) * 9/5 + 32 },
  TRANS_ACTUAL_GEAR: { pid: '01A4', name: 'Trans Actual Gear', unit: '',     parse: d => (d[4] & 0x0F) },
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

/**
 * Parse a DTC hex string (e.g. "4301" → "P0101") from Mode 03/07 response.
 */
function _parseDTCByte(high, low) {
  const prefixMap = { 0: 'P', 1: 'C', 2: 'B', 3: 'U' };
  const prefix = prefixMap[(high >> 6) & 0x03] ?? 'P';
  const digit1 = (high >> 4) & 0x03;
  const digit2 = high & 0x0F;
  const digit3 = (low >> 4) & 0x0F;
  const digit4 = low & 0x0F;
  return `${prefix}${digit1}${digit2.toString(16).toUpperCase()}${digit3.toString(16).toUpperCase()}${digit4.toString(16).toUpperCase()}`;
}

function _parseDTCResponse(response) {
  if (!response || response.includes('NO DATA') || response.includes('ERROR')) return [];
  const clean = response.replace(/\s/g, '');
  const bytes = clean.match(/.{1,2}/g)?.map(b => parseInt(b, 16));
  if (!bytes || bytes.length < 3) return [];
  // bytes[0] = mode byte (43 or 47), bytes[1] = count, then pairs
  const codes = [];
  for (let i = 2; i + 1 < bytes.length; i += 2) {
    if (bytes[i] === 0x00 && bytes[i + 1] === 0x00) continue;
    codes.push(_parseDTCByte(bytes[i], bytes[i + 1]));
  }
  return codes;
}

/**
 * Request stored DTCs (Mode 03).
 * @param {Function} sendCommand
 * @returns {Promise<string[]>} Array of DTC strings like ["P0217", "P0562"]
 */
export const requestDTCs = async (sendCommand) => {
  try {
    const response = await sendCommand('03');
    return _parseDTCResponse(response);
  } catch (err) {
    console.warn('[OBD2] Mode 03 failed:', err);
    return [];
  }
};

/**
 * Request pending DTCs (Mode 07).
 * @param {Function} sendCommand
 * @returns {Promise<string[]>}
 */
export const requestPendingDTCs = async (sendCommand) => {
  try {
    const response = await sendCommand('07');
    return _parseDTCResponse(response);
  } catch (err) {
    console.warn('[OBD2] Mode 07 failed:', err);
    return [];
  }
};

/**
 * Clear stored DTCs and reset MIL (Mode 04).
 * @param {Function} sendCommand
 * @returns {Promise<boolean>} true if acknowledged
 */
export const clearDTCs = async (sendCommand) => {
  try {
    const response = await sendCommand('04');
    return response != null && !response.includes('ERROR');
  } catch (err) {
    console.warn('[OBD2] Mode 04 (clear DTCs) failed:', err);
    return false;
  }
};

/**
 * Probe whether a given extended PID is supported by the ECU.
 * Returns the raw parsed bytes or null if unsupported.
 * @param {Function} sendCommand
 * @param {string} pid  e.g. '0188'
 * @returns {Promise<number[]|null>}
 */
export const probeExtendedPID = async (sendCommand, pid) => {
  try {
    const response = await sendCommand(pid);
    return parseHexResponse(response);
  } catch {
    return null;
  }
};

export { PID_MAP };
