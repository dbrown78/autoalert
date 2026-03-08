import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useAuth } from '../context/AuthContext';
import ForesightCard from '../components/ForesightCard';

const DTC_CODES = {
  'P0420': { short: 'Catalytic Converter Efficiency Low', severity: 'Medium', urgency: 'Within 2 weeks' },
  'P0300': { short: 'Random / Multiple Cylinder Misfire', severity: 'High', urgency: 'Within 1 week' },
  'P0171': { short: 'Fuel System Too Lean (Bank 1)', severity: 'Medium', urgency: 'Within 2 weeks' },
  'P0128': { short: 'Coolant Temp Below Thermostat Temp', severity: 'Low', urgency: 'Within 1 month' },
  'P0442': { short: 'EVAP System Leak (Small)', severity: 'Low', urgency: 'Check gas cap first' },
};

const COLORS = { Medium: '#C08B30', High: '#D0453A', Low: '#4CAF82' };
const URGENCY_COLORS = { 'Check gas cap first': '#4CAF82', 'Within 1 month': '#4CAF82', 'Within 2 weeks': '#C08B30', 'Within 1 week': '#D0453A' };

export default function HomeScreen({ navigation }) {
  const { user, logout } = useAuth();
  const codes = ['P0420', 'P0300', 'P0171'];

  return (
    <View style={S.container}>
      <View style={S.header}>
        <Text style={S.logo}>🚗 AutoAlert</Text>
        <View style={S.headerActions}>
          <TouchableOpacity onPress={() => navigation.navigate('ScanHistory')} style={S.historyBtn}>
            <Text style={S.historyTxt}>History</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={logout}>
            <Text style={S.logoutBtn}>Log out</Text>
          </TouchableOpacity>
        </View>
      </View>
      <Text style={S.welcome}>Welcome back, {user?.name} 👋</Text>
      <ForesightCard />
      <Text style={S.heading}>Active Alerts ({codes.length})</Text>
      <ScrollView style={S.scroll}>
        {codes.map(c => (
          <TouchableOpacity
            key={c}
            style={S.card}
            onPress={() => navigation.navigate('DTCDetail', { code: c })}
          >
            <View style={{ flex: 1 }}>
              <Text style={S.codeText}>{c}</Text>
              <Text style={S.codeSub}>{DTC_CODES[c].short}</Text>
              <Text style={[S.urgency, { color: URGENCY_COLORS[DTC_CODES[c].urgency] }]}>
                ⏱ {DTC_CODES[c].urgency}
              </Text>
            </View>
            <View style={[S.badge, { backgroundColor: COLORS[DTC_CODES[c].severity] }]}>
              <Text style={S.badgeTxt}>{DTC_CODES[c].severity}</Text>
            </View>
            <Text style={S.arrow}>›</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <TouchableOpacity style={S.red}>
        <Text style={S.btnTxt}>🆘 Roadside Assistance</Text>
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080808', padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 40, marginBottom: 8 },
  logo: { fontSize: 20, fontWeight: 'bold', color: '#E0E0E0', letterSpacing: 3 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  historyBtn: {},
  historyTxt: { color: '#C0C0C0', fontSize: 13, letterSpacing: 1 },
  logoutBtn: { color: '#777777', fontSize: 13, letterSpacing: 1 },
  welcome: { color: '#777777', fontSize: 13, marginBottom: 16 },
  heading: { fontSize: 10, color: '#505050', fontWeight: '700', marginBottom: 12, letterSpacing: 3, textTransform: 'uppercase' },
  scroll: { flex: 1 },
  card: { backgroundColor: '#1A1A1A', borderRadius: 0, padding: 16, marginBottom: 8, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#2A2A2A' },
  codeText: { color: '#E0E0E0', fontSize: 18, fontWeight: 'bold', letterSpacing: 1 },
  codeSub: { color: '#777777', fontSize: 13, marginTop: 2 },
  urgency: { fontSize: 11, marginTop: 4, fontWeight: '600' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 0, marginLeft: 8 },
  badgeTxt: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  arrow: { color: '#505050', fontSize: 20, marginLeft: 8 },
  red: { backgroundColor: 'transparent', padding: 16, borderRadius: 0, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: '#D0453A' },
  btnTxt: { color: '#D0453A', fontSize: 12, fontWeight: 'bold', letterSpacing: 3, textTransform: 'uppercase' },
});