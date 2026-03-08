import { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Animated,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import client from '../api/client';

const C = {
  bg: '#080808', surface: '#1A1A1A', border: '#2A2A2A',
  textPrimary: '#E0E0E0', textMuted: '#777777', accent: '#C0C0C0',
  red: '#D0453A', green: '#4CAF82', amber: '#C08B30',
};

const SEV = {
  CRITICAL: { color: C.red,   label: 'CRITICAL' },
  WARNING:  { color: C.amber, label: 'WARNING'  },
  MONITOR:  { color: C.textMuted, label: 'MONITOR' },
};

function getSeverity(sev) {
  const s = (sev ?? '').toUpperCase();
  if (s === 'HIGH' || s === 'CRITICAL') return SEV.CRITICAL;
  if (s === 'MEDIUM' || s === 'WARNING') return SEV.WARNING;
  return SEV.MONITOR;
}

function StatusBar({ status }) {
  const dot =
    status === 'connected'   ? C.green :
    status === 'connecting'  ? C.amber :
    C.red;
  const label =
    status === 'connected'   ? 'CONNECTED' :
    status === 'connecting'  ? 'CONNECTING...' :
    'DISCONNECTED';
  return (
    <View style={S.statusBar}>
      <View style={[S.statusDot, { backgroundColor: dot }]} />
      <Text style={[S.statusLabel, { color: dot }]}>{label}</Text>
      <Text style={S.statusRight}>OBD-II BLE ADAPTER</Text>
    </View>
  );
}

function AnimatedDots() {
  const [count, setCount] = useState(1);
  useEffect(() => {
    const t = setInterval(() => setCount(c => c % 3 + 1), 500);
    return () => clearInterval(t);
  }, []);
  return <Text style={S.scanDots}>{'.'.repeat(count)}</Text>;
}

export default function OBD2ScanScreen({ navigation }) {
  const { selectedVehicle } = useAuth();
  const [adapterStatus, setAdapterStatus] = useState('disconnected');
  const [scanning, setScanning] = useState(false);
  const [dtcs, setDtcs] = useState([]);
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState(null);

  const isConnected = adapterStatus === 'connected';

  const handleConnect = () => {
    if (adapterStatus === 'connecting' || adapterStatus === 'connected') return;
    setAdapterStatus('connecting');
    setTimeout(() => setAdapterStatus('connected'), 2000);
  };

  const handleScan = async () => {
    if (!isConnected || scanning) return;
    setScanning(true);
    setError(null);
    setScanned(false);
    try {
      const payload = selectedVehicle?.id ? { vehicle_id: selectedVehicle.id } : {};
      const res = await client.post('/scans', payload);
      setDtcs(res.data?.dtcs ?? res.data?.codes ?? []);
      setScanned(true);
    } catch (e) {
      setError(e.response?.data?.message || 'Scan failed. Check adapter connection.');
    } finally {
      setScanning(false);
    }
  };

  return (
    <View style={S.container}>
      {/* ── Header ── */}
      <View style={S.header}>
        <View style={S.headerLeft}>
          <View style={S.headerDot} />
          <Text style={S.headerTitle}>DIAGNOSTIC SCAN</Text>
        </View>
        {selectedVehicle && (
          <Text style={S.vehicleLabel}>
            {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}
          </Text>
        )}
      </View>

      {/* ── Connection status bar ── */}
      <StatusBar status={adapterStatus} />

      {/* ── Action buttons ── */}
      <View style={S.actions}>
        <TouchableOpacity
          style={[S.btn, isConnected && S.btnDisabled]}
          onPress={handleConnect}
          disabled={adapterStatus === 'connecting' || adapterStatus === 'connected'}
        >
          {adapterStatus === 'connecting' ? (
            <ActivityIndicator size="small" color={C.accent} />
          ) : (
            <Text style={[S.btnText, isConnected && S.btnTextDim]}>
              {isConnected ? 'CONNECTED' : 'CONNECT ADAPTER'}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[S.btn, S.btnPrimary, (!isConnected || scanning) && S.btnPrimaryDim]}
          onPress={handleScan}
          disabled={!isConnected || scanning}
        >
          <Text style={[S.btnText, S.btnTextPrimary, (!isConnected || scanning) && S.btnTextDimPrimary]}>
            {scanning ? 'SCANNING...' : 'SCAN VEHICLE'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Body ── */}
      <ScrollView style={S.body} contentContainerStyle={S.bodyContent}>

        {/* Scanning animation */}
        {scanning && (
          <View style={S.scanState}>
            <ActivityIndicator size="large" color={C.accent} style={{ marginBottom: 16 }} />
            <View style={S.scanLabelRow}>
              <Text style={S.scanLabel}>SCANNING VEHICLE SYSTEMS</Text>
              <AnimatedDots />
            </View>
            <Text style={S.scanSub}>Reading ECU fault memory</Text>
          </View>
        )}

        {/* Error */}
        {!scanning && error && (
          <View style={S.errorRow}>
            <View style={S.errorBar} />
            <Text style={S.errorText}>{error}</Text>
          </View>
        )}

        {/* Results */}
        {!scanning && scanned && !error && (
          <>
            <Text style={S.sectionLabel}>
              {dtcs.length === 0
                ? 'SCAN COMPLETE'
                : `FAULT CODES DETECTED · ${dtcs.length}`}
            </Text>

            {dtcs.length === 0 ? (
              <View style={S.emptyState}>
                <View style={S.emptyDotRow}>
                  <View style={[S.emptyDot, { backgroundColor: C.green }]} />
                  <View style={[S.emptyDot, { backgroundColor: C.green, opacity: 0.5 }]} />
                  <View style={[S.emptyDot, { backgroundColor: C.green, opacity: 0.25 }]} />
                </View>
                <Text style={S.emptyTitle}>NO FAULT CODES DETECTED</Text>
                <Text style={S.emptySub}>ALL SYSTEMS NOMINAL</Text>
              </View>
            ) : (
              dtcs.map((dtc, i) => {
                const sev = getSeverity(dtc.severity);
                return (
                  <TouchableOpacity
                    key={dtc.code ?? i}
                    style={S.dtcRow}
                    onPress={() => navigation.navigate('DTCDetail', { code: dtc.code })}
                    activeOpacity={0.75}
                  >
                    <View style={[S.dtcBar, { backgroundColor: sev.color }]} />
                    <View style={S.dtcBody}>
                      <View style={S.dtcTopRow}>
                        <Text style={S.dtcCode}>{dtc.code}</Text>
                        <View style={[S.sevBadge, { borderColor: sev.color }]}>
                          <Text style={[S.sevText, { color: sev.color }]}>{sev.label}</Text>
                        </View>
                      </View>
                      <Text style={S.dtcDesc} numberOfLines={2}>
                        {dtc.short_description ?? dtc.description ?? 'Unknown fault'}
                      </Text>
                    </View>
                    <Text style={S.dtcArrow}>›</Text>
                  </TouchableOpacity>
                );
              })
            )}
          </>
        )}

        {/* Pre-scan idle state */}
        {!scanning && !scanned && !error && (
          <View style={S.idleState}>
            <Text style={S.idleLabel}>
              {isConnected
                ? 'ADAPTER READY · PRESS SCAN VEHICLE TO BEGIN'
                : 'CONNECT OBD-II ADAPTER TO BEGIN DIAGNOSTIC'}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* ── Footer ── */}
      <Text style={S.footer}>OBD-II ISO 15765-4 · CAN BUS · SAE J1979</Text>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerDot: { width: 7, height: 7, borderRadius: 0, backgroundColor: C.accent },
  headerTitle: {
    color: C.accent, fontSize: 13, fontWeight: '800',
    letterSpacing: 3, textTransform: 'uppercase',
  },
  vehicleLabel: { color: C.textMuted, fontSize: 10, letterSpacing: 1 },

  statusBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: C.surface,
    borderBottomWidth: 1, borderBottomColor: C.border,
    gap: 8,
  },
  statusDot: { width: 6, height: 6, borderRadius: 0 },
  statusLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 2, flex: 1 },
  statusRight: { color: '#333', fontSize: 9, letterSpacing: 1 },

  actions: {
    flexDirection: 'row', gap: 10,
    padding: 16,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  btn: {
    flex: 1, paddingVertical: 12, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.accent, borderRadius: 0, minHeight: 44,
  },
  btnDisabled: { borderColor: '#333' },
  btnPrimary: { borderColor: C.accent },
  btnPrimaryDim: { borderColor: '#333' },
  btnText: {
    color: C.accent, fontSize: 10, fontWeight: '800',
    letterSpacing: 2, textTransform: 'uppercase',
  },
  btnTextDim: { color: '#333' },
  btnTextPrimary: { color: C.accent },
  btnTextDimPrimary: { color: '#333' },

  body: { flex: 1 },
  bodyContent: { padding: 16, paddingBottom: 32 },

  scanState: {
    alignItems: 'center', paddingVertical: 48,
  },
  scanLabelRow: { flexDirection: 'row', alignItems: 'baseline' },
  scanLabel: {
    color: C.accent, fontSize: 12, fontWeight: '800',
    letterSpacing: 2, textTransform: 'uppercase',
  },
  scanDots: { color: C.accent, fontSize: 14, fontWeight: '800', width: 20 },
  scanSub: { color: C.textMuted, fontSize: 11, marginTop: 8, letterSpacing: 1 },

  errorRow: {
    flexDirection: 'row', backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border, marginBottom: 12,
  },
  errorBar: { width: 3, backgroundColor: C.red },
  errorText: { flex: 1, color: C.red, fontSize: 12, padding: 14, letterSpacing: 0.5 },

  sectionLabel: {
    color: C.textMuted, fontSize: 9, fontWeight: '700',
    letterSpacing: 3, textTransform: 'uppercase', marginBottom: 12,
  },

  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 6 },
  emptyDotRow: { flexDirection: 'row', gap: 5, marginBottom: 10 },
  emptyDot: { width: 6, height: 6, borderRadius: 0, backgroundColor: C.green },
  emptyTitle: {
    color: C.green, fontSize: 13, fontWeight: '800',
    letterSpacing: 2, textTransform: 'uppercase',
  },
  emptySub: { color: C.textMuted, fontSize: 11, letterSpacing: 2 },

  dtcRow: {
    flexDirection: 'row', alignItems: 'stretch',
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    marginBottom: 8,
  },
  dtcBar: { width: 3 },
  dtcBody: { flex: 1, padding: 14, gap: 5 },
  dtcTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dtcCode: {
    color: C.textPrimary, fontSize: 16, fontWeight: '800', letterSpacing: 1,
  },
  sevBadge: {
    borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 0,
  },
  sevText: { fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  dtcDesc: { color: C.textMuted, fontSize: 12, lineHeight: 17 },
  dtcArrow: { color: '#333', fontSize: 20, alignSelf: 'center', paddingHorizontal: 12 },

  idleState: {
    alignItems: 'center', paddingVertical: 60, paddingHorizontal: 24,
  },
  idleLabel: {
    color: '#303030', fontSize: 10, fontWeight: '700',
    letterSpacing: 2, textTransform: 'uppercase', textAlign: 'center', lineHeight: 18,
  },

  footer: {
    color: '#252525', fontSize: 9, letterSpacing: 1.5,
    textAlign: 'center', paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: C.border,
    textTransform: 'uppercase',
  },
});
