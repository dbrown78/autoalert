import { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Linking } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import ForesightCard from '../components/ForesightCard';
import DriveSafetyCard from '../components/DriveSafetyCard';
import useDriveSafety from '../hooks/useDriveSafety';
import client from '../api/client';

const SEVERITY_COLORS = { high: '#D0453A', medium: '#C08B30', low: '#4CAF82' };

export default function HomeScreen({ navigation }) {
  const { user, logout, selectedVehicle } = useAuth();
  const { status: safetyStatus, reason: safetyReason, source: safetySource } =
    useDriveSafety(selectedVehicle?.id ?? null, { bleEnabled: false });
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const fetchScans = async () => {
        setLoading(true);
        setError(null);
        try {
          const res = await client.get('/scans');
          if (!cancelled) {
            // Dedupe by dtc_code — keep most recent occurrence of each
            const seen = new Set();
            const unique = (res.data.scans ?? []).filter(s => {
              if (seen.has(s.dtc_code)) return false;
              seen.add(s.dtc_code);
              return true;
            });
            setScans(unique);
          }
        } catch {
          if (!cancelled) setError('Could not load alerts.');
        } finally {
          if (!cancelled) setLoading(false);
        }
      };
      fetchScans();
      return () => { cancelled = true; };
    }, [])
  );

  return (
    <View style={S.container}>
      <View style={S.header}>
        <Text style={S.logo}>🚗 AutoAlert</Text>
        <View style={S.headerActions}>
          <TouchableOpacity onPress={() => navigation.navigate('Vehicles')} style={S.headerBtn}>
            <Text style={S.headerBtnTxt}>Vehicles</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('ScanHistory')} style={S.headerBtn}>
            <Text style={S.headerBtnTxt}>History</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={S.headerBtn}>
            <Text style={S.headerBtnTxt}>Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={logout}>
            <Text style={S.logoutBtn}>Log out</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={S.welcome}>Welcome back, {user?.name}</Text>

      <ForesightCard />

      {safetyStatus && (
        <DriveSafetyCard
          driveSafety={safetyStatus}
          driveSafetyReason={safetyReason}
          source={safetySource}
        />
      )}

      <Text style={S.sectionLabel}>
        {loading ? 'RECENT ALERTS' : `RECENT ALERTS · ${scans.length}`}
      </Text>

      <ScrollView style={S.scroll} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator color="#C0C0C0" style={{ marginTop: 32 }} />
        ) : error ? (
          <View style={S.errorRow}>
            <View style={S.errorBar} />
            <Text style={S.errorTxt}>{error}</Text>
          </View>
        ) : scans.length === 0 ? (
          <View style={S.emptyState}>
            <Text style={S.emptyTitle}>NO RECENT ALERTS</Text>
            <Text style={S.emptySub}>Scan your vehicle to see DTC codes here</Text>
          </View>
        ) : (
          scans.map(s => {
            const sev = (s.severity ?? '').toLowerCase();
            const color = SEVERITY_COLORS[sev] || '#777777';
            const date = s.scanned_at
              ? new Date(s.scanned_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              : '—';
            return (
              <TouchableOpacity
                key={s.id}
                style={S.card}
                onPress={() => navigation.navigate('DTCDetail', { code: s.dtc_code })}
                activeOpacity={0.75}
              >
                <View style={[S.cardBar, { backgroundColor: color }]} />
                <View style={{ flex: 1, paddingLeft: 12 }}>
                  <Text style={S.codeText}>{s.dtc_code}</Text>
                  <Text style={S.codeSub} numberOfLines={1}>{s.short_description}</Text>
                  <Text style={S.dateText}>{date}</Text>
                </View>
                <View style={[S.badge, { borderColor: color }]}>
                  <Text style={[S.badgeTxt, { color }]}>
                    {(s.severity ?? 'unknown').toUpperCase()}
                  </Text>
                </View>
                <Text style={S.arrow}>›</Text>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <TouchableOpacity
        style={S.emergencyBtn}
        onPress={() => Linking.openURL('tel:18004357628')}
        activeOpacity={0.75}
      >
        <Text style={S.emergencyTxt}>🆘 ROADSIDE ASSISTANCE</Text>
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080808', paddingHorizontal: 20 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 52, marginBottom: 8,
  },
  logo: { fontSize: 18, fontWeight: 'bold', color: '#E0E0E0', letterSpacing: 3 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  headerBtn: {},
  headerBtnTxt: { color: '#C0C0C0', fontSize: 13, letterSpacing: 1 },
  logoutBtn: { color: '#555555', fontSize: 13, letterSpacing: 1 },
  welcome: { color: '#555555', fontSize: 13, marginBottom: 16 },
  sectionLabel: {
    fontSize: 9, color: '#505050', fontWeight: '700',
    marginBottom: 10, letterSpacing: 3, textTransform: 'uppercase',
  },
  scroll: { flex: 1 },
  card: {
    backgroundColor: '#1A1A1A', padding: 14, marginBottom: 8,
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  cardBar: { width: 3, alignSelf: 'stretch', borderRadius: 0 },
  codeText: { color: '#E0E0E0', fontSize: 16, fontWeight: '800', letterSpacing: 1 },
  codeSub: { color: '#777777', fontSize: 12, marginTop: 2 },
  dateText: { color: '#444444', fontSize: 10, marginTop: 4, letterSpacing: 0.5 },
  badge: {
    borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2,
    marginLeft: 10,
  },
  badgeTxt: { fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  arrow: { color: '#333333', fontSize: 20, marginLeft: 10 },
  errorRow: {
    flexDirection: 'row', backgroundColor: '#1A1A1A',
    borderWidth: 1, borderColor: '#2A2A2A', marginBottom: 8,
  },
  errorBar: { width: 3, backgroundColor: '#D0453A' },
  errorTxt: { flex: 1, color: '#D0453A', fontSize: 12, padding: 14, letterSpacing: 0.5 },
  emptyState: { alignItems: 'center', paddingVertical: 48 },
  emptyTitle: { color: '#333333', fontSize: 12, fontWeight: '800', letterSpacing: 2 },
  emptySub: { color: '#333333', fontSize: 11, marginTop: 6, letterSpacing: 0.5 },
  emergencyBtn: {
    backgroundColor: 'transparent', padding: 16, alignItems: 'center',
    marginTop: 8, marginBottom: 24,
    borderWidth: 1, borderColor: '#D0453A',
  },
  emergencyTxt: { color: '#D0453A', fontSize: 11, fontWeight: 'bold', letterSpacing: 3 },
});
