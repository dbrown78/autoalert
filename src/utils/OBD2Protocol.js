// OBD2 Protocol utilities for ELM327 BLE adapter

// ---------------------------------------------------------------------------
// PID Map — Mode 01 standard + extended PIDs
// ---------------------------------------------------------------------------

const PID_MAP = {
  // ── Standard Mode 01 engine PIDs ─────────────────────────────────────────
  ENGINE_RPM:        { pid: '010C', name: 'Engine RPM',          unit: 'rpm',  parse: d => ((d[2] * 256 + d[3]) / 4) },
  VEHICLE_SPEED:     { pid: '010D', name: 'Vehicle Speed',       unit: 'mph',  parse: d => d[2] * 0.621371 },
  COOLANT_TEMP:      { pid: '0105', name: 'Coolant Temp',        unit: '°F',   parse: d => (d[2] - 40) * 9/5 + 32 },
  ENGINE_LOAD:       { pid: '0104', name: 'Engine Load',         unit: '%',    parse: d => d[2] * 100 / 255 },
  THROTTLE_POS:      { pid: '0111', name: 'Throttle Position',   unit: '%',    parse: d => d[2] * 100 / 255 },
  FUEL_LEVEL:        { pid: '012F', name: 'Fuel Level',          unit: '%',    parse: d => d[2] * 100 / 255 },
  INTAKE_AIR_TEMP:   { pid: '010F', name: 'Intake Air Temp',     unit: '°F',   parse: d => (d[2] - 40) * 9/5 + 32 },
  MAF_AIR_FLOW:      { pid: '0110', name: 'MAF Air Flow',        unit: 'g/s',  parse: d => (d[2] * 256 + d[3]) / 100 },
  O2_VOLTAGE:        { pid: '0114', name: 'O2 Sensor Voltage',   unit: 'V',    parse: d => d[2] * 0.005 },

  // ── Standard Mode 01 chassis/transmission PIDs ───────────────────────────
  ENGINE_RUN_TIME:   { pid: '011F', name: 'Engine Run Time',     unit: 's',    parse: d => d[2] * 256 + d[3] },
  DISTANCE_MIL_ON:   { pid: '0121', name: 'Distance MIL On',    unit: 'km',   parse: d => d[2] * 256 + d[3] },
  FUEL_RAIL_PRESS:   { pid: '0123', name: 'Fuel Rail Pressure',  unit: 'kPa',  parse: d => (d[2] * 256 + d[3]) * 10 },
  AMBIENT_AIR_TEMP:  { pid: '0146', name: 'Ambient Air Temp',    unit: '°C',   parse: d => d[2] - 40 },
  FUEL_TYPE:         { pid: '0151', name: 'Fuel Type',           unit: '',     parse: d => d[2] },

  // ── Extended PIDs (vehicle-dependent — not universally supported) ─────────
  // These use Mode 01 extended PID addressing; many vehicles respond via
  // generic OBD. Test with a PID support query before polling.
  TRANS_FLUID_TEMP:  {
    pid: '0188', name: 'Trans Fluid Temp', unit: '°C',
    parse: d => d[2] - 40,
    supported: false, // probe before polling: send '0188' and check for NO DATA
  },
  TRANS_ACTUAL_GEAR: {
    pid: '01A4', name: 'Trans Actual Gear', unit: '',
    parse: d => d[2],
    supported: false, // probe before polling: send '01A4' and check for NO DATA
  },

  // ── ELM327 proprietary (AT commands — not OBD2 PIDs) ─────────────────────
  BATTERY_VOLTAGE:   { pid: 'ATRV', name: 'Battery Voltage', unit: 'V', parse: null },
};

// ---------------------------------------------------------------------------
// ABS / Chassis — OBD2 limitation note
// ---------------------------------------------------------------------------
//
// SAE J1979 Mode 01 has NO ABS-specific PIDs. ABS wheel speed sensor data,
// brake pressure, and ABS active state are NOT accessible through standard
// OBD2 commands. To read ABS module data you must use:
//
//   • Manufacturer-specific Mode 22 (SAE J2190 / ISO 14229) — varies by brand
//     e.g.  Ford: AT SH 760, then 22 0145 (wheel speeds)
//           GM:   AT SH 5E0, then 22 1160 (ABS pressure)
//           BMW:  UDS 0x34 diagnostic session required
//
//   • Dedicated scan-tool protocols (e.g. J2534 pass-thru)
//
// The only standardized J1979 PIDs that relate to ABS indirectly:
//   0x46  Ambient Air Temp   — proxy for cold-brake behavior
//   0xC4  Brake switch state — available on some vehicles (Mode 01 extended)

// ---------------------------------------------------------------------------
// ELM327 init
// ---------------------------------------------------------------------------

/**
 * Initialize ELM327 adapter with reset and protocol auto-detect.
 * Returns { success, adapterVersion, errors }.
 */
export const initELM327 = async (sendCommand) => {
  const errors = [];
  let adapterVersion = null;

  const send = async (cmd) => {
    try {
      const resp = await sendCommand(cmd);
      return resp ?? '';
    } catch (err) {
      errors.push(`${cmd}: ${err.message ?? err}`);
      return '';
    }
  };

  const resetResp = await send('ATZ');
  if (resetResp) {
    // ELM327 vX.X appears in the ATZ response
    const m = resetResp.match(/ELM327\s+v?(\S+)/i);
    if (m) adapterVersion = `ELM327 v${m[1]}`;
  }

  await send('ATE0');   // Echo off
  await send('ATL0');   // Linefeeds off
  await send('ATS0');   // Spaces off
  await send('ATSP0');  // Auto protocol

  const success = errors.length === 0;
  return { success, adapterVersion, errors };
};

// ---------------------------------------------------------------------------
// PID polling
// ---------------------------------------------------------------------------

/**
 * Parse raw hex response bytes from ELM327.
 * Returns byte array or null on error/no data.
 */
const parseHexResponse = (response) => {
  if (!response || response.includes('NO DATA') || response.includes('ERROR')) return null;
  const clean = response.replace(/\s/g, '');
  const bytes = clean.match(/.{1,2}/g)?.map(b => parseInt(b, 16));
  return bytes || null;
};

/**
 * Poll a single PID and return parsed value.
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
 * Poll all PIDs and return array of results.
 * Skips PIDs with supported:false (extended PIDs require separate probing).
 */
export const pollAllPIDs = async (sendCommand, keys = Object.keys(PID_MAP)) => {
  const results = [];
  for (const key of keys) {
    if (key === 'BATTERY_VOLTAGE') continue;
    const def = PID_MAP[key];
    if (def?.supported === false) continue; // extended PID — probe separately
    const result = await pollPID(sendCommand, key);
    if (result) results.push(result);
  }
  return results;
};

/**
 * Probe an extended PID to check if the vehicle supports it.
 * If supported, marks PID_MAP entry as supported:true for future polling.
 */
export const probeExtendedPID = async (sendCommand, pidKey) => {
  const def = PID_MAP[pidKey];
  if (!def) return false;
  try {
    const resp = await sendCommand(def.pid);
    const supported = !(!resp || resp.includes('NO DATA') || resp.includes('ERROR'));
    def.supported = supported;
    return supported;
  } catch {
    return false;
  }
};

/**
 * Get battery voltage via ATRV command.
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

// ---------------------------------------------------------------------------
// Mode 03 / 07 — DTC read commands
// ---------------------------------------------------------------------------

/**
 * Decode two raw bytes from a DTC response into a code string.
 *
 * First byte bit layout (per SAE J1979):
 *   bits 7-6  = DTC type:  00=P  01=C  10=B  11=U
 *   bits 5-0  + second byte = 3-digit hex code number
 *
 * Examples:
 *   0x01, 0x43  →  P0143
 *   0x43, 0x01  →  P0301   (first nibble 0x4 = 0100 → type 01=C? no…)
 *
 * Correct bit math:
 *   type   = (byte1 >> 6) & 0x03        → index into ['P','C','B','U']
 *   digits = ((byte1 & 0x3F) << 8) | byte2  → 14-bit number, zero-padded to 4 hex chars
 */
const decodeDTCByte = (byte1, byte2) => {
  const types = ['P', 'C', 'B', 'U'];
  const type = types[(byte1 >> 6) & 0x03];
  const code = (((byte1 & 0x3F) << 8) | byte2).toString(16).padStart(4, '0').toUpperCase();
  return `${type}${code}`;
};

/**
 * Parse a raw ELM327 multi-line DTC response.
 *
 * ELM327 returns Mode 03 response like:
 *   43 01 43 00 00 00 00
 *   43 02 31 00 00 00 00
 *
 * Each line starts with the response header byte (43 for Mode 03, 47 for Mode 07).
 * The next byte is the DTC count on that line; the remaining bytes are DTC pairs.
 */
const parseDTCResponse = (raw, expectedHeader = '43') => {
  if (!raw) return [];
  const dtcs = [];
  const lines = raw.replace(/>/g, '').trim().split(/\r?\n/);

  for (const line of lines) {
    const hex = line.replace(/\s/g, '').toUpperCase();
    if (!hex.startsWith(expectedHeader.toUpperCase())) continue;

    // Skip the header byte; remaining bytes are DTC pairs
    const data = hex.slice(2);
    for (let i = 0; i + 3 < data.length; i += 4) {
      const b1 = parseInt(data.slice(i,     i + 2), 16);
      const b2 = parseInt(data.slice(i + 2, i + 4), 16);
      if (b1 === 0 && b2 === 0) continue; // padding / no DTC
      dtcs.push(decodeDTCByte(b1, b2));
    }
  }

  return dtcs;
};

/**
 * Request stored DTCs — OBD2 Mode 03.
 *
 * Sends `03` to the ELM327 adapter and returns a decoded array of DTC strings.
 * Example return: ['P0420', 'P0301', 'C0031']
 */
export const requestDTCs = async (sendCommand) => {
  try {
    const response = await sendCommand('03');
    return parseDTCResponse(response, '43');
  } catch (err) {
    console.warn('[OBD2] Mode 03 DTC read failed:', err);
    return [];
  }
};

/**
 * Request pending DTCs — OBD2 Mode 07.
 *
 * Pending DTCs are codes that have not yet triggered the MIL (check engine light)
 * but have been detected during the current or last drive cycle.
 * Response header is 47 instead of 43.
 */
export const requestPendingDTCs = async (sendCommand) => {
  try {
    const response = await sendCommand('07');
    return parseDTCResponse(response, '47');
  } catch (err) {
    console.warn('[OBD2] Mode 07 pending DTC read failed:', err);
    return [];
  }
};

/**
 * Clear stored DTCs — OBD2 Mode 04.
 *
 * Sends `04` to the adapter. On success the ECU returns `44`.
 * WARNING: This clears all stored DTCs and resets the MIL.
 * Returns true if the adapter acknowledged the clear.
 */
export const clearDTCs = async (sendCommand) => {
  try {
    const response = await sendCommand('04');
    if (!response) return false;
    const clean = response.replace(/\s/g, '').toUpperCase();
    return clean.includes('44');
  } catch (err) {
    console.warn('[OBD2] Mode 04 DTC clear failed:', err);
    return false;
  }
};

export { PID_MAP };
