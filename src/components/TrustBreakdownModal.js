import { useEffect, useRef } from 'react';
import {
  Modal, View, Text, Pressable,
  StyleSheet, Animated,
} from 'react-native';

const C = {
  bg:           '#080808',
  surface:      '#1A1A1A',
  surfaceAlt:   '#141414',
  border:       '#2A2A2A',
  borderGlow:   '#3A3A3A',
  accent:       '#C0C0C0',
  accentDim:    'rgba(192,192,192,0.08)',
  open:         '#4CAF82',
  openBg:       'rgba(76,175,130,0.12)',
  closed:       '#D0453A',
  closedBg:     'rgba(208,69,58,0.12)',
  gold:         '#C08B30',
  textPrimary:  '#E0E0E0',
  textSecondary:'#777777',
  textMuted:    '#505050',
};

function AnimatedBar({ ratio, color }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: Math.max(0, Math.min(1, ratio)),
      duration: 600,
      useNativeDriver: false,
    }).start();
  }, [ratio]);

  return (
    <View style={ST.barTrack}>
      <Animated.View
        style={[
          ST.barFill,
          {
            backgroundColor: color,
            width: anim.interpolate({
              inputRange: [0, 1],
              outputRange: ['0%', '100%'],
            }),
          },
        ]}
      />
    </View>
  );
}

function ComponentRow({ label, score, max, detail, color, isNegative }) {
  const ratio = max > 0 ? score / max : 0;
  return (
    <View style={ST.componentRow}>
      <View style={ST.componentHeader}>
        <Text style={ST.componentLabel}>{label}</Text>
        <Text style={[ST.componentScore, { color }]}>
          {score}<Text style={ST.componentMax}>/{max}</Text>
        </Text>
      </View>
      <AnimatedBar ratio={ratio} color={color} />
      {detail ? <Text style={ST.componentDetail}>{detail}</Text> : null}
    </View>
  );
}

export default function TrustBreakdownModal({ visible, onClose, trust }) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={ST.overlay}>
        <View style={ST.sheet}>
          {/* Drag handle */}
          <View style={ST.handle} />

          {/* Title */}
          <Text style={ST.title}>ODIN TRUST SCORE</Text>

          {trust && trust.score != null ? (
            <>
              {/* Large score */}
              <View style={ST.scoreBlock}>
                <Text style={[ST.scoreLarge, { color: trust.tier_color }]}>
                  {trust.score}
                </Text>
                <Text style={[ST.tierLabel, { color: trust.tier_color }]}>
                  {trust.tier?.toUpperCase()}
                </Text>
              </View>

              {/* Component rows */}
              <View style={ST.components}>
                <ComponentRow
                  label="COST ACCURACY"
                  score={trust.components?.cost_accuracy?.score ?? 0}
                  max={trust.components?.cost_accuracy?.max ?? 40}
                  detail={trust.components?.cost_accuracy?.detail}
                  color={trust.tier_color}
                />
                <ComponentRow
                  label="FIX SUCCESS RATE"
                  score={trust.components?.fix_success?.score ?? 0}
                  max={trust.components?.fix_success?.max ?? 40}
                  detail={trust.components?.fix_success?.detail}
                  color={trust.tier_color}
                />
                <ComponentRow
                  label="UPSELL PENALTY"
                  score={trust.components?.upsell?.penalty ?? 0}
                  max={trust.components?.upsell?.max ?? 20}
                  detail={trust.components?.upsell?.detail}
                  color={C.closed}
                  isNegative
                />
              </View>

              {/* Outcome count */}
              <Text style={ST.outcomeCount}>
                Based on {trust.outcome_count ?? 0} user report{trust.outcome_count !== 1 ? 's' : ''}
              </Text>
            </>
          ) : (
            <View style={ST.noDataBlock}>
              <Text style={ST.noDataTxt}>No trust data yet for this shop.</Text>
              <Text style={ST.noDataSub}>Be the first to report an outcome.</Text>
            </View>
          )}

          {/* Close */}
          <Pressable
            style={({ pressed }) => [ST.closeBtn, pressed && ST.pressed]}
            onPress={onClose}
          >
            <Text style={ST.closeTxt}>CLOSE</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const ST = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#141414',
    borderTopWidth: 1,
    borderTopColor: '#2A2A2A',
    borderRadius: 0,
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  handle: {
    width: 40, height: 3,
    backgroundColor: '#3A3A3A',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12, marginBottom: 24,
  },
  title: {
    color: C.accent, fontSize: 13, fontWeight: '800',
    letterSpacing: 2.5, marginBottom: 20,
  },

  // Score block
  scoreBlock: {
    alignItems: 'center', marginBottom: 28,
  },
  scoreLarge: {
    fontSize: 72, fontWeight: '800', lineHeight: 76,
  },
  tierLabel: {
    fontSize: 14, fontWeight: '800', letterSpacing: 3, marginTop: 4,
  },

  // Component rows
  components: { gap: 20, marginBottom: 24 },
  componentRow: {},
  componentHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'baseline', marginBottom: 6,
  },
  componentLabel: {
    color: C.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 1.5,
  },
  componentScore: {
    fontSize: 15, fontWeight: '800',
  },
  componentMax: {
    fontSize: 11, color: C.textMuted,
  },
  barTrack: {
    height: 3,
    backgroundColor: '#2A2A2A',
    borderRadius: 0,
    overflow: 'hidden',
  },
  barFill: {
    height: 3,
    borderRadius: 0,
  },
  componentDetail: {
    color: C.textSecondary, fontSize: 11, marginTop: 5, lineHeight: 16,
  },

  // Outcome count
  outcomeCount: {
    color: C.textMuted, fontSize: 11, textAlign: 'center', marginBottom: 24,
  },

  // No data
  noDataBlock: {
    alignItems: 'center', paddingVertical: 32,
  },
  noDataTxt: {
    color: C.textSecondary, fontSize: 14, marginBottom: 6,
  },
  noDataSub: {
    color: C.textMuted, fontSize: 12,
  },

  // Close button
  closeBtn: {
    borderWidth: 1, borderColor: C.border,
    paddingVertical: 14, alignItems: 'center',
    borderRadius: 0,
  },
  closeTxt: {
    color: C.accent, fontSize: 12, fontWeight: '800', letterSpacing: 1.5,
  },
  pressed: { opacity: 0.65 },
});
