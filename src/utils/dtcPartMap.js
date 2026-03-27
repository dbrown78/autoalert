/**
 * dtcPartMap.js
 * Maps OBD-II DTC codes to purchasable part names for the Find Parts feature.
 */

const DTC_PART_MAP = {
  // Oxygen / Air-Fuel Sensors
  P0030: 'oxygen sensor', P0031: 'oxygen sensor', P0032: 'oxygen sensor',
  P0036: 'oxygen sensor', P0037: 'oxygen sensor', P0038: 'oxygen sensor',
  P0050: 'oxygen sensor',
  P0130: 'upstream oxygen sensor', P0131: 'upstream oxygen sensor',
  P0132: 'upstream oxygen sensor', P0133: 'upstream oxygen sensor',
  P0134: 'upstream oxygen sensor', P0135: 'oxygen sensor heater',
  P0136: 'downstream oxygen sensor', P0137: 'downstream oxygen sensor',
  P0138: 'downstream oxygen sensor', P0139: 'downstream oxygen sensor',
  P0140: 'downstream oxygen sensor', P0141: 'oxygen sensor heater',
  P0150: 'oxygen sensor bank 2', P0155: 'oxygen sensor heater bank 2',
  P0156: 'downstream oxygen sensor bank 2', P0161: 'oxygen sensor heater bank 2',
  P2195: 'air fuel ratio sensor', P2196: 'air fuel ratio sensor',
  P2197: 'air fuel ratio sensor bank 2', P2198: 'air fuel ratio sensor bank 2',

  // Catalytic Converter
  P0420: 'catalytic converter', P0421: 'catalytic converter',
  P0422: 'catalytic converter', P0423: 'catalytic converter',
  P0424: 'catalytic converter', P0430: 'catalytic converter bank 2',
  P0431: 'catalytic converter bank 2', P0432: 'catalytic converter bank 2',
  P0433: 'catalytic converter bank 2', P0434: 'catalytic converter bank 2',

  // Mass Airflow Sensor
  P0100: 'mass air flow sensor', P0101: 'mass air flow sensor',
  P0102: 'mass air flow sensor', P0103: 'mass air flow sensor',
  P0104: 'mass air flow sensor',

  // MAP Sensor
  P0105: 'MAP sensor', P0106: 'MAP sensor', P0107: 'MAP sensor',
  P0108: 'MAP sensor', P0109: 'MAP sensor',

  // Throttle
  P0120: 'throttle position sensor', P0121: 'throttle position sensor',
  P0122: 'throttle position sensor', P0123: 'throttle position sensor',
  P0124: 'throttle position sensor', P0220: 'throttle position sensor',
  P0221: 'throttle position sensor', P0222: 'throttle position sensor',
  P0223: 'throttle position sensor', P0638: 'throttle body',
  P2100: 'throttle body', P2101: 'throttle body', P2110: 'throttle body',
  P2111: 'throttle body', P2112: 'throttle body',

  // Coolant Temp Sensor
  P0115: 'coolant temperature sensor', P0116: 'coolant temperature sensor',
  P0117: 'coolant temperature sensor', P0118: 'coolant temperature sensor',
  P0119: 'coolant temperature sensor',

  // Intake Air Temp
  P0110: 'intake air temperature sensor', P0111: 'intake air temperature sensor',
  P0112: 'intake air temperature sensor', P0113: 'intake air temperature sensor',
  P0114: 'intake air temperature sensor',

  // Crankshaft / Camshaft
  P0335: 'crankshaft position sensor', P0336: 'crankshaft position sensor',
  P0337: 'crankshaft position sensor', P0338: 'crankshaft position sensor',
  P0339: 'crankshaft position sensor',
  P0340: 'camshaft position sensor', P0341: 'camshaft position sensor',
  P0342: 'camshaft position sensor', P0343: 'camshaft position sensor',
  P0344: 'camshaft position sensor', P0345: 'camshaft position sensor bank 2',
  P0365: 'camshaft position sensor', P0366: 'camshaft position sensor',

  // VVT Solenoid
  P0010: 'VVT solenoid', P0011: 'VVT solenoid', P0012: 'VVT solenoid',
  P0013: 'VVT solenoid', P0014: 'VVT solenoid',
  P0020: 'VVT solenoid bank 2', P0021: 'VVT solenoid bank 2',
  P0022: 'VVT solenoid bank 2', P0023: 'VVT solenoid bank 2',
  P0024: 'VVT solenoid bank 2',

  // Ignition / Spark
  P0300: 'spark plugs and ignition coils',
  P0301: 'ignition coil spark plug cylinder 1',
  P0302: 'ignition coil spark plug cylinder 2',
  P0303: 'ignition coil spark plug cylinder 3',
  P0304: 'ignition coil spark plug cylinder 4',
  P0305: 'ignition coil spark plug cylinder 5',
  P0306: 'ignition coil spark plug cylinder 6',
  P0307: 'ignition coil spark plug cylinder 7',
  P0308: 'ignition coil spark plug cylinder 8',
  P0350: 'ignition coil', P0351: 'ignition coil cylinder 1',
  P0352: 'ignition coil cylinder 2', P0353: 'ignition coil cylinder 3',
  P0354: 'ignition coil cylinder 4', P0355: 'ignition coil cylinder 5',
  P0356: 'ignition coil cylinder 6',

  // Fuel System / Injectors
  P0087: 'fuel pump', P0088: 'fuel pressure regulator',
  P0089: 'fuel pressure regulator', P0090: 'fuel pressure regulator',
  P0171: 'fuel injector', P0172: 'fuel injector',
  P0173: 'fuel injector bank 2', P0174: 'fuel injector bank 2',
  P0175: 'fuel injector bank 2',
  P0200: 'fuel injector', P0201: 'fuel injector cylinder 1',
  P0202: 'fuel injector cylinder 2', P0203: 'fuel injector cylinder 3',
  P0204: 'fuel injector cylinder 4', P0205: 'fuel injector cylinder 5',
  P0206: 'fuel injector cylinder 6',

  // EVAP
  P0440: 'gas cap', P0441: 'evap purge valve', P0442: 'gas cap',
  P0443: 'evap purge valve', P0444: 'evap purge valve',
  P0445: 'evap purge valve', P0446: 'evap vent valve',
  P0447: 'evap vent valve', P0448: 'evap vent valve',
  P0449: 'evap vent valve', P0450: 'fuel tank pressure sensor',
  P0451: 'fuel tank pressure sensor', P0452: 'fuel tank pressure sensor',
  P0453: 'fuel tank pressure sensor', P0455: 'gas cap',
  P0456: 'gas cap', P0457: 'gas cap', P0458: 'evap purge solenoid',
  P0459: 'evap purge solenoid',

  // EGR
  P0400: 'EGR valve', P0401: 'EGR valve', P0402: 'EGR valve',
  P0403: 'EGR solenoid', P0404: 'EGR valve', P0405: 'EGR position sensor',
  P0406: 'EGR position sensor', P0407: 'EGR position sensor',
  P0408: 'EGR position sensor',

  // Transmission
  P0700: 'transmission control module', P0701: 'transmission control module',
  P0705: 'transmission range sensor', P0706: 'transmission range sensor',
  P0710: 'transmission fluid temperature sensor',
  P0715: 'transmission input speed sensor', P0720: 'transmission output speed sensor',
  P0730: 'transmission solenoid pack', P0740: 'torque converter clutch solenoid',
  P0741: 'torque converter clutch solenoid', P0750: 'shift solenoid',
  P0755: 'shift solenoid', P0760: 'shift solenoid', P0765: 'shift solenoid',

  // Charging
  P0560: 'car battery', P0562: 'alternator', P0563: 'alternator',
  P0620: 'alternator', P0621: 'alternator', P0622: 'alternator',

  // ABS
  C0031: 'wheel speed sensor', C0034: 'wheel speed sensor',
  C0035: 'wheel speed sensor', C0036: 'wheel speed sensor',
  C0037: 'wheel speed sensor', C0040: 'wheel speed sensor',
  C0041: 'ABS control module', C0110: 'ABS pump motor',
  C0121: 'ABS solenoid valve', C0265: 'ABS relay',

  // Steering / TPMS
  C0460: 'power steering pump', C0710: 'steering angle sensor',
  C0775: 'TPMS sensor', C0780: 'TPMS sensor', C0795: 'TPMS sensor',

  // Body / Electrical
  B0001: 'clock spring airbag', B0051: 'airbag module',
  B1000: 'body control module', B1317: 'car battery', B1318: 'car battery',
  B2960: 'ignition key transponder',
  U0001: 'CAN bus wiring harness', U0100: 'engine control module wiring',
  U0101: 'transmission control module wiring', U0121: 'ABS module wiring',
};

/**
 * Resolves the best purchasable part name for a DTC code.
 * Priority: map lookup → backend repairs[] → short_description fallback
 *
 * @param {string} dtcCode  - e.g. "P0171"
 * @param {object} detail   - DTC detail object from backend
 * @returns {string}
 */
export function resolvePartName(dtcCode, detail) {
  const code = (dtcCode ?? '').toUpperCase().trim();

  // 1. Map lookup — exact match
  if (code && DTC_PART_MAP[code]) {
    return DTC_PART_MAP[code];
  }

  // 2. Backend repairs[] — strip action verbs
  const repairs = detail?.repairs;
  if (Array.isArray(repairs) && repairs.length > 0) {
    const cleaned = repairs[0]
      .replace(/^(replace|inspect|check|clean|repair|rebuild|test|reseal|adjust|calibrate|reprogram|update|flush|recharge|install|remove)\s+/i, '')
      .trim();
    if (cleaned.length > 3) return cleaned;
  }

  // 3. short_description last resort
  if (!DTC_PART_MAP[code]) {
    console.warn(`[AutoAlert] No part map entry for "${code}" — add it to dtcPartMap.js`);
  }
  return detail?.short_description ?? code;
}

export default DTC_PART_MAP;
