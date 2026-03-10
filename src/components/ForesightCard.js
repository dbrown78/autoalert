import { useEffect, useState, useCallback } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

const RISK_COLORS = {
  low:      { color: '#4CAF82', label: 'LOW'  },
  moderate: { color: '#C08B30', label: 'MOD'  },
  high:     { color: '#D0453A', label: 'HIGH' },
  critical: { color: '#D0453A', label: 'CRIT' },
};

const URGENCY_CONFIG = {
  ok:     { color: '#4CAF82', label: 'ALL CLEAR'    },
  watch:  { color: '#C08B30', label: 'WATCH'        },
  soon:   { color: '#D0453A', label: 'SERVICE SOON' },
  urgent: { color: '#D0453A', label: 'URGENT'       },
};

// ---------------------------------------------------------------------------
// ForesightCard
// Props (all optional — falls back to AuthContext):
//   vehicleId   number   — override selectedVehicle.id
//   isPremium   boolean  — override user.is_premium
// ---------------------------------------------------------------------------

export default function ForesightCard({ vehicleId: vehicleIdProp, isPremium: isPremiumProp }) {
  const { user, selectedVehicle } = useAuth();

  const vehicleId = vehicleIdProp ?? selectedVehicle?.id;
  const isPremium = isPremiumProp ?? user?.is_premium ?? false;

  const [prediction, setPrediction] = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);

  const load = useCallback(async () => {
    if (!vehicleId || !isPremium) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await client.get(`/foresight/${vehicleId}`);
      setPrediction(data);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load prediction');
    } finally {
      setLoading(false);
    }
  }, [vehicleId, isPremium]);

  useEffect(() => { load(); }, [load]);

  if (!vehicleId) return null;

  return (
    <View style={S.card}>
      {/* ── Header ── */}
      <View style={S.header}>
        <View style={S.headerLeft}>
          <View style={S.odinDot} />
          <Text style={S.title}>ODIN FORESIGHT</Text>
          {isPremium && (
            <View style={S.premiumBadge}>
              <Text style={S.premiumText}>AI</Text>
            </View>
          )}
        </View>
        {isPremium && !loading && !error && (
          <TouchableOpacity onPress={load} style={S.refreshBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={S.refreshText}>↺</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Non-premium: paywall ── */}
      {!isPremium && (
        <View style={S.paywall}>
          <Text style={S.paywallLock}>🔒</Text>
          <Text style={S.paywallTitle}>Predictive Intelligence</Text>
          <Text style={S.paywallSub}>
            AI-powered failure prediction before symptoms appear.
          </Text>
          <View style={S.upgradeBtn}>
            <Text style={S.upgradeBtnText}>UPGRADE TO PREMIUM</Text>
          </View>
        </View>
      )}

      {/* ── Loading ── */}
      {isPremium && loading && (
        <View style={S.centerState}>
          <ActivityIndicator size="small" color="#C0C0C0" />
          <Text style={S.stateSubtext}>Running predictive analysis…</Text>
        </View>
      )}

      {/* ── Error ── */}
      {isPremium && !loading && error && (
        <View style={S.centerState}>
          <Text style={S.errorText}>{error}</Text>
          <TouchableOpacity onPress={load} style={S.retryBtn}>
            <Text style={S.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── ML Prediction result ── */}
      {isPremium && !loading && !error && prediction && (
        <>
          {/* Overall risk */}
          <OverallRisk prediction={prediction} />
          {/* Per-system part scores */}
          <PartScores partScores={prediction.part_scores} />
          {/* Service estimate */}
          <ServiceEstimate prediction={prediction} />
        </>
      )}

      {/* ── Footer ── */}
      <Text style={S.brandLine}>
        {isPremium ? 'ODIN ML · LightGBM · Sensor analysis' : 'Premium feature'}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function OverallRisk({ prediction }) {
  const pct        = Math.round((prediction.maintenance_probability ?? 0) * 100);
  const urg        = URGENCY_CONFIG[prediction.maintenance_urgency] ?? URGENCY_CONFIG.ok;
  const barColor   = urg.color;

  return (
    <View style={S.section}>
      <View style={S.overallRow}>
        <Text style={S.sectionLabel}>OVERALL RISK</Text>
        <View style={[S.urgencyPill, { borderColor: barColor }]}>
          <Text style={[S.urgencyText, { color: barColor }]}>{urg.label}</Text>
        </View>
      </View>
      <View style={S.riskBarBg}>
        <View style={[S.riskBarFill, { width: `${pct}%`, backgroundColor: barColor }]} />
      </View>
      <Text style={[S.pctLabel, { color: barColor }]}>{pct}%</Text>
    </View>
  );
}

function PartScores({ partScores }) {
  if (!partScores) return null;

  return (
    <View style={S.partSection}>
      {Object.entries(partScores).map(([system, data]) => {
        const rc  = RISK_COLORS[data.risk_level] ?? RISK_COLORS.low;
        const pct = Math.round((data.probability ?? 0) * 100);
        return (
          <View key={system} style={S.partRow}>
            <Text style={S.partLabel}>{data.label}</Text>
            <View style={[S.partBadge, { backgroundColor: rc.color + '22' }]}>
              <Text style={[S.partBadgeText, { color: rc.color }]}>{rc.label}</Text>
            </View>
            <Text style={[S.partPct, { color: rc.color }]}>{pct}%</Text>
          </View>
        );
      })}
    </View>
  );
}

function ServiceEstimate({ prediction }) {
  const days = prediction.days_until_service;
  const date = prediction.estimated_service_date;
  if (!days || !date) return null;

  const color = days <= 7 ? '#D0453A' : days <= 30 ? '#C08B30' : '#4CAF82';
  const formatted = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });

  return (
    <View style={[S.section, S.serviceRow]}>
      <Text style={S.sectionLabel}>EST. SERVICE</Text>
      <Text style={[S.serviceDate, { color }]}>
        {formatted} · {days}d
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const S = StyleSheet.create({
  card: {
    backgroundColor: '#1A1A1A',
    marginBottom: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 13,
    paddingBottom: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
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
    backgroundColor: '#C0C0C0',
    opacity: 0.9,
  },
  title: {
    color: '#C0C0C0',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  premiumBadge: {
    backgroundColor: 'rgba(192,192,192,0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(192,192,192,0.3)',
  },
  premiumText: {
    color: '#C0C0C0',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  refreshBtn: { padding: 4 },
  refreshText: { color: 'rgba(192,192,192,0.5)', fontSize: 16, fontWeight: 'bold' },

  // Paywall
  paywall: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
    gap: 6,
  },
  paywallLock: { fontSize: 28, marginBottom: 4 },
  paywallTitle: { color: '#E0E0E0', fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
  paywallSub: {
    color: 'rgba(224,224,224,0.45)',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 17,
  },
  upgradeBtn: {
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#C0C0C0',
  },
  upgradeBtnText: {
    color: '#C0C0C0',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
  },

  // Center states
  centerState: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
    gap: 8,
  },
  stateSubtext: { color: 'rgba(224,224,224,0.45)', fontSize: 12, marginTop: 6 },
  errorText: { color: '#777777', fontSize: 13 },
  retryBtn: {
    marginTop: 4,
    paddingHorizontal: 18,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(192,192,192,0.3)',
  },
  retryText: { color: '#C0C0C0', fontSize: 12, fontWeight: '700' },

  // Section wrapper
  section: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  sectionLabel: {
    color: '#505050',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },

  // Overall risk
  overallRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  urgencyPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  urgencyText: { fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  riskBarBg: {
    height: 4,
    backgroundColor: '#2A2A2A',
    overflow: 'hidden',
  },
  riskBarFill: { height: 4 },
  pctLabel: {
    marginTop: 6,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 1,
  },

  // Part scores
  partSection: {
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  partRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#222222',
  },
  partLabel: {
    flex: 1,
    color: '#C0C0C0',
    fontSize: 12,
    fontWeight: '600',
  },
  partBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    marginRight: 8,
  },
  partBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  partPct: { fontSize: 13, fontWeight: '700', minWidth: 36, textAlign: 'right' },

  // Service estimate
  serviceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  serviceDate: { fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },

  // Footer
  brandLine: {
    color: 'rgba(192,192,192,0.2)',
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    textAlign: 'center',
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: '#2A2A2A',
  },
});
