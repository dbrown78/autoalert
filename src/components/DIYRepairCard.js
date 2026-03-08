import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';

const YT_BASE = 'https://www.youtube.com/results?search_query=';

const BADGE = {
  easy:     { label: 'You can likely fix this yourself',    bg: 'rgba(76,175,130,0.08)',  text: '#4CAF82', border: '#4CAF82' },
  moderate: { label: 'Experienced DIYers can handle this', bg: 'rgba(192,139,48,0.08)', text: '#C08B30', border: '#C08B30' },
};

function ytUrl(query) {
  return YT_BASE + encodeURIComponent(query);
}

function VideoLink({ label, query, primary }) {
  return (
    <TouchableOpacity
      style={[S.linkRow, primary && S.linkRowPrimary]}
      onPress={() => Linking.openURL(ytUrl(query))}
      activeOpacity={0.7}
    >
      <Text style={[S.playIcon, primary && S.playIconPrimary]}>▶</Text>
      <Text style={[S.linkLabel, primary && S.linkLabelPrimary]} numberOfLines={2}>
        {label}
      </Text>
      <Text style={S.arrow}>›</Text>
    </TouchableOpacity>
  );
}

export default function DIYRepairCard({ dtcCode, shortDescription, make, model, diyDifficulty, youtubeSearchQuery }) {
  const badge = BADGE[diyDifficulty];
  if (!badge) return null; // 'hard' or undefined — don't render

  const primaryQuery  = youtubeSearchQuery || `${dtcCode} ${shortDescription} fix`;
  const generalQuery  = `${dtcCode} ${shortDescription}`;
  const beginnerQuery = `${shortDescription} how to fix`;

  return (
    <View style={S.card}>
      <View style={S.titleRow}>
        <Text style={S.title}>🎥 DIY Repair Videos</Text>
        <View style={[S.badge, { backgroundColor: badge.bg, borderColor: badge.border }]}>
          <Text style={[S.badgeTxt, { color: badge.text }]}>{badge.label}</Text>
        </View>
      </View>

      <VideoLink
        primary
        label={primaryQuery}
        query={primaryQuery}
      />
      <VideoLink
        label={`${dtcCode} ${shortDescription}`}
        query={generalQuery}
      />
      <VideoLink
        label={`${shortDescription} — how to fix`}
        query={beginnerQuery}
      />
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
  titleRow: {
    marginBottom: 12,
    gap: 8,
  },
  title: {
    color: '#E0E0E0',
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 0,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeTxt: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 0,
    backgroundColor: '#141414',
    marginBottom: 8,
    gap: 10,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  linkRowPrimary: {
    backgroundColor: 'rgba(208,69,58,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(208,69,58,0.35)',
  },
  playIcon: {
    color: '#505050',
    fontSize: 13,
  },
  playIconPrimary: {
    color: '#D0453A',
    fontSize: 14,
  },
  linkLabel: {
    flex: 1,
    color: '#777777',
    fontSize: 13,
    lineHeight: 18,
  },
  linkLabelPrimary: {
    color: '#E0E0E0',
    fontWeight: '600',
  },
  arrow: {
    color: '#2A2A2A',
    fontSize: 18,
  },
});
