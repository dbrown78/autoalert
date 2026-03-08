import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Platform,
} from 'react-native';
import { useFonts, ShareTechMono_400Regular } from '@expo-google-fonts/share-tech-mono';
import { Rajdhani_400Regular, Rajdhani_600SemiBold } from '@expo-google-fonts/rajdhani';
import { useAuth } from '../context/AuthContext';

export default function LoginScreen({ navigation }) {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const { login, loading, error } = useAuth();

  const [fontsLoaded] = useFonts({
    ShareTechMono_400Regular,
    Rajdhani_400Regular,
    Rajdhani_600SemiBold,
  });

  const monoFont    = fontsLoaded ? 'ShareTechMono_400Regular' : Platform.select({ ios: 'Courier New', android: 'monospace', default: 'monospace' });
  const rajdhaniReg = fontsLoaded ? 'Rajdhani_400Regular'      : undefined;
  const rajdhaniBold= fontsLoaded ? 'Rajdhani_600SemiBold'     : undefined;

  return (
    <View style={S.container}>
      {/* Tactical grid lines */}
      <View style={S.grid} pointerEvents="none">
        {Array.from({ length: 12 }).map((_, i) => (
          <View key={`h${i}`} style={[S.gridLineH, { top: `${(i + 1) * 8}%` }]} />
        ))}
        {Array.from({ length: 6 }).map((_, i) => (
          <View key={`v${i}`} style={[S.gridLineV, { left: `${(i + 1) * 16}%` }]} />
        ))}
      </View>

      <View style={S.inner}>
        {/* Header */}
        <Text style={[S.wordmark, { fontFamily: monoFont }]}>ODIN</Text>
        <Text style={[S.subword, { fontFamily: monoFont }]}>AUTOCALERT</Text>
        <View style={S.divider} />
        <Text style={[S.tagline, { fontFamily: rajdhaniReg }]}>PREDICTIVE VEHICLE INTELLIGENCE</Text>

        {/* Form */}
        <View style={S.formBlock}>
          {error ? <Text style={[S.error, { fontFamily: rajdhaniReg }]}>{error}</Text> : null}

          <Text style={[S.label, { fontFamily: monoFont }]}>EMAIL</Text>
          <TextInput
            style={[S.input, { fontFamily: rajdhaniReg }]}
            placeholder="operator@domain.com"
            placeholderTextColor="#404040"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            selectionColor="#C0C0C0"
          />

          <Text style={[S.label, { fontFamily: monoFont }]}>PASSWORD</Text>
          <TextInput
            style={[S.input, { fontFamily: rajdhaniReg }]}
            placeholder="••••••••"
            placeholderTextColor="#404040"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            selectionColor="#C0C0C0"
          />

          <TouchableOpacity
            style={[S.btn, loading && S.btnDisabled]}
            onPress={() => login(email, password)}
            disabled={loading}
            activeOpacity={0.7}
          >
            {loading
              ? <ActivityIndicator color="#C0C0C0" />
              : <Text style={[S.btnTxt, { fontFamily: monoFont }]}>AUTHENTICATE</Text>
            }
          </TouchableOpacity>
        </View>

        {/* Footer link */}
        <TouchableOpacity onPress={() => navigation.navigate('Register')} activeOpacity={0.7}>
          <Text style={[S.link, { fontFamily: rajdhaniBold }]}>
            NO ACCOUNT?{'  '}
            <Text style={S.linkAccent}>REGISTER OPERATOR</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080808',
  },
  grid: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(192,192,192,0.04)',
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(192,192,192,0.04)',
  },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  wordmark: {
    fontSize: 52,
    color: '#E8E8E8',
    letterSpacing: 12,
  },
  subword: {
    fontSize: 14,
    color: '#808080',
    letterSpacing: 6,
    marginTop: 2,
  },
  divider: {
    width: 48,
    height: 1,
    backgroundColor: '#2A2A2A',
    marginVertical: 16,
  },
  tagline: {
    fontSize: 11,
    color: '#404040',
    letterSpacing: 3,
    marginBottom: 40,
  },
  formBlock: {
    width: '100%',
    backgroundColor: '#0F0F0F',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    padding: 24,
    marginBottom: 24,
  },
  error: {
    color: '#CC3333',
    fontSize: 13,
    letterSpacing: 1,
    marginBottom: 16,
    borderLeftWidth: 2,
    borderLeftColor: '#CC3333',
    paddingLeft: 10,
  },
  label: {
    fontSize: 10,
    color: '#505050',
    letterSpacing: 3,
    marginBottom: 6,
  },
  input: {
    width: '100%',
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    borderRadius: 0,
    padding: 14,
    color: '#C0C0C0',
    fontSize: 16,
    marginBottom: 20,
  },
  btn: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#C0C0C0',
    backgroundColor: 'transparent',
    padding: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  btnDisabled: {
    borderColor: '#2A2A2A',
    opacity: 0.5,
  },
  btnTxt: {
    color: '#C0C0C0',
    fontSize: 13,
    letterSpacing: 4,
  },
  link: {
    color: '#404040',
    fontSize: 13,
    letterSpacing: 2,
  },
  linkAccent: {
    color: '#808080',
  },
});
