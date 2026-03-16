import { View, Text, StyleSheet } from 'react-native';

const CONFIG = {
  yes:     { icon: '✅', label: 'Safe to Drive',      bg: 'rgba(76,175,130,0.08)',  border: '#4CAF82', text: '#4CAF82' },
  caution: { icon: '⚠️',  label: 'Drive with Caution', bg: 'rgba(192,139,48,0.08)', border: '#C08B30', text: '#C08B30' },
  no:      { icon: '🚫', label: 'Do Not Drive',       bg: 'rgba(208,69,58,0.08)',   border: '#D0453A', text: '#D0453A' },
};

const SOURCE_LABEL = { sensor: 'LIVE', dtc: 'DTC', foresight: 'ML', clear: 'LIVE' };
const SOURCE_COLOR = { sensor: '#4CAF82', dtc: '#777777', foresight: '#C08B30', clear: '#4CAF82' };

export default function DriveSafetyCard({ driveSafety, driveSafetyReason, source }) {
  if (!driveSafety) return null;
  const { icon, label, bg, border, text } = CONFIG[driveSafety] ?? CONFIG.caution;
  const sourceLabel = source ? SOURCE_LABEL[source] : null;
  const sourceColor = source ? (SOURCE_COLOR[source] ?? '#777777') : null;

  return (
    <View style={[S.card, { backgroundColor: bg, borderColor: border }]}>
      <View style={S.header}>
        <Text style={S.icon}>{icon}</Text>
        <Text style={[S.label, { color: text }]}>{label}</Text>
        {sourceLabel ? (
          <View style={[S.sourceBadge, { borderColor: sourceColor }]}>
            <Text style={[S.sourceText, { color: sourceColor }]}>{sourceLabel}</Text>
          </View>
        ) : null}
      </View>
      {driveSafetyReason ? (
        <Text style={S.reason}>{driveSafetyReason}</Text>
      ) : null}
    </View>
  );
}

const S = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 0,
    padding: 16,
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  icon: { fontSize: 20 },
  label: { fontSize: 15, fontWeight: 'bold', letterSpacing: 1, flex: 1 },
  reason: { color: '#E0E0E0', opacity: 0.75, fontSize: 13, lineHeight: 20 },
  sourceBadge: {
    borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2,
  },
  sourceText: { fontSize: 8, fontWeight: '800', letterSpacing: 1.5 },
});
