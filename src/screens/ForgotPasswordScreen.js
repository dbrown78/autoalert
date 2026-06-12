import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import { useFonts, ShareTechMono_400Regular } from '@expo-google-fonts/share-tech-mono';
import { Rajdhani_400Regular, Rajdhani_600SemiBold } from '@expo-google-fonts/rajdhani';
import { API_URL } from '../api/client';

export default function ForgotPasswordScreen({ navigation }) {
  const [step, setStep] = useState('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const [fontsLoaded] = useFonts({
    ShareTechMono_400Regular,
    Rajdhani_400Regular,
    Rajdhani_600SemiBold,
  });

  const monoFont     = fontsLoaded ? 'ShareTechMono_400Regular' : Platform.select({ ios: 'Courier New', android: 'monospace', default: 'monospace' });
  const rajdhaniReg  = fontsLoaded ? 'Rajdhani_400Regular'      : undefined;
  const rajdhaniBold = fontsLoaded ? 'Rajdhani_600SemiBold'     : undefined;

  const requestCode = async () => {
    if (!email.trim()) {
      Alert.alert('Email required', 'Enter your account email.');
      return;
    }
    setLoading(true);
    try {
      await fetch(`${API_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      setStep('reset');
      Alert.alert('Check your email', 'If an account exists, a 6-digit code is on its way.');
    } catch {
      Alert.alert('Error', 'Could not send code. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const submitReset = async () => {
    if (!code.trim() || !newPassword) {
      Alert.alert('Missing info', 'Enter the code and a new password.');
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert('Weak password', 'Use at least 8 characters.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: code.trim(), newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reset failed');
      Alert.alert('Password updated', 'Sign in with your new password.', [
        { text: 'OK', onPress: () => navigation.navigate('Login') },
      ]);
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not reset password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={S.container}>
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
        <Text style={[S.subword, { fontFamily: monoFont }]}>AUTOALERT</Text>
        <View style={S.divider} />
        <Text style={[S.tagline, { fontFamily: rajdhaniReg }]}>PASSWORD RECOVERY</Text>

        <View style={S.formBlock}>
          {step === 'request' ? (
            <>
              <Text style={[S.label, { fontFamily: monoFont }]}>ACCOUNT EMAIL</Text>
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
              <TouchableOpacity
                style={[S.btn, loading && S.btnDisabled]}
                onPress={requestCode}
                disabled={loading}
                activeOpacity={0.7}
              >
                {loading
                  ? <ActivityIndicator color="#C0C0C0" />
                  : <Text style={[S.btnTxt, { fontFamily: monoFont }]}>SEND CODE</Text>
                }
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={[S.label, { fontFamily: monoFont }]}>6-DIGIT CODE</Text>
              <TextInput
                style={[S.input, { fontFamily: rajdhaniReg }]}
                placeholder="123456"
                placeholderTextColor="#404040"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                maxLength={6}
                selectionColor="#C0C0C0"
              />
              <Text style={[S.label, { fontFamily: monoFont }]}>NEW PASSWORD</Text>
              <TextInput
                style={[S.input, { fontFamily: rajdhaniReg }]}
                placeholder="••••••••"
                placeholderTextColor="#404040"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                selectionColor="#C0C0C0"
              />
              <TouchableOpacity
                style={[S.btn, loading && S.btnDisabled]}
                onPress={submitReset}
                disabled={loading}
                activeOpacity={0.7}
              >
                {loading
                  ? <ActivityIndicator color="#C0C0C0" />
                  : <Text style={[S.btnTxt, { fontFamily: monoFont }]}>RESET PASSWORD</Text>
                }
              </TouchableOpacity>
              <TouchableOpacity onPress={requestCode} disabled={loading} activeOpacity={0.7}>
                <Text style={[S.resend, { fontFamily: rajdhaniReg }]}>RESEND CODE</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={[S.link, { fontFamily: rajdhaniBold }]}>
            {'← '}
            <Text style={S.linkAccent}>BACK TO LOGIN</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080808' },
  grid: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  gridLineH: {
    position: 'absolute', left: 0, right: 0, height: 1,
    backgroundColor: 'rgba(192,192,192,0.04)',
  },
  gridLineV: {
    position: 'absolute', top: 0, bottom: 0, width: 1,
    backgroundColor: 'rgba(192,192,192,0.04)',
  },
  inner: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  wordmark: { fontSize: 52, color: '#E8E8E8', letterSpacing: 12 },
  subword: { fontSize: 14, color: '#808080', letterSpacing: 6, marginTop: 2 },
  divider: { width: 48, height: 1, backgroundColor: '#2A2A2A', marginVertical: 16 },
  tagline: { fontSize: 11, color: '#404040', letterSpacing: 3, marginBottom: 40 },
  formBlock: {
    width: '100%', backgroundColor: '#0F0F0F',
    borderWidth: 1, borderColor: '#2A2A2A', padding: 24, marginBottom: 24,
  },
  label: { fontSize: 10, color: '#505050', letterSpacing: 3, marginBottom: 6 },
  input: {
    width: '100%', backgroundColor: '#0A0A0A',
    borderWidth: 1, borderColor: '#2A2A2A', borderRadius: 0,
    padding: 14, color: '#C0C0C0', fontSize: 16, marginBottom: 20,
  },
  btn: {
    width: '100%', borderWidth: 1, borderColor: '#C0C0C0',
    backgroundColor: 'transparent', padding: 16, alignItems: 'center', marginTop: 4,
  },
  btnDisabled: { borderColor: '#2A2A2A', opacity: 0.5 },
  btnTxt: { color: '#C0C0C0', fontSize: 13, letterSpacing: 4 },
  resend: { color: '#404040', textAlign: 'center', marginTop: 20, fontSize: 12, letterSpacing: 2 },
  link: { color: '#404040', fontSize: 13, letterSpacing: 2 },
  linkAccent: { color: '#808080' },
});
