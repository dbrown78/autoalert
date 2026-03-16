// components/PartsLinks.js
// Renders a row of discount parts search buttons for a given part + vehicle
//
// USAGE:
//   import PartsLinks from '../components/PartsLinks';
//   <PartsLinks partName="oxygen sensor" vehicle={selectedVehicle} />
//
// WHERE TO ADD:
//   - DTCDetailScreen (below repair cost estimate)
//   - RepairCostCard component (if abstracted)
//
// PROPS:
//   partName  {string}  - Part name derived from DTC lookup (e.g. "catalytic converter")
//   vehicle   {object}  - { year, make, model } from vehicle context/store

import React from 'react';
import { View, Text, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { buildPartsLinks } from '../utils/partsSearch';

export default function PartsLinks({ partName, vehicle }) {
  const links = buildPartsLinks(partName, vehicle);

  const handlePress = (url) => {
    Linking.openURL(url).catch(() => {
      console.warn('Could not open URL:', url);
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>🔧 Find this part cheaper:</Text>
      <View style={styles.row}>
        {links.map(({ label, url, color }) => (
          <TouchableOpacity
            key={label}
            style={[styles.button, { backgroundColor: color }]}
            onPress={() => handlePress(url)}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 16,
    marginBottom: 8,
  },
  label: {
    fontSize: 13,
    color: '#888',
    marginBottom: 8,
    fontWeight: '500',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
