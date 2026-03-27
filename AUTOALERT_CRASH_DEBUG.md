# AutoAlert — TestFlight Crash Debug Task
**Incident:** FE755318-816C-4045-9ABB-BA212153E782  
**Build:** 1.0.0 (13) · com.mhlabs201.odin · iPhone OS 26.3.1  
**Crash window:** ~0.72s after launch — dies before any user interaction

---

## Root Cause Summary

Thread 1 (`com.meta.react.turbomodulemanager.queue`) crashes via:

```
ObjCTurboModule::performVoidMethodInvocation
  → objc_exception_rethrow
    → __cxa_rethrow → std::__terminate → abort() → SIGABRT
```

A native TurboModule throws an **uncaught Objective-C exception during startup initialization**. The exception message is swallowed before `abort()` fires. Three candidates ranked by probability:

1. **Missing BLE Info.plist permission keys** — `react-native-ble-plx` throws hard on init in release builds without these strings
2. **Missing Keychain entitlement** — `expo-secure-store` crashes on Keychain access in release if entitlement is absent
3. **SecureStore called before native modules are ready** — race condition on app init

---

## Task: Audit and Fix All Three Issues

### Fix 1 — BLE Info.plist Keys (Highest Priority)

**File to check:** `ios/autoalert/Info.plist`  
**Also check:** `app.json` / `app.config.js` under `expo.ios.infoPlist`

Verify ALL THREE keys exist with non-empty description strings:

```xml
<key>NSBluetoothAlwaysUsageDescription</key>
<string>AutoAlert uses Bluetooth to connect to your OBD2 scanner.</string>

<key>NSBluetoothPeripheralUsageDescription</key>
<string>AutoAlert uses Bluetooth to connect to your OBD2 scanner.</string>

<key>NSLocationWhenInUseUsageDescription</key>
<string>Required for Bluetooth Low Energy scanning on iOS.</string>
```

**Action:** If any of these are missing, add them. If `ios/` directory doesn't exist (managed Expo workflow), ensure they are set in `app.config.js`:

```js
ios: {
  infoPlist: {
    NSBluetoothAlwaysUsageDescription:
      "AutoAlert uses Bluetooth to connect to your OBD2 scanner.",
    NSBluetoothPeripheralUsageDescription:
      "AutoAlert uses Bluetooth to connect to your OBD2 scanner.",
    NSLocationWhenInUseUsageDescription:
      "Required for Bluetooth Low Energy scanning on iOS.",
  }
}
```

---

### Fix 2 — Keychain Entitlement

**File to check:** `ios/autoalert/autoalert.entitlements`  
**Also check:** `app.json` / `app.config.js` under `expo.ios.entitlements`

Verify the entitlements file exists and contains:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>keychain-access-groups</key>
  <array>
    <string>$(AppIdentifierPrefix)com.mhlabs201.odin</string>
  </array>
  <key>com.apple.developer.team-identifier</key>
  <string>C4Y59WB79P</string>
</dict>
</plist>
```

For managed Expo workflow, ensure `app.config.js` includes:

```js
ios: {
  entitlements: {
    "keychain-access-groups": ["$(AppIdentifierPrefix)com.mhlabs201.odin"]
  }
}
```

If the entitlements file exists in `ios/` but is NOT referenced in the Xcode project's Code Signing Entitlements build setting, that is also a crash cause — verify `ios/autoalert.xcodeproj/project.pbxproj` references the entitlements file under `CODE_SIGN_ENTITLEMENTS`.

---

### Fix 3 — Harden App Startup Sequence

**Files to check:** `App.js`, `src/App.js`, `index.js`, root navigation file, any auth context provider  

Find any `useEffect` or top-level async call that touches `SecureStore`, BLE, or auth state **before** a null check or try/catch. Wrap them:

```js
// BEFORE (crash-prone in release)
useEffect(() => {
  const token = await SecureStore.getItemAsync('token');
  if (token) navigate('Home');
}, []);

// AFTER (safe)
useEffect(() => {
  const initAuth = async () => {
    try {
      const token = await SecureStore.getItemAsync('token');
      if (token) navigate('Home');
    } catch (e) {
      // Keychain unavailable — treat as logged out
      console.warn('SecureStore init failed:', e);
    }
  };
  initAuth();
}, []);
```

Similarly for any BLE initialization — wrap `BleManager` constructor or `startDeviceScan` calls in try/catch.

---

### Fix 4 — Add Global Error Boundary (Release Safety Net)

**File to create/update:** `App.js` or root component

Add a React error boundary so that JS-layer crashes in release builds produce a recoverable screen instead of a silent abort:

```js
import React from 'react';
import { View, Text, Button } from 'react-native';

class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
    // TODO: send to Sentry / Crashlytics when integrated
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 12 }}>
            Something went wrong
          </Text>
          <Text style={{ color: '#666', marginBottom: 24, textAlign: 'center' }}>
            {this.state.error?.message || 'Unknown error'}
          </Text>
          <Button title="Restart" onPress={() => this.setState({ hasError: false })} />
        </View>
      );
    }
    return this.props.children;
  }
}

// Wrap your root navigator:
export default function App() {
  return (
    <ErrorBoundary>
      {/* existing NavigationContainer / providers */}
    </ErrorBoundary>
  );
}
```

---

## Verification Checklist

After applying fixes, verify locally before re-submitting to TestFlight:

```bash
# 1. Clean build artifacts
npx expo prebuild --clean

# 2. Run a local RELEASE build (not dev — this is what TestFlight sees)
npx expo run:ios --configuration Release

# 3. Watch for any red errors in Metro / Xcode console at launch
# 4. Confirm app stays alive past the 0.72s crash window
# 5. Confirm login flow completes without abort

# 6. Once passing locally, submit new TestFlight build
eas build --platform ios --profile preview
```

If the local release build still crashes, open Xcode, add an **Exception Breakpoint** (Debug → Breakpoints → + → Exception Breakpoint → All Exceptions, Throw) and run again — this will stop on the exact line before the exception is swallowed.

---

## Reference

| Field | Value |
|---|---|
| Bundle ID | `com.mhlabs201.odin` |
| Apple Team ID | `C4Y59WB79P` |
| ASC App ID | `6760629641` |
| Crash Thread | 1 — `com.meta.react.turbomodulemanager.queue` |
| Exception | `EXC_CRASH (SIGABRT)` via `ObjCTurboModule::performVoidMethodInvocation` |
| React Native framework | `React.framework` (hermesvm runtime) |
