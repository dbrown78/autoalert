import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useAuth } from '../context/AuthContext';

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, loading, error } = useAuth();

  return (
    <View style={S.container}>
      <Text style={S.logo}>🚗 AutoAlert</Text>
      <Text style={S.subtitle}>Welcome back</Text>

      {error && <Text style={S.error}>{error}</Text>}

      <TextInput
        style={S.input}
        placeholder="Email"
        placeholderTextColor="rgba(255,255,255,0.3)"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        style={S.input}
        placeholder="Password"
        placeholderTextColor="rgba(255,255,255,0.3)"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <TouchableOpacity
        style={[S.btn, loading && { opacity: 0.6 }]}
        onPress={() => login(email, password)}
        disabled={loading}
      >
        {loading ? <ActivityIndicator color="#1a1a2e" /> : <Text style={S.btnTxt}>Log In</Text>}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.navigate('Register')}>
        <Text style={S.link}>Don't have an account? Sign up</Text>
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', alignItems: 'center', justifyContent: 'center', padding: 24 },
  logo: { fontSize: 36, fontWeight: 'bold', color: '#00d4ff', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#fff', opacity: 0.7, marginBottom: 32 },
  error: { color: '#e74c3c', marginBottom: 12, textAlign: 'center' },
  input: { width: '100%', backgroundColor: '#16213e', borderRadius: 10, padding: 14, color: '#fff', fontSize: 15, marginBottom: 12 },
  btn: { width: '100%', backgroundColor: '#00d4ff', padding: 16, borderRadius: 30, alignItems: 'center', marginTop: 8 },
  btnTxt: { color: '#1a1a2e', fontSize: 16, fontWeight: 'bold' },
  link: { color: '#00d4ff', marginTop: 20, fontSize: 14 },
});