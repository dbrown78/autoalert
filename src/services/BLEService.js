import { BleManager } from 'react-native-ble-plx';

// Single BleManager instance for the entire app lifetime.
// Never call .destroy() on screen unmount — that kills BLE for all screens.
// destroyBLEManager() is provided for true app-exit teardown only.
let _manager = null;

export function getBLEManager() {
  if (!_manager) {
    _manager = new BleManager();
  }
  return _manager;
}

export function destroyBLEManager() {
  if (_manager) {
    _manager.destroy();
    _manager = null;
  }
}
