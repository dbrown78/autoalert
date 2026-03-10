import { useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  ActivityIndicator, TouchableOpacity, Animated,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import useSensorStream from '../../hooks/useSensorStream';

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

const C = {
  bg: '#080808', surface: '#1A1A1A', border: '#2A2A2A',
  textPrimary: '#E0E0E0', textMuted: '#777777', accent: '#C0C0C0',
  red: '#D0453A', green: '#4CAF82', amber: '#C08B30',
};

// ---------------------------------------------------------------------------
// Sensor metadata — must match Phase 3 mockOBD2Stream sensor types
// ---------------------------------------------------------------------------

const SENSOR_META = {
  coolant_temp:  { label: 'COOLANT TEMP',    unit: '°C',  normalRange: [75,  95]   },
  rpm:           { label: 'ENGINE RPM',       unit: 'rpm', normalRange: [600, 3000] },
  voltage:       { label: 'BATTERY VOLTAGE', unit: 'V',   normalRange: [12,  14.7] },
  o2_sensor:     { label: 'O2 SENSOR',       unit: 'V',   normalRange: [0.1, 0.9]  },
  fuel_trim:     { label: 'FUEL TRIM',       unit: '%',   normalRange: [-5,  5]    },
  engine_load:   { label: 'ENGINE LOAD',     unit: '%',   normalRange: [10,  70]   },
  intake_temp:   { label: 'INTAKE TEMP',     unit: '°C',  normalRange: [20,  50]   },
};

const THRESHOLDS = {
  coolant_temp: { warnHigh: 95,  critHigh: 105 },
  rpm:          { warnHigh: 5500, critHigh: 6500 },
  voltage:      { warnLow: 11.8, critLow: 10.5 },
  o2_sensor:    { warnHigh: 1.2, critHigh: 1.5, warnLow: 0.05, critLow: 0 },
  fuel_trim:    { warnHigh: 10,  critHigh: 20,  warnLow: -10,  critLow: -20 },
  engine_load:  { warnHigh: 80,  critHigh: 95 },
  intake_temp:  { warnHigh: 55,  critHigh: 65 },
};

const SENSOR_KEYS = Object.keys(SENSOR_META);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSensorStatus(key, value) {
  const t = THRESHOLDS[key];
  if (!t || value == null) return 'unknown';
  if (t.critHigh != null && value >= t.critHigh) return 'critical';
  if (t.critLow  != null && value <= t.critLow)  return 'critical';
  if (t.warnHigh != null && value >= t.warnHigh) return 'warn';
  if (t.warnLow  != null && value <= t.warnLow)  return 'warn';
  return 'normal';
}

function statusColor(status) {
  if (status === 'critical') return C.red;
  if (status === 'warn')     return C.amber;
  if (status === 'normal')   return C.green;
  return C.textMuted;
}

function barFillPct(key, value) {
  const meta = SENSOR_META[key];
  if (!meta || value == null) return 0;
  const [lo, hi] = meta.normalRange;
  return Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
}

// ---------------------------------------------------------------------------
// SensorCard
// ---------------------------------------------------------------------------

function SensorCard({ sensorKey, entry }) {
  // entry = { value: number, recorded_at: string } | undefined
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
// Pulsing dot (shown when streaming)
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
  const { selectedVehicle } = useAuth();
  const vehicleId = selectedVehicle?.id ?? null;

  const { sensors, streaming, error, startStream, stopStream } = useSensorStream(vehicleId);

  const hasSensors  = Object.keys(sensors).length > 0;
  const critCount   = SENSOR_KEYS.filter(k => getSensorStatus(k, sensors[k]?.value) === 'critical').length;

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
            {streaming
              ? <Text style={[S.streamLabel, { color: C.green }]}>● STREAMING LIVE</Text>
              : <Text style={[S.streamLabel, { color: C.textMuted }]}>○ STREAM INACTIVE</Text>
            }
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
          {/* ── Stream control button ── */}
          <View style={S.controlBar}>
            <TouchableOpacity
              onPress={streaming ? stopStream : startStream}
              style={[S.streamBtn, streaming ? S.streamBtnStop : S.streamBtnStart]}
              activeOpacity={0.75}
            >
              {streaming ? (
                <Text style={[S.streamBtnText, { color: C.red }]}>■  STOP STREAM</Text>
              ) : (
                <Text style={[S.streamBtnText, { color: C.green }]}>▶  START STREAM</Text>
              )}
            </TouchableOpacity>

            <View style={S.pollBadge}>
              <Text style={S.pollBadgeText}>3S POLL</Text>
            </View>
          </View>

          {/* ── Error banner ── */}
          {error && (
            <View style={S.errorBanner}>
              <Text style={S.errorBannerText}>{error}</Text>
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
              {SENSOR_KEYS.map(key => (
                <SensorCard key={key} sensorKey={key} entry={sensors[key]} />
              ))}

              {/* Stream info footer card */}
              {streaming && (
                <View style={S.infoCard}>
                  <ActivityIndicator size="small" color={C.green} />
                  <Text style={S.infoText}>
                    Buffering readings every 2s · Flushing to DB every 5s
                  </Text>
                </View>
              )}
            </ScrollView>
          )}
        </>
      )}

      {/* ── Footer ── */}
      <Text style={S.footer}>OBD-II SENSOR BUFFER · PHASE 3 · SAE J1979</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sensor card styles
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
// Screen styles
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
  streamBtnStart: { borderColor: C.green, backgroundColor: 'rgba(76,175,130,0.06)' },
  streamBtnStop:  { borderColor: C.red,   backgroundColor: 'rgba(208,69,58,0.06)'  },
  streamBtnText:  { fontSize: 11, fontWeight: '800', letterSpacing: 2 },
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

  // Footer
  footer: {
    color: '#252525', fontSize: 9, letterSpacing: 1.5,
    textAlign: 'center', paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: C.border,
    textTransform: 'uppercase',
  },
});
