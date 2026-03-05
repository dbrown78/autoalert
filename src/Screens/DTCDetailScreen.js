import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import client from '../api/client';
import CostComparisonCard from '../components/CostComparisonCard';
import DriveSafetyCard from '../components/DriveSafetyCard';
import { useAuth } from '../context/AuthContext';

const SEVERITY_COLORS = { high: '#e74c3c', medium: '#f39c12', low: '#27ae60' };
const URGENCY_COLORS = { 'Check gas cap first': '#27ae60', 'Within 1 month': '#27ae60', 'Within 2 weeks': '#f39c12', 'Within 1 week': '#e74c3c' };

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
          {detail.symptoms.map((s, i) => (
            <View key={i} style={S.bulletRow}>
              <Text style={S.bullet}>•</Text>
              <Text style={S.bulletText}>{s}</Text>
            </View>
          ))}
        </Section>

        <Section title="Common causes">
          {detail.possible_causes.map((c, i) => (
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
          <CostComparisonCard
            oemCostMin={detail.oem_cost_min}
            oemCostMax={detail.oem_cost_max}
            aftermarketCostMin={detail.aftermarket_cost_min}
            aftermarketCostMax={detail.aftermarket_cost_max}
            laborHoursMin={detail.labor_hours_min}
            laborHoursMax={detail.labor_hours_max}
            diyDifficulty={detail.diy_difficulty}
          />
        )}

        <TouchableOpacity
          style={S.mechanicBtn}
          onPress={() => navigation.navigate('MechanicFinder', {
            dtcCode: detail.code,
            make: selectedVehicle?.make ?? null,
            model: selectedVehicle?.model ?? null,
            year: selectedVehicle?.year ?? null,
          })}
        >
          <Text style={S.mechanicTxt}>🔧 Find a Mechanic Near Me</Text>
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
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  center: { justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 52, paddingHorizontal: 20, paddingBottom: 12 },
  backBtn: { width: 60 },
  backTxt: { color: '#00d4ff', fontSize: 16 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  scroll: { flex: 1, paddingHorizontal: 20 },
  heroCard: { backgroundColor: '#16213e', borderRadius: 16, padding: 20, marginBottom: 16, alignItems: 'center' },
  codeLabel: { color: '#00d4ff', fontSize: 32, fontWeight: 'bold', letterSpacing: 2 },
  codeShort: { color: '#fff', fontSize: 15, opacity: 0.85, textAlign: 'center', marginTop: 6, marginBottom: 14 },
  badgeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  badge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  badgeTxt: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  vehicleBadge: { marginTop: 10, backgroundColor: 'rgba(0,212,255,0.15)', borderWidth: 1, borderColor: '#00d4ff', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  vehicleBadgeTxt: { color: '#00d4ff', fontSize: 12, fontWeight: '600' },
  section: { backgroundColor: '#16213e', borderRadius: 14, padding: 16, marginBottom: 14 },
  sectionTitle: { color: '#00d4ff', fontSize: 15, fontWeight: 'bold', marginBottom: 12 },
  bodyText: { color: '#fff', fontSize: 14, lineHeight: 22, opacity: 0.85 },
  bulletRow: { flexDirection: 'row', marginBottom: 6 },
  bullet: { color: '#00d4ff', fontSize: 14, marginRight: 8, marginTop: 1 },
  bulletText: { color: '#fff', fontSize: 14, opacity: 0.85, flex: 1, lineHeight: 20 },
  mechanicBtn: { backgroundColor: '#0f3460', borderWidth: 1, borderColor: '#00d4ff', padding: 16, borderRadius: 30, alignItems: 'center', marginTop: 4, marginBottom: 10 },
  mechanicTxt: { color: '#00d4ff', fontSize: 16, fontWeight: 'bold' },
  emergencyBtn: { backgroundColor: '#e74c3c', padding: 16, borderRadius: 30, alignItems: 'center', marginTop: 4 },
  emergencyTxt: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  errorText: { color: '#fff', textAlign: 'center', fontSize: 16, paddingHorizontal: 32 },
});
