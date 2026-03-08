import { useState, useEffect, useCallback } from 'react';
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

const SEVERITY_CONFIG = {
  high:   { color: C.red,   label: 'HIGH' },
  medium: { color: C.amber, label: 'MED' },
  low:    { color: C.green, label: 'LOW' },
};

const HEALTH_KEYS = [
  { key: 'coolant',  label: 'COOLANT SYSTEM' },
  { key: 'battery',  label: 'BATTERY / CHARGING' },
  { key: 'oil',      label: 'OIL SYSTEM' },
  { key: 'brakes',   label: 'BRAKE SYSTEM' },
];

function healthColor(score) {
  if (score >= 0.8) return C.green;
  if (score >= 0.5) return C.amber;
  return C.red;
}

function HealthBar({ label, score }) {
  const pct = Math.max(0, Math.min(1, score ?? 0));
  const color = healthColor(pct);
  const pctLabel = Math.round(pct * 100);

  return (
    <View style={HB.row}>
      <Text style={HB.label}>{label}</Text>
      <View style={HB.trackWrap}>
        <View style={HB.track}>
          <View style={[HB.fill, { width: `${pctLabel}%`, backgroundColor: color }]} />
        </View>
      </View>
      <Text style={[HB.pct, { color }]}>{pctLabel}%</Text>
    </View>
  );
}

function AlertRow({ alert }) {
  const sev = SEVERITY_CONFIG[alert.severity?.toLowerCase()] ?? SEVERITY_CONFIG.low;
  const ts = alert.timestamp
    ? new Date(alert.timestamp).toLocaleString([], {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : null;

  return (
    <View style={AR.row}>
      <View style={[AR.bar, { backgroundColor: sev.color }]} />
      <View style={AR.body}>
        <View style={AR.topRow}>
          <Text style={AR.sensor}>{alert.sensor_label ?? alert.sensor ?? 'Unknown'}</Text>
          <View style={[AR.sevPill, { backgroundColor: `${sev.color}1A`, borderColor: sev.color }]}>
            <Text style={[AR.sevText, { color: sev.color }]}>{sev.label}</Text>
          </View>
        </View>
        <Text style={AR.rule} numberOfLines={2}>{alert.rule_description ?? alert.message ?? alert.label ?? ''}</Text>
        {ts && <Text style={AR.ts}>{ts}</Text>}
      </View>
    </View>
  );
}

export default function ForesightScreen() {
  const { selectedVehicle } = useAuth();
  const [health, setHealth]   = useState(null);
  const [alerts, setAlerts]   = useState([]);
  const [loadingHealth, setLoadingHealth] = useState(true);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [errorHealth, setErrorHealth] = useState(false);
  const [errorAlerts, setErrorAlerts] = useState(false);

  const load = useCallback(async () => {
    if (!selectedVehicle?.id) {
      setLoadingHealth(false);
      setLoadingAlerts(false);
      return;
    }
    const id = selectedVehicle.id;

    setLoadingHealth(true);
    setLoadingAlerts(true);
    setErrorHealth(false);
    setErrorAlerts(false);

    const [healthRes, alertsRes] = await Promise.allSettled([
      client.get(`/foresight/health`, { params: { vehicle_id: id } }),
      client.get(`/foresight/alerts`, { params: { vehicle_id: id } }),
    ]);

    if (healthRes.status === 'fulfilled') {
      setHealth(healthRes.value.data?.health ?? healthRes.value.data ?? null);
    } else {
      setErrorHealth(true);
    }
    setLoadingHealth(false);

    if (alertsRes.status === 'fulfilled') {
      setAlerts(alertsRes.value.data?.alerts ?? alertsRes.value.data ?? []);
    } else {
      setErrorAlerts(true);
    }
    setLoadingAlerts(false);
  }, [selectedVehicle?.id]);

  useEffect(() => { load(); }, [load]);

  const totalAlerts = alerts.length;
  const critAlerts  = alerts.filter(a => (a.severity ?? '').toLowerCase() === 'high').length;

  return (
    <View style={S.container}>
      {/* ── Header ── */}
      <View style={S.header}>
        <View style={S.headerLeft}>
          <View style={S.headerDot} />
          <View>
            <Text style={S.headerTitle}>FORESIGHT</Text>
            <Text style={S.headerSub}>PREDICTIVE ANALYSIS</Text>
          </View>
        </View>
        <View style={S.headerRight}>
          <View style={S.phaseBadge}>
            <Text style={S.phaseText}>PHASE 1 · RULE-BASED</Text>
          </View>
          {!loadingAlerts && !loadingHealth && (
            <TouchableOpacity onPress={load} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={S.refreshIcon}>↺</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Vehicle pill ── */}
      {selectedVehicle && (
        <View style={S.vehicleBar}>
          <Text style={S.vehicleText}>
            {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}
          </Text>
          {totalAlerts > 0 && (
            <View style={[S.alertBadge, { backgroundColor: critAlerts > 0 ? C.red : C.amber }]}>
              <Text style={S.alertBadgeText}>{totalAlerts} alert{totalAlerts !== 1 ? 's' : ''}</Text>
            </View>
          )}
        </View>
      )}

      <ScrollView style={S.scroll} contentContainerStyle={S.scrollContent}>

        {/* ── Component Health ── */}
        <View style={S.section}>
          <Text style={S.sectionTitle}>COMPONENT HEALTH</Text>
          <View style={S.sectionCard}>
            {loadingHealth ? (
              <View style={S.loadRow}>
                <ActivityIndicator size="small" color={C.accent} />
                <Text style={S.loadText}>Analyzing components...</Text>
              </View>
            ) : errorHealth ? (
              <Text style={S.errorText}>Could not load health data</Text>
            ) : !health ? (
              <Text style={S.mutedText}>No health data available</Text>
            ) : (
              HEALTH_KEYS.map(({ key, label }) => (
                <HealthBar key={key} label={label} score={health[key]} />
              ))
            )}
          </View>
        </View>

        {/* ── Active Alerts ── */}
        <View style={S.section}>
          <View style={S.sectionTitleRow}>
            <Text style={S.sectionTitle}>ACTIVE ALERTS</Text>
            {totalAlerts > 0 && (
              <View style={S.countBadge}>
                <Text style={S.countText}>{totalAlerts}</Text>
              </View>
            )}
          </View>

          {loadingAlerts ? (
            <View style={S.loadRow}>
              <ActivityIndicator size="small" color={C.accent} />
              <Text style={S.loadText}>Loading alerts...</Text>
            </View>
          ) : errorAlerts ? (
            <View style={S.errorRow}>
              <View style={S.errorStripe} />
              <Text style={S.errorText}>Could not load alerts</Text>
            </View>
          ) : alerts.length === 0 ? (
            <View style={S.emptyAlerts}>
              <View style={S.emptyDotRow}>
                <View style={[S.emptyDot, { backgroundColor: C.green }]} />
                <View style={[S.emptyDot, { backgroundColor: C.green, opacity: 0.5 }]} />
                <View style={[S.emptyDot, { backgroundColor: C.green, opacity: 0.25 }]} />
              </View>
              <Text style={S.emptyTitle}>ALL SYSTEMS NOMINAL</Text>
              <Text style={S.emptySub}>No predictive alerts detected</Text>
            </View>
          ) : (
            alerts.map((alert, i) => <AlertRow key={alert.id ?? i} alert={alert} />)
          )}
        </View>

        {/* ── Prediction note ── */}
        <View style={S.noteCard}>
          <View style={S.noteLeft} />
          <Text style={S.noteText}>
            ML ANALYSIS AVAILABLE IN V1.1 · FORESIGHT PHASE 4
          </Text>
        </View>

        {/* ── Footer brand ── */}
        <Text style={S.brandLine}>POWERED BY ODIN PREDICTIVE ANALYSIS</Text>
      </ScrollView>
    </View>
  );
}

const HB = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  label: { width: 130, color: C.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  trackWrap: { flex: 1 },
  track: {
    height: 3, backgroundColor: '#222', borderRadius: 0, overflow: 'hidden',
  },
  fill: { height: 3, borderRadius: 0 },
  pct: { width: 36, textAlign: 'right', fontSize: 11, fontWeight: '700' },
});

const AR = StyleSheet.create({
  row: {
    flexDirection: 'row', backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border, marginBottom: 8,
  },
  bar: { width: 3 },
  body: { flex: 1, padding: 12, gap: 4 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sensor: {
    color: C.textPrimary, fontSize: 12, fontWeight: '700',
    letterSpacing: 0.5, flex: 1,
  },
  sevPill: {
    paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderRadius: 0,
  },
  sevText: { fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  rule: { color: C.textMuted, fontSize: 11, lineHeight: 16 },
  ts: { color: '#404040', fontSize: 9, letterSpacing: 0.5, marginTop: 2 },
});

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerDot: { width: 7, height: 7, borderRadius: 0, backgroundColor: C.accent },
  headerTitle: {
    color: C.accent, fontSize: 13, fontWeight: '800',
    letterSpacing: 3, textTransform: 'uppercase', lineHeight: 16,
  },
  headerSub: {
    color: '#404040', fontSize: 8, letterSpacing: 2,
    textTransform: 'uppercase', fontWeight: '700',
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  phaseBadge: {
    borderWidth: 1, borderColor: '#303030',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 0,
  },
  phaseText: { color: '#505050', fontSize: 8, fontWeight: '700', letterSpacing: 1.5 },
  refreshIcon: { color: 'rgba(192,192,192,0.4)', fontSize: 16, fontWeight: 'bold' },

  vehicleBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  vehicleText: { color: C.textMuted, fontSize: 10, letterSpacing: 1 },
  alertBadge: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 0,
  },
  alertBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },

  section: { marginBottom: 20 },
  sectionTitle: {
    color: C.textMuted, fontSize: 9, fontWeight: '700',
    letterSpacing: 3, textTransform: 'uppercase', marginBottom: 10,
  },
  sectionTitleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10,
  },
  countBadge: {
    backgroundColor: C.red, width: 18, height: 18,
    alignItems: 'center', justifyContent: 'center', borderRadius: 0,
  },
  countText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  sectionCard: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, padding: 14,
  },

  loadRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8,
  },
  loadText: { color: C.textMuted, fontSize: 11 },

  errorRow: {
    flexDirection: 'row', backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border,
  },
  errorStripe: { width: 3, backgroundColor: C.red },
  errorText: { color: C.red, fontSize: 12, padding: 12 },
  mutedText: { color: '#404040', fontSize: 11 },

  emptyAlerts: {
    alignItems: 'center', paddingVertical: 28, gap: 6,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  emptyDotRow: { flexDirection: 'row', gap: 5, marginBottom: 8 },
  emptyDot: { width: 6, height: 6, borderRadius: 0 },
  emptyTitle: {
    color: C.green, fontSize: 12, fontWeight: '800',
    letterSpacing: 2, textTransform: 'uppercase',
  },
  emptySub: { color: C.textMuted, fontSize: 11 },

  noteCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surface, borderWidth: 1, borderColor: '#252525',
    marginBottom: 16,
  },
  noteLeft: { width: 3, backgroundColor: '#303030', alignSelf: 'stretch' },
  noteText: {
    flex: 1, color: '#404040', fontSize: 9,
    letterSpacing: 1.5, fontWeight: '700', padding: 12,
  },

  brandLine: {
    color: 'rgba(192,192,192,0.12)', fontSize: 9, fontWeight: '600',
    letterSpacing: 2, textTransform: 'uppercase', textAlign: 'center',
    paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.border,
  },
});
