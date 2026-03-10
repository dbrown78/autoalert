// components/ForesightCard.js
// Premium Foresight ML prediction card.
// Shows per-part failure probabilities, maintenance urgency, and service date estimate.

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, ScrollView, Alert,
} from 'react-native';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE_URL = Platform.OS === 'web'
  ? 'http://localhost:3001'
  : 'http://192.168.1.221:3001';

// ── Risk colors ───────────────────────────────────────────────────────────────
const RISK_CONFIG = {
  low:      { color: '#22C55E', bg: '#F0FDF4', label: 'Low Risk'    },
  moderate: { color: '#F59E0B', bg: '#FFFBEB', label: 'Watch'       },
  high:     { color: '#F97316', bg: '#FFF7ED', label: 'Attention'   },
  critical: { color: '#EF4444', bg: '#FEF2F2', label: 'Critical'    },
};

const URGENCY_CONFIG = {
  normal:   { color: '#22C55E', icon: '✓',  headline: 'All Systems Normal'        },
  watch:    { color: '#F59E0B', icon: '◎',  headline: 'Monitor Closely'           },
  soon:     { color: '#F97316', icon: '⚠',  headline: 'Service Recommended Soon'  },
  critical: { color: '#EF4444', icon: '⛔', headline: 'Service Needed Immediately' },
};

// ── Main component ────────────────────────────────────────────────────────────

export default function ForesightCard({ vehicleId, isPremium = true }) {
  const [prediction, setPrediction] = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchPrediction = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const token = await AsyncStorage.getItem('token');
      const url   = `${BASE_URL}/api/foresight/${vehicleId}${force ? '?force=true' : ''}`;
      const res   = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 403) {
        setError('premium');
        return;
      }

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setPrediction(data);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isPremium && vehicleId) fetchPrediction();
  }, [vehicleId]);

  // ── Render: Not Premium ─────────────────────────────────────────────────────
  if (!isPremium || error === 'premium') {
    return (
      <View style={styles.premiumGate}>
        <Text style={styles.premiumIcon}>🔒</Text>
        <Text style={styles.premiumTitle}>Foresight ML</Text>
        <Text style={styles.premiumSub}>
          AI-powered failure predictions & maintenance estimates.
          Upgrade to ODIN Premium to unlock.
        </Text>
        <TouchableOpacity style={styles.upgradeBtn} onPress={() => {}}>
          <Text style={styles.upgradeBtnText}>Upgrade to Premium</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Render: Loading ─────────────────────────────────────────────────────────
  if (loading && !prediction) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6366F1" />
        <Text style={styles.loadingText}>Running Foresight analysis…</Text>
      </View>
    );
  }

  // ── Render: Error ───────────────────────────────────────────────────────────
  if (error && !prediction) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>⚠ {error}</Text>
        <TouchableOpacity onPress={() => fetchPrediction()}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!prediction) return null;

  const urgency = URGENCY_CONFIG[prediction.maintenance_urgency] || URGENCY_CONFIG.normal;
  const overallPct = Math.round(prediction.maintenance_probability * 100);
  const partScores = prediction.part_scores || {};

  // ── Render: Full Card ───────────────────────────────────────────────────────
  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.cardTitle}>⚡ Foresight</Text>
        <TouchableOpacity onPress={() => fetchPrediction(true)} disabled={loading}>
          <Text style={styles.refreshBtn}>{loading ? '…' : '↻ Refresh'}</Text>
        </TouchableOpacity>
      </View>

      {/* Urgency Banner */}
      <View style={[styles.urgencyBanner, { backgroundColor: urgency.color + '18' }]}>
        <Text style={[styles.urgencyIcon, { color: urgency.color }]}>{urgency.icon}</Text>
        <View style={styles.urgencyText}>
          <Text style={[styles.urgencyHeadline, { color: urgency.color }]}>
            {urgency.headline}
          </Text>
          {prediction.estimated_service_date && (
            <Text style={styles.serviceDate}>
              Service estimated by{' '}
              <Text style={{ fontWeight: '700' }}>
                {new Date(prediction.estimated_service_date).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric',
                })}
              </Text>
              {prediction.days_until_service && ` (~${prediction.days_until_service} days)`}
            </Text>
          )}
        </View>
        <Text style={[styles.overallPct, { color: urgency.color }]}>{overallPct}%</Text>
      </View>

      {/* Per-Part Scores */}
      <Text style={styles.sectionTitle}>Part Health</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.partsRow}>
        {Object.entries(partScores).map(([part, score]) => {
          const risk = RISK_CONFIG[score.risk_level] || RISK_CONFIG.low;
          const pct  = Math.round((score.probability || 0) * 100);
          return (
            <View key={part} style={[styles.partCard, { backgroundColor: risk.bg }]}>
              <Text style={styles.partLabel}>{score.label || part}</Text>
              <Text style={[styles.partPct, { color: risk.color }]}>{pct}%</Text>
              <View style={styles.partBar}>
                <View style={[styles.partBarFill, {
                  width: `${pct}%`,
                  backgroundColor: risk.color,
                }]} />
              </View>
              <Text style={[styles.partRisk, { color: risk.color }]}>{risk.label}</Text>
            </View>
          );
        })}
      </ScrollView>

      {/* Footer */}
      {lastRefresh && (
        <Text style={styles.footer}>
          {prediction.source === 'cache' ? '📦 Cached · ' : '🤖 Live · '}
          {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  refreshBtn: {
    fontSize: 13,
    color: '#6366F1',
    fontWeight: '600',
  },
  urgencyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    gap: 10,
  },
  urgencyIcon: {
    fontSize: 24,
  },
  urgencyText: {
    flex: 1,
  },
  urgencyHeadline: {
    fontSize: 14,
    fontWeight: '700',
  },
  serviceDate: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  overallPct: {
    fontSize: 24,
    fontWeight: '800',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  partsRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  partCard: {
    borderRadius: 10,
    padding: 12,
    marginRight: 10,
    width: 110,
  },
  partLabel: {
    fontSize: 11,
    color: '#374151',
    fontWeight: '600',
    marginBottom: 4,
  },
  partPct: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 6,
  },
  partBar: {
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 4,
  },
  partBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  partRisk: {
    fontSize: 11,
    fontWeight: '600',
  },
  footer: {
    fontSize: 11,
    color: '#9CA3AF',
    textAlign: 'right',
  },
  // Premium gate
  premiumGate: {
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginVertical: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
  },
  premiumIcon: { fontSize: 32, marginBottom: 8 },
  premiumTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 4 },
  premiumSub: { fontSize: 13, color: '#6B7280', textAlign: 'center', marginBottom: 16 },
  upgradeBtn: {
    backgroundColor: '#6366F1',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  upgradeBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  // Loading / error
  loadingContainer: { padding: 32, alignItems: 'center' },
  loadingText: { marginTop: 12, color: '#6B7280', fontSize: 14 },
  errorContainer: { padding: 24, alignItems: 'center' },
  errorText: { color: '#EF4444', fontSize: 14, marginBottom: 8 },
  retryText: { color: '#6366F1', fontWeight: '600' },
});
