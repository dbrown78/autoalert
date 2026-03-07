import { useEffect, useState, useCallback } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

// Severity config — low=blue per ODIN spec
const SEVERITY = {
  high:   { color: '#e74c3c', bg: 'rgba(231,76,60,0.10)',   border: 'rgba(231,76,60,0.35)',   label: 'HIGH' },
  medium: { color: '#f39c12', bg: 'rgba(243,156,18,0.10)',  border: 'rgba(243,156,18,0.35)',  label: 'MED' },
  low:    { color: '#3b82f6', bg: 'rgba(59,130,246,0.10)',  border: 'rgba(59,130,246,0.35)',  label: 'LOW' },
};

const SENSOR_LABELS = {
  coolant_temp: 'Coolant Temp',
  voltage:      'Voltage',
  fuel_trim:    'Fuel Trim',
  rpm:          'Idle RPM',
};

export default function ForesightCard() {
  const { selectedVehicle } = useAuth();
  const [alerts, setAlerts]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(false);

  const load = useCallback(async () => {
    if (!selectedVehicle?.id) return;
    setLoading(true);
    setError(false);
    try {
      const res = await client.get(`/foresight/${selectedVehicle.id}`);
      setAlerts(res.data.alerts ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [selectedVehicle?.id]);

  useEffect(() => { load(); }, [load]);

  // Don't render at all without a vehicle
  if (!selectedVehicle) return null;

  return (
    <View style={S.card}>
      {/* ── Header ── */}
      <View style={S.header}>
        <View style={S.headerLeft}>
          <View style={S.odinDot} />
          <Text style={S.title}>ODIN FORESIGHT</Text>
        </View>
        {!loading && !error && alerts.length > 0 && (
          <View style={S.countBadge}>
            <Text style={S.countText}>{alerts.length}</Text>
          </View>
        )}
        {!loading && !error && (
          <TouchableOpacity onPress={load} style={S.refreshBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={S.refreshText}>↺</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Loading ── */}
      {loading && (
        <View style={S.centerState}>
          <ActivityIndicator size="small" color="#00d4ff" />
          <Text style={S.stateSubtext}>Analyzing sensor trends…</Text>
        </View>
      )}

      {/* ── Error ── */}
      {!loading && error && (
        <View style={S.centerState}>
          <Text style={S.errorText}>Could not load predictive alerts</Text>
          <TouchableOpacity onPress={load} style={S.retryBtn}>
            <Text style={S.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Empty state ── */}
      {!loading && !error && alerts.length === 0 && (
        <View style={S.emptyState}>
          <View style={S.emptyDotRow}>
            <View style={[S.emptyDot, { backgroundColor: '#27ae60' }]} />
            <View style={[S.emptyDot, { backgroundColor: '#27ae60', opacity: 0.5 }]} />
            <View style={[S.emptyDot, { backgroundColor: '#27ae60', opacity: 0.25 }]} />
          </View>
          <Text style={S.emptyTitle}>All sensors normal</Text>
          <Text style={S.emptySubtext}>No predictive alerts detected for this vehicle</Text>
        </View>
      )}

      {/* ── Alert rows ── */}
      {!loading && !error && alerts.map((alert, i) => {
        const sev = SEVERITY[alert.severity] ?? SEVERITY.low;
        return (
          <View
            key={alert.id ?? i}
            style={[
              S.alertRow,
              i < alerts.length - 1 && S.alertRowDivider,
            ]}
          >
            {/* Left severity bar */}
            <View style={[S.severityBar, { backgroundColor: sev.color }]} />

            <View style={S.alertBody}>
              {/* Top row: sensor pill + severity badge */}
              <View style={S.alertTopRow}>
                <View style={[S.sensorPill, { backgroundColor: sev.bg, borderColor: sev.border }]}>
                  <Text style={[S.sensorText, { color: sev.color }]}>
                    {SENSOR_LABELS[alert.sensor] ?? alert.sensor}
                  </Text>
                </View>
                <View style={[S.severityPill, { backgroundColor: sev.bg }]}>
                  <Text style={[S.severityPillText, { color: sev.color }]}>{sev.label}</Text>
                </View>
              </View>

              {/* Alert label */}
              <Text style={S.alertLabel}>{alert.label}</Text>

              {/* Detail text */}
              {alert.detail ? (
                <Text style={S.alertDetail} numberOfLines={2}>{alert.detail}</Text>
              ) : null}
            </View>
          </View>
        );
      })}

      {/* ── Footer brand line ── */}
      <Text style={S.brandLine}>Powered by ODIN predictive analysis</Text>
    </View>
  );
}

const S = StyleSheet.create({
  card: {
    backgroundColor: '#16213e',
    borderRadius: 14,
    marginBottom: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.15)',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 13,
    paddingBottom: 11,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  odinDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#00d4ff',
    // Simulated pulse via opacity — no animation needed for static render
    opacity: 0.9,
  },
  title: {
    color: '#00d4ff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  countBadge: {
    backgroundColor: '#e74c3c',
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  countText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  refreshBtn: {
    padding: 4,
  },
  refreshText: {
    color: 'rgba(0,212,255,0.5)',
    fontSize: 16,
    fontWeight: 'bold',
  },

  // Center states (loading / error / empty)
  centerState: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
    gap: 8,
  },
  stateSubtext: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 12,
    marginTop: 6,
  },
  errorText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
  },
  retryBtn: {
    marginTop: 4,
    paddingHorizontal: 18,
    paddingVertical: 7,
    backgroundColor: 'rgba(0,212,255,0.12)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.3)',
  },
  retryText: {
    color: '#00d4ff',
    fontSize: 12,
    fontWeight: '700',
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 16,
    gap: 4,
  },
  emptyDotRow: {
    flexDirection: 'row',
    gap: 5,
    marginBottom: 8,
  },
  emptyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  emptyTitle: {
    color: '#27ae60',
    fontSize: 14,
    fontWeight: '700',
  },
  emptySubtext: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 2,
  },

  // Alert rows
  alertRow: {
    flexDirection: 'row',
    minHeight: 44,       // WCAG touch target minimum
  },
  alertRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  severityBar: {
    width: 3,
  },
  alertBody: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 5,
  },
  alertTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sensorPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  sensorText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  severityPill: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  severityPillText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  alertLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  alertDetail: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    lineHeight: 16,
  },

  // Footer
  brandLine: {
    color: 'rgba(0,212,255,0.2)',
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    textAlign: 'center',
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.04)',
  },
});
