import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';

const DTC_DETAILS = {
  'P0420': {
    short: 'Catalytic Converter Efficiency Low',
    severity: 'Medium',
    urgency: 'Within 2 weeks',
    description: 'Your catalytic converter is not reducing emissions as effectively as it should. This is often triggered when the converter wears out or is damaged by oil/coolant contamination.',
    symptoms: ['Check engine light on', 'Possible sulfur / rotten egg smell from exhaust', 'Slightly reduced fuel economy', 'May fail emissions test'],
    causes: ['Worn or damaged catalytic converter', 'Engine oil or coolant burning (contaminating the cat)', 'Faulty upstream or downstream O2 sensor', 'Exhaust leaks before the catalytic converter'],
    repairs: [
      { fix: 'Replace catalytic converter', oem: '$800–$1,500', aftermarket: '$200–$600' },
      { fix: 'Replace O2 sensor(s)', oem: '$150–$300', aftermarket: '$80–$150' },
      { fix: 'Repair exhaust leak', oem: '$100–$300', aftermarket: '$50–$150' },
    ],
  },
  'P0300': {
    short: 'Random / Multiple Cylinder Misfire',
    severity: 'High',
    urgency: 'Within 1 week',
    description: 'Your engine is misfiring — one or more cylinders are not firing correctly. This can cause rough running and damage to the catalytic converter.',
    symptoms: ['Rough idle or shaking', 'Engine hesitation or stumbling', 'Check engine light flashing (severe misfire)', 'Poor acceleration and fuel economy'],
    causes: ['Worn or fouled spark plugs', 'Faulty ignition coils', 'Clogged or leaking fuel injectors', 'Low compression (worn engine)', 'Vacuum leaks'],
    repairs: [
      { fix: 'Replace spark plugs', oem: '$100–$250', aftermarket: '$40–$100' },
      { fix: 'Replace ignition coil(s)', oem: '$150–$350', aftermarket: '$60–$150' },
      { fix: 'Clean / replace fuel injectors', oem: '$200–$500', aftermarket: '$80–$250' },
    ],
  },
  'P0171': {
    short: 'Fuel System Too Lean (Bank 1)',
    severity: 'Medium',
    urgency: 'Within 2 weeks',
    description: 'The engine is running with too much air and not enough fuel on Bank 1. Over time a lean condition can cause engine damage and should be diagnosed promptly.',
    symptoms: ['Check engine light on', 'Rough idle', 'Hesitation on acceleration', 'Reduced fuel economy'],
    causes: ['Vacuum leak (cracked hose or intake manifold gasket)', 'Dirty or faulty mass airflow (MAF) sensor', 'Weak fuel pump or clogged fuel filter', 'Faulty oxygen sensor', 'Clogged fuel injectors'],
    repairs: [
      { fix: 'Fix vacuum leak', oem: '$100–$400', aftermarket: '$30–$150' },
      { fix: 'Clean / replace MAF sensor', oem: '$200–$400', aftermarket: '$50–$150' },
      { fix: 'Replace fuel pump', oem: '$400–$800', aftermarket: '$150–$400' },
    ],
  },
  'P0128': {
    short: 'Coolant Temp Below Thermostat Temp',
    severity: 'Low',
    urgency: 'Within 1 month',
    description: 'Your engine is not reaching its normal operating temperature. Usually caused by a stuck-open thermostat and affects fuel economy and heater performance.',
    symptoms: ['Temperature gauge stays low', 'Poor heater output in cold weather', 'Reduced fuel economy', 'Check engine light on'],
    causes: ['Thermostat stuck open', 'Faulty coolant temperature sensor', 'Low coolant level'],
    repairs: [
      { fix: 'Replace thermostat', oem: '$150–$350', aftermarket: '$50–$150' },
      { fix: 'Replace coolant temp sensor', oem: '$100–$200', aftermarket: '$30–$80' },
    ],
  },
  'P0442': {
    short: 'EVAP System Leak (Small)',
    severity: 'Low',
    urgency: 'Check gas cap first',
    description: 'A small leak has been detected in the evaporative emission control system. Start by checking your gas cap — it is the most common and cheapest fix.',
    symptoms: ['Check engine light on', 'Faint fuel smell near the vehicle', 'May fail emissions test'],
    causes: ['Loose or damaged gas cap', 'Cracked EVAP hose or line', 'Faulty purge valve or vent valve', 'Damaged charcoal canister'],
    repairs: [
      { fix: 'Replace gas cap', oem: '$20–$50', aftermarket: '$10–$25' },
      { fix: 'Replace EVAP hose / line', oem: '$100–$300', aftermarket: '$40–$120' },
      { fix: 'Replace purge or vent valve', oem: '$150–$350', aftermarket: '$50–$150' },
    ],
  },
};

const SEVERITY_COLORS = { High: '#e74c3c', Medium: '#f39c12', Low: '#27ae60' };
const URGENCY_COLORS = { 'Check gas cap first': '#27ae60', 'Within 1 month': '#27ae60', 'Within 2 weeks': '#f39c12', 'Within 1 week': '#e74c3c' };

export default function DTCDetailScreen({ route, navigation }) {
  const { code } = route.params;
  const detail = DTC_DETAILS[code];

  if (!detail) {
    return (
      <View style={S.container}>
        <Text style={S.errorText}>No details available for {code}</Text>
      </View>
    );
  }

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
        <View style={S.heroCard}>
          <Text style={S.codeLabel}>{code}</Text>
          <Text style={S.codeShort}>{detail.short}</Text>
          <View style={S.badgeRow}>
            <View style={[S.badge, { backgroundColor: SEVERITY_COLORS[detail.severity] }]}>
              <Text style={S.badgeTxt}>{detail.severity} Severity</Text>
            </View>
            <View style={[S.badge, { backgroundColor: URGENCY_COLORS[detail.urgency] }]}>
              <Text style={S.badgeTxt}>⏱ {detail.urgency}</Text>
            </View>
          </View>
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
          {detail.causes.map((c, i) => (
            <View key={i} style={S.bulletRow}>
              <Text style={S.bullet}>•</Text>
              <Text style={S.bulletText}>{c}</Text>
            </View>
          ))}
        </Section>

        <Section title="Repair cost estimates">
          <View style={S.tableHeader}>
            <Text style={[S.tableCell, S.tableHead, { flex: 2 }]}>Repair</Text>
            <Text style={[S.tableCell, S.tableHead]}>OEM</Text>
            <Text style={[S.tableCell, S.tableHead]}>Aftermarket</Text>
          </View>
          {detail.repairs.map((r, i) => (
            <View key={i} style={[S.tableRow, i % 2 === 0 && S.tableRowAlt]}>
              <Text style={[S.tableCell, { flex: 2, color: '#fff' }]}>{r.fix}</Text>
              <Text style={[S.tableCell, { color: '#f39c12' }]}>{r.oem}</Text>
              <Text style={[S.tableCell, { color: '#27ae60' }]}>{r.aftermarket}</Text>
            </View>
          ))}
          <Text style={S.disclaimer}>* Estimates vary by location, vehicle make/model, and labor rates.</Text>
        </Section>

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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 52, paddingHorizontal: 20, paddingBottom: 12 },
  backBtn: { width: 60 },
  backTxt: { color: '#00d4ff', fontSize: 16 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  scroll: { flex: 1, paddingHorizontal: 20 },
  heroCard: { backgroundColor: '#16213e', borderRadius: 16, padding: 20, marginBottom: 16, alignItems: 'center' },
  codeLabel: { color: '#00d4ff', fontSize: 32, fontWeight: 'bold', letterSpacing: 2 },
  codeShort: { color: '#fff', fontSize: 15, opacity: 0.85, textAlign: 'center', marginTop: 6, marginBottom: 14 },
  badgeRow: { flexDirection: 'row', gap: 8 },
  badge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  badgeTxt: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  section: { backgroundColor: '#16213e', borderRadius: 14, padding: 16, marginBottom: 14 },
  sectionTitle: { color: '#00d4ff', fontSize: 15, fontWeight: 'bold', marginBottom: 12 },
  bodyText: { color: '#fff', fontSize: 14, lineHeight: 22, opacity: 0.85 },
  bulletRow: { flexDirection: 'row', marginBottom: 6 },
  bullet: { color: '#00d4ff', fontSize: 14, marginRight: 8, marginTop: 1 },
  bulletText: { color: '#fff', fontSize: 14, opacity: 0.85, flex: 1, lineHeight: 20 },
  tableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#0f3460', paddingBottom: 8, marginBottom: 4 },
  tableHead: { color: '#00d4ff', fontWeight: 'bold' },
  tableRow: { flexDirection: 'row', paddingVertical: 8 },
  tableRowAlt: { backgroundColor: 'rgba(0,212,255,0.05)', borderRadius: 6 },
  tableCell: { flex: 1, fontSize: 12, paddingHorizontal: 4 },
  disclaimer: { color: '#fff', opacity: 0.4, fontSize: 11, marginTop: 10, fontStyle: 'italic' },
  emergencyBtn: { backgroundColor: '#e74c3c', padding: 16, borderRadius: 30, alignItems: 'center', marginTop: 4 },
  emergencyTxt: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  errorText: { color: '#fff', textAlign: 'center', marginTop: 100, fontSize: 16 },
});