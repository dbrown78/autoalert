import { View, Text, StyleSheet } from 'react-native';

const CONFIG = {
  yes:     { icon: '✅', label: 'Safe to Drive',      bg: '#1a4a2e', border: '#27ae60', text: '#27ae60' },
  caution: { icon: '⚠️',  label: 'Drive with Caution', bg: '#4a3800', border: '#f39c12', text: '#f39c12' },
  no:      { icon: '🚫', label: 'Do Not Drive',       bg: '#4a1a1a', border: '#e74c3c', text: '#e74c3c' },
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
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  icon: { fontSize: 22 },
  label: { fontSize: 18, fontWeight: 'bold' },
  reason: { color: '#fff', opacity: 0.85, fontSize: 14, lineHeight: 20 },
});
