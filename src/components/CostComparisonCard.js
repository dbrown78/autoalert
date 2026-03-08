import { View, Text, StyleSheet } from 'react-native';

const DIY_COLORS = { easy: '#4CAF82', moderate: '#C08B30', hard: '#D0453A' };
const DIY_LABELS = { easy: '🔧 Easy DIY', moderate: '⚙️ Moderate DIY', hard: '🔩 Hard DIY' };

const fmt = n => '$' + Number(n).toLocaleString();

export default function CostComparisonCard({
  oemCostMin, oemCostMax,
  aftermarketCostMin, aftermarketCostMax,
  laborHoursMin, laborHoursMax,
  diyDifficulty,
}) {
  const maxSavings = oemCostMax - aftermarketCostMin;

  return (
    <View style={S.card}>
      <Text style={S.title}>Cost Comparison</Text>

      <View style={S.columns}>
        <View style={[S.col, S.oemCol]}>
          <Text style={S.colLabel}>OEM / Dealer</Text>
          <Text style={S.oemPrice}>{fmt(oemCostMin)}–{fmt(oemCostMax)}</Text>
        </View>
        <View style={S.colDivider} />
        <View style={[S.col, S.amCol]}>
          <Text style={S.colLabel}>Aftermarket</Text>
          <Text style={S.amPrice}>{fmt(aftermarketCostMin)}–{fmt(aftermarketCostMax)}</Text>
        </View>
      </View>

      {maxSavings > 0 && (
        <View style={S.savingsRow}>
          <Text style={S.savingsText}>
            Save up to {fmt(maxSavings)} with aftermarket parts
          </Text>
        </View>
      )}

      <View style={S.footer}>
        <View style={S.footerItem}>
          <Text style={S.footerLabel}>⏱ Labor estimate</Text>
          <Text style={S.footerValue}>{laborHoursMin}–{laborHoursMax} hrs</Text>
        </View>
        <View style={[S.diyBadge, { backgroundColor: DIY_COLORS[diyDifficulty] }]}>
          <Text style={S.diyText}>{DIY_LABELS[diyDifficulty]}</Text>
        </View>
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 0,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  title: {
    color: '#C0C0C0',
    fontSize: 10,
    fontWeight: 'bold',
    marginBottom: 14,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  columns: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  col: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  oemCol: {
    backgroundColor: 'rgba(192,139,48,0.08)',
  },
  amCol: {
    backgroundColor: 'rgba(76,175,130,0.08)',
  },
  colDivider: {
    width: 8,
  },
  colLabel: {
    fontSize: 10,
    color: '#777777',
    marginBottom: 6,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  oemPrice: {
    color: '#C08B30',
    fontSize: 18,
    fontWeight: 'bold',
  },
  amPrice: {
    color: '#4CAF82',
    fontSize: 18,
    fontWeight: 'bold',
  },
  savingsRow: {
    backgroundColor: 'rgba(76,175,130,0.08)',
    borderRadius: 0,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(76,175,130,0.25)',
  },
  savingsText: {
    color: '#4CAF82',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  footerItem: {
    gap: 2,
  },
  footerLabel: {
    color: '#777777',
    fontSize: 11,
  },
  footerValue: {
    color: '#E0E0E0',
    fontSize: 14,
    fontWeight: '600',
  },
  diyBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 0,
  },
  diyText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
});
