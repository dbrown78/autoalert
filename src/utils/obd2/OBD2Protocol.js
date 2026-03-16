/**
 * OBD2Protocol.js
 *
 * ELM327 AT command initialization and SAE J1979 PID polling utilities.
 *
 * This module is pure JS — it takes a `sendCommand(cmd): Promise<string>`
 * callback that routes commands over whatever transport is available
 * (BLE GATT write → ELM327 UART). All parsing and protocol logic lives here.
 *
 * Usage (after BLE connect):
 *   const { initELM327, pollAllPIDs, getBatteryVoltage } = OBD2Protocol;
 *   await initELM327(sendCommand);
 *   const readings = await pollAllPIDs(sendCommand);
 */

// ---------------------------------------------------------------------------
// AT init sequence
// ---------------------------------------------------------------------------

const AT_INIT_SEQUENCE = [
  { cmd: 'ATZ',   expect: 'ELM327', desc: 'Reset',                   timeout: 3000 },
  { cmd: 'ATE0',  expect: 'OK',     desc: 'Echo off'                              },
  { cmd: 'ATL0',  expect: 'OK',     desc: 'Linefeeds off'                         },
  { cmd: 'ATH0',  expect: 'OK',     desc: 'Headers off'                           },
  { cmd: 'ATS0',  expect: 'OK',     desc: 'Spaces off'                            },
  // ATSP0 triggers CAN/ISO protocol negotiation — K-Line buses can take 3–5s.
  // 5s timeout prevents initELM327 from continuing mid-negotiation.
  { cmd: 'ATSP0', expect: 'OK',     desc: 'Auto-detect protocol',    timeout: 5000 },
  { cmd: 'ATI',   expect: 'ELM327', desc: 'Identify adapter version'              },
];

const CMD_TIMEOUT_MS = 2000;

// ---------------------------------------------------------------------------
// PID definitions (SAE J1979 Mode 01)
// ---------------------------------------------------------------------------

export const PIDS = {
  RPM: {
    cmd:    '010C',
    name:   'rpm',
    label:  'Engine RPM',
    unit:   'rpm',
    parse:  (bytes) => ((bytes[0] * 256) + bytes[1]) / 4,
  },
  SPEED: {
    cmd:    '010D',
    name:   'speed',
    label:  'Vehicle Speed',
    unit:   'km/h',
    parse:  (bytes) => bytes[0],
  },
  COOLANT_TEMP: {
    cmd:    '0105',
    name:   'coolant_temp',
    label:  'Coolant Temperature',
    unit:   '°C',
    parse:  (bytes) => bytes[0] - 40,
  },
  THROTTLE: {
    cmd:    '0111',
    name:   'throttle',
    label:  'Throttle Position',
    unit:   '%',
    parse:  (bytes) => (bytes[0] * 100) / 255,
  },
  FUEL_LEVEL: {
    cmd:    '012F',
    name:   'fuel_level',
    label:  'Fuel Level',
    unit:   '%',
    parse:  (bytes) => (bytes[0] * 100) / 255,
  },
  ENGINE_LOAD: {
    cmd:    '0104',
    name:   'engine_load',
    label:  'Engine Load',
    unit:   '%',
    parse:  (bytes) => (bytes[0] * 100) / 255,
  },
  // IAT — Intake Air Temperature (PID 010F). Distinct from MAP/intake pressure.
  INTAKE_TEMP: {
    cmd:    '010F',
    name:   'intake_temp',
    label:  'Intake Air Temp',
    unit:   '°C',
    parse:  (bytes) => bytes[0] - 40,
  },
  // MAP — kept as a separate named entry; not in sensorThresholds (display only)
  INTAKE_PRESSURE: {
    cmd:    '010B',
    name:   'intake_pressure',
    label:  'Intake Manifold Pressure',
    unit:   'kPa',
    parse:  (bytes) => bytes[0],
  },
  // O2 sensor bank 1, sensor 1 (PID 0114). Voltage 0–1.275V.
  O2_SENSOR: {
    cmd:    '0114',
    name:   'o2_sensor',
    label:  'O2 Sensor',
    unit:   'V',
    parse:  (bytes) => bytes[1] / 200,
  },
  // Short-term fuel trim (PID 0106). Signed: 0x80 = 0%, 0x00 = -100%, 0xFF = +99.2%.
  FUEL_TRIM: {
    cmd:    '0106',
    name:   'fuel_trim',
    label:  'Fuel Trim (Short)',
    unit:   '%',
    parse:  (bytes) => (bytes[0] / 128 - 1) * 100,
  },
};

// ---------------------------------------------------------------------------
// Module headers for multi-ECU reads (ABS, TCM)
// Switch with ATSH before issuing DTC or PID commands to those modules.
// Always restore ENGINE_HEADER after enhanced reads.
// ---------------------------------------------------------------------------

export const MODULE_HEADERS = {
  ENGINE:       'ATSH7E0', // PCM / Engine Control Module (default)
  TRANSMISSION: 'ATSH7E1', // TCM / Transmission Control Module
  ABS:          'ATSH760', // ABS / EBCM — most common CAN address
  // OEM alternates: GM uses ATSH028, Ford uses ATSH726.
  // If ABS reads return NO DATA, try probing alternates via probeABSModule().
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip whitespace, 'SEARCHING...', and prompt characters from ELM327 response.
 */
function cleanResponse(raw) {
  return raw
    .replace(/\s+/g, '')
    .replace(/SEARCHING\.\.\./g, '')
    .replace(/>/g, '')
    .toUpperCase()
    .trim();
}

/**
 * Extract the data bytes from a Mode 01 PID response.
 * E.g. "410C1A2B" → bytes after the echo bytes [0x41, 0x0C] → [0x1A, 0x2B]
 */
function extractDataBytes(cleaned, expectedEchoPrefix) {
  // Response format: 41 <PID_byte> <data bytes...>
  // expectedEchoPrefix = '41' + PID_byte (e.g. '410C')
  const prefix = expectedEchoPrefix.replace(/\s/g, '').toUpperCase();
  if (!cleaned.startsWith(prefix)) return null;
  const dataPart = cleaned.slice(prefix.length);
  if (dataPart.length % 2 !== 0 || dataPart.length === 0) return null;
  const bytes = [];
  for (let i = 0; i < dataPart.length; i += 2) {
    const byte = parseInt(dataPart.slice(i, i + 2), 16);
    if (isNaN(byte)) return null;
    bytes.push(byte);
  }
  return bytes;
}

/**
 * Send a command with a timeout, return cleaned response string.
 * Throws with error.type = 'timeout' | 'error' on failure.
 */
async function sendWithTimeout(sendCommand, cmd, timeoutMs = CMD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`Timeout waiting for response to ${cmd}`);
      err.type = 'timeout';
      reject(err);
    }, timeoutMs);

    sendCommand(cmd)
      .then(raw => {
        clearTimeout(timer);
        resolve(cleanResponse(raw));
      })
      .catch(err => {
        clearTimeout(timer);
        err.type = err.type ?? 'error';
        reject(err);
      });
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the ELM327 AT initialization sequence.
 *
 * @param {(cmd: string) => Promise<string>} sendCommand
 * @returns {Promise<{ success: boolean, adapterVersion: string | null, errors: string[] }>}
 */
export async function initELM327(sendCommand) {
  const errors = [];
  let adapterVersion = null;

  for (const step of AT_INIT_SEQUENCE) {
    try {
      // Per-step timeout — ATZ and ATSP0 need more than the default 2s
      const timeout = step.timeout ?? CMD_TIMEOUT_MS;
      const response = await sendWithTimeout(sendCommand, step.cmd, timeout);

      if (!response.includes(step.expect)) {
        errors.push(`${step.cmd} unexpected response: ${response}`);
      }
      if (step.cmd === 'ATI' || step.cmd === 'ATZ') {
        adapterVersion = response;
      }
    } catch (err) {
      errors.push(`${step.cmd} (${step.desc}): ${err.message}`);
      // ATZ, ATE0 failures are fatal — abort init
      if (step.cmd === 'ATZ' || step.cmd === 'ATE0') {
        return { success: false, adapterVersion, errors };
      }
    }
  }

  return { success: errors.length === 0, adapterVersion, errors };
}

/**
 * Parse a raw ELM327 PID response string.
 *
 * @param {object} pidDef  - One of the PIDS entries
 * @param {string} rawResponse
 * @returns {{ pid, name, value, unit, raw, error } | { pid, name, value: null, unit, error }}
 */
export function parsePIDResponse(pidDef, rawResponse) {
  const base = { pid: pidDef.cmd, name: pidDef.name, unit: pidDef.unit, raw: rawResponse };
  try {
    const cleaned = cleanResponse(rawResponse);

    if (cleaned.includes('NODATA') || cleaned.includes('ERROR') || cleaned.includes('UNABLE')) {
      return { ...base, value: null, error: 'no_data' };
    }

    // Expected echo prefix: '41' + mode1 byte from cmd (e.g. '010C' → echo '410C')
    const echoPrefix = '41' + pidDef.cmd.slice(2); // '01XX' → '41XX'
    const bytes = extractDataBytes(cleaned, echoPrefix);
    if (!bytes) return { ...base, value: null, error: 'parse_error' };

    const value = pidDef.parse(bytes);
    if (typeof value !== 'number' || isNaN(value)) {
      return { ...base, value: null, error: 'parse_error' };
    }

    return { ...base, value: Math.round(value * 10) / 10, error: null };
  } catch {
    return { ...base, value: null, error: 'parse_error' };
  }
}

/**
 * Poll a single PID.
 *
 * @param {(cmd: string) => Promise<string>} sendCommand
 * @param {object} pidDef  - One of the PIDS entries
 */
export async function pollPID(sendCommand, pidDef) {
  try {
    const raw = await sendWithTimeout(sendCommand, pidDef.cmd);
    return parsePIDResponse(pidDef, raw);
  } catch (err) {
    return {
      pid:   pidDef.cmd,
      name:  pidDef.name,
      value: null,
      unit:  pidDef.unit,
      raw:   null,
      error: err.type ?? 'error',
    };
  }
}

/**
 * Poll all defined PIDs sequentially and return results array.
 * Sequential (not Promise.all) — ELM327 operates over a serial UART bridge;
 * concurrent sends can cause response bytes to interleave and corrupt parses.
 * Errors on individual PIDs are non-fatal — that entry gets value: null.
 *
 * @param {(cmd: string) => Promise<string>} sendCommand
 * @returns {Promise<Array<{ pid, name, value, unit, raw, error }>>}
 */
export async function pollAllPIDs(sendCommand) {
  const results = [];
  for (const def of Object.values(PIDS)) {
    results.push(await pollPID(sendCommand, def));
  }
  return results;
}

/**
 * Read battery voltage via ATRV command.
 * Response format: "12.4V" or "12.4"
 *
 * @param {(cmd: string) => Promise<string>} sendCommand
 * @returns {Promise<{ value: number | null, unit: 'V', error: string | null }>}
 */
export async function getBatteryVoltage(sendCommand) {
  try {
    const raw = await sendWithTimeout(sendCommand, 'ATRV');
    const cleaned = raw.replace(/\s/g, '').toUpperCase().replace('V', '');
    const value = parseFloat(cleaned);
    if (isNaN(value) || value < 5 || value > 20) {
      return { value: null, unit: 'V', error: 'parse_error' };
    }
    return { value: Math.round(value * 10) / 10, unit: 'V', error: null };
  } catch (err) {
    return { value: null, unit: 'V', error: err.type ?? 'error' };
  }
}
