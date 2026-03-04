import { View, Text, StyleSheet } from 'react-native';

const DIY_COLORS = { easy: '#27ae60', moderate: '#f39c12', hard: '#e74c3c' };
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
    backgroundColor: '#16213e',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
  },
  title: {
    color: '#00d4ff',
    fontSize: 15,
    fontWeight: 'bold',
    marginBottom: 14,
  },
  columns: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  col: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 10,
  },
  oemCol: {
    backgroundColor: 'rgba(243,156,18,0.12)',
  },
  amCol: {
    backgroundColor: 'rgba(39,174,96,0.12)',
  },
  colDivider: {
    width: 10,
  },
  colLabel: {
    fontSize: 11,
    color: '#fff',
    opacity: 0.6,
    marginBottom: 6,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  oemPrice: {
    color: '#f39c12',
    fontSize: 18,
    fontWeight: 'bold',
  },
  amPrice: {
    color: '#27ae60',
    fontSize: 18,
    fontWeight: 'bold',
  },
  savingsRow: {
    backgroundColor: 'rgba(39,174,96,0.15)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  savingsText: {
    color: '#27ae60',
    fontSize: 13,
    fontWeight: '600',
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
    color: '#fff',
    opacity: 0.5,
    fontSize: 11,
  },
  footerValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  diyBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  diyText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
});
