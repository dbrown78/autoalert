import { useState, useEffect, useRef, useCallback } from 'react';
import { BleManager, State } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import { Buffer } from 'buffer';

// ---------------------------------------------------------------------------
// ELM327 BLE UUIDs
// ---------------------------------------------------------------------------
// These are standard for most OBD2 BLE adapters (Vgate iCar, OBDLink CX, etc.)
// Some adapters use 18F0/18F1 or FFE0/FFE1 instead — check adapter docs if
// scanning succeeds but connect/notify fails.
const OBD_SERVICE_UUID         = 'FFF0';
const OBD_WRITE_CHARACTERISTIC = 'FFF2';
const OBD_NOTIFY_CHARACTERISTIC = 'FFF1';

// ---------------------------------------------------------------------------
// ELM327 init sequence
// ---------------------------------------------------------------------------
const INIT_COMMANDS = [
  'ATZ\r',   // reset
  'ATE0\r',  // echo off
  'ATL0\r',  // linefeed off
  'ATS0\r',  // spaces off
  'ATH0\r',  // headers off
  'ATSP0\r', // auto protocol
];

// ---------------------------------------------------------------------------
// DTC decode helpers (Mode 03 / 07 / 04)
// ---------------------------------------------------------------------------
const decodeDTCByte = (byte1, byte2) => {
  const types = ['P', 'C', 'B', 'U'];
  const type = types[(byte1 & 0xC0) >> 6];
  const code = ((byte1 & 0x3F) << 8 | byte2).toString(16).padStart(4, '0').toUpperCase();
  return `${type}${code}`;
};

const parseDTCResponse = (rawResponse, expectedHeader) => {
  const dtcs = [];
  const hex = rawResponse.replace(/\s/g, '').replace('>', '').toUpperCase();
  const header = expectedHeader.toUpperCase();
  const idx = hex.indexOf(header);
  if (idx === -1) return dtcs;
  const dataHex = hex.slice(idx + header.length);
  for (let i = 0; i + 3 < dataHex.length; i += 4) {
    const b1 = parseInt(dataHex.substring(i, i + 2), 16);
    const b2 = parseInt(dataHex.substring(i + 2, i + 4), 16);
    if (b1 === 0 && b2 === 0) continue; // padding
    dtcs.push(decodeDTCByte(b1, b2));
  }
  return dtcs;
};

// ---------------------------------------------------------------------------
// SAE J1979 Mode 01 PID map
// ---------------------------------------------------------------------------
const PID_MAP = {
  '010C': { name: 'rpm',              decode: (d) => (d[0] * 256 + d[1]) / 4 },
  '010D': { name: 'speed',            decode: (d) => d[0] },
  '0105': { name: 'coolant_temp',     decode: (d) => d[0] - 40 },
  '0111': { name: 'throttle',         decode: (d) => Math.round(d[0] * 100 / 255) },
  '0104': { name: 'engine_load',      decode: (d) => Math.round(d[0] * 100 / 255) },
  '0142': { name: 'voltage',          decode: (d) => (d[0] * 256 + d[1]) / 1000 },
  '010F': { name: 'intake_temp',      decode: (d) => d[0] - 40 },
  '0106': { name: 'fuel_trim',        decode: (d) => ((d[0] - 128) * 100 / 128) },
  '0188': { name: 'trans_fluid_temp', decode: (d) => d[0] - 40 },
  '01A4': { name: 'trans_gear',       decode: (d) => d[0] & 0x0F },
  '0146': { name: 'ambient_temp',     decode: (d) => d[0] - 40 },
  '0151': { name: 'fuel_type',        decode: (d) => d[0] },
  '0123': { name: 'fuel_rail_pressure', decode: (d) => (256 * d[0] + d[1]) * 10 },
};

const PID_LIST = Object.keys(PID_MAP);

// Singleton — avoids re-creating the BleManager on every render
const manager = new BleManager();

// ---------------------------------------------------------------------------
// useBLEManager
// ---------------------------------------------------------------------------
// Interface matches the existing TelemetryScreen contract:
//   bleState   — 'connected' | 'disconnected' | 'unavailable'
//   sensors    — flat { [name]: value } object (same shape as stub)
//   isSupported — true when the platform supports BLE
//
// Additional properties exposed for the new scan/connect UI:
//   isScanning, nearbyDevices, isConnecting, error
//   startScan, stopScan, connectToDevice, disconnect
// ---------------------------------------------------------------------------
export default function useBLEManager({ enabled = false } = {}) {
  const [hwState, setHwState]           = useState(State.Unknown);
  const [isScanning, setIsScanning]     = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected]   = useState(false);
  const [sensors, setSensors]           = useState({});
  const [error, setError]               = useState(null);
  const [nearbyDevices, setNearbyDevices] = useState([]);
  const [dtcCodes, setDtcCodes]           = useState([]);
  const [pendingDtcCodes, setPendingDtcCodes] = useState([]);

  const deviceRef           = useRef(null);
  const writeCharRef        = useRef(null);
  const notifySubRef        = useRef(null);
  const pollIntervalRef     = useRef(null);
  const responseBufferRef   = useRef('');
  const pidIndexRef         = useRef(0);
  const pendingResolverRef  = useRef(null); // one-shot command resolver

  // ── Hardware state monitor ────────────────────────────────────────────────
  useEffect(() => {
    const sub = manager.onStateChange((state) => setHwState(state), true);
    return () => sub.remove();
  }, []);

  // ── Derived values ────────────────────────────────────────────────────────
  // Map to the string-enum interface TelemetryScreen already uses
  const bleState = isConnected ? 'connected'
    : hwState === State.PoweredOff || hwState === State.Unsupported ? 'unavailable'
    : 'disconnected';

  const isSupported = hwState !== State.Unsupported;

  // ── Android permissions ───────────────────────────────────────────────────
  const requestPermissions = useCallback(async () => {
    if (Platform.OS !== 'android') return true;
    const granted = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);
    return Object.values(granted).every(
      (v) => v === PermissionsAndroid.RESULTS.GRANTED
    );
  }, []);

  // ── Scan ─────────────────────────────────────────────────────────────────
  const startScan = useCallback(async () => {
    const ok = await requestPermissions();
    if (!ok) { setError('Bluetooth permission denied'); return; }
    if (hwState !== State.PoweredOn) { setError('Bluetooth is off'); return; }

    setNearbyDevices([]);
    setIsScanning(true);
    setError(null);

    manager.startDeviceScan(null, { allowDuplicates: false }, (err, found) => {
      if (err) { setError(err.message); setIsScanning(false); return; }
      if (found?.name) {
        setNearbyDevices((prev) => {
          if (prev.find((d) => d.id === found.id)) return prev;
          return [...prev, { id: found.id, name: found.name, rssi: found.rssi }];
        });
      }
    });

    // Auto-stop after 10 s
    setTimeout(() => { manager.stopDeviceScan(); setIsScanning(false); }, 10000);
  }, [hwState, requestPermissions]);

  const stopScan = useCallback(() => {
    manager.stopDeviceScan();
    setIsScanning(false);
  }, []);

  // ── ELM327 response parser ────────────────────────────────────────────────
  const parseResponse = useCallback((raw, pid) => {
    try {
      const hex = raw.replace(/\s/g, '').replace('>', '');
      if (hex.startsWith('41')) {
        const dataHex = hex.slice(4); // skip '41' + echoed PID byte
        const bytes = (dataHex.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16));
        return PID_MAP[pid]?.decode(bytes) ?? null;
      }
    } catch {
      // ignore malformed frames
    }
    return null;
  }, []);

  // ── Low-level write ───────────────────────────────────────────────────────
  const sendCommand = useCallback(async (command) => {
    if (!writeCharRef.current) return;
    const encoded = Buffer.from(command, 'ascii').toString('base64');
    await writeCharRef.current.writeWithResponse(encoded);
  }, []);

  // ── One-shot command (sends + waits for '>' terminated response) ─────────
  const sendCommandAndWait = useCallback((command, timeoutMs = 3000) => {
    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => {
        pendingResolverRef.current = null;
        reject(new Error(`Command timeout: ${command.trim()}`));
      }, timeoutMs);
      pendingResolverRef.current = (raw) => {
        clearTimeout(timer);
        resolve(raw);
      };
      try {
        await sendCommand(command);
      } catch (e) {
        clearTimeout(timer);
        pendingResolverRef.current = null;
        reject(e);
      }
    });
  }, [sendCommand]);

  // ── Polling loop ──────────────────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    pidIndexRef.current = 0;
    pollIntervalRef.current = setInterval(async () => {
      const pid = PID_LIST[pidIndexRef.current % PID_LIST.length];
      pidIndexRef.current++;
      await sendCommand(pid + '\r');
    }, 500);
  }, [sendCommand]);

  // ── Connect ───────────────────────────────────────────────────────────────
  const connectToDevice = useCallback(async (deviceId) => {
    try {
      stopScan();
      setIsConnecting(true);
      setError(null);

      const connected = await manager.connectToDevice(deviceId);
      await connected.discoverAllServicesAndCharacteristics();

      deviceRef.current = connected;

      // Resolve write + notify characteristics
      const services = await connected.services();
      for (const svc of services) {
        const chars = await svc.characteristics();
        for (const char of chars) {
          const uuid = char.uuid.toUpperCase().replace(/-/g, '');
          if (uuid.includes(OBD_WRITE_CHARACTERISTIC))  writeCharRef.current = char;
          if (uuid.includes(OBD_NOTIFY_CHARACTERISTIC)) {
            // Subscribe to incoming frames
            notifySubRef.current = char.monitor((err, c) => {
              if (err || !c?.value) return;
              const decoded = Buffer.from(c.value, 'base64').toString('ascii');
              responseBufferRef.current += decoded;

              // ELM327 terminates each response with '>'
              if (responseBufferRef.current.includes('>')) {
                const raw = responseBufferRef.current;
                responseBufferRef.current = '';
                // If a one-shot command is waiting, resolve it instead of polling
                if (pendingResolverRef.current) {
                  const resolve = pendingResolverRef.current;
                  pendingResolverRef.current = null;
                  resolve(raw);
                  return;
                }
                const currentPid =
                  PID_LIST[(pidIndexRef.current - 1) % PID_LIST.length];
                const value = parseResponse(raw, currentPid);
                if (value !== null) {
                  const sensorName = PID_MAP[currentPid].name;
                  setSensors((prev) => ({ ...prev, [sensorName]: value }));
                }
              }
            });
          }
        }
      }

      // Disconnect handler
      connected.onDisconnected(() => {
        stopPolling();
        notifySubRef.current?.remove();
        notifySubRef.current = null;
        writeCharRef.current = null;
        deviceRef.current = null;
        setIsConnected(false);
        setSensors({});
      });

      // ELM327 boot sequence
      for (const cmd of INIT_COMMANDS) {
        await sendCommand(cmd);
        await new Promise((r) => setTimeout(r, 200));
      }

      setIsConnected(true);

      // Fetch stored + pending DTCs before starting the polling loop
      try {
        const raw03 = await sendCommandAndWait('03\r', 3000);
        setDtcCodes(parseDTCResponse(raw03, '43'));
      } catch (e) { console.warn('[BLE] init DTC read:', e.message); }

      try {
        const raw07 = await sendCommandAndWait('07\r', 3000);
        setPendingDtcCodes(parseDTCResponse(raw07, '47'));
      } catch (e) { console.warn('[BLE] init pending DTC read:', e.message); }

      startPolling();
    } catch (err) {
      setError(err.message);
      setIsConnected(false);
    } finally {
      setIsConnecting(false);
    }
  }, [stopScan, parseResponse, sendCommand, sendCommandAndWait, startPolling, stopPolling]);

  // ── Disconnect ────────────────────────────────────────────────────────────
  const disconnect = useCallback(async () => {
    stopPolling();
    notifySubRef.current?.remove();
    notifySubRef.current = null;
    writeCharRef.current = null;
    await deviceRef.current?.cancelConnection().catch(() => {});
    deviceRef.current = null;
    setIsConnected(false);
    setSensors({});
  }, [stopPolling]);

  // ── DTC commands ──────────────────────────────────────────────────────────
  const requestDTCs = useCallback(async () => {
    try {
      stopPolling();
      const raw = await sendCommandAndWait('03\r', 3000);
      const codes = parseDTCResponse(raw, '43');
      setDtcCodes(codes);
      startPolling();
      return codes;
    } catch (e) {
      console.warn('[BLE] requestDTCs error:', e);
      startPolling();
      return [];
    }
  }, [sendCommandAndWait, stopPolling, startPolling]);

  const requestPendingDTCs = useCallback(async () => {
    try {
      stopPolling();
      const raw = await sendCommandAndWait('07\r', 3000);
      const codes = parseDTCResponse(raw, '47');
      setPendingDtcCodes(codes);
      startPolling();
      return codes;
    } catch (e) {
      console.warn('[BLE] requestPendingDTCs error:', e);
      startPolling();
      return [];
    }
  }, [sendCommandAndWait, stopPolling, startPolling]);

  const clearDTCs = useCallback(async () => {
    try {
      stopPolling();
      await sendCommandAndWait('04\r', 3000);
      setDtcCodes([]);
      setPendingDtcCodes([]);
      startPolling();
    } catch (e) {
      console.warn('[BLE] clearDTCs error:', e);
      startPolling();
    }
  }, [sendCommandAndWait, stopPolling, startPolling]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopPolling();
      notifySubRef.current?.remove();
      manager.destroy();
    };
  }, [stopPolling]);

  return {
    // ── Legacy interface (TelemetryScreen) ──
    bleState,
    sensors,
    isSupported,
    connectedDevice: deviceRef.current,

    // ── Scan / connect UI ──
    isScanning,
    isConnecting,
    isConnected,
    nearbyDevices,
    error,

    // ── Actions ──
    startScan,
    stopScan,
    connectToDevice,
    disconnect,

    // ── DTC commands ──
    dtcCodes,
    pendingDtcCodes,
    requestDTCs,
    requestPendingDTCs,
    clearDTCs,

    // ── Compat stubs (other hooks may call these) ──
    syncing: false,
    connecting: isConnecting,
    connectionError: error,
    lastDTC: null,
    devices: nearbyDevices,
    sendCommand,
    readSensorData: async () => null,
    requestManualScan: startScan,
    clearLastDTC: () => {},
  };
}
