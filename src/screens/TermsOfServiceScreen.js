import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';

const SECTIONS = [
  {
    heading: '1. Acceptance of Terms',
    body: 'By downloading, installing, or using AutoAlert ("the App"), you agree to be bound by these Terms of Service. If you do not agree, do not use the App.',
  },
  {
    heading: '2. Description of Service',
    body: 'AutoAlert provides vehicle diagnostics, DTC (Diagnostic Trouble Code) lookup, OBD-II telemetry monitoring, mechanic finder, and drive safety indicators. The App is designed to assist vehicle owners in understanding their vehicle\'s condition.',
  },
  {
    heading: '3. User Accounts',
    body: 'You are responsible for maintaining the confidentiality of your account credentials and for all activity that occurs under your account. You agree to notify us immediately of any unauthorized use of your account.',
  },
  {
    heading: '4. Vehicle Data',
    body: 'Data collected from your OBD-II adapter is used solely to provide diagnostics and predictive maintenance features within the App. We do not sell your vehicle data to third parties. Anonymized aggregate data may be used to improve the service.',
  },
  {
    heading: '5. Subscriptions & Billing',
    body: 'Premium subscriptions are billed through the Apple App Store or Google Play Store. Subscriptions renew automatically unless cancelled at least 24 hours before the end of the current billing period. To cancel, go to Settings → Apple ID → Subscriptions on your device.',
  },
  {
    heading: '6. Disclaimer of Warranties',
    body: 'AutoAlert provides diagnostic information for reference purposes only. Always consult a qualified mechanic before undertaking vehicle repairs. We are not liable for vehicle damage, personal injury, or financial loss resulting from actions taken based on information provided by the App. The App is provided "as is" without warranties of any kind.',
  },
  {
    heading: '7. Account Deletion',
    body: 'You may delete your account at any time from Settings → Account → Delete Account within the App. Account deletion is permanent and removes all associated data including vehicles, scan history, and telemetry within 30 days of the request.',
  },
  {
    heading: '8. Contact Us',
    body: 'For support or questions about these terms, contact us at: support@odinai.app',
  },
  {
    heading: '9. Changes to Terms',
    body: 'We may update these Terms of Service from time to time. We will notify you of material changes via the App or email. Continued use of the App after changes take effect constitutes your acceptance of the revised terms.',
  },
  {
    heading: '10. Governing Law',
    body: 'These Terms are governed by and construed in accordance with the laws of the State of New York, without regard to its conflict of law provisions.',
  },
];

export default function TermsOfServiceScreen({ navigation }) {
  return (
    <View style={S.container}>
      <View style={S.header}>
        <Text style={S.brand}>AUTOALERT</Text>
        <Text style={S.title}>TERMS OF SERVICE</Text>
        <View style={S.divider} />
      </View>

      <ScrollView style={S.scroll} showsVerticalScrollIndicator={false}>
        {SECTIONS.map((sec, i) => (
          <View key={i} style={S.section}>
            <Text style={S.sectionHeading}>{sec.heading.toUpperCase()}</Text>
            <Text style={S.sectionBody}>{sec.body}</Text>
          </View>
        ))}
        <Text style={S.effective}>Effective Date: March 17, 2026</Text>
        <View style={{ height: 40 }} />
      </ScrollView>

      <TouchableOpacity style={S.closeBtn} onPress={() => navigation.goBack()} activeOpacity={0.75}>
        <Text style={S.closeTxt}>CLOSE</Text>
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080808' },
  header: { paddingHorizontal: 24, paddingTop: 56, paddingBottom: 8 },
  brand: { fontSize: 20, color: '#C0C0C0', letterSpacing: 6, fontWeight: '800' },
  title: { fontSize: 10, color: '#505050', letterSpacing: 3, marginTop: 4 },
  divider: { width: 48, height: 1, backgroundColor: '#2A2A2A', marginTop: 16, marginBottom: 8 },
  scroll: { flex: 1, paddingHorizontal: 24 },
  section: { marginBottom: 24 },
  sectionHeading: {
    fontSize: 9, color: '#707070', fontWeight: '800',
    letterSpacing: 2, marginBottom: 8,
  },
  sectionBody: { fontSize: 13, color: '#777777', lineHeight: 20 },
  effective: { fontSize: 10, color: '#404040', letterSpacing: 1, marginTop: 8 },
  closeBtn: {
    margin: 20,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    padding: 16,
    alignItems: 'center',
  },
  closeTxt: { color: '#C0C0C0', fontSize: 11, fontWeight: '800', letterSpacing: 4 },
});
