import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Linking, Platform,
} from 'react-native';
import * as Location from 'expo-location';
import client from '../api/client';

// Haversine distance in miles
function distanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return (2 * R * Math.asin(Math.sqrt(a))).toFixed(1);
}

function StarRating({ rating, count }) {
  if (rating == null) return <Text style={S.noRating}>No rating</Text>;
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  const stars = '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
  return (
    <Text style={S.rating}>
      <Text style={S.stars}>{stars}</Text>
      {' '}{rating.toFixed(1)}{count > 0 ? ` (${count.toLocaleString()})` : ''}
    </Text>
  );
}

function handleCall(phone) {
  Linking.openURL(`tel:${phone.replace(/\D/g, '')}`);
}

function handleDirections(lat, lng, name) {
  const dest = `${lat},${lng}`;
  const label = encodeURIComponent(name);
  const url = Platform.OS === 'ios'
    ? `maps://app?daddr=${dest}&q=${label}`
    : `geo:${dest}?q=${dest}(${label})`;
  Linking.openURL(url).catch(() =>
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${dest}`)
  );
}

export default function MechanicFinderScreen({ route, navigation }) {
  const { dtcCode, make, model, year } = route.params ?? {};
  const [coords, setCoords] = useState(null);
  const [shops, setShops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setError('Location permission is required to find nearby mechanics.');
          setLoading(false);
          return;
        }

        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const { latitude, longitude } = loc.coords;
        setCoords({ latitude, longitude });

        const res = await client.get('/mechanics/nearby', {
          params: { lat: latitude, lng: longitude },
        });
        setShops(res.data.shops ?? []);
      } catch (err) {
        setError('Could not find nearby mechanics. Please try again.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const vehicleLabel = make && model && year ? `${year} ${make} ${model}` : null;

  return (
    <View style={S.container}>
      <View style={S.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn}>
          <Text style={S.backTxt}>← Back</Text>
        </TouchableOpacity>
        <Text style={S.headerTitle}>Nearby Mechanics</Text>
        <View style={{ width: 60 }} />
      </View>

      {dtcCode && (
        <View style={S.contextBanner}>
          <Text style={S.contextTxt}>
            Searching for repairs on{' '}
            <Text style={S.contextBold}>{dtcCode}</Text>
            {vehicleLabel ? (
              <Text> · {vehicleLabel}</Text>
            ) : null}
          </Text>
        </View>
      )}

      {loading ? (
        <View style={S.center}>
          <ActivityIndicator size="large" color="#00d4ff" />
          <Text style={S.loadingTxt}>Finding mechanics near you…</Text>
        </View>
      ) : error ? (
        <View style={S.center}>
          <Text style={S.errorTxt}>{error}</Text>
          <TouchableOpacity style={S.retryBtn} onPress={() => {
            setError(null);
            setLoading(true);
            // re-trigger by remounting; simplest: navigate back and back
            navigation.replace('MechanicFinder', route.params);
          }}>
            <Text style={S.retryTxt}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : shops.length === 0 ? (
        <View style={S.center}>
          <Text style={S.errorTxt}>No auto repair shops found within 5 miles.</Text>
        </View>
      ) : (
        <ScrollView style={S.scroll} showsVerticalScrollIndicator={false}>
          <Text style={S.resultCount}>{shops.length} shops found nearby</Text>
          {shops.map((shop, i) => {
            const dist = coords && shop.lat && shop.lng
              ? distanceMiles(coords.latitude, coords.longitude, shop.lat, shop.lng)
              : null;
            return (
              <View key={shop.id ?? i} style={S.card}>
                <View style={S.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={S.shopName}>{shop.name}</Text>
                    <StarRating rating={shop.rating} count={shop.ratingCount} />
                  </View>
                  <View style={S.rightCol}>
                    {dist && <Text style={S.distance}>{dist} mi</Text>}
                    {shop.openNow != null && (
                      <Text style={[S.openStatus, { color: shop.openNow ? '#27ae60' : '#e74c3c' }]}>
                        {shop.openNow ? 'Open' : 'Closed'}
                      </Text>
                    )}
                  </View>
                </View>

                {shop.address ? (
                  <Text style={S.address}>{shop.address}</Text>
                ) : null}

                {shop.phone ? (
                  <Text style={S.phone}>{shop.phone}</Text>
                ) : null}

                <View style={S.actions}>
                  {shop.phone ? (
                    <TouchableOpacity
                      style={[S.actionBtn, S.callBtn]}
                      onPress={() => handleCall(shop.phone)}
                    >
                      <Text style={S.actionTxt}>📞 Call</Text>
                    </TouchableOpacity>
                  ) : null}
                  {shop.lat && shop.lng ? (
                    <TouchableOpacity
                      style={[S.actionBtn, S.dirBtn]}
                      onPress={() => handleDirections(shop.lat, shop.lng, shop.name)}
                    >
                      <Text style={S.actionTxt}>🗺 Directions</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            );
          })}
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
  contextBanner: {
    backgroundColor: 'rgba(0,212,255,0.1)', marginHorizontal: 16, marginBottom: 8,
    borderRadius: 10, padding: 10, borderWidth: 1, borderColor: 'rgba(0,212,255,0.25)',
  },
  contextTxt: { color: '#fff', fontSize: 13, opacity: 0.85, textAlign: 'center' },
  contextBold: { color: '#00d4ff', fontWeight: 'bold' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  loadingTxt: { color: '#fff', opacity: 0.6, marginTop: 14, fontSize: 14 },
  errorTxt: { color: '#fff', opacity: 0.75, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  retryBtn: {
    marginTop: 20, backgroundColor: '#00d4ff', paddingHorizontal: 28,
    paddingVertical: 12, borderRadius: 24,
  },
  retryTxt: { color: '#1a1a2e', fontWeight: 'bold', fontSize: 15 },
  scroll: { flex: 1, paddingHorizontal: 16 },
  resultCount: { color: '#fff', opacity: 0.5, fontSize: 12, marginBottom: 10, marginTop: 4 },
  card: {
    backgroundColor: '#16213e', borderRadius: 14, padding: 16,
    marginBottom: 12,
  },
  cardTop: { flexDirection: 'row', marginBottom: 6 },
  rightCol: { alignItems: 'flex-end', gap: 4 },
  shopName: { color: '#fff', fontSize: 15, fontWeight: 'bold', marginBottom: 4, flexShrink: 1 },
  rating: { color: '#fff', fontSize: 13, opacity: 0.85 },
  stars: { color: '#f39c12' },
  noRating: { color: '#fff', opacity: 0.4, fontSize: 12 },
  distance: { color: '#00d4ff', fontSize: 13, fontWeight: '600' },
  openStatus: { fontSize: 12, fontWeight: '600' },
  address: { color: '#fff', opacity: 0.6, fontSize: 12, marginBottom: 4 },
  phone: { color: '#00d4ff', fontSize: 13, marginBottom: 10 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  actionBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 22, alignItems: 'center',
  },
  callBtn: { backgroundColor: '#27ae60' },
  dirBtn: { backgroundColor: '#0f3460' },
  actionTxt: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
});
