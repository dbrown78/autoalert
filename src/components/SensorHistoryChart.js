import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator,
  StyleSheet, Dimensions,
} from 'react-native';
import {
  VictoryChart, VictoryLine, VictoryAxis,
} from 'victory-native';

const SCREEN_WIDTH = Dimensions.get('window').width;

const SENSOR_LINES = [
  { key: 'rpm',          label: 'RPM',        color: '#4FC3F7', scale: 0.01 },
  { key: 'speed',        label: 'SPEED',      color: '#81C784' },
  { key: 'coolant_temp', label: 'COOLANT °C', color: '#FF7043' },
  { key: 'engine_load',  label: 'LOAD %',     color: '#FFD54F' },
  { key: 'throttle',     label: 'THROTTLE %', color: '#CE93D8' },
];

export default function SensorHistoryChart({
  seriesMap, loading, error, window, onWindowChange,
}) {
  const [active, setActive] = useState(new Set(SENSOR_LINES.map(s => s.key)));

  const toggle = (key) => {
    setActive(prev => {
      const next = new Set(prev);
      if (next.has(key)) { if (next.size > 1) next.delete(key); }
      else next.add(key);
      return next;
    });
  };

  const hasData = SENSOR_LINES.some(s => (seriesMap[s.key]?.length ?? 0) > 0);

  return (
    <View style={S.wrapper}>
      {/* Section divider */}
      <View style={S.divider} />

      <Text style={S.title}>SENSOR HISTORY</Text>

      {/* Window picker */}
      <View style={S.windowRow}>
        {['1h', '6h', '24h', '7d'].map(w => (
          <TouchableOpacity
            key={w}
            onPress={() => onWindowChange(w)}
            style={[S.windowBtn, window === w && S.windowBtnActive]}
          >
            <Text style={[S.windowText, window === w && S.windowTextActive]}>{w}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Chart body */}
      {loading ? (
        <View style={S.center}>
          <ActivityIndicator color="#C0C0C0" />
          <Text style={S.muted}>Loading history…</Text>
        </View>
      ) : error ? (
        <View style={S.center}>
          <Text style={S.errText}>Could not load history</Text>
        </View>
      ) : !hasData ? (
        <View style={S.center}>
          <Text style={S.muted}>No data for this window yet</Text>
        </View>
      ) : (
        <VictoryChart
          width={SCREEN_WIDTH - 32}
          height={220}
          padding={{ top: 10, bottom: 36, left: 46, right: 16 }}
        >
          <VictoryAxis
            style={{
              axis:       { stroke: '#2A2A2A' },
              tickLabels: { fill: 'transparent' },
              grid:       { stroke: '#1A1A1A' },
            }}
            tickCount={5}
          />
          <VictoryAxis
            dependentAxis
            style={{
              axis:       { stroke: '#2A2A2A' },
              tickLabels: { fill: '#555', fontSize: 9, fontFamily: 'monospace' },
              grid:       { stroke: '#1E1E1E', strokeDasharray: '4,4' },
            }}
            tickCount={5}
          />
          {SENSOR_LINES.filter(s => active.has(s.key) && seriesMap[s.key]?.length > 0).map(sensor => (
            <VictoryLine
              key={sensor.key}
              data={seriesMap[sensor.key].map(p => ({
                x: p.x,
                y: sensor.scale ? p.y * sensor.scale : p.y,
              }))}
              style={{ data: { stroke: sensor.color, strokeWidth: 1.5 } }}
              interpolation="monotoneX"
            />
          ))}
        </VictoryChart>
      )}

      {/* Legend / toggles */}
      <View style={S.legendRow}>
        {SENSOR_LINES.map(sensor => {
          const on = active.has(sensor.key);
          return (
            <TouchableOpacity
              key={sensor.key}
              onPress={() => toggle(sensor.key)}
              style={[S.pill, { borderColor: sensor.color }, !on && S.pillOff]}
            >
              <View style={[S.dot, { backgroundColor: on ? sensor.color : '#333' }]} />
              <Text style={[S.pillText, !on && S.pillTextOff]}>{sensor.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={S.note}>RPM scaled ×0.01 to share axis</Text>
    </View>
  );
}

const S = StyleSheet.create({
  wrapper:        { marginBottom: 16 },
  divider:        { height: 1, backgroundColor: '#1E1E1E', marginHorizontal: 12, marginBottom: 16 },
  title:          { color: '#C0C0C0', fontSize: 10, fontWeight: '800', letterSpacing: 2.5,
                    marginHorizontal: 16, marginBottom: 10 },

  windowRow:      { flexDirection: 'row', marginHorizontal: 16, marginBottom: 6 },
  windowBtn:      { paddingHorizontal: 12, paddingVertical: 4, backgroundColor: '#1A1A1A',
                    marginRight: 6 },
  windowBtnActive:{ backgroundColor: '#242424', borderWidth: 1, borderColor: '#484848' },
  windowText:     { color: '#484848', fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  windowTextActive:{ color: '#E0E0E0' },

  center:         { height: 120, alignItems: 'center', justifyContent: 'center' },
  muted:          { color: '#484848', fontSize: 11, marginTop: 8 },
  errText:        { color: '#D0453A', fontSize: 11 },

  legendRow:      { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: 12, marginTop: 2 },
  pill:           { flexDirection: 'row', alignItems: 'center', borderWidth: 1,
                    paddingHorizontal: 8, paddingVertical: 3,
                    marginRight: 6, marginBottom: 4 },
  pillOff:        { opacity: 0.3 },
  dot:            { width: 6, height: 6, marginRight: 4 },
  pillText:       { color: '#C0C0C0', fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  pillTextOff:    { color: '#555' },

  note:           { color: '#2A2A2A', fontSize: 8, letterSpacing: 1, marginHorizontal: 16, marginTop: 4 },
});
