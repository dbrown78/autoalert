// components/SensorHistoryDashboard.js
// Vehicle health history dashboard — sensor trend charts.
// Premium feature. Shows rolling sensor data with community baseline overlays.
// Uses Victory Native for charts (expo-compatible, no SVG issues).
//
// Install: npx expo install victory-native react-native-svg

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Dimensions,
} from 'react-native';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  VictoryChart, VictoryLine, VictoryAxis, VictoryTheme,
  VictoryTooltip, VictoryVoronoiContainer, VictoryArea,
} from 'victory-native';

const BASE_URL = Platform.OS === 'web'
  ? 'http://localhost:3001'
  : 'http://192.168.1.221:3001';

const SCREEN_WIDTH = Dimensions.get('window').width;

// ── Sensor display config ─────────────────────────────────────────────────────
const SENSOR_CONFIG = {
  coolant_temp:     { label: 'Coolant Temp',    unit: '°C',  color: '#EF4444', warningThreshold: 110 },
  battery_voltage:  { label: 'Battery Voltage', unit: 'V',   color: '#F59E0B', warningThreshold: 12.0 },
  engine_rpm:       { label: 'Engine RPM',      unit: 'RPM', color: '#6366F1', warningThreshold: 5500 },
  lub_oil_temp:     { label: 'Oil Temp',         unit: '°C',  color: '#F97316', warningThreshold: 130 },
  lub_oil_pressure: { label: 'Oil Pressure',     unit: 'kPa', color: '#10B981', warningThreshold: 100 },
  fuel_pressure:    { label: 'Fuel Pressure',    unit: 'kPa', color: '#3B82F6', warningThreshold: 25  },
};

const WINDOWS = ['1h', '6h', '24h', '7d'];

// ── Main component ────────────────────────────────────────────────────────────

export default function SensorHistoryDashboard({ vehicleId, vehicleMeta }) {
  const [selectedSensor, setSelectedSensor] = useState('coolant_temp');
  const [selectedWindow, setSelectedWindow] = useState('24h');
  const [history, setHistory]               = useState([]);
  const [baseline, setBaseline]             = useState(null);
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState(null);

  const fetchHistory = useCallback(async () => {
    if (!vehicleId) return;
    setLoading(true);
    setError(null);
    try {
      const token = await AsyncStorage.getItem('token');
      const url   = `${BASE_URL}/api/sensors/${vehicleId}/history?sensor=${selectedSensor}&window=${selectedWindow}`;
      const res   = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHistory(data.readings || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [vehicleId, selectedSensor, selectedWindow]);

  const fetchBaseline = useCallback(async () => {
    if (!vehicleId || !vehicleMeta) return;
    try {
      const token = await AsyncStorage.getItem('token');
      const { make, model, year } = vehicleMeta;
      const url   = `${BASE_URL}/api/baselines?make=${make}&model=${model}&year=${year}&sensor=${selectedSensor}`;
      const res   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setBaseline(data.baseline);
      }
    } catch (_) {
      // Baseline is optional — don't fail the chart if it's missing
    }
  }, [vehicleId, vehicleMeta, selectedSensor]);

  useEffect(() => {
    fetchHistory();
    fetchBaseline();
  }, [fetchHistory, fetchBaseline]);

  // ── Format chart data ───────────────────────────────────────────────────────
  const chartData = history.map(r => ({
    x: new Date(r.recorded_at),
    y: parseFloat(r.value),
  }));

  const config = SENSOR_CONFIG[selectedSensor] || {};
  const latest = chartData.length ? chartData[chartData.length - 1].y : null;
  const minY   = chartData.length ? Math.min(...chartData.map(d => d.y)) : 0;
  const maxY   = chartData.length ? Math.max(...chartData.map(d => d.y)) : 100;
  const padding = (maxY - minY) * 0.2 || 10;

  const isWarning = latest !== null && config.warningThreshold !== undefined && (
    selectedSensor === 'battery_voltage' || selectedSensor === 'lub_oil_pressure' || selectedSensor === 'fuel_pressure'
      ? latest < config.warningThreshold
      : latest > config.warningThreshold
  );

  // Community baseline insight
  const baselineInsight = baseline && latest ? (() => {
    const diff = ((latest - baseline.mean_value) / baseline.mean_value) * 100;
    if (Math.abs(diff) < 5) return null;
    const dir  = diff > 0 ? 'higher' : 'lower';
    return `${Math.abs(diff).toFixed(1)}% ${dir} than similar vehicles`;
  })() : null;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>📊 Sensor History</Text>
      </View>

      {/* Sensor selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sensorTabs}>
        {Object.entries(SENSOR_CONFIG).map(([type, cfg]) => (
          <TouchableOpacity
            key={type}
            style={[styles.sensorTab, selectedSensor === type && { borderColor: cfg.color, backgroundColor: cfg.color + '15' }]}
            onPress={() => setSelectedSensor(type)}
          >
            <Text style={[styles.sensorTabText, selectedSensor === type && { color: cfg.color }]}>
              {cfg.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Window selector */}
      <View style={styles.windowTabs}>
        {WINDOWS.map(w => (
          <TouchableOpacity
            key={w}
            style={[styles.windowTab, selectedWindow === w && styles.windowTabActive]}
            onPress={() => setSelectedWindow(w)}
          >
            <Text style={[styles.windowTabText, selectedWindow === w && styles.windowTabTextActive]}>
              {w}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Current value + baseline insight */}
      {latest !== null && (
        <View style={styles.currentValue}>
          <Text style={[styles.currentValueNum, { color: isWarning ? '#EF4444' : '#111827' }]}>
            {latest.toFixed(1)} {config.unit}
          </Text>
          {isWarning && <Text style={styles.warningBadge}>⚠ Above threshold</Text>}
          {baselineInsight && (
            <Text style={styles.baselineInsight}>🔵 {baselineInsight}</Text>
          )}
        </View>
      )}

      {/* Chart */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={config.color || '#6366F1'} />
        </View>
      ) : error ? (
        <Text style={styles.errorText}>⚠ {error}</Text>
      ) : chartData.length < 2 ? (
        <Text style={styles.emptyText}>Not enough data for this window. Keep streaming.</Text>
      ) : (
        <View style={styles.chartContainer}>
          <VictoryChart
            width={SCREEN_WIDTH - 32}
            height={200}
            theme={VictoryTheme.material}
            containerComponent={
              <VictoryVoronoiContainer
                voronoiDimension="x"
                labels={({ datum }) => `${datum.y.toFixed(1)} ${config.unit}`}
                labelComponent={<VictoryTooltip />}
              />
            }
            padding={{ top: 10, bottom: 40, left: 50, right: 20 }}
            domain={{ y: [minY - padding, maxY + padding] }}
          >
            <VictoryAxis
              tickFormat={(t) => {
                const d = new Date(t);
                return selectedWindow === '7d'
                  ? d.toLocaleDateString([], { month: 'short', day: 'numeric' })
                  : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              }}
              style={{ tickLabels: { fontSize: 9, fill: '#9CA3AF' } }}
            />
            <VictoryAxis dependentAxis
              style={{ tickLabels: { fontSize: 9, fill: '#9CA3AF' } }}
            />

            {/* Community baseline band */}
            {baseline && (
              <VictoryArea
                data={chartData.map(d => ({
                  x: d.x,
                  y: parseFloat(baseline.p90_value),
                  y0: parseFloat(baseline.p10_value),
                }))}
                style={{ data: { fill: '#6366F1', opacity: 0.08 } }}
              />
            )}

            {/* Sensor line */}
            <VictoryLine
              data={chartData}
              style={{
                data: { stroke: config.color || '#6366F1', strokeWidth: 2 },
              }}
              interpolation="monotoneX"
            />
          </VictoryChart>

          {/* Legend */}
          {baseline && (
            <View style={styles.legend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendLine, { backgroundColor: config.color }]} />
                <Text style={styles.legendLabel}>Your vehicle</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendBand, { backgroundColor: '#6366F1' }]} />
                <Text style={styles.legendLabel}>Community P10–P90</Text>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  title:  { fontSize: 16, fontWeight: '700', color: '#111827' },
  sensorTabs: { flexDirection: 'row', marginBottom: 10 },
  sensorTab: {
    paddingVertical: 6, paddingHorizontal: 12,
    borderRadius: 20, borderWidth: 1.5,
    borderColor: '#E5E7EB', marginRight: 8,
  },
  sensorTabText: { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  windowTabs: { flexDirection: 'row', marginBottom: 12, gap: 8 },
  windowTab: {
    paddingVertical: 4, paddingHorizontal: 12,
    borderRadius: 6, backgroundColor: '#F3F4F6',
  },
  windowTabActive: { backgroundColor: '#6366F1' },
  windowTabText: { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  windowTabTextActive: { color: '#FFFFFF' },
  currentValue: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  currentValueNum: { fontSize: 22, fontWeight: '800' },
  warningBadge: { fontSize: 12, color: '#EF4444', fontWeight: '600', backgroundColor: '#FEF2F2', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  baselineInsight: { fontSize: 11, color: '#6366F1', fontWeight: '600' },
  chartContainer: { marginTop: 4 },
  legend: { flexDirection: 'row', gap: 16, justifyContent: 'flex-end', marginTop: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendLine: { width: 16, height: 2, borderRadius: 1 },
  legendBand: { width: 16, height: 8, borderRadius: 2, opacity: 0.3 },
  legendLabel: { fontSize: 10, color: '#9CA3AF' },
  loadingContainer: { height: 200, justifyContent: 'center', alignItems: 'center' },
  errorText: { color: '#EF4444', padding: 16, textAlign: 'center' },
  emptyText: { color: '#9CA3AF', padding: 16, textAlign: 'center', fontStyle: 'italic' },
});
