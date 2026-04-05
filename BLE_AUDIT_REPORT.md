# BLE Audit Report — 2026-04-05

## Root Cause

`startScan` in `useBLEManager.js` treated `State.Unknown` (BLE stack not yet initialized) identically to `State.PoweredOff`, causing a false "Bluetooth is off" error whenever the scan was triggered during the brief window before the first `onStateChange` callback settled.

---

## Files Modified

- `src/hooks/useBLEManager.js` — added `hwStateRef` to always read current BLE state; rewrote `startScan` guard to distinguish `Unknown`/`Resetting` (wait 1.5 s, then re-check) from `PoweredOff` (show error), `Unauthorized` (show permission error), and `Unsupported`
- `src/screens/TelemetryScreen.js` — changed "BLE OFF" label to "BLE IDLE" (was showing when BLE is on but not connected)
- `src/screens/OBD2ScanScreen.js` — fixed dead `bleState === 'poweredOff'` check to `bleState === 'unavailable'` (the string `useBLEManager` actually emits)

---

## Checklist Results

### A. iOS Permissions (Info.plist + app.json)
- [x] `NSBluetoothAlwaysUsageDescription` — PASS
- [x] `NSBluetoothPeripheralUsageDescription` — PASS
- [x] `NSBluetoothAlwaysAndWhenInUseUsageDescription` — PASS
- [x] Bluetooth declared in `app.json` `ios.infoPlist` — PASS
- [ ] `UIBackgroundModes` `bluetooth-central` — NOT PRESENT (WARNING — see below)

### B. CBCentralManager State Timing
- [x] State read inside `onStateChange` callback — PASS
- [x] Initial state defaults to `State.Unknown` — PASS
- [FIXED] `startScan` was treating `Unknown` as "off" — FIXED: now waits 1.5 s for state to settle, then checks specifically for `PoweredOff`

### C. State String Mapping
- [FIXED] `Unknown` was mapping to "Bluetooth is off" via the catch-all `!== PoweredOn` check — FIXED
- [x] `PoweredOff` → "Bluetooth is off" — PASS
- [FIXED] `Unauthorized` → now shows "Bluetooth permission denied" instead of "Bluetooth is off" — FIXED
- [x] `Resetting` handled gracefully (waits, re-checks) — FIXED
- [x] Only `PoweredOff` maps to "Bluetooth is off" — PASS (after fix)

### D. BLEDevicePicker.js
- [x] Calls `onStartScan()` on modal open — the fix in `useBLEManager` handles the race condition upstream
- [x] "0 DEVICES FOUND" shown while scanning in progress — PASS (shows "SCANNING FOR DEVICES…" first)
- [x] 15 s scan timeout — PASS
- [x] Error message shown via `connectionError` prop — PASS

### E. TelemetryScreen.js
- [FIXED] "BLE OFF" label showed when BLE was on but not connected — FIXED to "BLE IDLE"
- [x] `bleError` banner only renders when `bleError && !bleConnected` — PASS
- [x] Disconnect banner has 30 s timeout — PASS

### F. Race Condition — App Foreground
- [ ] No `AppState` foreground resume listener — WARNING (see below)

---

## Launch Readiness Warnings

1. **No `UIBackgroundModes: bluetooth-central`** — If the app ever needs to receive BLE data while backgrounded (e.g. alert monitoring), this must be added to `app.json` under `ios.infoPlist`. Not blocking for foreground-only use.

2. **No AppState foreground resume** — If the user backgrounds the app with BLE scanning active then returns, the scan is not restarted. `BleManager` may also need to be re-initialized after a long background. Add an `AppState` listener in `useBLEManager` if continuous connection is a goal.

3. **Hardcoded OBD2 UUIDs** — `OBD_SERVICE_UUID = 'FFF0'`, write `FFF2`, notify `FFF1`. Some adapters use `18F0`/`18F1` or `FFE0`/`FFE1`. A device-UUID lookup table or user-configurable override would improve compatibility.

4. **BleManager singleton destroyed on unmount** — `manager.destroy()` is called in the cleanup effect. If `useBLEManager` is used in multiple screens, the singleton will be destroyed when the first screen unmounts, breaking BLE in all other screens. Consider managing the singleton lifecycle at the app level.

5. **No scan timeout on TelemetryScreen direct scan** — `startScan` sets a 10 s auto-stop, but `BLEDevicePicker` also has its own 15 s timeout. The two timers can conflict if the picker is open and the 10 s fires first.

6. **Demo mode vehicles** — Not explicitly bypassing BLE path; relies on no OBD data being returned. Acceptable for now but could be made explicit.

---

## Recommended Next Steps

1. **Rebuild and install on TestFlight** — the false positive is fixed; test by tapping "SCAN FOR ADAPTER" immediately after app launch.
2. **Test with Bluetooth OFF** — confirm the red "Bluetooth is off" error still appears correctly when BLE is genuinely disabled.
3. **Test with Bluetooth ON, no adapter nearby** — should scan for 10 s, show "0 DEVICES FOUND", no error banner.
4. **Test returning from background** — confirm BLE state is re-evaluated on foreground resume (or add AppState listener if not).
5. Consider addressing the `BleManager.destroy()` singleton issue before adding more BLE screens.
