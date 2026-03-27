import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, Pressable, Image,
  StyleSheet, ActivityIndicator, Linking, Platform,
} from 'react-native';
import * as Location from 'expo-location';
import client from '../api/client';
import SubmitOutcomeModal from '../components/SubmitOutcomeModal';
import TrustBreakdownModal from '../components/TrustBreakdownModal';

// ─── Palette (Cyberpunk HUD) ────────────────────────────────────────────────
const C = {
  bg:          '#080808',
  surface:     '#1A1A1A',
  surfaceAlt:  '#141414',
  border:      '#2A2A2A',
  borderGlow:  '#3A3A3A',
  accent:      '#C0C0C0',
  accentDim:   'rgba(192,192,192,0.08)',
  open:        '#4CAF82',
  openBg:      'rgba(76,175,130,0.12)',
  closed:      '#D0453A',
  closedBg:    'rgba(208,69,58,0.12)',
  gold:        '#C08B30',
  textPrimary: '#E0E0E0',
  textSecondary: '#777777',
  textMuted:   '#505050',
};

// ─── Helpers ────────────────────────────────────────────────────────────────
function haversineDistance(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
  const R = 3958.8;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function openDirections(lat, lng, name) {
  const dest = `${lat},${lng}`;
  const label = encodeURIComponent(name);
  const url = Platform.OS === 'ios'
    ? `maps://app?daddr=${dest}&q=${label}`
    : `geo:${dest}?q=${dest}(${label})`;
  Linking.openURL(url).catch(() =>
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${dest}`)
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────
function StarRow({ rating, count }) {
  if (rating == null) return <Text style={ST.noRating}>No rating</Text>;
  const filled = Math.round(rating);
  const stars = Array.from({ length: 5 }, (_, i) =>
    i < filled ? '★' : '☆'
  ).join('');
  return (
    <Text style={ST.ratingRow}>
      <Text style={ST.stars}>{stars}</Text>
      <Text style={ST.ratingVal}> {rating.toFixed(1)}</Text>
      {count > 0 && <Text style={ST.ratingCount}> ({count.toLocaleString()})</Text>}
    </Text>
  );
}

function OpenBadge({ openNow }) {
  if (openNow == null) return null;
  return (
    <View style={[ST.badge, openNow ? ST.badgeOpen : ST.badgeClosed]}>
      <Text style={[ST.badgeTxt, { color: openNow ? C.open : C.closed }]}>
        {openNow ? 'OPEN' : 'CLOSED'}
      </Text>
    </View>
  );
}

// ─── Rating filter bar ──────────────────────────────────────────────────────
const RATING_OPTIONS = [
  { label: 'Any',  value: null },
  { label: '3.5+', value: 3.5  },
  { label: '4.0+', value: 4.0  },
  { label: '4.5+', value: 4.5  },
];

function RatingFilterBar({ selected, onSelect }) {
  return (
    <View style={ST.filterBar}>
      <Text style={ST.filterBarLabel}>RATING</Text>
      <View style={ST.filterOptions}>
        {RATING_OPTIONS.map(opt => {
          const active = selected === opt.value;
          return (
            <Pressable
              key={String(opt.value)}
              style={({ pressed }) => [
                ST.filterOption,
                active && ST.filterOptionActive,
                pressed && ST.pressed,
              ]}
              onPress={() => onSelect(opt.value)}
            >
              <Text style={[ST.filterOptionTxt, active && ST.filterOptionTxtActive]}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// Task 3a — TrustBadge: pressable pill, breakdown modal, external trust support
function TrustBadge({ shopId, externalTrust }) {
  const [fetchedTrust, setFetchedTrust] = useState(null);
  const [done, setDone]                 = useState(false);
  const [breakdownVisible, setBreakdownVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    client.get(`/mechanics/${shopId}/trust`)
      .then(res => { if (!cancelled) { setFetchedTrust(res.data.trust); setDone(true); } })
      .catch(() => { if (!cancelled) setDone(true); });
    return () => { cancelled = true; };
  }, [shopId]);

  // externalTrust (from a fresh submission) takes priority over the fetched value
  const trust = externalTrust ?? fetchedTrust;

  if (!done && !externalTrust) {
    return (
      <View style={ST.trustRow}>
        <Text style={ST.trustLabel}>ODIN</Text>
        <Text style={ST.trustLoading}>—</Text>
      </View>
    );
  }

  if (!trust || trust.score == null) {
    return (
      <>
        <Pressable
          style={ST.trustRow}
          onPress={() => setBreakdownVisible(true)}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Text style={ST.trustLabel}>ODIN</Text>
          <Text style={ST.trustNoData}>No data yet</Text>
        </Pressable>
        <TrustBreakdownModal
          visible={breakdownVisible}
          onClose={() => setBreakdownVisible(false)}
          trust={null}
        />
      </>
    );
  }

  const bg     = trust.tier_color + '1f';
  const border = trust.tier_color + '59';

  return (
    <>
      <Pressable
        style={ST.trustRow}
        onPress={() => setBreakdownVisible(true)}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Text style={ST.trustLabel}>ODIN</Text>
        <View style={[ST.trustPill, { backgroundColor: bg, borderColor: border }]}>
          <Text style={[ST.trustPillTxt, { color: trust.tier_color }]}>
            {trust.tier.toUpperCase()} · {trust.score}
          </Text>
        </View>
      </Pressable>

      <TrustBreakdownModal
        visible={breakdownVisible}
        onClose={() => setBreakdownVisible(false)}
        trust={trust}
      />
    </>
  );
}

// Task 3b — MechanicCard: Report Outcome button + SubmitOutcomeModal
function MechanicCard({ shop, userLat, userLng, dtcCode, onTrustUpdate }) {
  // Prefer backend-computed distanceMiles; fall back to client-side haversine
  const dist = shop.distanceMiles ?? haversineDistance(userLat, userLng, shop.lat, shop.lng);
  const distLabel = dist != null ? `${Number(dist).toFixed(1)} mi away` : null;
  const [outcomeModalVisible, setOutcomeModalVisible] = useState(false);
  const [externalTrust, setExternalTrust]             = useState(null);

  function handleSubmitted(trust) {
    setExternalTrust(trust);
    setOutcomeModalVisible(false);
    if (onTrustUpdate) onTrustUpdate(shop.id, trust);
  }

  return (
    <View style={ST.card}>
      {/* ── Shop photo ── */}
      {shop.photoUrl ? (
        <Image
          source={{ uri: shop.photoUrl }}
          style={ST.shopPhoto}
          resizeMode="cover"
        />
      ) : (
        <View style={[ST.shopPhoto, ST.shopPhotoPlaceholder]}>
          <Text style={ST.shopPhotoIcon}>⚙</Text>
        </View>
      )}

      {/* ── Top row: name + distance ── */}
      <View style={ST.cardHeader}>
        <Text style={ST.shopName} numberOfLines={2}>{shop.name}</Text>
        {distLabel && (
          <View style={ST.distPill}>
            <Text style={ST.distTxt}>{distLabel}</Text>
          </View>
        )}
      </View>

      {/* ── Rating + open badge ── */}
      <View style={ST.metaRow}>
        <StarRow rating={shop.rating} count={shop.ratingCount} />
        <OpenBadge openNow={shop.openNow} />
      </View>

      {/* ── ODIN Trust Score (Task 4: externalTrust passed in) ── */}
      <TrustBadge shopId={shop.id} externalTrust={externalTrust} />

      {/* ── Address ── */}
      {shop.address ? (
        <Text style={ST.address} numberOfLines={2}>{shop.address}</Text>
      ) : null}

      {/* ── Actions ── */}
      <View style={ST.actions}>
        {shop.phone ? (
          <Pressable
            style={({ pressed }) => [ST.actionBtn, ST.callBtn, pressed && ST.pressed]}
            onPress={() => Linking.openURL(`tel:${shop.phone.replace(/\D/g, '')}`)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={ST.callIcon}>✆</Text>
            <Text style={ST.callTxt}>{shop.phone}</Text>
          </Pressable>
        ) : (
          <Text style={ST.noPhone}>No phone listed</Text>
        )}

        {shop.lat && shop.lng ? (
          <Pressable
            style={({ pressed }) => [ST.actionBtn, ST.dirBtn, pressed && ST.pressed]}
            onPress={() => openDirections(shop.lat, shop.lng, shop.name)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={ST.dirTxt}>Directions</Text>
          </Pressable>
        ) : null}
      </View>

      {/* ── Report Outcome button (Task 3b) ── */}
      <Pressable
        style={({ pressed }) => [ST.reportBtn, pressed && ST.pressed]}
        onPress={() => setOutcomeModalVisible(true)}
      >
        <Text style={ST.reportBtnTxt}>⊕  REPORT OUTCOME</Text>
      </Pressable>

      {/* ── Outcome modal ── */}
      <SubmitOutcomeModal
        visible={outcomeModalVisible}
        onClose={() => setOutcomeModalVisible(false)}
        onSubmitted={handleSubmitted}
        shop={{ id: shop.id, name: shop.name }}
        dtcCode={dtcCode ?? null}
      />
    </View>
  );
}

// ─── Screen ─────────────────────────────────────────────────────────────────
export default function MechanicFinderScreen({ route, navigation }) {
  const { dtcCode, make, model, year } = route.params ?? {};

  const [coords, setCoords]       = useState(null);
  const [shops, setShops]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [minRating, setMinRating] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission is required to find nearby mechanics.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = pos.coords;
      setCoords({ latitude, longitude });

      const params = { lat: latitude, lng: longitude, dtc: dtcCode ?? undefined };
      if (minRating != null) params.minRating = minRating;
      const res = await client.get('/mechanics', { params });
      setShops(res.data.shops ?? []);
    } catch (err) {
      console.error('[AutoAlert] MechanicFinder load error:', err);
      setError('Could not load nearby mechanics. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [dtcCode, minRating]);

  useEffect(() => { load(); }, [load]);

  const vehicleLabel = make && model && year ? `${year} ${make} ${model}` : null;

  // ── Header ─────────────────────────────────────────────────────────────
  const ListHeader = (
    <>
      {(dtcCode || vehicleLabel) && (
        <View style={ST.contextBanner}>
          {dtcCode && (
            <Text style={ST.contextCode}>{dtcCode}</Text>
          )}
          {vehicleLabel && (
            <Text style={ST.contextVehicle}>{vehicleLabel}</Text>
          )}
        </View>
      )}
      <RatingFilterBar selected={minRating} onSelect={setMinRating} />
      {shops.length > 0 && (
        <Text style={ST.resultCount}>
          {shops.length} SHOP{shops.length !== 1 ? 'S' : ''} NEARBY
        </Text>
      )}
    </>
  );

  return (
    <View style={ST.container}>
      {/* ── Top nav bar ── */}
      <View style={ST.navBar}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [ST.backBtn, pressed && ST.pressed]}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={ST.backTxt}>← Back</Text>
        </Pressable>
        <Text style={ST.navTitle}>NEARBY MECHANICS</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* ── Neon rule under nav ── */}
      <View style={ST.neonRule} />

      {/* ── Body ── */}
      {loading ? (
        <View style={ST.center}>
          <ActivityIndicator size="large" color={C.accent} />
          <Text style={ST.loadingTxt}>Scanning for mechanics…</Text>
        </View>
      ) : error ? (
        <View style={ST.center}>
          <Text style={ST.errorTxt}>{error}</Text>
          <Pressable
            style={({ pressed }) => [ST.retryBtn, pressed && ST.pressed]}
            onPress={load}
          >
            <Text style={ST.retryTxt}>TRY AGAIN</Text>
          </Pressable>
        </View>
      ) : shops.length === 0 ? (
        <View style={ST.center}>
          <Text style={ST.emptyIcon}>⚙</Text>
          <Text style={ST.emptyTitle}>NO MECHANICS FOUND</Text>
          <Text style={ST.emptySubtitle}>Try expanding your search area or check your connection.</Text>
        </View>
      ) : (
        <FlatList
          data={shops}
          keyExtractor={(item, i) => item.id ?? String(i)}
          renderItem={({ item }) => (
            <MechanicCard
              shop={item}
              userLat={coords?.latitude}
              userLng={coords?.longitude}
              dtcCode={dtcCode}
              onTrustUpdate={() => {}}
            />
          )}
          ListHeaderComponent={ListHeader}
          contentContainerStyle={ST.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────
const ST = StyleSheet.create({
  container:    { flex: 1, backgroundColor: C.bg },

  // Nav
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 52, paddingHorizontal: 20, paddingBottom: 14,
  },
  backBtn:  { width: 60 },
  backTxt:  { color: C.accent, fontSize: 16 },
  navTitle: {
    color: C.accent, fontSize: 13, fontWeight: '800',
    letterSpacing: 2.5, textTransform: 'uppercase',
  },
  neonRule: {
    height: 1, backgroundColor: C.border,
    marginHorizontal: 20,
  },

  // States
  center:       { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  loadingTxt:   { color: C.textSecondary, marginTop: 14, fontSize: 13, letterSpacing: 1 },
  errorTxt:     { color: C.closed, textAlign: 'center', fontSize: 14, lineHeight: 22, marginBottom: 20 },
  retryBtn: {
    borderWidth: 1, borderColor: C.accent, paddingHorizontal: 28,
    paddingVertical: 12, borderRadius: 0,
  },
  retryTxt:     { color: C.accent, fontWeight: '700', fontSize: 13, letterSpacing: 1.5 },
  emptyIcon:    { fontSize: 40, color: C.textMuted, marginBottom: 16 },
  emptyTitle:   { color: C.textPrimary, fontSize: 15, fontWeight: '800', letterSpacing: 2, marginBottom: 8 },
  emptySubtitle:{ color: C.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 20 },

  // List
  listContent:  { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 48 },
  resultCount: {
    color: C.textMuted, fontSize: 10, fontWeight: '700',
    letterSpacing: 2, marginBottom: 12, marginTop: 4,
  },

  // Context banner
  contextBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.accentDim, borderWidth: 1, borderColor: C.border,
    borderRadius: 0, paddingHorizontal: 14, paddingVertical: 10,
    marginBottom: 16,
  },
  contextCode:    { color: C.accent, fontWeight: '800', fontSize: 14, letterSpacing: 1 },
  contextVehicle: { color: C.textSecondary, fontSize: 12 },

  // Rating filter bar
  filterBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 14, marginTop: 2,
  },
  filterBarLabel: {
    color: C.textMuted, fontSize: 9, fontWeight: '800',
    letterSpacing: 1.5, textTransform: 'uppercase',
  },
  filterOptions: { flexDirection: 'row', gap: 6 },
  filterOption: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: C.border, borderRadius: 0,
  },
  filterOptionActive: {
    borderColor: C.accent, backgroundColor: C.accentDim,
  },
  filterOptionTxt: {
    color: C.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5,
  },
  filterOptionTxtActive: { color: C.accent },

  // Card
  card: {
    backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border,
    borderRadius: 0,
    marginBottom: 10,
    overflow: 'hidden',
  },
  shopPhoto: {
    width: '100%', height: 140,
  },
  shopPhotoPlaceholder: {
    backgroundColor: C.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  shopPhotoIcon: { color: C.textMuted, fontSize: 32 },
  cardHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, paddingHorizontal: 16, paddingTop: 14 },
  shopName:    { color: C.textPrimary, fontSize: 15, fontWeight: '700', flex: 1, marginRight: 10, lineHeight: 21 },

  distPill: {
    backgroundColor: C.accentDim, borderWidth: 1, borderColor: C.border,
    borderRadius: 0, paddingHorizontal: 8, paddingVertical: 3,
  },
  distTxt: { color: C.accent, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },

  metaRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, paddingHorizontal: 16 },
  ratingRow:   { flexDirection: 'row', alignItems: 'center' },
  stars:       { color: C.gold, fontSize: 13 },
  ratingVal:   { color: C.textPrimary, fontSize: 13, fontWeight: '600' },
  ratingCount: { color: C.textSecondary, fontSize: 12 },
  noRating:    { color: C.textMuted, fontSize: 12 },

  badge:       { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 0 },
  badgeOpen:   { backgroundColor: C.openBg },
  badgeClosed: { backgroundColor: C.closedBg },
  badgeTxt:    { fontSize: 10, fontWeight: '800', letterSpacing: 1 },

  // Trust score row
  trustRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 8, marginTop: 2, paddingHorizontal: 16,
  },
  trustLabel: {
    color: '#505050', fontSize: 9, fontWeight: '800',
    letterSpacing: 1.5, textTransform: 'uppercase',
  },
  trustPill: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 0, borderWidth: 1,
  },
  trustPillTxt: {
    fontSize: 10, fontWeight: '800', letterSpacing: 0.8,
  },
  trustLoading: { color: C.textMuted, fontSize: 12 },
  trustNoData:  { color: C.textMuted, fontSize: 11, fontStyle: 'italic' },

  address:     { color: C.textSecondary, fontSize: 12, lineHeight: 17, marginBottom: 12, paddingHorizontal: 16 },

  // Actions
  actions:  { flexDirection: 'row', gap: 8, marginTop: 4, paddingHorizontal: 16 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, paddingHorizontal: 14, borderRadius: 0, minHeight: 44,
  },
  callBtn:  { flex: 1, backgroundColor: C.accentDim, borderWidth: 1, borderColor: C.border },
  callIcon: { color: C.accent, fontSize: 14, marginRight: 6 },
  callTxt:  { color: C.accent, fontSize: 13, fontWeight: '600' },
  dirBtn:   { paddingHorizontal: 16, backgroundColor: C.accentDim, borderWidth: 1, borderColor: C.border },
  dirTxt:   { color: C.textSecondary, fontSize: 13, fontWeight: '600' },
  noPhone:  { color: C.textMuted, fontSize: 12, alignSelf: 'center' },

  // Report outcome button (Task 3c)
  // NOTE: borderStyle:'dashed' omitted — on iOS it silently kills child rendering
  reportBtn: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#2A2A2A',
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  reportBtnTxt: {
    color: '#505050',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
  },

  pressed:  { opacity: 0.65 },
});
