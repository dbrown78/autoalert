import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import client from '../api/client';
import CostComparisonCard from '../components/CostComparisonCard';
import DIYRepairCard from '../components/DIYRepairCard';
import DriveSafetyCard from '../components/DriveSafetyCard';
import { useAuth } from '../context/AuthContext';

const SEVERITY_COLORS = { high: '#D0453A', medium: '#C08B30', low: '#4CAF82' };
const URGENCY_COLORS = { 'Check gas cap first': '#4CAF82', 'Within 1 month': '#4CAF82', 'Within 2 weeks': '#C08B30', 'Within 1 week': '#D0453A' };

const capitalize = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

export default function DTCDetailScreen({ route, navigation }) {
  const { code } = route.params;
  const { selectedVehicle } = useAuth();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let url = `/dtc/${code}`;
    if (selectedVehicle) {
      const params = new URLSearchParams({
        make: selectedVehicle.make,
        model: selectedVehicle.model,
        year: selectedVehicle.year,
      });
      url += `?${params.toString()}`;
    }
    client.get(url)
      .then(res => {
        setDetail(res.data.dtc);
        client.post('/scans', {
          dtc_code: code,
          vehicle_id: selectedVehicle?.id ?? null,
        }).catch(() => {}); // fire-and-forget, silent on failure

        // ODIN Foresight: log telemetry snapshot alongside the scan event.
        // Discrete sensor fields (rpm, coolant_temp, etc.) are null until live
        // OBD hardware is integrated; raw_data captures DTC context for now.
        client.post('/telemetry', {
          vehicle_id: selectedVehicle?.id ?? null,
          raw_data: {
            dtc_code: code,
            severity: res.data.dtc.severity,
            urgency: res.data.dtc.urgency,
          },
        }).catch(() => {});
      })
      .catch(() => setError('Could not load details for ' + code))
      .finally(() => setLoading(false));
  }, [code, selectedVehicle]);

  if (loading) {
    return (
      <View style={[S.container, S.center]}>
        <ActivityIndicator size="large" color="#00d4ff" />
      </View>
    );
  }

  if (error || !detail) {
    return (
      <View style={[S.container, S.center]}>
        <Text style={S.errorText}>{error || 'No details available for ' + code}</Text>
      </View>
    );
  }

  const severityLabel = capitalize(detail.severity);
  const severityColor = SEVERITY_COLORS[detail.severity] || '#aaa';
  const urgencyColor = URGENCY_COLORS[detail.urgency] || '#aaa';

  return (
    <View style={S.container}>
      <View style={S.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn}>
          <Text style={S.backTxt}>← Back</Text>
        </TouchableOpacity>
        <Text style={S.headerTitle}>Code Details</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={S.scroll} showsVerticalScrollIndicator={false}>
        <DriveSafetyCard
          driveSafety={detail.drive_safety}
          driveSafetyReason={detail.drive_safety_reason}
        />

        <View style={S.heroCard}>
          <Text style={S.codeLabel}>{detail.code}</Text>
          <Text style={S.codeShort}>{detail.short_description}</Text>
          <View style={S.badgeRow}>
            <View style={[S.badge, { backgroundColor: severityColor }]}>
              <Text style={S.badgeTxt}>{severityLabel} Severity</Text>
            </View>
            {detail.urgency && (
              <View style={[S.badge, { backgroundColor: urgencyColor }]}>
                <Text style={S.badgeTxt}>⏱ {detail.urgency}</Text>
              </View>
            )}
          </View>
          {detail.vehicle_specific && selectedVehicle && (
            <View style={S.vehicleBadge}>
              <Text style={S.vehicleBadgeTxt}>
                🚗 Matched to your {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}
              </Text>
            </View>
          )}
        </View>

        <Section title="What's happening?">
          <Text style={S.bodyText}>{detail.description}</Text>
        </Section>

        <Section title="Symptoms you may notice">
          {(detail.symptoms ?? []).map((s, i) => (
            <View key={i} style={S.bulletRow}>
              <Text style={S.bullet}>•</Text>
              <Text style={S.bulletText}>{s}</Text>
            </View>
          ))}
        </Section>

        <Section title="Common causes">
          {(detail.possible_causes ?? []).map((c, i) => (
            <View key={i} style={S.bulletRow}>
              <Text style={S.bullet}>•</Text>
              <Text style={S.bulletText}>{c}</Text>
            </View>
          ))}
        </Section>

        {detail.notes && (
          <Section title="Vehicle-specific notes">
            <Text style={S.bodyText}>{detail.notes}</Text>
          </Section>
        )}

        {detail.oem_cost_min != null && (
          <>
            <CostComparisonCard
              oemCostMin={detail.oem_cost_min}
              oemCostMax={detail.oem_cost_max}
              aftermarketCostMin={detail.aftermarket_cost_min}
              aftermarketCostMax={detail.aftermarket_cost_max}
              laborHoursMin={detail.labor_hours_min}
              laborHoursMax={detail.labor_hours_max}
              diyDifficulty={detail.diy_difficulty}
            />
            <TouchableOpacity
              style={S.amazonBtn}
              onPress={() => {
                const q = encodeURIComponent(`${detail.code} ${detail.short_description} parts`);
                Linking.openURL(`https://www.amazon.com/s?k=${q}&tag=odinai-20`);
              }}
            >
              <Text style={S.amazonTxt}>Find Parts on Amazon →</Text>
            </TouchableOpacity>
          </>
        )}

        <DIYRepairCard
          dtcCode={detail.code}
          shortDescription={detail.short_description}
          make={selectedVehicle?.make}
          model={selectedVehicle?.model}
          diyDifficulty={detail.diy_difficulty}
          youtubeSearchQuery={detail.youtube_search_query}
        />

        <TouchableOpacity
          style={S.mechanicBtn}
          onPress={() => navigation.navigate('MechanicFinder', {
            dtcCode: detail.code,
            make: selectedVehicle?.make ?? null,
            model: selectedVehicle?.model ?? null,
            year: selectedVehicle?.year ?? null,
          })}
        >
          <Text style={S.mechanicLabel}>FIND A MECHANIC</Text>
          <Text style={S.mechanicSub}>Nearby auto repair shops</Text>
        </TouchableOpacity>

        <TouchableOpacity style={S.emergencyBtn}>
          <Text style={S.emergencyTxt}>🆘 Roadside Assistance</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

function Section({ title, children }) {
  return (
    <View style={S.section}>
      <Text style={S.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080808' },
  center: { justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 52, paddingHorizontal: 20, paddingBottom: 12 },
  backBtn: { width: 60 },
  backTxt: { color: '#C0C0C0', fontSize: 16 },
  headerTitle: { color: '#E0E0E0', fontSize: 13, fontWeight: 'bold', letterSpacing: 2, textTransform: 'uppercase' },
  scroll: { flex: 1, paddingHorizontal: 20 },
  heroCard: { backgroundColor: '#1A1A1A', borderRadius: 0, padding: 20, marginBottom: 14, alignItems: 'center', borderWidth: 1, borderColor: '#2A2A2A' },
  codeLabel: { color: '#E0E0E0', fontSize: 32, fontWeight: 'bold', letterSpacing: 4 },
  codeShort: { color: '#777777', fontSize: 13, textAlign: 'center', marginTop: 6, marginBottom: 14, letterSpacing: 0.5 },
  badgeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  badge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 0, borderWidth: 1 },
  badgeTxt: { color: '#fff', fontSize: 11, fontWeight: 'bold', letterSpacing: 0.5 },
  vehicleBadge: { marginTop: 10, borderWidth: 1, borderColor: '#2A2A2A', borderRadius: 0, paddingHorizontal: 14, paddingVertical: 6 },
  vehicleBadgeTxt: { color: '#777777', fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  section: { backgroundColor: '#1A1A1A', borderRadius: 0, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#2A2A2A' },
  sectionTitle: { color: '#C0C0C0', fontSize: 10, fontWeight: 'bold', marginBottom: 12, letterSpacing: 3, textTransform: 'uppercase' },
  bodyText: { color: '#E0E0E0', fontSize: 14, lineHeight: 22, opacity: 0.85 },
  bulletRow: { flexDirection: 'row', marginBottom: 6 },
  bullet: { color: '#505050', fontSize: 14, marginRight: 8, marginTop: 1 },
  bulletText: { color: '#E0E0E0', fontSize: 14, opacity: 0.85, flex: 1, lineHeight: 20 },
  mechanicBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1, borderColor: '#C0C0C0',
    padding: 16, borderRadius: 0,
    alignItems: 'center', marginTop: 4, marginBottom: 10,
  },
  mechanicLabel: { color: '#E0E0E0', fontSize: 11, fontWeight: '800', letterSpacing: 3 },
  mechanicSub: { color: '#777777', fontSize: 11, marginTop: 3, letterSpacing: 0.5 },
  amazonBtn: { backgroundColor: '#1A1A1A', padding: 14, borderRadius: 0, alignItems: 'center', marginTop: -2, marginBottom: 10, borderWidth: 1, borderColor: '#2A2A2A' },
  amazonTxt: { color: '#E0E0E0', fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  emergencyBtn: { backgroundColor: 'transparent', padding: 16, borderRadius: 0, alignItems: 'center', marginTop: 4, borderWidth: 1, borderColor: '#D0453A' },
  emergencyTxt: { color: '#D0453A', fontSize: 12, fontWeight: 'bold', letterSpacing: 3, textTransform: 'uppercase' },
  errorText: { color: '#E0E0E0', textAlign: 'center', fontSize: 16, paddingHorizontal: 32 },
});
