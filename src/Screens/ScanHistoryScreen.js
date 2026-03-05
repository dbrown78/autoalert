import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert,
} from 'react-native';
import client from '../api/client';

const SEVERITY_COLORS = { high: '#e74c3c', medium: '#f39c12', low: '#27ae60' };

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function dateLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function groupByDate(scans) {
  const groups = new Map();
  for (const scan of scans) {
    const key = dateLabel(scan.scanned_at);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(scan);
  }
  return [...groups.entries()];
}

export default function ScanHistoryScreen({ navigation }) {
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadScans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await client.get('/scans');
      setScans(res.data.scans);
    } catch {
      setError('Could not load scan history.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadScans(); }, [loadScans]);

  const handleDelete = (id) => {
    Alert.alert('Remove Entry', 'Remove this scan from your history?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          try {
            await client.delete(`/scans/${id}`);
            setScans(prev => prev.filter(s => s.id !== id));
          } catch {
            Alert.alert('Error', 'Could not delete this entry.');
          }
        },
      },
    ]);
  };

  const grouped = groupByDate(scans);

  return (
    <View style={S.container}>
      <View style={S.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn}>
          <Text style={S.backTxt}>← Back</Text>
        </TouchableOpacity>
        <Text style={S.headerTitle}>Scan History</Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={S.center}>
          <ActivityIndicator size="large" color="#00d4ff" />
        </View>
      ) : error ? (
        <View style={S.center}>
          <Text style={S.errorTxt}>{error}</Text>
          <TouchableOpacity style={S.retryBtn} onPress={loadScans}>
            <Text style={S.retryTxt}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : scans.length === 0 ? (
        <View style={S.center}>
          <Text style={S.emptyIcon}>🔍</Text>
          <Text style={S.emptyTitle}>No scans yet</Text>
          <Text style={S.emptyBody}>
            Tap any alert on the home screen to look up a DTC code — it will appear here.
          </Text>
        </View>
      ) : (
        <ScrollView style={S.scroll} showsVerticalScrollIndicator={false}>
          {grouped.map(([label, group]) => (
            <View key={label}>
              <Text style={S.dateLabel}>{label}</Text>
              {group.map(scan => (
                <TouchableOpacity
                  key={scan.id}
                  style={S.card}
                  activeOpacity={0.75}
                  onPress={() => navigation.navigate('DTCDetail', { code: scan.dtc_code })}
                >
                  <View style={S.cardLeft}>
                    <View style={S.codeRow}>
                      <Text style={S.code}>{scan.dtc_code}</Text>
                      <View style={[S.badge, { backgroundColor: SEVERITY_COLORS[scan.severity] ?? '#aaa' }]}>
                        <Text style={S.badgeTxt}>
                          {scan.severity.charAt(0).toUpperCase() + scan.severity.slice(1)}
                        </Text>
                      </View>
                    </View>
                    <Text style={S.desc} numberOfLines={1}>{scan.short_description}</Text>
                    {scan.vehicle_make ? (
                      <Text style={S.vehicle}>
                        🚗 {scan.vehicle_year} {scan.vehicle_make} {scan.vehicle_model}
                      </Text>
                    ) : null}
                    <Text style={S.time}>{timeAgo(scan.scanned_at)}</Text>
                  </View>
                  <TouchableOpacity
                    style={S.deleteBtn}
                    onPress={() => handleDelete(scan.id)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Text style={S.deleteTxt}>✕</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </View>
          ))}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 52, paddingHorizontal: 20, paddingBottom: 12,
  },
  backBtn: { width: 60 },
  backTxt: { color: '#00d4ff', fontSize: 16 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 36 },
  errorTxt: { color: '#fff', opacity: 0.7, fontSize: 15, textAlign: 'center' },
  retryBtn: { marginTop: 16, backgroundColor: '#00d4ff', paddingHorizontal: 28, paddingVertical: 10, borderRadius: 22 },
  retryTxt: { color: '#1a1a2e', fontWeight: 'bold', fontSize: 14 },
  emptyIcon: { fontSize: 48, marginBottom: 14 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  emptyBody: { color: '#fff', opacity: 0.5, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  scroll: { flex: 1, paddingHorizontal: 16 },
  dateLabel: {
    color: '#00d4ff', fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase',
    letterSpacing: 1, marginTop: 18, marginBottom: 8, opacity: 0.8,
  },
  card: {
    backgroundColor: '#16213e', borderRadius: 12, padding: 14,
    marginBottom: 10, flexDirection: 'row', alignItems: 'center',
  },
  cardLeft: { flex: 1 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  code: { color: '#00d4ff', fontSize: 16, fontWeight: 'bold' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeTxt: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  desc: { color: '#fff', fontSize: 13, opacity: 0.8, marginBottom: 3 },
  vehicle: { color: '#fff', opacity: 0.5, fontSize: 11, marginBottom: 3 },
  time: { color: '#fff', opacity: 0.4, fontSize: 11 },
  deleteBtn: { padding: 6 },
  deleteTxt: { color: '#fff', opacity: 0.35, fontSize: 16 },
});
