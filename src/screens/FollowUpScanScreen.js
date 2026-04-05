import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator } from 'react-native';
import useBLEManager from '../hooks/useBLEManager';

export default function FollowUpScanScreen({ navigation, route }) {
  const { vehicleId, previousDTCs = [] } = route.params || {};
  const { isConnected, requestDTCs, requestPendingDTCs, startScan, isScanning } = useBLEManager();
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState(null);

  const runScan = async () => {
    setScanning(true);
    try {
      const stored = await requestDTCs();
      const pending = await requestPendingDTCs();
      setResults({ stored, pending });
    } finally {
      setScanning(false);
    }
  };

  const clearedCodes = previousDTCs.filter(c => !results?.stored?.includes(c) && !results?.pending?.includes(c));
  const remainingCodes = results ? [...(results.stored || []), ...(results.pending || [])] : [];

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <Text style={s.title}>Follow-Up Scan</Text>
        <Text style={s.sub}>Verify repair by scanning for remaining fault codes.</Text>

        {!isConnected ? (
          <View style={s.card}>
            <Text style={s.cardTitle}>🔌 Connect OBD2 Adapter</Text>
            <Text style={s.cardText}>Plug in your ELM327 adapter and tap Scan.</Text>
            <TouchableOpacity style={s.btn} onPress={startScan} disabled={isScanning}>
              {isScanning ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Scan for Adapters</Text>}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.card}>
            <Text style={s.cardTitle}>✅ Adapter Connected</Text>
            <TouchableOpacity style={s.btn} onPress={runScan} disabled={scanning}>
              {scanning ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Run DTC Scan</Text>}
            </TouchableOpacity>
          </View>
        )}

        {results && (
          <View style={s.resultsCard}>
            <Text style={s.resultTitle}>Scan Results</Text>
            {clearedCodes.length > 0 && (
              <View>
                <Text style={s.clearedLabel}>✅ Cleared ({clearedCodes.length})</Text>
                {clearedCodes.map(c => <Text key={c} style={s.clearedCode}>{c}</Text>)}
              </View>
            )}
            {remainingCodes.length > 0 ? (
              <View>
                <Text style={s.remainLabel}>⚠️ Still Present ({remainingCodes.length})</Text>
                {remainingCodes.map(c => <Text key={c} style={s.remainCode}>{c}</Text>)}
              </View>
            ) : (
              <Text style={s.allClear}>🎉 No fault codes detected. Repair verified!</Text>
            )}
          </View>
        )}

        <TouchableOpacity style={s.back} onPress={() => navigation.goBack()}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0D0D0D' },
  container: { flex: 1, padding: 20 },
  title: { fontSize: 22, fontWeight: '700', color: '#FFF', marginBottom: 6 },
  sub: { fontSize: 14, color: '#888', marginBottom: 20 },
  card: { backgroundColor: '#1A1A1A', borderRadius: 12, padding: 18, marginBottom: 16 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#FFF', marginBottom: 6 },
  cardText: { fontSize: 13, color: '#AAA', marginBottom: 12 },
  btn: { backgroundColor: '#FF6B00', borderRadius: 8, padding: 14, alignItems: 'center' },
  btnText: { color: '#FFF', fontWeight: '700', fontSize: 15 },
  resultsCard: { backgroundColor: '#1A1A1A', borderRadius: 12, padding: 18, marginBottom: 16 },
  resultTitle: { fontSize: 16, fontWeight: '700', color: '#FFF', marginBottom: 12 },
  clearedLabel: { color: '#4CAF50', fontSize: 14, fontWeight: '600', marginBottom: 4 },
  clearedCode: { color: '#4CAF50', fontSize: 13, marginLeft: 8, marginBottom: 2 },
  remainLabel: { color: '#FF9800', fontSize: 14, fontWeight: '600', marginTop: 10, marginBottom: 4 },
  remainCode: { color: '#FF9800', fontSize: 13, marginLeft: 8, marginBottom: 2 },
  allClear: { color: '#4CAF50', fontSize: 15, fontWeight: '600', textAlign: 'center', marginTop: 8 },
  back: { marginTop: 'auto', padding: 12, alignItems: 'center' },
  backText: { color: '#666', fontSize: 14 },
});
