import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, SafeAreaView
} from 'react-native';
import { API_URL } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function ReportSubmissionScreen({ navigation, route }) {
  const { token } = useAuth();
  const { vehicleId, dtcCode, componentName } = route.params || {};
  const [shopName, setShopName] = useState('');
  const [repairDescription, setRepairDescription] = useState('');
  const [cost, setCost] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!repairDescription.trim()) {
      Alert.alert('Required', 'Please describe the repair performed.');
      return;
    }
    setLoading(true);
    try {
      await fetch(`${API_URL}/api/vehicles/${vehicleId}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dtcCode, componentName, shopName, repairDescription, cost: parseFloat(cost) || null }),
      });
      Alert.alert('Submitted', 'Your repair report has been saved.', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (e) {
      Alert.alert('Error', 'Failed to submit report. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.container}>
        <Text style={s.title}>Submit Repair Report</Text>
        {dtcCode && <Text style={s.subtitle}>Code: {dtcCode}{componentName ? ` — ${componentName}` : ''}</Text>}

        <Text style={s.label}>Shop Name (optional)</Text>
        <TextInput style={s.input} value={shopName} onChangeText={setShopName} placeholder="e.g. Jiffy Lube" placeholderTextColor="#555" />

        <Text style={s.label}>Repair Description *</Text>
        <TextInput style={[s.input, s.multiline]} value={repairDescription} onChangeText={setRepairDescription}
          placeholder="Describe what was repaired or replaced..." placeholderTextColor="#555" multiline numberOfLines={4} />

        <Text style={s.label}>Total Cost ($)</Text>
        <TextInput style={s.input} value={cost} onChangeText={setCost} placeholder="0.00" placeholderTextColor="#555" keyboardType="decimal-pad" />

        <TouchableOpacity style={s.btn} onPress={submit} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Submit Report</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={s.cancel} onPress={() => navigation.goBack()}>
          <Text style={s.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0D0D0D' },
  container: { padding: 20 },
  title: { fontSize: 22, fontWeight: '700', color: '#FFFFFF', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#888', marginBottom: 20 },
  label: { fontSize: 13, color: '#AAAAAA', marginBottom: 6, marginTop: 16 },
  input: { backgroundColor: '#1A1A1A', color: '#FFF', borderRadius: 8, padding: 12, fontSize: 15, borderWidth: 1, borderColor: '#333' },
  multiline: { height: 100, textAlignVertical: 'top' },
  btn: { backgroundColor: '#FF6B00', borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 28 },
  btnText: { color: '#FFF', fontWeight: '700', fontSize: 16 },
  cancel: { alignItems: 'center', marginTop: 16 },
  cancelText: { color: '#666', fontSize: 14 },
});
