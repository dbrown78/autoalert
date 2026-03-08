import { View, Text, StyleSheet } from 'react-native';

const CONFIG = {
  yes:     { icon: '✅', label: 'Safe to Drive',      bg: 'rgba(76,175,130,0.08)',  border: '#4CAF82', text: '#4CAF82' },
  caution: { icon: '⚠️',  label: 'Drive with Caution', bg: 'rgba(192,139,48,0.08)', border: '#C08B30', text: '#C08B30' },
  no:      { icon: '🚫', label: 'Do Not Drive',       bg: 'rgba(208,69,58,0.08)',   border: '#D0453A', text: '#D0453A' },
};

export default function DriveSafetyCard({ driveSafety, driveSafetyReason }) {
  if (!driveSafety) return null;
  const { icon, label, bg, border, text } = CONFIG[driveSafety] ?? CONFIG.caution;

  return (
    <View style={[S.card, { backgroundColor: bg, borderColor: border }]}>
      <View style={S.header}>
        <Text style={S.icon}>{icon}</Text>
        <Text style={[S.label, { color: text }]}>{label}</Text>
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
  label: { fontSize: 15, fontWeight: 'bold', letterSpacing: 1 },
  reason: { color: '#E0E0E0', opacity: 0.75, fontSize: 13, lineHeight: 20 },
});
