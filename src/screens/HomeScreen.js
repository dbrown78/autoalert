import { useState, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Linking, Animated, Dimensions, SafeAreaView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import ForesightCard from '../components/ForesightCard';
import DriveSafetyCard from '../components/DriveSafetyCard';
import useDriveSafety from '../hooks/useDriveSafety';
import client from '../api/client';

const SEVERITY_COLORS = { high: '#D0453A', medium: '#C08B30', low: '#4CAF82' };
const DRAWER_WIDTH = Dimensions.get('window').width * 0.72;

export default function HomeScreen({ navigation }) {
  const { user, logout, selectedVehicle } = useAuth();
  const { status: safetyStatus, reason: safetyReason, source: safetySource } =
    useDriveSafety(selectedVehicle?.id ?? null, { bleEnabled: false });
  const [scans, setScans]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const drawerAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;

  const openDrawer = () => {
    setDrawerOpen(true);
    Animated.timing(drawerAnim, {
      toValue: 0,
      duration: 240,
      useNativeDriver: true,
    }).start();
  };

  const closeDrawer = () => {
    Animated.timing(drawerAnim, {
      toValue: -DRAWER_WIDTH,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setDrawerOpen(false));
  };

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const fetchScans = async () => {
        setLoading(true);
        setError(null);
        try {
          const res = await client.get('/scans');
          if (!cancelled) {
            const seen   = new Set();
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
    <SafeAreaView style={S.root}>
      {/* ── Drawer overlay ── */}
      {drawerOpen && (
        <TouchableOpacity
          style={S.overlay}
          activeOpacity={1}
          onPress={closeDrawer}
        />
      )}

      {/* ── Slide-in drawer ── */}
      <Animated.View style={[S.drawer, { transform: [{ translateX: drawerAnim }] }]}>
        <View style={S.drawerProfile}>
          <View style={S.drawerAvatar}>
            <Text style={S.drawerAvatarTxt}>
              {(user?.name ?? 'U').charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={S.drawerName}>{user?.name ?? ''}</Text>
          <Text style={S.drawerEmail}>{user?.email ?? ''}</Text>
        </View>

        <View style={S.drawerDivider} />

        {[
          { label: 'VEHICLES',     screen: 'Vehicles'    },
          { label: 'SCAN HISTORY', screen: 'ScanHistory' },
          { label: 'SETTINGS',     screen: 'Settings'    },
        ].map(({ label, screen }) => (
          <TouchableOpacity
            key={screen}
            style={S.drawerItem}
            onPress={() => { closeDrawer(); navigation.navigate(screen); }}
            activeOpacity={0.7}
          >
            <Text style={S.drawerItemTxt}>{label}</Text>
          </TouchableOpacity>
        ))}

        <View style={S.drawerDivider} />

        <TouchableOpacity
          style={S.drawerItem}
          onPress={() => { closeDrawer(); logout(); }}
          activeOpacity={0.7}
        >
          <Text style={[S.drawerItemTxt, { color: '#555555' }]}>LOG OUT</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* ── Main content ── */}
      <View style={S.container}>
        <View style={S.header}>
          <TouchableOpacity onPress={openDrawer} style={S.hamburger} activeOpacity={0.7}>
            <View style={S.hamburgerLine} />
            <View style={S.hamburgerLine} />
            <View style={S.hamburgerLine} />
          </TouchableOpacity>
          <Text style={S.logo}>ODIN AUTOALERT</Text>
          <View style={{ width: 36 }} />
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
              const sev   = (s.severity ?? '').toLowerCase();
              const color = SEVERITY_COLORS[sev] || '#777777';
              const date  = s.scanned_at
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
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#080808' },

  // Drawer
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    zIndex: 10,
  },
  drawer: {
    position: 'absolute', top: 0, bottom: 0, left: 0,
    width: DRAWER_WIDTH,
    backgroundColor: '#111111',
    borderRightWidth: 1, borderRightColor: '#2A2A2A',
    zIndex: 20,
    paddingTop: 60,
  },
  drawerProfile: { paddingHorizontal: 24, paddingBottom: 24, alignItems: 'flex-start' },
  drawerAvatar: {
    width: 48, height: 48, borderRadius: 0,
    backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#C0C0C0',
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  drawerAvatarTxt: { color: '#C0C0C0', fontSize: 20, fontWeight: '700' },
  drawerName:  { color: '#E0E0E0', fontSize: 14, fontWeight: '700', letterSpacing: 1 },
  drawerEmail: { color: '#555555', fontSize: 11, marginTop: 2, letterSpacing: 0.5 },
  drawerDivider: { height: 1, backgroundColor: '#1E1E1E', marginVertical: 8, marginHorizontal: 16 },
  drawerItem: { paddingHorizontal: 24, paddingVertical: 16 },
  drawerItemTxt: {
    color: '#C0C0C0', fontSize: 11, fontWeight: '800',
    letterSpacing: 3, textTransform: 'uppercase',
  },

  // Main
  container: { flex: 1, paddingHorizontal: 20 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 12, marginBottom: 8,
  },
  hamburger: { width: 36, gap: 5, paddingVertical: 4 },
  hamburgerLine: { height: 2, backgroundColor: '#C0C0C0', borderRadius: 0 },
  logo: { color: '#E0E0E0', fontSize: 13, fontWeight: '800', letterSpacing: 3 },
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
  cardBar: { width: 3, alignSelf: 'stretch' },
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
