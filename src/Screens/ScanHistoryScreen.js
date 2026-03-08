import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, SectionList, Pressable, StyleSheet,
  ActivityIndicator, Alert, Animated, Linking,
} from 'react-native';
import client from '../api/client';

function buildPartsURL(scan) {
  const parts = [scan.dtc_code];
  if (scan.vehicle_year)  parts.push(scan.vehicle_year);
  if (scan.vehicle_make)  parts.push(scan.vehicle_make);
  if (scan.vehicle_model) parts.push(scan.vehicle_model);
  if (scan.short_description) parts.push(scan.short_description);
  parts.push('repair parts');
  const url = 'https://www.google.com/search?q=' + encodeURIComponent(parts.join(' '));
  console.log('[buildPartsURL]', url);
  return url;
}

// ─── Theme ───────────────────────────────────────────────────────────────────
const C = {
  bg:            '#080808',
  surface:       '#1A1A1A',
  border:        '#2A2A2A',
  accent:        '#C0C0C0',
  accentDim:     'rgba(192,192,192,0.08)',
  textPrimary:   '#E0E0E0',
  textSecondary: '#777777',
  textMuted:     '#505050',
  sevHigh:       '#D0453A',
  sevMed:        '#C08B30',
  sevLow:        '#4CAF82',
};

const SEV_COLOR = { high: C.sevHigh, medium: C.sevMed, low: C.sevLow };

// ─── Helpers ─────────────────────────────────────────────────────────────────
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7)  return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function dateLabel(iso) {
  const d         = new Date(iso);
  const today     = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString())     return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function buildSections(scans) {
  const map = new Map();
  for (const scan of scans) {
    const key = dateLabel(scan.scanned_at);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(scan);
  }
  return [...map.entries()].map(([title, data]) => ({ title, data }));
}

// ─── Scan reticle icon (empty state) ─────────────────────────────────────────
function ReticleIcon() {
  const opacity = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.9,  duration: 1600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 1600, useNativeDriver: true }),
      ])
    ).start();
  }, [opacity]);

  // Corner bracket helper
  const TL = () => (
    <View style={[RI.corner, RI.tl]}>
      <View style={[RI.arm, RI.armH]} />
      <View style={[RI.arm, RI.armV]} />
    </View>
  );
  const TR = () => (
    <View style={[RI.corner, RI.tr]}>
      <View style={[RI.arm, RI.armH]} />
      <View style={[RI.arm, RI.armV]} />
    </View>
  );
  const BL = () => (
    <View style={[RI.corner, RI.bl]}>
      <View style={[RI.arm, RI.armH]} />
      <View style={[RI.arm, RI.armV]} />
    </View>
  );
  const BR = () => (
    <View style={[RI.corner, RI.br]}>
      <View style={[RI.arm, RI.armH]} />
      <View style={[RI.arm, RI.armV]} />
    </View>
  );

  return (
    <Animated.View style={[RI.wrap, { opacity }]}>
      <View style={RI.frame}>
        <TL /><TR /><BL /><BR />
        {/* Centre dot */}
        <View style={RI.dot} />
        {/* Horizontal scan line */}
        <View style={RI.scanLine} />
      </View>
    </Animated.View>
  );
}

const RI = StyleSheet.create({
  wrap:     { alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  frame:    { width: 72, height: 72, position: 'relative', alignItems: 'center', justifyContent: 'center' },
  corner:   { position: 'absolute', width: 14, height: 14 },
  tl:       { top: 0, left: 0 },
  tr:       { top: 0, right: 0 },
  bl:       { bottom: 0, left: 0 },
  br:       { bottom: 0, right: 0 },
  arm:      { position: 'absolute', backgroundColor: C.accent },
  armH:     { height: 2, width: 14, top: 0, left: 0 },
  armV:     { width: 2, height: 14, top: 0, left: 0 },
  dot:      { width: 6, height: 6, borderRadius: 0, backgroundColor: C.accent },
  scanLine: { position: 'absolute', height: 1, width: 40, backgroundColor: C.accent, opacity: 0.4 },
});

// ─── Scan card ───────────────────────────────────────────────────────────────
function ScanCard({ scan, onDelete, onPress }) {
  const sevColor = SEV_COLOR[scan.severity] ?? '#888';
  const sevLabel = scan.severity
    ? scan.severity.charAt(0).toUpperCase() + scan.severity.slice(1)
    : '—';

  return (
    <Pressable
      style={({ pressed }) => [S.card, pressed && S.cardPressed]}
      onPress={onPress}
      android_ripple={{ color: 'rgba(0,212,255,0.08)' }}
    >
      {/* Left severity accent bar */}
      <View style={[S.accentBar, { backgroundColor: sevColor }]} />

      {/* Card body — right-padded to clear the delete button */}
      <View style={S.cardBody}>
        {/* Code + severity badge */}
        <View style={S.codeRow}>
          <Text style={S.code}>{scan.dtc_code}</Text>
          <View style={[S.sevBadge, { backgroundColor: sevColor + '22', borderColor: sevColor + '55' }]}>
            <Text style={[S.sevTxt, { color: sevColor }]}>{sevLabel.toUpperCase()}</Text>
          </View>
        </View>

        {/* Description */}
        <Text style={S.desc} numberOfLines={1}>{scan.short_description}</Text>

        {/* Vehicle */}
        {scan.vehicle_make ? (
          <View style={S.vehicleRow}>
            <View style={S.vehiclePill}>
              <Text style={S.vehiclePillTxt}>VEH</Text>
            </View>
            <Text style={S.vehicleTxt}>
              {scan.vehicle_year} {scan.vehicle_make} {scan.vehicle_model}
            </Text>
          </View>
        ) : null}

        {/* Bottom row: timestamp + Find Parts */}
        <View style={S.cardFooter}>
          <Text style={S.time}>{timeAgo(scan.scanned_at)}</Text>
          <Pressable
            style={({ pressed }) => [S.partsBtn, pressed && S.partsBtnPressed]}
            onPress={() => Linking.openURL(buildPartsURL(scan))}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={S.partsBtnTxt}>Find Parts</Text>
          </Pressable>
        </View>
      </View>

      {/* Delete button — absolutely positioned, no nesting issue */}
      <Pressable
        style={({ pressed }) => [S.deleteBtn, pressed && S.deleteBtnPressed]}
        onPress={onDelete}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        android_ripple={{ color: 'rgba(231,76,60,0.15)', borderless: true }}
      >
        <View style={S.deleteX}>
          <View style={[S.deleteArm, { transform: [{ rotate: '45deg' }] }]} />
          <View style={[S.deleteArm, { transform: [{ rotate: '-45deg' }] }]} />
        </View>
      </Pressable>
    </Pressable>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────
export default function ScanHistoryScreen({ navigation }) {
  const [scans, setScans]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const loadScans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await client.get('/scans');
      setScans(res.data.scans ?? []);
    } catch {
      setError('Could not load scan history.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadScans(); }, [loadScans]);

  const handleDelete = useCallback((id) => {
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
  }, []);

  const sections = buildSections(scans);

  return (
    <View style={S.container}>
      {/* ── Header ── */}
      <View style={S.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [S.backBtn, pressed && S.pressed]}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={S.backTxt}>← Back</Text>
        </Pressable>
        <Text style={S.headerTitle}>Scan History</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={S.headerRule} />

      {/* ── Body ── */}
      {loading ? (
        <View style={S.center}>
          <ActivityIndicator size="large" color={C.accent} />
          <Text style={S.loadingTxt}>Loading history…</Text>
        </View>

      ) : error ? (
        <View style={S.center}>
          <Text style={S.errorTxt}>{error}</Text>
          <Pressable
            style={({ pressed }) => [S.retryBtn, pressed && S.pressed]}
            onPress={loadScans}
          >
            <Text style={S.retryTxt}>Try Again</Text>
          </Pressable>
        </View>

      ) : scans.length === 0 ? (
        <View style={S.center}>
          <ReticleIcon />
          <Text style={S.emptyTitle}>No scans yet</Text>
          <Text style={S.emptyBody}>
            Tap any alert on the home screen to look up a DTC code — it will appear here automatically.
          </Text>
          <Pressable
            style={({ pressed }) => [S.emptyAction, pressed && S.pressed]}
            onPress={() => navigation.goBack()}
          >
            <Text style={S.emptyActionTxt}>Go to Dashboard</Text>
          </Pressable>
        </View>

      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item, i) => item.id?.toString() ?? String(i)}
          renderSectionHeader={({ section: { title } }) => (
            <View style={S.sectionHeader}>
              <Text style={S.sectionTitle}>{title}</Text>
              <View style={S.sectionRule} />
            </View>
          )}
          renderItem={({ item }) => (
            <ScanCard
              scan={item}
              onPress={() => navigation.navigate('DTCDetail', { code: item.dtc_code })}
              onDelete={() => handleDelete(item.id)}
            />
          )}
          contentContainerStyle={S.listContent}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
        />
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 52, paddingHorizontal: 20, paddingBottom: 14,
  },
  backBtn:     { width: 60 },
  backTxt:     { color: C.accent, fontSize: 16 },
  headerTitle: { color: C.textPrimary, fontSize: 18, fontWeight: '700' },
  headerRule:  { height: 1, backgroundColor: C.border, marginHorizontal: 20 },

  // States
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  loadingTxt: { color: C.textMuted, marginTop: 14, fontSize: 13, letterSpacing: 0.5 },
  errorTxt:   { color: C.textSecondary, textAlign: 'center', fontSize: 14, lineHeight: 22, marginBottom: 20 },
  retryBtn: {
    borderWidth: 1, borderColor: C.accent,
    paddingHorizontal: 28, paddingVertical: 11, borderRadius: 0,
  },
  retryTxt: { color: C.accent, fontWeight: '700', fontSize: 13 },

  // Empty state
  emptyTitle: {
    color: C.textPrimary, fontSize: 20, fontWeight: '700',
    letterSpacing: 0.3, marginBottom: 10,
  },
  emptyBody: {
    color: C.textSecondary, fontSize: 13, textAlign: 'center',
    lineHeight: 21, marginBottom: 28,
  },
  emptyAction: {
    backgroundColor: C.accentDim, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 24, paddingVertical: 11, borderRadius: 0,
  },
  emptyActionTxt: { color: C.accent, fontSize: 13, fontWeight: '700' },

  // List
  listContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 48 },

  // Section header
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginTop: 20, marginBottom: 10,
  },
  sectionTitle: {
    color: C.accent, fontSize: 11, fontWeight: '800',
    textTransform: 'uppercase', letterSpacing: 1.5, opacity: 0.75,
    flexShrink: 0,
  },
  sectionRule: { flex: 1, height: 1, backgroundColor: C.border },

  // Card
  card: {
    backgroundColor: C.surface,
    borderRadius: 0,
    marginBottom: 8,
    flexDirection: 'row',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.border,
  },
  cardPressed: { opacity: 0.72 },

  accentBar: { width: 3 },

  cardBody: {
    flex: 1,
    paddingVertical: 13,
    paddingLeft: 12,
    paddingRight: 48,   // clear the delete button
    gap: 4,
  },

  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  code:    { color: C.accent, fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },

  sevBadge: {
    paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: 0, borderWidth: 1,
  },
  sevTxt: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },

  desc: { color: C.textPrimary, fontSize: 13, opacity: 0.85, lineHeight: 18 },

  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  vehiclePill: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 5, paddingVertical: 1, borderRadius: 0,
  },
  vehiclePillTxt: { color: C.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  vehicleTxt:     { color: C.textSecondary, fontSize: 11 },

  cardFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 2,
  },
  time: { color: C.textMuted, fontSize: 11 },

  partsBtn: {
    backgroundColor: C.accentDim,
    borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 0,
  },
  partsBtnPressed: { backgroundColor: 'rgba(192,192,192,0.15)' },
  partsBtnTxt: { color: C.accent, fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },

  // Delete button (absolutely positioned)
  deleteBtn: {
    position: 'absolute', right: 0, top: 0, bottom: 0,
    width: 44, alignItems: 'center', justifyContent: 'center',
  },
  deleteBtnPressed: { backgroundColor: 'rgba(208,69,58,0.08)' },
  deleteX:   { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  deleteArm: {
    position: 'absolute',
    width: 12, height: 1.5,
    backgroundColor: 'rgba(255,255,255,0.28)',
    borderRadius: 0,
  },

  pressed: { opacity: 0.65 },
});
