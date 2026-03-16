import { useEffect, useRef, useState, useCallback } from 'react';
import { NativeModules, NativeEventEmitter, Platform, AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import client from '../api/client';
import { initELM327, pollAllPIDs, getBatteryVoltage } from '../utils/OBD2Protocol';

const { BLEManagerModule } = NativeModules;

const isSupported = Platform.OS === 'ios' && !!BLEManagerModule;
const emitter = isSupported ? new NativeEventEmitter(BLEManagerModule) : null;

const SECURE_STORE_KEY    = 'odin_last_ble_device';
const SCAN_TIMEOUT_MS     = 15000;
const CONNECT_TIMEOUT_MS  = 10000;
const MAX_RECONNECT_TRIES = 3;
const SENSOR_STALE_MS     = 30000; // clear last-known sensors after 30s of no BLE data
// JS-level OBD2 polling interval. Runs alongside (and merges with) native onSensorUpdate events.
const JS_POLL_INTERVAL_MS = 3000;

/**
 * useBLEManager
 *
 * Manages the OBD2 BLE adapter:
 *   - Device discovery with RSSI
 *   - Connect / disconnect with timeout
 *   - Auto-reconnect on foreground (exponential backoff, max 3 tries)
 *   - Persist last-connected device in SecureStore
 *   - Preserve last sensor values 30s after disconnect before clearing
 *   - Flush SQLite scan buffer to backend on foreground
 *   - sendCommand for OBD2Protocol AT / PID communication
 */
export default function useBLEManager() {
  const [bleState, setBleState]   = useState('idle');
  const [devices, setDevices]     = useState([]);      // [{ id, name, rssi }]
  const [lastDTC, setLastDTC]     = useState(null);
  const [sensors, setSensors]     = useState({});
  const [syncing, setSyncing]     = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState(null);

  const subscriptions  = useRef([]);
  const scanTimerRef   = useRef(null);
  const connectTimerRef = useRef(null);
  const staleTimerRef  = useRef(null);
  const reconnectRef   = useRef({ tries: 0, timer: null });
  const appStateRef    = useRef(AppState.currentState);
  // JS-level polling loop ref — runs pollAllPIDs + getBatteryVoltage on interval
  const jsPollRef      = useRef(null);

  // ── Buffer flush ──────────────────────────────────────────────────────────

  const flushBuffer = useCallback(async (scans) => {
    if (!scans?.length || syncing) return;
    setSyncing(true);
    try {
      await client.post('/scans/batch', { scans });
      const ids = scans.map(s => s.id).filter(Boolean);
      if (ids.length && isSupported) BLEManagerModule.markSynced(ids);
    } catch {
      // Non-fatal: retained in SQLite for next foreground flush
    } finally {
      setSyncing(false);
    }
  }, [syncing]);

  // ── Persist / restore last device ────────────────────────────────────────

  const saveLastDevice = useCallback(async (deviceId) => {
    try { await SecureStore.setItemAsync(SECURE_STORE_KEY, deviceId); } catch {}
  }, []);

  const loadLastDevice = useCallback(async () => {
    try { return await SecureStore.getItemAsync(SECURE_STORE_KEY); } catch { return null; }
  }, []);

  // ── Auto-reconnect with exponential backoff ───────────────────────────────

  const attemptReconnect = useCallback((deviceId) => {
    const { tries } = reconnectRef.current;
    if (!deviceId || !isSupported || tries >= MAX_RECONNECT_TRIES) {
      reconnectRef.current.tries = 0;
      return;
    }
    const delay = Math.pow(2, tries) * 2000; // 2s, 4s, 8s
    reconnectRef.current.timer = setTimeout(() => {
      reconnectRef.current.tries += 1;
      setConnectionError(null);
      BLEManagerModule.connect(deviceId);

      connectTimerRef.current = setTimeout(() => {
        // If still not connected after timeout, try next backoff or give up
        setBleState(prev => {
          if (prev !== 'connected') {
            attemptReconnect(deviceId);
          }
          return prev;
        });
      }, CONNECT_TIMEOUT_MS);
    }, delay);
  }, []);

  // ── AppState: reconnect + buffer flush on foreground ─────────────────────

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextState) => {
      if (appStateRef.current !== 'active' && nextState === 'active') {
        // App foregrounded
        reconnectRef.current.tries = 0;
        const savedId = await loadLastDevice();
        if (savedId && isSupported) {
          attemptReconnect(savedId);
        }
      }
      appStateRef.current = nextState;
    });
    return () => subscription.remove();
  }, [loadLastDevice, attemptReconnect]);

  // ── Native event subscriptions ────────────────────────────────────────────

  useEffect(() => {
    if (!isSupported) return;

    subscriptions.current = [
      emitter.addListener('onBLEStateChange', ({ state }) => {
        setBleState(state);

        if (state === 'connected') {
          setConnecting(false);
          setConnectionError(null);
          clearTimeout(connectTimerRef.current);
          clearTimeout(staleTimerRef.current);
          reconnectRef.current.tries = 0;
          // Kick off JS-level OBD2 polling now that the adapter is connected.
          // sendCommand is stable (useCallback on bleState) — call via module-level ref.
          startJSPolling(BLEManagerModule.sendCommand.bind(BLEManagerModule));
        }

        if (state === 'disconnected' || state === 'poweredOff') {
          setConnecting(false);
          stopJSPolling();
          // Keep last sensor values for SENSOR_STALE_MS before clearing
          clearTimeout(staleTimerRef.current);
          staleTimerRef.current = setTimeout(() => {
            setSensors({});
          }, SENSOR_STALE_MS);
        }

        if (state === 'scanning') {
          setDevices([]); // clear stale device list each scan
          clearTimeout(scanTimerRef.current);
          scanTimerRef.current = setTimeout(() => {
            if (isSupported) BLEManagerModule.stopScan();
          }, SCAN_TIMEOUT_MS);
        }

        if (state !== 'scanning') {
          clearTimeout(scanTimerRef.current);
        }
      }),

      emitter.addListener('onDeviceDiscovered', ({ id, name, rssi }) => {
        setDevices(prev => {
          const idx = prev.findIndex(d => d.id === id);
          if (idx >= 0) {
            // Update RSSI in place
            const next = [...prev];
            next[idx] = { ...next[idx], rssi };
            return next;
          }
          return [...prev, { id, name: name ?? 'Unknown Device', rssi }];
        });
      }),

      emitter.addListener('onDTCDetected', (event) => {
        setLastDTC(event);
      }),

      emitter.addListener('onSensorUpdate', (event) => {
        clearTimeout(staleTimerRef.current); // reset stale timer on every sensor tick
        const { timestamp: _ts, ...sensorValues } = event;
        setSensors(prev => ({ ...prev, ...sensorValues }));
      }),

      emitter.addListener('onBufferFlush', ({ scans }) => {
        flushBuffer(scans);
      }),
    ];

    return () => {
      subscriptions.current.forEach(sub => sub.remove());
      subscriptions.current = [];
      clearTimeout(scanTimerRef.current);
      clearTimeout(connectTimerRef.current);
      clearTimeout(staleTimerRef.current);
      clearTimeout(reconnectRef.current.timer);
      stopJSPolling();
    };
  }, [flushBuffer]);

  // ── JS-level OBD2 polling loop ────────────────────────────────────────────
  // Runs after ELM327 init succeeds. Calls pollAllPIDs + getBatteryVoltage and
  // merges results into sensors state — same shape as onSensorUpdate events.
  // Native onSensorUpdate events take priority (they arrive via setSensors spread
  // after jsPoll, so last-write wins; native events reset the stale timer too).

  const runJSPoll = useCallback(async (sendCommandFn) => {
    try {
      const [pidResults, voltageResult] = await Promise.all([
        pollAllPIDs(sendCommandFn),
        getBatteryVoltage(sendCommandFn),
      ]);

      const update = {};
      for (const result of pidResults) {
        if (result.value !== null && result.name) {
          update[result.name] = result.value;
        }
      }
      if (voltageResult.value !== null) {
        update.voltage = voltageResult.value;
      }

      if (Object.keys(update).length > 0) {
        clearTimeout(staleTimerRef.current); // treat JS poll data as a live tick
        setSensors(prev => ({ ...prev, ...update }));
      }
    } catch {
      // Non-fatal — adapter may have disconnected; polling will stop on next disconnect event
    }
  }, []);

  const startJSPolling = useCallback(async (sendCommandFn) => {
    stopJSPolling();
    const { success, errors } = await initELM327(sendCommandFn);
    if (!success) {
      console.warn('[BLE] ELM327 init errors:', errors);
      // Non-fatal: partial init may still allow polling
    }
    // Run immediately, then on interval
    runJSPoll(sendCommandFn);
    jsPollRef.current = setInterval(() => runJSPoll(sendCommandFn), JS_POLL_INTERVAL_MS);
  }, [runJSPoll]);

  function stopJSPolling() {
    if (jsPollRef.current) {
      clearInterval(jsPollRef.current);
      jsPollRef.current = null;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  const startScan = useCallback(() => {
    if (!isSupported) return;
    setDevices([]);
    setConnectionError(null);
    BLEManagerModule.startScan();
  }, []);

  const stopScan = useCallback(() => {
    if (!isSupported) return;
    clearTimeout(scanTimerRef.current);
    BLEManagerModule.stopScan();
  }, []);

  const connect = useCallback(async (peripheralId) => {
    if (!isSupported || !peripheralId) return;
    setConnecting(true);
    setConnectionError(null);
    BLEManagerModule.connect(peripheralId);

    // Save device id optimistically; clear on timeout/error
    await saveLastDevice(peripheralId);

    connectTimerRef.current = setTimeout(() => {
      setConnecting(false);
      setConnectionError('Connection timed out. Check adapter power and proximity.');
      setBleState(prev => (prev === 'connecting' ? 'disconnected' : prev));
    }, CONNECT_TIMEOUT_MS);
  }, [saveLastDevice]);

  const disconnect = useCallback(() => {
    if (!isSupported) return;
    SecureStore.deleteItemAsync(SECURE_STORE_KEY).catch(() => {});
    reconnectRef.current.tries = MAX_RECONNECT_TRIES; // suppress auto-reconnect
    BLEManagerModule.disconnect();
  }, []);

  const requestManualScan = useCallback(() => {
    if (isSupported) BLEManagerModule.requestManualScan();
  }, []);

  /**
   * Send an AT command or PID request to the ELM327 adapter via BLE.
   * Returns the raw string response from the adapter.
   * Used by OBD2Protocol.js.
   *
   * Requires BLEManagerModule.sendCommand(cmd: string): Promise<string>
   * to be implemented in the native iOS module.
   */
  const sendCommand = useCallback((cmd) => {
    if (!isSupported) return Promise.reject(new Error('BLE not supported on this platform'));
    if (bleState !== 'connected') return Promise.reject(new Error('BLE adapter not connected'));
    return BLEManagerModule.sendCommand(cmd);
  }, [bleState]);

  return {
    bleState,
    devices,
    lastDTC,
    sensors,
    syncing,
    connecting,
    connectionError,
    isSupported,
    startScan,
    stopScan,
    connect,
    disconnect,
    requestManualScan,
    sendCommand,
  };
}
