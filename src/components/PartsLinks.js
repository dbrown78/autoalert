import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { buildPartsLinks } from '../utils/partsSearch';

export default function PartsLinks({ partName, vehicle }) {
  if (!partName) return null;
  const links = buildPartsLinks(partName, vehicle);

  return (
    <View style={S.container}>
      <Text style={S.label}>FIND PARTS</Text>
      <View style={S.grid}>
        {links.map(({ label, sublabel, url }) => (
          <TouchableOpacity
            key={label}
            style={S.btn}
            onPress={() => Linking.openURL(url)}
            activeOpacity={0.7}
          >
            <Text style={S.btnLabel}>{label}</Text>
            <Text style={S.btnSub}>{sublabel}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  container: {
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    padding: 16,
    marginBottom: 10,
  },
  label: {
    color: '#505050',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  btn: {
    borderWidth: 1,
    borderColor: '#2A2A2A',
    paddingVertical: 12,
    paddingHorizontal: 10,
    width: '48%',
    alignItems: 'center',
  },
  btnLabel: { color: '#C0C0C0', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  btnSub: { color: '#505050', fontSize: 10, marginTop: 3, letterSpacing: 0.5 },
});
