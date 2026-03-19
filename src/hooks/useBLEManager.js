/**
 * useBLEManager — Safe stub for builds where BLE native module is unavailable.
 * Returns no-op values so dependent hooks (useDriveSafety, useSensorStream) don't crash.
 * BLE functionality will be fully implemented in v1.1 with react-native-ble-plx.
 */
export default function useBLEManager({ enabled = false } = {}) {
  return {
    bleState: 'unavailable',
    devices: [],
    lastDTC: null,
    sensors: {},
    syncing: false,
    connecting: false,
    connectionError: null,
    connectedDevice: null,
    isConnected: false,
    isSupported: false,
    startScan: () => {},
    stopScan: () => {},
    connect: async () => {},
    disconnect: async () => {},
    sendCommand: async () => null,
    readSensorData: async () => null,
    requestManualScan: () => {},
    clearLastDTC: () => {},
  };
}
