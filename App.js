import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import EmailVerificationScreen from './src/screens/EmailVerificationScreen';
import HomeScreen from './src/screens/HomeScreen';
import DTCDetailScreen from './src/screens/DTCDetailScreen';
import MechanicFinderScreen from './src/screens/MechanicFinderScreen';
import ScanHistoryScreen from './src/screens/ScanHistoryScreen';
import OBD2ScanScreen from './src/screens/OBD2ScanScreen';
import TelemetryScreen from './src/screens/TelemetryScreen';
import ForesightScreen from './src/screens/ForesightScreen';
import VehicleScreen from './src/screens/VehicleScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import TermsOfServiceScreen from './src/screens/TermsOfServiceScreen';
import ReportSubmissionScreen from './src/screens/ReportSubmissionScreen';
import FollowUpScanScreen from './src/screens/FollowUpScanScreen';

class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, backgroundColor: '#080808', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Text style={{ color: '#C0C0C0', fontSize: 16, fontWeight: '800', letterSpacing: 2, marginBottom: 12 }}>
            SOMETHING WENT WRONG
          </Text>
          <Text style={{ color: '#555', fontSize: 12, textAlign: 'center', marginBottom: 24 }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </Text>
          <TouchableOpacity
            onPress={() => this.setState({ hasError: false, error: null })}
            style={{ borderWidth: 1, borderColor: '#C0C0C0', paddingVertical: 10, paddingHorizontal: 24 }}
          >
            <Text style={{ color: '#C0C0C0', fontSize: 10, fontWeight: '800', letterSpacing: 2 }}>RETRY</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

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
            <Stack.Screen name="Vehicles"        component={VehicleScreen} />
            <Stack.Screen name="Settings"        component={SettingsScreen} />
            <Stack.Screen name="TermsOfService"     component={TermsOfServiceScreen} />
            <Stack.Screen name="ReportSubmission"   component={ReportSubmissionScreen} />
            <Stack.Screen name="FollowUpScan"        component={FollowUpScanScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Login"             component={LoginScreen} />
            <Stack.Screen name="Register"          component={RegisterScreen} />
            <Stack.Screen name="EmailVerification" component={EmailVerificationScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppNavigator />
      </AuthProvider>
    </ErrorBoundary>
  );
}
