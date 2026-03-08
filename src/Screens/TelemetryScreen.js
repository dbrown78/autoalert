import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import client from '../api/client';

const C = {
  bg: '#080808', surface: '#1A1A1A', border: '#2A2A2A',
  textPrimary: '#E0E0E0', textMuted: '#777777', accent: '#C0C0C0',
  red: '#D0453A', green: '#4CAF82', amber: '#C08B30',
};

// Threshold rules (mirrors foresight RULES)
const THRESHOLDS = {
  coolant_temp:      { warnHigh: 95,  critHigh: 105 },
  rpm:               { warnHigh: 6000, critHigh: 7000 },
  voltage:           { warnLow: 11.5, critLow: 10 },
  oil_pressure:      { warnLow: 2,    critLow: 1 },
  fuel_pressure:     { warnLow: 30,   critLow: 20 },
  coolant_pressure:  { warnHigh: 18,  critHigh: 22 },
  engine_load:       { warnHigh: 80,  critHigh: 95 },
  fuel_trim:         { warnHigh: 10,  critHigh: 20, warnLow: -10, critLow: -20 },
};

const SENSOR_META = {
  coolant_temp:     { label: 'COOLANT TEMP',     unit: '°C',  normalRange: [75, 95] },
  rpm:              { label: 'ENGINE RPM',        unit: 'rpm', normalRange: [600, 3000] },
  voltage:          { label: 'BATTERY VOLTAGE',  unit: 'V',   normalRange: [12, 14.7] },
  oil_pressure:     { label: 'OIL PRESSURE',     unit: 'bar', normalRange: [2, 5] },
  fuel_pressure:    { label: 'FUEL PRESSURE',    unit: 'kPa', normalRange: [30, 55] },
  coolant_pressure: { label: 'COOLANT PRESSURE', unit: 'bar', normalRange: [0.8, 1.6] },
  engine_load:      { label: 'ENGINE LOAD',      unit: '%',   normalRange: [10, 70] },
  fuel_trim:        { label: 'FUEL TRIM',        unit: '%',   normalRange: [-5, 5] },
};

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

function miniBarWidth(key, value) {
  const meta = SENSOR_META[key];
  if (!meta || value == null) return 0;
  const [lo, hi] = meta.normalRange;
  const span = hi - lo;
  const pct = Math.max(0, Math.min(1, (value - lo) / span));
  return pct;
}

function SensorCard({ sensorKey, value }) {
  const meta = SENSOR_META[sensorKey] ?? { label: sensorKey.toUpperCase(), unit: '' };
  const status = getSensorStatus(sensorKey, value);
  const color = statusColor(status);
  const barFill = miniBarWidth(sensorKey, value);

  const displayVal = value != null
    ? (typeof value === 'number' ? value.toFixed(1) : String(value))
    : '—';

  return (
    <View style={[SC.card, { borderColor: status === 'critical' ? C.red : status === 'warn' ? C.amber : C.border }]}>
      <Text style={SC.label}>{meta.label}</Text>
      <View style={SC.valueRow}>
        <Text style={[SC.value, { color }]}>{displayVal}</Text>
        <Text style={SC.unit}>{meta.unit}</Text>
      </View>
      {/* Mini status bar */}
      <View style={SC.miniBarTrack}>
        <View style={[SC.miniBarFill, { width: `${Math.round(barFill * 100)}%`, backgroundColor: color }]} />
      </View>
      <Text style={[SC.statusText, { color }]}>{status.toUpperCase()}</Text>
    </View>
  );
}

const SENSOR_KEYS = [
  'coolant_temp', 'rpm', 'voltage', 'oil_pressure',
  'fuel_pressure', 'coolant_pressure', 'engine_load', 'fuel_trim',
];

export default function TelemetryScreen() {
  const { selectedVehicle } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const intervalRef = useRef(null);

  const fetchTelemetry = useCallback(async () => {
    if (!selectedVehicle?.id) { setLoading(false); return; }
    try {
      const res = await client.get('/telemetry/latest', {
        params: { vehicle_id: selectedVehicle.id },
      });
      setData(res.data?.sensors ?? res.data ?? null);
      setLastUpdated(new Date());
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [selectedVehicle?.id]);

  useEffect(() => {
    setLoading(true);
    fetchTelemetry();
    intervalRef.current = setInterval(fetchTelemetry, 5000);
    return () => clearInterval(intervalRef.current);
  }, [fetchTelemetry]);

  const timeStr = lastUpdated
    ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  // Determine active alerts count for header badge
  const critCount = data
    ? SENSOR_KEYS.filter(k => getSensorStatus(k, data[k]) === 'critical').length
    : 0;

  return (
    <View style={S.container}>
      {/* ── Header ── */}
      <View style={S.header}>
        <View style={S.headerLeft}>
          <View style={[S.headerDot, { backgroundColor: data ? C.green : C.textMuted }]} />
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
          <View style={S.pollIndicator}>
            <ActivityIndicator size="small" color={data ? C.green : C.textMuted} />
            <Text style={S.pollLabel}>POLLING 5S</Text>
          </View>
        </View>
      )}

      {/* ── Body ── */}
      {!selectedVehicle ? (
        <View style={S.centerState}>
          <View style={S.noAdapterDot} />
          <Text style={S.noAdapterTitle}>NO ADAPTER CONNECTED</Text>
          <Text style={S.noAdapterSub}>Add a vehicle to receive telemetry data</Text>
        </View>
      ) : loading ? (
        <View style={S.centerState}>
          <ActivityIndicator size="large" color={C.accent} />
          <Text style={S.loadingText}>ACQUIRING SENSOR DATA...</Text>
        </View>
      ) : error && !data ? (
        <View style={S.centerState}>
          <Text style={S.errorTitle}>TELEMETRY UNAVAILABLE</Text>
          <Text style={S.errorSub}>Could not reach telemetry endpoint</Text>
          <TouchableOpacity style={S.retryBtn} onPress={fetchTelemetry}>
            <Text style={S.retryText}>RETRY</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView style={S.scroll} contentContainerStyle={S.grid}>
          {SENSOR_KEYS.map(key => (
            <SensorCard key={key} sensorKey={key} value={data?.[key]} />
          ))}
        </ScrollView>
      )}

      {/* ── Footer ── */}
      <Text style={S.footer}>OBD-II SENSOR DATA · SAE J1979 · ISO 15031</Text>
    </View>
  );
}

const SC = StyleSheet.create({
  card: {
    width: '48%', backgroundColor: C.surface,
    borderWidth: 1, borderRadius: 0,
    padding: 14, marginBottom: 10,
    gap: 6,
  },
  label: {
    color: C.textMuted, fontSize: 9, fontWeight: '700',
    letterSpacing: 1.5, textTransform: 'uppercase',
  },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  value: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  unit: { color: C.textMuted, fontSize: 11, fontWeight: '600', marginBottom: 2 },
  miniBarTrack: {
    height: 2, backgroundColor: '#222', borderRadius: 0, overflow: 'hidden',
  },
  miniBarFill: { height: 2, borderRadius: 0 },
  statusText: { fontSize: 8, fontWeight: '800', letterSpacing: 2 },
});

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerDot: { width: 7, height: 7, borderRadius: 0 },
  headerTitle: {
    color: C.accent, fontSize: 13, fontWeight: '800',
    letterSpacing: 3, textTransform: 'uppercase',
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  critBadge: {
    backgroundColor: C.red, width: 18, height: 18,
    alignItems: 'center', justifyContent: 'center', borderRadius: 0,
  },
  critBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  timestamp: { color: C.textMuted, fontSize: 10, letterSpacing: 0.5 },

  subHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  subHeaderText: { color: C.textMuted, fontSize: 10, letterSpacing: 1 },
  pollIndicator: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pollLabel: { color: '#333', fontSize: 8, letterSpacing: 2 },

  scroll: { flex: 1 },
  grid: {
    padding: 12,
    flexDirection: 'row', flexWrap: 'wrap',
    justifyContent: 'space-between',
  },

  centerState: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10,
  },
  noAdapterDot: {
    width: 10, height: 10, borderRadius: 0, backgroundColor: '#303030', marginBottom: 8,
  },
  noAdapterTitle: {
    color: C.textMuted, fontSize: 12, fontWeight: '800',
    letterSpacing: 3, textTransform: 'uppercase',
  },
  noAdapterSub: { color: '#404040', fontSize: 11, letterSpacing: 0.5 },
  loadingText: {
    color: C.textMuted, fontSize: 10, letterSpacing: 2,
    textTransform: 'uppercase', marginTop: 12,
  },
  errorTitle: {
    color: C.red, fontSize: 11, fontWeight: '800',
    letterSpacing: 2, textTransform: 'uppercase',
  },
  errorSub: { color: C.textMuted, fontSize: 11 },
  retryBtn: {
    marginTop: 8, paddingHorizontal: 20, paddingVertical: 9,
    borderWidth: 1, borderColor: C.accent, borderRadius: 0,
  },
  retryText: {
    color: C.accent, fontSize: 10, fontWeight: '800', letterSpacing: 2,
  },

  footer: {
    color: '#252525', fontSize: 9, letterSpacing: 1.5,
    textAlign: 'center', paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: C.border,
    textTransform: 'uppercase',
  },
});
