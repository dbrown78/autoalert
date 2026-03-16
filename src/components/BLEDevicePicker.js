import { useState, useEffect, useRef } from 'react';
import {
  Modal, View, Text, TouchableOpacity,
  FlatList, StyleSheet, ActivityIndicator,
} from 'react-native';

const C = {
  bg: '#0D0D0D', surface: '#1A1A1A', border: '#2A2A2A',
  textPrimary: '#E0E0E0', textMuted: '#777777', accent: '#C0C0C0',
  green: '#4CAF82', amber: '#C08B30', red: '#D0453A',
};

const SCAN_TIMEOUT_MS = 15000;

/** Returns a 0–4 signal strength tier from RSSI dBm */
function rssiTier(rssi) {
  if (rssi == null) return 0;
  if (rssi >= -60) return 4;
  if (rssi >= -70) return 3;
  if (rssi >= -80) return 2;
  if (rssi >= -90) return 1;
  return 0;
}

function SignalBars({ rssi }) {
  const tier = rssiTier(rssi);
  return (
    <View style={SB.row}>
      {[1, 2, 3, 4].map(i => (
        <View
          key={i}
          style={[
            SB.bar,
            { height: 4 + i * 3 },
            i <= tier ? SB.barActive : SB.barInactive,
          ]}
        />
      ))}
    </View>
  );
}

const SB = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  bar: { width: 5 },
  barActive:   { backgroundColor: C.green },
  barInactive: { backgroundColor: '#333' },
});

/**
 * BLEDevicePicker
 *
 * Props:
 *   visible        boolean
 *   onClose        () => void
 *   devices        Array<{ id, name, rssi }>
 *   isScanning     boolean
 *   connecting     boolean                — true while connect() in progress
 *   connectionError string | null
 *   onStartScan    () => void
 *   onStopScan     () => void
 *   onSelectDevice (deviceId: string) => void
 */
export default function BLEDevicePicker({
  visible,
  onClose,
  devices = [],
  isScanning,
  connecting,
  connectionError,
  onStartScan,
  onStopScan,
  onSelectDevice,
}) {
  const [timedOut, setTimedOut] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const timeoutRef = useRef(null);

  // Start scan when modal opens; enforce 15s timeout
  useEffect(() => {
    if (!visible) {
      setTimedOut(false);
      setSelectedId(null);
      clearTimeout(timeoutRef.current);
      return;
    }
    onStartScan();
    timeoutRef.current = setTimeout(() => {
      onStopScan();
      setTimedOut(true);
    }, SCAN_TIMEOUT_MS);
    return () => clearTimeout(timeoutRef.current);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = (deviceId) => {
    if (connecting) return;
    setSelectedId(deviceId);
    clearTimeout(timeoutRef.current);
    onStopScan();
    onSelectDevice(deviceId);
  };

  const handleScanAgain = () => {
    setTimedOut(false);
    setSelectedId(null);
    onStartScan();
    timeoutRef.current = setTimeout(() => {
      onStopScan();
      setTimedOut(true);
    }, SCAN_TIMEOUT_MS);
  };

  const renderDevice = ({ item }) => {
    const isConnecting = connecting && selectedId === item.id;
    const shortId = item.id ? item.id.slice(-8).toUpperCase() : '—';
    const displayName = item.name || 'Unknown Device';
    return (
      <TouchableOpacity
        style={[S.deviceRow, selectedId === item.id && S.deviceRowSelected]}
        onPress={() => handleSelect(item.id)}
        activeOpacity={0.7}
        disabled={connecting}
      >
        <View style={S.deviceLeft}>
          <Text style={S.deviceName} numberOfLines={1}>{displayName}</Text>
          <Text style={S.deviceId}>{shortId}</Text>
        </View>
        <View style={S.deviceRight}>
          <SignalBars rssi={item.rssi} />
          {isConnecting ? (
            <ActivityIndicator size="small" color={C.accent} style={{ marginLeft: 10 }} />
          ) : (
            <Text style={S.arrow}>›</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={S.overlay}>
        <View style={S.sheet}>
          {/* Header */}
          <View style={S.header}>
            <View style={S.headerLeft}>
              <View style={[S.dot, isScanning && S.dotActive]} />
              <Text style={S.title}>SELECT OBD-II ADAPTER</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={S.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Status row */}
          <View style={S.statusRow}>
            {isScanning ? (
              <>
                <ActivityIndicator size="small" color={C.accent} />
                <Text style={S.statusText}>SCANNING FOR DEVICES...</Text>
              </>
            ) : timedOut ? (
              <Text style={[S.statusText, { color: C.amber }]}>SCAN TIMED OUT</Text>
            ) : (
              <Text style={S.statusText}>{devices.length} DEVICE{devices.length !== 1 ? 'S' : ''} FOUND</Text>
            )}
          </View>

          {/* Error banner */}
          {connectionError ? (
            <View style={S.errorBanner}>
              <View style={S.errorStripe} />
              <Text style={S.errorText}>{connectionError}</Text>
            </View>
          ) : null}

          {/* Device list */}
          {devices.length > 0 ? (
            <FlatList
              data={devices}
              keyExtractor={item => item.id}
              renderItem={renderDevice}
              style={S.list}
              contentContainerStyle={S.listContent}
              showsVerticalScrollIndicator={false}
            />
          ) : (
            <View style={S.emptyState}>
              {isScanning ? (
                <Text style={S.emptyText}>Looking for nearby OBD-II adapters{'\n'}(ELM327, OBDLINK, etc.)</Text>
              ) : (
                <Text style={S.emptyText}>No devices found nearby.{'\n'}Make sure your adapter is powered on and in range.</Text>
              )}
            </View>
          )}

          {/* Scan again / cancel footer */}
          <View style={S.footer}>
            {(timedOut || (!isScanning && devices.length === 0)) && !connecting ? (
              <TouchableOpacity style={S.footerBtn} onPress={handleScanAgain}>
                <Text style={S.footerBtnText}>SCAN AGAIN</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={[S.footerBtn, S.footerBtnSecondary]} onPress={onClose}>
              <Text style={[S.footerBtnText, { color: C.textMuted }]}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const S = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.border,
    maxHeight: '75%',
  },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerLeft:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot:         { width: 7, height: 7, backgroundColor: '#333' },
  dotActive:   { backgroundColor: C.green },
  title: {
    color: C.accent, fontSize: 12, fontWeight: '800',
    letterSpacing: 3, textTransform: 'uppercase',
  },
  closeBtn: { color: C.textMuted, fontSize: 18, lineHeight: 22 },

  statusRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  statusText: {
    color: C.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 2,
  },

  errorBanner: {
    flexDirection: 'row',
    backgroundColor: 'rgba(208,69,58,0.08)',
    borderBottomWidth: 1, borderBottomColor: 'rgba(208,69,58,0.2)',
  },
  errorStripe: { width: 3, backgroundColor: C.red },
  errorText: { flex: 1, color: C.red, fontSize: 11, padding: 10, letterSpacing: 0.3 },

  list:        { flex: 1 },
  listContent: { paddingVertical: 4 },

  deviceRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  deviceRowSelected: {
    backgroundColor: 'rgba(192,192,192,0.05)',
  },
  deviceLeft:  { flex: 1, gap: 3 },
  deviceRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  deviceName: { color: C.textPrimary, fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  deviceId:   { color: '#444', fontSize: 10, letterSpacing: 1.5, fontFamily: 'monospace' },
  arrow:      { color: '#444', fontSize: 20, marginLeft: 8 },

  emptyState: { padding: 40, alignItems: 'center' },
  emptyText:  {
    color: '#444', fontSize: 12, textAlign: 'center',
    lineHeight: 20, letterSpacing: 0.3,
  },

  footer: {
    padding: 16, gap: 8,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  footerBtn: {
    borderWidth: 1, borderColor: C.accent,
    paddingVertical: 12, alignItems: 'center',
  },
  footerBtnSecondary: { borderColor: '#2A2A2A' },
  footerBtnText: {
    color: C.accent, fontSize: 10, fontWeight: '800', letterSpacing: 2,
  },
});
