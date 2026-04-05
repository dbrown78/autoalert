# BLE Singleton Refactor Report — 2026-04-05

## Changes Made

- **`src/services/BLEService.js` created** — exports `getBLEManager()` (lazy singleton) and
  `destroyBLEManager()` (for intentional app-exit teardown only). `BleManager` is now
  instantiated exactly once for the entire app lifetime.

- **`src/hooks/useBLEManager.js`**:
  - Removed module-level `const manager = new BleManager()`
  - Removed `import { BleManager }` (no longer needed in the hook)
  - Added `import { getBLEManager } from '../services/BLEService'`
  - Added `import { AppState }` from react-native
  - Hook now calls `const manager = getBLEManager()` at the top of the render — always
    returns the same singleton reference
  - Merged `AppState.addEventListener('change', ...)` into the `onStateChange` useEffect:
    on `nextState === 'active'`, calls `manager.state()` to re-sync `hwState` and `hwStateRef`
  - Removed `manager.destroy()` from the unmount cleanup — replaced with comment explaining why

- **`src/screens/FollowUpScanScreen.js`** — fixed broken named import
  `import { useBLEManager }` → `import useBLEManager` (default export). The named import
  resolved to `undefined`, causing a crash whenever this screen was navigated to.

- **`app.json`** — added `"UIBackgroundModes": ["bluetooth-central"]` to `ios.infoPlist`
  so CoreBluetooth state restoration works correctly when the app returns from background.

---

## Screens Verified (no direct BleManager usage)

- TelemetryScreen: ✅ — uses `useBLEManager` hook only
- OBD2ScanScreen: ✅ — uses `useBLEManager` hook only
- FollowUpScanScreen: ✅ — fixed; default import now resolves correctly
- BLEDevicePicker: ✅ — props-only, no manager access
- useDriveSafety: ✅ — uses `useBLEManager` hook only
- useSensorStream: ✅ — uses `useBLEManager` hook only

Only `BLEService.js` instantiates `BleManager`. Confirmed with grep.

---

## AppState Resume Behavior

When the app returns to the foreground (`AppState` fires `'active'`):
1. `manager.state()` is called — reads current CoreBluetooth hardware state
2. `hwStateRef.current` and the `hwState` React state are both updated
3. If the user toggled Bluetooth off and back on while backgrounded, the UI will
   reflect the correct state immediately without requiring a scan attempt

The subscription is cleaned up on hook unmount alongside the `onStateChange` subscription.

---

## Remaining Launch Warnings

1. **Multiple simultaneous hook instances on TelemetryScreen** — `TelemetryScreen` calls
   `useBLEManager` directly AND calls `useDriveSafety` (which calls `useBLEManager` again).
   Both share the same singleton manager, but each has its own React state — meaning two
   independent `onStateChange` subscriptions fire on every state change, and two
   `AppState` listeners are active. This works correctly but is wasteful. Long-term fix:
   lift BLE state into a React context so all consumers read from one place.

2. **No auto-reconnect on foreground resume** — if a BLE connection dropped while
   backgrounded, the app shows "SCAN FOR ADAPTER" again. The `onDisconnected` callback
   already cleans up state correctly; auto-reconnect was intentionally not added as it
   requires device ID persistence and retry logic that is out of scope here.

3. **Scan timeout conflict** — `startScan` sets a 10 s auto-stop; `BLEDevicePicker` sets
   its own 15 s timeout. If both are active simultaneously, the 10 s timer fires first
   and stops the scan while the picker still shows "SCANNING".
