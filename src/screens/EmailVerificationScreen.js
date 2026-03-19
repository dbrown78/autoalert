import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Platform,
} from 'react-native';
import { useFonts, ShareTechMono_400Regular } from '@expo-google-fonts/share-tech-mono';
import { Rajdhani_400Regular, Rajdhani_600SemiBold } from '@expo-google-fonts/rajdhani';
import { useAuth } from '../context/AuthContext';
import client from '../api/client';

const RESEND_COOLDOWN = 60;

export default function EmailVerificationScreen({ route, navigation }) {
  const email = route.params?.email ?? '';
  const { loginWithToken } = useAuth();

  const [code, setCode]           = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState('');
  const [cooldown, setCooldown]   = useState(0);
  const timerRef = useRef(null);

  const [fontsLoaded] = useFonts({
    ShareTechMono_400Regular,
    Rajdhani_400Regular,
    Rajdhani_600SemiBold,
  });

  const monoFont    = fontsLoaded ? 'ShareTechMono_400Regular' : Platform.select({ ios: 'Courier New', android: 'monospace', default: 'monospace' });
  const rajdhaniReg = fontsLoaded ? 'Rajdhani_400Regular'      : undefined;

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const startCooldown = () => {
    setCooldown(RESEND_COOLDOWN);
    timerRef.current = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) { clearInterval(timerRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const handleVerify = async () => {
    if (code.length !== 6) { setError('Enter the 6-digit code'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await client.post('/auth/verify-email', { email, code });
      await loginWithToken(res.data.token, res.data.user);
      // AppNavigator will redirect to MainTabs automatically once user is set
    } catch (err) {
      setError(err.response?.data?.error || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setError('');
    try {
      await client.post('/auth/resend-verification', { email });
      setSuccess('New code sent');
      startCooldown();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to resend code');
    }
  };

  return (
    <View style={S.container}>
      {/* Tactical grid */}
      <View style={S.grid} pointerEvents="none">
        {Array.from({ length: 12 }).map((_, i) => (
          <View key={`h${i}`} style={[S.gridLineH, { top: `${(i + 1) * 8}%` }]} />
        ))}
        {Array.from({ length: 6 }).map((_, i) => (
          <View key={`v${i}`} style={[S.gridLineV, { left: `${(i + 1) * 16}%` }]} />
        ))}
      </View>

      <View style={S.inner}>
        <Text style={[S.wordmark, { fontFamily: monoFont }]}>ODIN</Text>
        <Text style={[S.title, { fontFamily: monoFont }]}>VERIFY YOUR EMAIL</Text>
        <View style={S.divider} />
        <Text style={[S.subtitle, { fontFamily: rajdhaniReg }]}>
          Enter the 6-digit code sent to
        </Text>
        <Text style={[S.emailTxt, { fontFamily: monoFont }]}>{email}</Text>

        <View style={S.formBlock}>
          {error  ? <Text style={[S.error,   { fontFamily: rajdhaniReg }]}>{error}</Text>  : null}
          {success ? <Text style={[S.success, { fontFamily: rajdhaniReg }]}>{success}</Text> : null}

          <Text style={[S.label, { fontFamily: monoFont }]}>VERIFICATION CODE</Text>
          <TextInput
            style={[S.input, { fontFamily: monoFont, letterSpacing: 8, textAlign: 'center' }]}
            placeholder="000000"
            placeholderTextColor="#404040"
            value={code}
            onChangeText={t => { setCode(t.replace(/\D/g, '').slice(0, 6)); setError(''); }}
            keyboardType="numeric"
            maxLength={6}
            selectionColor="#C0C0C0"
          />

          <TouchableOpacity
            style={[S.btn, (loading || code.length !== 6) && S.btnDisabled]}
            onPress={handleVerify}
            disabled={loading || code.length !== 6}
            activeOpacity={0.7}
          >
            {loading
              ? <ActivityIndicator color="#C0C0C0" />
              : <Text style={[S.btnTxt, { fontFamily: monoFont }]}>VERIFY</Text>
            }
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={handleResend} disabled={cooldown > 0} activeOpacity={0.7}>
          <Text style={[S.resend, { fontFamily: rajdhaniReg, color: cooldown > 0 ? '#333' : '#808080' }]}>
            {cooldown > 0 ? `RESEND CODE (${cooldown}s)` : 'RESEND CODE'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080808' },
  grid: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  gridLineH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(192,192,192,0.04)' },
  gridLineV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(192,192,192,0.04)' },
  inner: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  wordmark: { fontSize: 52, color: '#E8E8E8', letterSpacing: 12 },
  title: { fontSize: 12, color: '#C0C0C0', letterSpacing: 4, marginTop: 12 },
  divider: { width: 48, height: 1, backgroundColor: '#2A2A2A', marginVertical: 16 },
  subtitle: { fontSize: 12, color: '#505050', letterSpacing: 1, textAlign: 'center' },
  emailTxt: { fontSize: 11, color: '#808080', letterSpacing: 2, marginTop: 4, marginBottom: 28 },
  formBlock: {
    width: '100%', backgroundColor: '#0F0F0F',
    borderWidth: 1, borderColor: '#2A2A2A', padding: 24, marginBottom: 20,
  },
  error: {
    color: '#CC3333', fontSize: 13, letterSpacing: 1, marginBottom: 16,
    borderLeftWidth: 2, borderLeftColor: '#CC3333', paddingLeft: 10,
  },
  success: {
    color: '#4CAF82', fontSize: 13, letterSpacing: 1, marginBottom: 16,
    borderLeftWidth: 2, borderLeftColor: '#4CAF82', paddingLeft: 10,
  },
  label: { fontSize: 10, color: '#505050', letterSpacing: 3, marginBottom: 6 },
  input: {
    width: '100%', backgroundColor: '#0A0A0A',
    borderWidth: 1, borderColor: '#2A2A2A', borderRadius: 0,
    padding: 14, color: '#C0C0C0', fontSize: 24, marginBottom: 20,
  },
  btn: {
    width: '100%', borderWidth: 1, borderColor: '#C0C0C0',
    backgroundColor: 'transparent', padding: 16, alignItems: 'center', marginTop: 4,
  },
  btnDisabled: { borderColor: '#2A2A2A', opacity: 0.4 },
  btnTxt: { color: '#C0C0C0', fontSize: 13, letterSpacing: 4 },
  resend: { fontSize: 12, letterSpacing: 2 },
});
