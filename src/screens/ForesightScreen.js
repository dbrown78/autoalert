import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import client from '../api/client';

const C = {
  bg: '#080808', surface: '#1A1A1A', border: '#2A2A2A',
  textPrimary: '#E0E0E0', textMuted: '#777777', accent: '#C0C0C0',
  red: '#D0453A', green: '#4CAF82', amber: '#C08B30', blue: '#4A90D9',
};

const SEVERITY_COLOR = {
  healthy:  C.green,
  early:    C.amber,
  late:     C.amber,
  imminent: C.red,
};

const SEVERITY_LABEL = {
  healthy:  'NOMINAL',
  early:    'EARLY WARNING',
  late:     'DEGRADING',
  imminent: 'IMMINENT FAILURE',
};

const ALERT_COLOR = {
  high:   C.red,
  medium: C.amber,
  low:    C.green,
};

const HEALTH_KEYS = [
  { key: 'coolant',  label: 'COOLANT SYSTEM' },
  { key: 'battery',  label: 'BATTERY / CHARGING' },
  { key: 'oil',      label: 'OIL SYSTEM' },
  { key: 'brakes',   label: 'BRAKE SYSTEM' },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function ProbabilityGauge({ prob, severity }) {
  const color = SEVERITY_COLOR[severity] ?? C.accent;
  const pct   = Math.round((prob ?? 0) * 100);

  return (
    <View style={PG.wrap}>
      <View style={PG.track}>
        <View style={[PG.fill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <View style={PG.labelRow}>
        <Text style={PG.pct}>{pct}%</Text>
        <Text style={[PG.sev, { color }]}>{SEVERITY_LABEL[severity] ?? severity?.toUpperCase()}</Text>
      </View>
    </View>
  );
}

function FailureModeCard({ mode }) {
  const pct = Math.round((mode.probability ?? 0) * 100);
  return (
    <View style={FM.row}>
      <View style={FM.left}>
        <Text style={FM.name}>{mode.display_name}</Text>
        <Text style={FM.dtc}>{mode.dtc_code}</Text>
      </View>
      <View style={FM.right}>
        <Text style={FM.prob}>{pct}%</Text>
        <Text style={FM.cost}>
          OEM ${mode.repair_cost_oem?.[0] ?? '?'}–${mode.repair_cost_oem?.[1] ?? '?'} · AM ${mode.repair_cost_aftermarket?.[0] ?? '?'}–${mode.repair_cost_aftermarket?.[1] ?? '?'}
        </Text>
      </View>
    </View>
  );
}

function SensorRow({ name, info }) {
  const pct = Math.round((info.contribution ?? 0) * 100);
  const isDegrad = info.status === 'degrading';
  return (
    <View style={SR.row}>
      <View style={SR.left}>
        <Text style={SR.label}>{info.display_name ?? name}</Text>
        {info.current_mean != null && (
          <Text style={SR.val}>{info.current_mean.toFixed(2)}</Text>
        )}
      </View>
      <View style={SR.barWrap}>
        <View style={SR.track}>
          <View style={[SR.fill, {
            width: `${pct}%`,
            backgroundColor: isDegrad ? C.amber : C.border,
          }]} />
        </View>
      </View>
      <Text style={[SR.pct, isDegrad && { color: C.amber }]}>{pct}%</Text>
    </View>
  );
}

function HealthBar({ label, score }) {
  const pct   = Math.round(Math.max(0, Math.min(1, score ?? 1)) * 100);
  const color = pct >= 80 ? C.green : pct >= 50 ? C.amber : C.red;
  return (
    <View style={HB.row}>
      <Text style={HB.label}>{label}</Text>
      <View style={HB.trackWrap}>
        <View style={HB.track}>
          <View style={[HB.fill, { width: `${pct}%`, backgroundColor: color }]} />
        </View>
      </View>
      <Text style={[HB.pct, { color }]}>{pct}%</Text>
    </View>
  );
}

function AlertRow({ alert }) {
  const color = ALERT_COLOR[alert.severity?.toLowerCase()] ?? C.textMuted;
  return (
    <View style={AR.row}>
      <View style={[AR.bar, { backgroundColor: color }]} />
      <View style={AR.body}>
        <View style={AR.top}>
          <Text style={AR.sensor}>{alert.label ?? alert.sensor}</Text>
          <View style={[AR.pill, { backgroundColor: `${color}1A`, borderColor: color }]}>
            <Text style={[AR.pillText, { color }]}>{alert.severity?.toUpperCase()}</Text>
          </View>
        </View>
        <Text style={AR.desc} numberOfLines={2}>{alert.detail ?? alert.rule_description ?? ''}</Text>
      </View>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function ForesightScreen() {
  const { selectedVehicle } = useAuth();
  const [ml,      setMl]      = useState(null);
  const [mlErr,   setMlErr]   = useState(false);
  const [health,  setHealth]  = useState(null);
  const [alerts,  setAlerts]  = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!selectedVehicle?.id) { setLoading(false); return; }
    const id = selectedVehicle.id;
    setLoading(true);
    setMlErr(false);

    const [mlRes, healthRes, alertsRes] = await Promise.allSettled([
      client.get(`/foresight/predict/${id}`),
      client.get('/foresight/component-health', { params: { vehicle_id: id } }),
      client.get('/foresight/alerts',            { params: { vehicle_id: id } }),
    ]);

    if (mlRes.status === 'fulfilled') {
      setMl(mlRes.value.data);
    } else {
      setMlErr(true);
      setMl(null);
    }

    if (healthRes.status === 'fulfilled') {
      setHealth(healthRes.value.data?.health ?? null);
    }

    if (alertsRes.status === 'fulfilled') {
      setAlerts(alertsRes.value.data?.alerts ?? []);
    }

    setLoading(false);
  }, [selectedVehicle?.id]);

  useEffect(() => { load(); }, [load]);

  const critAlerts = alerts.filter(a => a.severity?.toLowerCase() === 'high').length;
  const sensors    = ml?.sensors ? Object.entries(ml.sensors) : [];

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
            <Text style={S.phaseText}>PHASE 4 · ML-POWERED</Text>
          </View>
          {!loading && (
            <TouchableOpacity onPress={load} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={S.refreshIcon}>↺</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Vehicle bar ── */}
      {selectedVehicle && (
        <View style={S.vehicleBar}>
          <Text style={S.vehicleText}>
            {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}
          </Text>
          {critAlerts > 0 && (
            <View style={[S.alertBadge, { backgroundColor: C.red }]}>
              <Text style={S.alertBadgeText}>{critAlerts} CRITICAL</Text>
            </View>
          )}
        </View>
      )}

      {loading ? (
        <View style={S.loadFull}>
          <ActivityIndicator size="large" color={C.accent} />
          <Text style={S.loadText}>Running predictive analysis...</Text>
        </View>
      ) : !selectedVehicle ? (
        <View style={S.loadFull}>
          <Text style={S.mutedText}>No vehicle selected</Text>
        </View>
      ) : (
        <ScrollView style={S.scroll} contentContainerStyle={S.scrollContent}>

          {/* ── ML Prediction ── */}
          <View style={S.section}>
            <Text style={S.sectionTitle}>ML FAILURE PREDICTION</Text>
            <View style={S.card}>
              {mlErr ? (
                <>
                  <View style={S.noMlRow}>
                    <View style={[S.noMlDot, { backgroundColor: '#333' }]} />
                    <Text style={S.noMlText}>ML prediction unavailable for this vehicle</Text>
                  </View>
                  <Text style={S.noMlSub}>Historical sim data required · Rule-based analysis active below</Text>
                </>
              ) : ml ? (
                <>
                  <ProbabilityGauge prob={ml.overall_failure_probability} severity={ml.severity} />

                  <View style={S.metaRow}>
                    {ml.days_to_failure_estimate != null ? (
                      <View style={S.metaChip}>
                        <Text style={S.metaLabel}>EST. DAYS TO FAILURE</Text>
                        <Text style={[S.metaVal, { color: C.red }]}>{ml.days_to_failure_estimate}d</Text>
                      </View>
                    ) : (
                      <View style={S.metaChip}>
                        <Text style={S.metaLabel}>TIME TO FAILURE</Text>
                        <Text style={[S.metaVal, { color: C.green }]}>NOT IMMINENT</Text>
                      </View>
                    )}
                    <View style={S.metaChip}>
                      <Text style={S.metaLabel}>CONFIDENCE</Text>
                      <Text style={S.metaVal}>{Math.round((ml.confidence ?? 0) * 100)}%</Text>
                    </View>
                    <View style={S.metaChip}>
                      <Text style={S.metaLabel}>MODEL</Text>
                      <Text style={S.metaVal}>{ml.model_version?.slice(-8) ?? '—'}</Text>
                    </View>
                  </View>
                </>
              ) : null}
            </View>
          </View>

          {/* ── Top Failure Modes ── */}
          {ml && !mlErr && ml.top_failure_modes?.length > 0 && (
            <View style={S.section}>
              <Text style={S.sectionTitle}>TOP FAILURE MODES</Text>
              <View style={S.card}>
                {ml.top_failure_modes.map((m, i) => (
                  <FailureModeCard key={m.mode ?? i} mode={m} />
                ))}
              </View>
            </View>
          )}

          {/* ── Sensor Contributions ── */}
          {ml && !mlErr && sensors.length > 0 && (
            <View style={S.section}>
              <Text style={S.sectionTitle}>SENSOR CONTRIBUTIONS</Text>
              <View style={S.card}>
                {sensors.map(([name, info]) => (
                  <SensorRow key={name} name={name} info={info} />
                ))}
              </View>
            </View>
          )}

          {/* ── Component Health ── */}
          <View style={S.section}>
            <Text style={S.sectionTitle}>COMPONENT HEALTH</Text>
            <View style={S.card}>
              {health ? (
                HEALTH_KEYS.map(({ key, label }) => (
                  <HealthBar key={key} label={label} score={health[key]} />
                ))
              ) : (
                <Text style={S.mutedText}>No health data</Text>
              )}
            </View>
          </View>

          {/* ── Active Alerts ── */}
          <View style={S.section}>
            <View style={S.sectionTitleRow}>
              <Text style={S.sectionTitle}>ACTIVE ALERTS</Text>
              {alerts.length > 0 && (
                <View style={S.countBadge}>
                  <Text style={S.countText}>{alerts.length}</Text>
                </View>
              )}
            </View>

            {alerts.length === 0 ? (
              <View style={S.emptyAlerts}>
                <View style={S.emptyDotRow}>
                  {[1, 0.5, 0.25].map((op, i) => (
                    <View key={i} style={[S.emptyDot, { backgroundColor: C.green, opacity: op }]} />
                  ))}
                </View>
                <Text style={S.emptyTitle}>ALL SYSTEMS NOMINAL</Text>
                <Text style={S.emptySub}>No rule-based alerts detected</Text>
              </View>
            ) : (
              alerts.map((a, i) => <AlertRow key={a.id ?? i} alert={a} />)
            )}
          </View>

          <Text style={S.brandLine}>POWERED BY ODIN PREDICTIVE ANALYSIS</Text>
        </ScrollView>
      )}
    </View>
  );
}

// ── StyleSheets ───────────────────────────────────────────────────────────────

const PG = StyleSheet.create({
  wrap: { gap: 6, marginBottom: 4 },
  track: { height: 4, backgroundColor: '#222', overflow: 'hidden' },
  fill:  { height: 4 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pct:  { color: C.textPrimary, fontSize: 22, fontWeight: '800', letterSpacing: 1 },
  sev:  { fontSize: 9, fontWeight: '800', letterSpacing: 2 },
});

const FM = StyleSheet.create({
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  left:  { flex: 1, gap: 2 },
  right: { alignItems: 'flex-end', gap: 2 },
  name:  { color: C.textPrimary, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  dtc:   { color: C.textMuted, fontSize: 9, letterSpacing: 1 },
  prob:  { color: C.amber, fontSize: 14, fontWeight: '800' },
  cost:  { color: C.textMuted, fontSize: 9 },
});

const SR = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  left: { width: 140, gap: 1 },
  label: { color: C.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  val: { color: C.textPrimary, fontSize: 10, fontWeight: '600' },
  barWrap: { flex: 1 },
  track: { height: 2, backgroundColor: '#222', overflow: 'hidden' },
  fill:  { height: 2 },
  pct:   { width: 32, textAlign: 'right', color: C.textMuted, fontSize: 9, fontWeight: '700' },
});

const HB = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  label:    { width: 130, color: C.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  trackWrap:{ flex: 1 },
  track:    { height: 3, backgroundColor: '#222', overflow: 'hidden' },
  fill:     { height: 3 },
  pct:      { width: 36, textAlign: 'right', fontSize: 11, fontWeight: '700' },
});

const AR = StyleSheet.create({
  row: {
    flexDirection: 'row', backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border, marginBottom: 8,
  },
  bar:      { width: 3 },
  body:     { flex: 1, padding: 12, gap: 4 },
  top:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sensor:   { color: C.textPrimary, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, flex: 1 },
  pill:     { paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1 },
  pillText: { fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  desc:     { color: C.textMuted, fontSize: 11, lineHeight: 16 },
});

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerLeft:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerDot:   { width: 7, height: 7, backgroundColor: C.accent },
  headerTitle: { color: C.accent, fontSize: 13, fontWeight: '800', letterSpacing: 3 },
  headerSub:   { color: '#404040', fontSize: 8, letterSpacing: 2, fontWeight: '700' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  phaseBadge:  { borderWidth: 1, borderColor: '#303030', paddingHorizontal: 8, paddingVertical: 3 },
  phaseText:   { color: C.blue, fontSize: 8, fontWeight: '700', letterSpacing: 1.5 },
  refreshIcon: { color: 'rgba(192,192,192,0.4)', fontSize: 16, fontWeight: 'bold' },

  vehicleBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  vehicleText:     { color: C.textMuted, fontSize: 10, letterSpacing: 1 },
  alertBadge:      { paddingHorizontal: 8, paddingVertical: 2 },
  alertBadgeText:  { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },

  loadFull: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadText: { color: C.textMuted, fontSize: 12, letterSpacing: 1 },
  mutedText:{ color: '#404040', fontSize: 11 },

  scroll:        { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },

  section: { marginBottom: 20 },
  sectionTitle: {
    color: C.textMuted, fontSize: 9, fontWeight: '700',
    letterSpacing: 3, marginBottom: 10,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  countBadge: {
    backgroundColor: C.red, width: 18, height: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  countText: { color: '#fff', fontSize: 10, fontWeight: '800' },

  card: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, padding: 14,
  },

  metaRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  metaChip: {
    flex: 1, backgroundColor: '#111', borderWidth: 1, borderColor: C.border,
    padding: 8, gap: 4,
  },
  metaLabel: { color: '#444', fontSize: 7, fontWeight: '700', letterSpacing: 1.5 },
  metaVal:   { color: C.accent, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },

  noMlRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  noMlDot:  { width: 6, height: 6 },
  noMlText: { color: C.textMuted, fontSize: 11, fontWeight: '600' },
  noMlSub:  { color: '#333', fontSize: 9, letterSpacing: 0.5, lineHeight: 14 },

  emptyAlerts: {
    alignItems: 'center', paddingVertical: 28, gap: 6,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  emptyDotRow: { flexDirection: 'row', gap: 5, marginBottom: 8 },
  emptyDot:    { width: 6, height: 6 },
  emptyTitle:  { color: C.green, fontSize: 12, fontWeight: '800', letterSpacing: 2 },
  emptySub:    { color: C.textMuted, fontSize: 11 },

  brandLine: {
    color: 'rgba(192,192,192,0.12)', fontSize: 9, fontWeight: '600',
    letterSpacing: 2, textAlign: 'center',
    paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.border,
  },
});
