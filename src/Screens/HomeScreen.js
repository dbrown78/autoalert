import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useAuth } from '../context/AuthContext';

const DTC_CODES = {
  'P0420': { short: 'Catalytic Converter Efficiency Low', severity: 'Medium', urgency: 'Within 2 weeks' },
  'P0300': { short: 'Random / Multiple Cylinder Misfire', severity: 'High', urgency: 'Within 1 week' },
  'P0171': { short: 'Fuel System Too Lean (Bank 1)', severity: 'Medium', urgency: 'Within 2 weeks' },
  'P0128': { short: 'Coolant Temp Below Thermostat Temp', severity: 'Low', urgency: 'Within 1 month' },
  'P0442': { short: 'EVAP System Leak (Small)', severity: 'Low', urgency: 'Check gas cap first' },
};

const COLORS = { Medium:'#f39c12', High:'#e74c3c', Low:'#27ae60' };
const URGENCY_COLORS = { 'Check gas cap first':'#27ae60', 'Within 1 month':'#27ae60', 'Within 2 weeks':'#f39c12', 'Within 1 week':'#e74c3c' };

export default function HomeScreen({ navigation }) {
  const { user, logout } = useAuth();
  const codes = ['P0420', 'P0300', 'P0171'];

  return (
    <View style={S.container}>
      <View style={S.header}>
        <Text style={S.logo}>🚗 AutoAlert</Text>
        <TouchableOpacity onPress={logout}>
          <Text style={S.logoutBtn}>Log out</Text>
        </TouchableOpacity>
      </View>
      <Text style={S.welcome}>Welcome back, {user?.name} 👋</Text>
      <Text style={S.heading}>Active Alerts ({codes.length})</Text>
      <ScrollView style={S.scroll}>
        {codes.map(c => (
          <TouchableOpacity key={c} style={S.card}>
            <View style={{flex:1}}>
              <Text style={S.codeText}>{c}</Text>
              <Text style={S.codeSub}>{DTC_CODES[c].short}</Text>
              <Text style={[S.urgency, {color: URGENCY_COLORS[DTC_CODES[c].urgency]}]}>
                ⏱ {DTC_CODES[c].urgency}
              </Text>
            </View>
            <View style={[S.badge, {backgroundColor: COLORS[DTC_CODES[c].severity]}]}>
              <Text style={S.badgeTxt}>{DTC_CODES[c].severity}</Text>
            </View>
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
  container:{flex:1,backgroundColor:'#1a1a2e',padding:20},
  header:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginTop:40,marginBottom:8},
  logo:{fontSize:28,fontWeight:'bold',color:'#00d4ff'},
  logoutBtn:{color:'#e74c3c',fontSize:14,fontWeight:'bold'},
  welcome:{color:'#fff',fontSize:16,opacity:0.8,marginBottom:16},
  heading:{fontSize:20,color:'#fff',fontWeight:'bold',marginBottom:12},
  scroll:{flex:1},
  card:{backgroundColor:'#16213e',borderRadius:12,padding:16,marginBottom:12,flexDirection:'row',alignItems:'center'},
  codeText:{color:'#00d4ff',fontSize:18,fontWeight:'bold'},
  codeSub:{color:'#fff',fontSize:13,opacity:0.8,marginTop:2},
  urgency:{fontSize:11,marginTop:4,fontWeight:'600'},
  badge:{paddingHorizontal:10,paddingVertical:4,borderRadius:20,marginLeft:8},
  badgeTxt:{color:'#fff',fontSize:12,fontWeight:'bold'},
  red:{backgroundColor:'#e74c3c',padding:16,borderRadius:30,alignItems:'center',marginTop:8},
  btnTxt:{color:'#fff',fontSize:16,fontWeight:'bold'},
});