import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';

const YT_BASE = 'https://www.youtube.com/results?search_query=';

const BADGE = {
  easy:     { label: 'You can likely fix this yourself', bg: '#1a4a2e', text: '#27ae60', border: '#27ae60' },
  moderate: { label: 'Experienced DIYers can handle this', bg: '#4a3800', text: '#f39c12', border: '#f39c12' },
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
    backgroundColor: '#16213e',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
  },
  titleRow: {
    marginBottom: 12,
    gap: 8,
  },
  title: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeTxt: { fontSize: 12, fontWeight: '600' },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#0f1f3d',
    marginBottom: 8,
    gap: 10,
  },
  linkRowPrimary: {
    backgroundColor: '#1a0000',
    borderWidth: 1,
    borderColor: '#ff3c3c',
  },
  playIcon: {
    color: '#aaa',
    fontSize: 13,
  },
  playIconPrimary: {
    color: '#ff3c3c',
    fontSize: 15,
  },
  linkLabel: {
    flex: 1,
    color: '#ccc',
    fontSize: 13,
    lineHeight: 18,
  },
  linkLabelPrimary: {
    color: '#fff',
    fontWeight: '600',
  },
  arrow: {
    color: '#555',
    fontSize: 18,
  },
});
