import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import HomeScreen from './src/screens/HomeScreen';
import DTCDetailScreen from './src/screens/DTCDetailScreen';
import MechanicFinderScreen from './src/screens/MechanicFinderScreen';
import ScanHistoryScreen from './src/screens/ScanHistoryScreen';
import OBD2ScanScreen from './src/screens/OBD2ScanScreen';
import TelemetryScreen from './src/screens/TelemetryScreen';
import ForesightScreen from './src/screens/ForesightScreen';

const Stack = createNativeStackNavigator();
const Tab   = createBottomTabNavigator();

const TAB_BAR_STYLE = {
  backgroundColor: '#0D0D0D',
  borderTopColor: '#2A2A2A',
  borderTopWidth: 1,
  height: 56,
};

const TAB_LABEL_STYLE = {
  fontSize: 8,
  fontWeight: '800',
  letterSpacing: 2,
  textTransform: 'uppercase',
  marginBottom: 4,
};

// Tab icon — a simple square dot that matches the ODIN design language
function TabIcon({ focused, color }) {
  return (
    <View style={{
      width: 5, height: 5, borderRadius: 0,
      backgroundColor: focused ? color : 'transparent',
      borderWidth: 1, borderColor: color,
      marginTop: 8,
    }} />
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused, color }) => (
          <TabIcon focused={focused} color={color} />
        ),
        tabBarStyle: TAB_BAR_STYLE,
        tabBarLabelStyle: TAB_LABEL_STYLE,
        tabBarActiveTintColor: '#C0C0C0',
        tabBarInactiveTintColor: '#404040',
      })}
    >
      <Tab.Screen name="Home"      component={HomeScreen}      options={{ tabBarLabel: 'HOME' }} />
      <Tab.Screen name="Scan"      component={OBD2ScanScreen}  options={{ tabBarLabel: 'SCAN' }} />
      <Tab.Screen name="Telemetry" component={TelemetryScreen} options={{ tabBarLabel: 'TELEMETRY' }} />
      <Tab.Screen name="Foresight" component={ForesightScreen} options={{ tabBarLabel: 'FORESIGHT' }} />
    </Tab.Navigator>
  );
}

function AppNavigator() {
  const { user, appReady } = useAuth();

  if (!appReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#080808', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#C0C0C0" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {user ? (
          <>
            <Stack.Screen name="MainTabs"       component={MainTabs} />
            <Stack.Screen name="DTCDetail"       component={DTCDetailScreen} />
            <Stack.Screen name="MechanicFinder"  component={MechanicFinderScreen} />
            <Stack.Screen name="ScanHistory"     component={ScanHistoryScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Login"    component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppNavigator />
    </AuthProvider>
  );
}
