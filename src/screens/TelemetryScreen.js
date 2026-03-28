import { useEffect, useRef, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  ActivityIndicator, TouchableOpacity, Animated, useWindowDimensions,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import useSensorStream from '../hooks/useSensorStream';
import useBLEManager from '../hooks/useBLEManager';
import useDriveSafety from '../hooks/useDriveSafety';
import { useSensorHistory } from '../hooks/useSensorHistory';
import DriveSafetyCard from '../components/DriveSafetyCard';
import SensorHistoryChart from '../components/SensorHistoryChart';
import {
  SENSOR_META, SENSOR_KEYS,
  getSensorStatus, statusColor, barFillPct,
} from '../utils/sensorThresholds';

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

const C = {
  bg: '#080808', surface: '#1A1A1A', border: '#2A2A2A',
  textPrimary: '#E0E0E0', textMuted: '#777777', accent: '#C0C0C0',
  red: '#D0453A', green: '#4CAF82', amber: '#C08B30',
};

// Keys owned by ABS / TCM module cards — excluded from the main engine sensor grid.
const MODULE_KEYS = new Set([
  'trans_fluid_temp', 'slip_rpm', 'line_pressure',
  'brake_pressure', 'wheel_speed_delta',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the worst getSensorStatus across a set of sensor keys.
 * ORDER: critical > warn > normal > unknown
 */
function worstStatusOf(keys, sensors) {
  const ORDER = { critical: 3, warn: 2, normal: 1, unknown: 0 };
  let worst = 'unknown';
  for (const key of keys) {
    const st = getSensorStatus(key, sensors[key]?.value ?? null);
    if ((ORDER[st] ?? 0) > (ORDER[worst] ?? 0)) worst = st;
  }
  return worst;
}

/** Format a gear_position numeric value to display string. */
function formatGear(value) {
  if (value == null) return '—';
  const n = Math.round(value);
  if (n === 0) return 'N';
  if (n >= 1 && n <= 8) return String(n);
  return '—';
}

// ---------------------------------------------------------------------------
// SensorCard  (unchanged)
// ---------------------------------------------------------------------------

function SensorCard({ sensorKey, entry }) {
  const meta   = SENSOR_META[sensorKey] ?? { label: sensorKey.toUpperCase(), unit: '' };
  const value  = entry?.value ?? null;
  const status = getSensorStatus(sensorKey, value);
  const color  = statusColor(status);
  const fill   = barFillPct(sensorKey, value);
  const display = value != null ? Number(value).toFixed(1) : '—';
  const borderColor = status === 'critical' ? C.red : status === 'warn' ? C.amber : C.border;

  return (
    <View style={[SC.card, { borderColor }]}>
      <Text style={SC.label}>{meta.label}</Text>
      <View style={SC.valueRow}>
        <Text style={[SC.value, { color }]}>{display}</Text>
        <Text style={SC.unit}>{meta.unit}</Text>
      </View>
      <View style={SC.barTrack}>
        <View style={[SC.barFill, { width: `${Math.round(fill * 100)}%`, backgroundColor: color }]} />
      </View>
      <Text style={[SC.status, { color }]}>{status.toUpperCase()}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// SkeletonCard — shown during the first poll cycle after BLE connect
// ---------------------------------------------------------------------------

function SkeletonCard({ label, style }) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.65, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3,  duration: 800, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View style={[SK.card, style, { opacity }]}>
      <View style={SK.header}>
        <View style={SK.dot} />
        <Text style={SK.label}>{label}</Text>
      </View>
      <View style={SK.rowPlaceholder} />
      <View style={[SK.rowPlaceholder, { width: '75%' }]} />
      <View style={[SK.rowPlaceholder, { width: '60%' }]} />
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// NotDetectedCard — shown when module probe returns no data after first poll
// ---------------------------------------------------------------------------

function NotDetectedCard({ label, style }) {
  return (
    <View style={[ND.card, style]}>
      <View style={ND.header}>
        <View style={ND.dot} />
        <Text style={ND.label}>{label}</Text>
        <View style={ND.badge}>
          <Text style={ND.badgeText}>NOT DETECTED</Text>
        </View>
      </View>
      <Text style={ND.sub}>
        {label} — not detected on this vehicle
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ModuleSensorRow — a single sensor row inside a module card (bar variant)
// ---------------------------------------------------------------------------

function ModuleSensorRow({ sensorKey, value, label, unit }) {
  const status  = getSensorStatus(sensorKey, value);
  const color   = statusColor(status);
  const fill    = barFillPct(sensorKey, value);
  const display = value != null ? Number(value).toFixed(1) : '—';

  return (
    <View style={MR.row}>
      <Text style={MR.label}>{label}</Text>
      <View style={MR.right}>
        <View style={MR.valueRow}>
          <Text style={[MR.value, { color }]}>{display}</Text>
          <Text style={MR.unit}>{unit}</Text>
        </View>
        <View style={MR.barTrack}>
          <View style={[MR.barFill, { width: `${Math.round(fill * 100)}%`, backgroundColor: color }]} />
        </View>
        <Text style={[MR.statusText, { color }]}>{status.toUpperCase()}</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ABSCard — honest OBD2 limitation messaging + chassis DTC codes
// ---------------------------------------------------------------------------

function ABSCard({ chassisDtcs = [], style }) {
  const hasChassisFaults = chassisDtcs.length > 0;
  const borderColor = hasChassisFaults ? C.amber : C.border;
  const dotColor    = hasChassisFaults ? C.amber : C.textMuted;

  return (
    <View style={[MC.card, style, { borderColor }]}>
      <View style={MC.header}>
        <View style={[MC.statusDot, { backgroundColor: dotColor }]} />
        <Text style={MC.moduleLabel}>ABS / TRACTION CONTROL</Text>
      </View>

      <View style={MC.divider} />

      <Text style={ABS.infoText}>
        Standard OBD2 (SAE J1979) does not expose ABS module data.
        ABS wheel speed sensors require manufacturer-specific Mode 22
        commands that vary by make and model.
      </Text>

      {hasChassisFaults && (
        <View style={ABS.faultSection}>
          <Text style={ABS.faultHeader}>CHASSIS FAULT CODES DETECTED</Text>
          {chassisDtcs.map((code) => (
            <View key={code} style={ABS.faultRow}>
              <View style={[ABS.faultDot, { backgroundColor: C.amber }]} />
              <Text style={ABS.faultCode}>{code}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// TransmissionCard
// ---------------------------------------------------------------------------

function TransmissionCard({ sensors, style }) {
  // Card status excludes gear_position (no threshold)
  const cardStatus = useMemo(() =>
    worstStatusOf(['trans_fluid_temp', 'slip_rpm', 'line_pressure'], sensors)
  , [sensors]);

  const dotColor    = statusColor(cardStatus);
  const borderColor = cardStatus === 'critical' ? C.red
                    : cardStatus === 'warn'     ? C.amber
                    : C.border;

  const gearDisplay = formatGear(sensors.gear_position?.value ?? null);

  return (
    <View style={[MC.card, style, { borderColor }]}>
      {/* Card header */}
      <View style={MC.header}>
        <View style={[MC.statusDot, { backgroundColor: dotColor }]} />
        <Text style={MC.moduleLabel}>TRANSMISSION</Text>
        <Text style={[MC.moduleTag, { color: C.textMuted }]}>ATSH7E1</Text>
      </View>

      <View style={MC.divider} />

      {/* bar rows */}
      <ModuleSensorRow
        sensorKey="trans_fluid_temp"
        value={sensors.trans_fluid_temp?.value ?? null}
        label="FLUID TEMP"
        unit="°C"
      />
      <ModuleSensorRow
        sensorKey="slip_rpm"
        value={sensors.slip_rpm?.value ?? null}
        label="CONV SLIP"
        unit="rpm"
      />
      <ModuleSensorRow
        sensorKey="line_pressure"
        value={sensors.line_pressure?.value ?? null}
        label="LINE PRESS"
        unit="psi"
      />

      {/* Gear position — text only, no bar */}
      <View style={MR.row}>
        <Text style={MR.label}>GEAR</Text>
        <View style={MR.right}>
          <Text style={MC.gearValue}>{gearDisplay}</Text>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// PulseDot  (unchanged)
// ---------------------------------------------------------------------------

function PulseDot() {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.2, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1,   duration: 700, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return <Animated.View style={[S.pulseDot, { opacity }]} />;
}

// ---------------------------------------------------------------------------
// TelemetryScreen
// ---------------------------------------------------------------------------

export default function TelemetryScreen() {
  const { selectedVehicle, token } = useAuth();
  const vehicleId = selectedVehicle?.id ?? null;
  const { width: screenWidth } = useWindowDimensions();
  const isNarrow = screenWidth < 375;

  const [streamEnabled, setStreamEnabled] = useState(false);
  const { sensorData: streamSensors, isStreaming: streaming, streamError: error } = useSensorStream({ enabled: streamEnabled });
  const {
    bleState,
    sensors: bleSensors,
    isSupported: bleSupported,
    isScanning: bleScanning,
    isConnecting: bleConnecting,
    nearbyDevices,
    error: bleError,
    startScan,
    connectToDevice,
    disconnect: bleDisconnect,
    dtcCodes,
    pendingDtcCodes,
  } = useBLEManager({ enabled: true, vehicleId, authToken: token });
  const {
    status: safetyStatus,
    reason: safetyReason,
    source: safetySource,
    hasABS,
    hasTCM,
  } = useDriveSafety(vehicleId, { bleEnabled: true });

  const {
    seriesMap, window: histWindow, loading: histLoading,
    error: histError, fetchHistory, changeWindow,
  } = useSensorHistory(vehicleId);

  const bleConnected = bleState === 'connected';

  // True during the first ~3s after BLE connect before any sensor data arrives.
  // Once bleSensors has any key the first poll is done.
  const isModuleLoading = bleConnected && Object.keys(bleSensors).length === 0;

  // Module cards span full-width on narrow screens, 48% on wider screens
  // to slot into the same 2-column flex grid as engine sensor cards.
  const moduleCardWidth = isNarrow ? '100%' : '48%';

  // Merge BLE values over mock-stream values when BLE is connected.
  const sensors = useMemo(() => {
    const base = streamSensors ?? {};
    if (!bleConnected || !Object.keys(bleSensors).length) return base;
    const now = new Date().toISOString();
    const bleWrapped = Object.fromEntries(
      Object.entries(bleSensors).map(([k, v]) => [k, { value: v, recorded_at: now }])
    );
    return { ...base, ...bleWrapped };
  }, [bleConnected, bleSensors, streamSensors]);

  const hasSensors = Object.keys(sensors).length > 0;
  const critCount  = SENSOR_KEYS.filter(k => getSensorStatus(k, sensors[k]?.value) === 'critical').length;

  // ── BLE disconnect banner ──────────────────────────────────────────────────
  const [disconnectBanner, setDisconnectBanner] = useState(false);
  const prevBleStateRef = useRef(bleState);
  const bannerTimerRef  = useRef(null);

  useEffect(() => {
    if (prevBleStateRef.current === 'connected' && bleState === 'disconnected') {
      setDisconnectBanner(true);
      clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = setTimeout(() => setDisconnectBanner(false), 30000);
    }
    if (bleState === 'connected') {
      setDisconnectBanner(false);
      clearTimeout(bannerTimerRef.current);
    }
    prevBleStateRef.current = bleState;
  }, [bleState]);

  useEffect(() => () => clearTimeout(bannerTimerRef.current), []);

  // Fetch sensor history when vehicleId becomes available
  useEffect(() => {
    if (vehicleId) fetchHistory();
  }, [vehicleId]);

  // Most-recent recorded_at across all sensors
  const lastUpdated = hasSensors
    ? new Date(Math.max(...Object.values(sensors).map(s => new Date(s.recorded_at).getTime())))
    : null;
  const timeStr = lastUpdated
    ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  return (
    <View style={S.container}>

      {/* ── Header ── */}
      <View style={S.header}>
        <View style={S.headerLeft}>
          {streaming ? <PulseDot /> : <View style={S.staticDot} />}
          <Text style={S.headerTitle}>LIVE TELEMETRY</Text>
        </View>
        <View style={S.headerRight}>
          {critCount > 0 && (
            <View style={S.critBadge}>
              <Text style={S.critBadgeText}>{critCount}</Text>
            </View>
          )}
          {timeStr && <Text style={S.timestamp}>{timeStr}</Text>}
        </View>
      </View>

      {/* ── Vehicle sub-header ── */}
      {selectedVehicle && (
        <View style={S.subHeader}>
          <Text style={S.subHeaderText}>
            {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}
          </Text>
          <View style={S.streamStatus}>
            {bleConnected ? (
              <Text style={[S.streamLabel, { color: C.green }]}>● BLE LIVE</Text>
            ) : streaming ? (
              <Text style={[S.streamLabel, { color: C.green }]}>● STREAMING LIVE</Text>
            ) : (
              <Text style={[S.streamLabel, { color: C.textMuted }]}>○ STREAM INACTIVE</Text>
            )}
            {bleSupported && !bleConnected && (
              <Text style={[S.streamLabel, { color: '#404040', marginLeft: 8 }]}>BLE OFF</Text>
            )}
          </View>
        </View>
      )}

      {/* ── No vehicle ── */}
      {!selectedVehicle ? (
        <View style={S.centerState}>
          <View style={S.noVehicleDot} />
          <Text style={S.emptyTitle}>NO VEHICLE SELECTED</Text>
          <Text style={S.emptySub}>Select a vehicle to begin sensor streaming</Text>
        </View>
      ) : (
        <>
          {/* ── Stream / BLE control bar ── */}
          <View style={S.controlBar}>
            {bleConnected ? (
              <TouchableOpacity
                onPress={bleDisconnect}
                style={[S.streamBtn, S.streamBtnBLE]}
                activeOpacity={0.75}
              >
                <Text style={[S.streamBtnText, { color: C.accent }]}>⬡  BLE ADAPTER CONNECTED</Text>
              </TouchableOpacity>
            ) : bleConnecting ? (
              <View style={[S.streamBtn, S.streamBtnBLE]}>
                <ActivityIndicator size="small" color={C.accent} style={{ marginRight: 8 }} />
                <Text style={[S.streamBtnText, { color: C.textMuted }]}>CONNECTING…</Text>
              </View>
            ) : bleSupported ? (
              <TouchableOpacity
                onPress={bleScanning ? () => {} : startScan}
                style={[S.streamBtn, S.streamBtnBLEScan]}
                activeOpacity={0.75}
              >
                {bleScanning ? (
                  <>
                    <ActivityIndicator size="small" color={C.accent} style={{ marginRight: 8 }} />
                    <Text style={[S.streamBtnText, { color: C.accent }]}>SCANNING…</Text>
                  </>
                ) : (
                  <Text style={[S.streamBtnText, { color: C.accent }]}>⬡  SCAN FOR ADAPTER</Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={() => setStreamEnabled(v => !v)}
                style={[S.streamBtn, streaming ? S.streamBtnStop : S.streamBtnStart]}
                activeOpacity={0.75}
              >
                {streaming ? (
                  <Text style={[S.streamBtnText, { color: C.red }]}>■  STOP STREAM</Text>
                ) : (
                  <Text style={[S.streamBtnText, { color: C.green }]}>▶  START STREAM</Text>
                )}
              </TouchableOpacity>
            )}

            <View style={S.pollBadge}>
              <Text style={S.pollBadgeText}>{bleConnected ? 'BLE' : '3S POLL'}</Text>
            </View>
          </View>

          {/* ── Error banner ── */}
          {error && (
            <View style={S.errorBanner}>
              <Text style={S.errorBannerText}>{error}</Text>
            </View>
          )}

          {/* ── BLE disconnect banner ── */}
          {disconnectBanner && (
            <View style={S.disconnectBanner}>
              <View style={S.disconnectStripe} />
              <Text style={S.disconnectText}>
                ADAPTER DISCONNECTED — SHOWING LAST KNOWN READINGS
              </Text>
            </View>
          )}

          {/* ── BLE nearby devices list ── */}
          {!bleConnected && nearbyDevices.length > 0 && (
            <View style={S.deviceList}>
              <Text style={S.deviceListHeader}>NEARBY ADAPTERS</Text>
              {nearbyDevices.map((d) => (
                <TouchableOpacity
                  key={d.id}
                  onPress={() => connectToDevice(d.id)}
                  style={S.deviceRow}
                  activeOpacity={0.7}
                >
                  <View style={S.deviceRowLeft}>
                    <View style={S.deviceDot} />
                    <Text style={S.deviceName}>{d.name}</Text>
                  </View>
                  <Text style={S.deviceRssi}>{d.rssi} dBm</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* ── BLE error banner ── */}
          {bleError && !bleConnected && (
            <View style={S.errorBanner}>
              <Text style={S.errorBannerText}>BLE — {bleError}</Text>
            </View>
          )}

          {/* ── Drive safety indicator ── */}
          {safetyStatus && (
            <View style={S.safetyWrap}>
              <DriveSafetyCard
                driveSafety={safetyStatus}
                driveSafetyReason={safetyReason}
                source={safetySource}
              />
            </View>
          )}

          {/* ── Sensor grid ── */}
          {!streaming && !hasSensors ? (
            <View style={S.centerState}>
              <Text style={S.emptyTitle}>NO DATA</Text>
              <Text style={S.emptySub}>Press START STREAM to begin receiving{'\n'}live OBD-II sensor readings</Text>
            </View>
          ) : (
            <ScrollView style={S.scroll} contentContainerStyle={S.grid}>
              {/* Engine sensor cards — MODULE_KEYS excluded; those render in module cards below */}
              {SENSOR_KEYS.filter(k => !MODULE_KEYS.has(k)).map(key => (
                <SensorCard key={key} sensorKey={key} entry={sensors[key]} />
              ))}

              {/* ── ABS / Traction Control Card ── */}
              <ABSCard
                chassisDtcs={(dtcCodes ?? []).filter(c => c.startsWith('C'))}
                style={{ width: moduleCardWidth }}
              />

              {/* ── Transmission Card ── */}
              {isModuleLoading ? (
                <SkeletonCard
                  label="TRANSMISSION"
                  style={{ width: moduleCardWidth }}
                />
              ) : hasTCM ? (
                <TransmissionCard
                  sensors={sensors}
                  style={{ width: moduleCardWidth }}
                />
              ) : (
                <NotDetectedCard
                  label="TRANSMISSION"
                  style={{ width: moduleCardWidth }}
                />
              )}

              {/* ── BLE DTC codes panel ── */}
              {bleConnected && (dtcCodes.length > 0 || pendingDtcCodes.length > 0) && (
                <View style={[S.dtcPanel, { width: '100%' }]}>
                  <Text style={S.dtcPanelHeader}>FAULT CODES — OBD2 MODE 03/07</Text>
                  {dtcCodes.length > 0 && (
                    <>
                      <Text style={S.dtcSubHeader}>STORED</Text>
                      <View style={S.dtcRow}>
                        {dtcCodes.map(code => (
                          <View key={code} style={S.dtcBadge}>
                            <Text style={S.dtcBadgeText}>{code}</Text>
                          </View>
                        ))}
                      </View>
                    </>
                  )}
                  {pendingDtcCodes.length > 0 && (
                    <>
                      <Text style={[S.dtcSubHeader, { color: C.amber }]}>PENDING</Text>
                      <View style={S.dtcRow}>
                        {pendingDtcCodes.map(code => (
                          <View key={code} style={[S.dtcBadge, { borderColor: C.amber }]}>
                            <Text style={[S.dtcBadgeText, { color: C.amber }]}>{code}</Text>
                          </View>
                        ))}
                      </View>
                    </>
                  )}
                </View>
              )}

              {/* Stream info footer card */}
              {(streaming || bleConnected) && (
                <View style={[S.infoCard, bleConnected && S.infoCardBLE]}>
                  <ActivityIndicator size="small" color={bleConnected ? C.accent : C.green} />
                  <Text style={S.infoText}>
                    {bleConnected
                      ? 'Live OBD-II data via Bluetooth · Background scan active'
                      : 'Buffering readings every 2s · Flushing to DB every 5s'}
                  </Text>
                </View>
              )}

              {/* ── Sensor history chart ── */}
              <View style={{ width: '100%' }}>
                <SensorHistoryChart
                  seriesMap={seriesMap}
                  loading={histLoading}
                  error={histError}
                  window={histWindow}
                  onWindowChange={changeWindow}
                />
              </View>
            </ScrollView>
          )}
        </>
      )}

      {/* ── Footer ── */}
      <Text style={S.footer}>
        {bleConnected
          ? 'OBD-II BLE · NATIVE SENSOR STREAM · SAE J1979'
          : 'OBD-II SENSOR BUFFER · PHASE 3 · SAE J1979'}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Engine sensor card styles  (unchanged)
// ---------------------------------------------------------------------------

const SC = StyleSheet.create({
  card: {
    width: '48%',
    backgroundColor: C.surface,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
    gap: 6,
  },
  label: {
    color: C.textMuted, fontSize: 9, fontWeight: '700',
    letterSpacing: 1.5, textTransform: 'uppercase',
  },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  value:    { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  unit:     { color: C.textMuted, fontSize: 11, fontWeight: '600', marginBottom: 2 },
  barTrack: { height: 2, backgroundColor: '#222', overflow: 'hidden' },
  barFill:  { height: 2 },
  status:   { fontSize: 8, fontWeight: '800', letterSpacing: 2 },
});

// ---------------------------------------------------------------------------
// Skeleton card styles
// ---------------------------------------------------------------------------

const SK = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 10,
    gap: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot:    { width: 6, height: 6, backgroundColor: '#303030' },
  label:  { color: '#303030', fontSize: 9, fontWeight: '700', letterSpacing: 1.5 },
  rowPlaceholder: {
    height: 8, width: '100%',
    backgroundColor: '#222', borderRadius: 0,
  },
});

// ---------------------------------------------------------------------------
// Not-detected card styles
// ---------------------------------------------------------------------------

const ND = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 10,
    gap: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot:    { width: 6, height: 6, backgroundColor: '#303030' },
  label:  { color: '#404040', fontSize: 9, fontWeight: '700', letterSpacing: 1.5, flex: 1 },
  badge: {
    borderWidth: 1, borderColor: '#303030',
    paddingHorizontal: 6, paddingVertical: 2,
  },
  badgeText: { color: '#404040', fontSize: 7, fontWeight: '800', letterSpacing: 1.5 },
  sub: { color: '#333', fontSize: 10, letterSpacing: 0.3 },
});

// ---------------------------------------------------------------------------
// Module card shared styles
// ---------------------------------------------------------------------------

const MC = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
    gap: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  statusDot: { width: 6, height: 6 },
  moduleLabel: {
    color: C.accent, fontSize: 9, fontWeight: '800',
    letterSpacing: 1.5, flex: 1,
  },
  moduleTag: {
    fontSize: 7, fontWeight: '700', letterSpacing: 1,
  },
  divider: {
    height: 1, backgroundColor: C.border, marginBottom: 10,
  },
  pill: {
    borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3,
  },
  pillText: { fontSize: 8, fontWeight: '800', letterSpacing: 1.5 },
  gearValue: {
    color: C.textPrimary, fontSize: 22, fontWeight: '800', letterSpacing: -0.5,
  },
});

// ---------------------------------------------------------------------------
// Module sensor row styles
// ---------------------------------------------------------------------------

const MR = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: '#161616',
  },
  label: {
    color: C.textMuted, fontSize: 8, fontWeight: '700',
    letterSpacing: 1.5, textTransform: 'uppercase',
    flex: 1,
  },
  right: { flex: 1.4, gap: 3 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  value:    { fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  unit:     { color: C.textMuted, fontSize: 9, fontWeight: '600' },
  barTrack: { height: 2, backgroundColor: '#222', overflow: 'hidden' },
  barFill:  { height: 2 },
  statusText: { fontSize: 7, fontWeight: '800', letterSpacing: 1.5 },
});

// ---------------------------------------------------------------------------
// ABS info card styles
// ---------------------------------------------------------------------------

const ABS = StyleSheet.create({
  infoText: {
    color: '#555', fontSize: 10, lineHeight: 16, letterSpacing: 0.2,
  },
  faultSection: { marginTop: 10, gap: 4 },
  faultHeader: {
    color: C.amber, fontSize: 8, fontWeight: '800', letterSpacing: 1.5, marginBottom: 4,
  },
  faultRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  faultDot: { width: 5, height: 5 },
  faultCode: { color: C.amber, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
});

// ---------------------------------------------------------------------------
// Screen styles  (unchanged)
// ---------------------------------------------------------------------------

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerLeft:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: {
    color: C.accent, fontSize: 13, fontWeight: '800',
    letterSpacing: 3, textTransform: 'uppercase',
  },
  pulseDot: { width: 7, height: 7, backgroundColor: C.green },
  staticDot: { width: 7, height: 7, backgroundColor: C.textMuted, opacity: 0.4 },
  critBadge: {
    backgroundColor: C.red, width: 18, height: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  critBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  timestamp: { color: C.textMuted, fontSize: 10, letterSpacing: 0.5 },

  // Sub-header
  subHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  subHeaderText: { color: C.textMuted, fontSize: 10, letterSpacing: 1 },
  streamStatus: { flexDirection: 'row', alignItems: 'center' },
  streamLabel:  { fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },

  // Stream control
  controlBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
    gap: 10,
  },
  streamBtn: {
    flex: 1, paddingVertical: 11,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  streamBtnStart:   { borderColor: C.green,  backgroundColor: 'rgba(76,175,130,0.06)' },
  streamBtnStop:    { borderColor: C.red,    backgroundColor: 'rgba(208,69,58,0.06)'  },
  streamBtnBLE:     { borderColor: C.accent, backgroundColor: 'rgba(192,192,192,0.04)', flexDirection: 'row' },
  streamBtnBLEScan: { borderColor: '#3A3A3A', backgroundColor: 'rgba(192,192,192,0.03)', flexDirection: 'row' },
  streamBtnText:    { fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  pollBadge: {
    paddingHorizontal: 10, paddingVertical: 11,
    borderWidth: 1, borderColor: C.border,
  },
  pollBadgeText: { color: '#404040', fontSize: 9, fontWeight: '700', letterSpacing: 1.5 },

  // Error banner
  errorBanner: {
    backgroundColor: 'rgba(208,69,58,0.1)', borderBottomWidth: 1,
    borderBottomColor: 'rgba(208,69,58,0.3)', paddingHorizontal: 16, paddingVertical: 8,
  },
  errorBannerText: { color: C.red, fontSize: 11 },

  // BLE disconnect banner
  disconnectBanner: {
    flexDirection: 'row',
    backgroundColor: 'rgba(192,139,48,0.08)',
    borderBottomWidth: 1, borderBottomColor: 'rgba(192,139,48,0.25)',
  },
  disconnectStripe: { width: 3, backgroundColor: C.amber },
  disconnectText: {
    flex: 1, color: C.amber, fontSize: 9, fontWeight: '700',
    letterSpacing: 1.5, padding: 10,
  },

  // Drive safety wrap
  safetyWrap: { paddingHorizontal: 16, paddingTop: 12 },

  // Grid
  scroll: { flex: 1 },
  grid: {
    padding: 12, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between',
  },

  // Info card (streaming active)
  infoCard: {
    width: '100%', flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(76,175,130,0.05)',
    borderWidth: 1, borderColor: 'rgba(76,175,130,0.15)',
    padding: 12, gap: 10, marginBottom: 10,
  },
  infoCardBLE: {
    backgroundColor: 'rgba(192,192,192,0.04)',
    borderColor: 'rgba(192,192,192,0.15)',
  },
  infoText: { color: '#404040', fontSize: 10, flex: 1, letterSpacing: 0.3 },

  // Center states
  centerState: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10,
  },
  noVehicleDot: { width: 10, height: 10, backgroundColor: '#303030', marginBottom: 8 },
  emptyTitle: {
    color: C.textMuted, fontSize: 12, fontWeight: '800',
    letterSpacing: 3, textTransform: 'uppercase',
  },
  emptySub: {
    color: '#404040', fontSize: 11, letterSpacing: 0.5,
    textAlign: 'center', lineHeight: 18,
  },

  // BLE device list
  deviceList: {
    borderBottomWidth: 1, borderBottomColor: C.border,
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: '#0D0D0D',
  },
  deviceListHeader: {
    color: '#404040', fontSize: 8, fontWeight: '800',
    letterSpacing: 2, marginBottom: 8,
  },
  deviceRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    borderTopWidth: 1, borderTopColor: '#161616',
  },
  deviceRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  deviceDot: { width: 5, height: 5, backgroundColor: C.accent },
  deviceName: {
    color: C.textPrimary, fontSize: 12, fontWeight: '700', letterSpacing: 0.5,
  },
  deviceRssi: {
    color: C.textMuted, fontSize: 9, fontWeight: '600', letterSpacing: 0.5,
  },

  // DTC panel
  dtcPanel: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    padding: 14, marginBottom: 10, gap: 6,
  },
  dtcPanelHeader: {
    color: C.textMuted, fontSize: 8, fontWeight: '800', letterSpacing: 2,
    marginBottom: 4,
  },
  dtcSubHeader: {
    color: C.textMuted, fontSize: 7, fontWeight: '700', letterSpacing: 1.5,
    marginTop: 4,
  },
  dtcRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  dtcBadge: {
    borderWidth: 1, borderColor: C.red,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  dtcBadgeText: { color: C.red, fontSize: 11, fontWeight: '700', letterSpacing: 1 },

  // Footer
  footer: {
    color: '#252525', fontSize: 9, letterSpacing: 1.5,
    textAlign: 'center', paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: C.border,
    textTransform: 'uppercase',
  },
});
