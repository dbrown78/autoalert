import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Alert, TextInput, Linking, ActivityIndicator,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import client from '../api/client';

export default function SettingsScreen({ navigation }) {
  const { user, logout } = useAuth();
  const [deleteStep, setDeleteStep]     = useState(0); // 0=hidden, 1=typing
  const [deleteInput, setDeleteInput]   = useState('');
  const [deleting, setDeleting]         = useState(false);
  const [deleteError, setDeleteError]   = useState('');

  const openSubscriptions = () => {
    Linking.openURL('https://apps.apple.com/account/subscriptions');
  };

  const openSupport = () => {
    Linking.openURL(
      'mailto:support@odinai.app?subject=AutoAlert%20Support%20Request&body=App%20version%3A%201.0.0%0ADevice%3A%20iPhone%0A%0ADescribe%20your%20issue%3A'
    );
  };

  const handleDeleteTap = () => {
    Alert.alert(
      'Delete Account?',
      'This will permanently delete your account, vehicles, scan history, and all associated data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', style: 'destructive', onPress: () => { setDeleteStep(1); setDeleteInput(''); setDeleteError(''); } },
      ]
    );
  };

  const confirmDelete = async () => {
    if (deleteInput !== 'DELETE') {
      setDeleteError('Type DELETE to confirm');
      return;
    }
    setDeleting(true);
    setDeleteError('');
    try {
      await client.delete('/auth/account');
      await logout();
    } catch (err) {
      setDeleteError(err.response?.data?.error || 'Failed to delete account');
      setDeleting(false);
    }
  };

  return (
    <View style={S.container}>
      <View style={S.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn} activeOpacity={0.7}>
          <Text style={S.backTxt}>‹ BACK</Text>
        </TouchableOpacity>
        <Text style={S.screenTitle}>SETTINGS</Text>
      </View>

      <ScrollView style={S.scroll} showsVerticalScrollIndicator={false}>

        {/* Account */}
        <Text style={S.sectionLabel}>ACCOUNT</Text>
        <View style={S.card}>
          <View style={S.row}>
            <Text style={S.rowLabel}>NAME</Text>
            <Text style={S.rowValue}>{user?.name ?? '—'}</Text>
          </View>
          <View style={[S.row, { borderTopWidth: 1, borderTopColor: '#1A1A1A' }]}>
            <Text style={S.rowLabel}>EMAIL</Text>
            <Text style={S.rowValue}>{user?.email ?? '—'}</Text>
          </View>
        </View>

        {/* Support */}
        <Text style={S.sectionLabel}>SUPPORT</Text>
        <View style={S.card}>
          <TouchableOpacity style={S.row} onPress={openSupport} activeOpacity={0.75}>
            <View style={{ flex: 1 }}>
              <Text style={S.rowTitle}>Contact Support</Text>
              <Text style={S.rowSub}>support@odinai.app</Text>
            </View>
            <Text style={S.arrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Legal */}
        <Text style={S.sectionLabel}>LEGAL</Text>
        <View style={S.card}>
          <TouchableOpacity style={S.row} onPress={() => navigation.navigate('TermsOfService')} activeOpacity={0.75}>
            <Text style={S.rowTitle}>Terms of Service</Text>
            <Text style={S.arrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Subscription */}
        <Text style={S.sectionLabel}>SUBSCRIPTION</Text>
        <View style={S.card}>
          <TouchableOpacity style={S.row} onPress={openSubscriptions} activeOpacity={0.75}>
            <View style={{ flex: 1 }}>
              <Text style={S.rowTitle}>Manage Subscription</Text>
              <Text style={S.rowSub}>Cancel or modify via App Store</Text>
            </View>
            <Text style={S.arrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Danger zone */}
        <Text style={S.sectionLabel}>ACCOUNT ACTIONS</Text>
        <View style={S.card}>
          <TouchableOpacity style={S.row} onPress={handleDeleteTap} activeOpacity={0.75}>
            <Text style={S.dangerTxt}>Delete Account</Text>
          </TouchableOpacity>
        </View>

        {/* Delete confirmation input */}
        {deleteStep === 1 && (
          <View style={S.deleteBox}>
            <Text style={S.deleteWarning}>
              TYPE "DELETE" TO PERMANENTLY DELETE YOUR ACCOUNT
            </Text>
            <TextInput
              style={S.deleteInput}
              placeholder="DELETE"
              placeholderTextColor="#3A3A3A"
              value={deleteInput}
              onChangeText={t => { setDeleteInput(t); setDeleteError(''); }}
              autoCapitalize="characters"
              selectionColor="#D0453A"
            />
            {deleteError ? <Text style={S.deleteError}>{deleteError}</Text> : null}
            <TouchableOpacity
              style={[S.deleteBtn, (deleteInput !== 'DELETE' || deleting) && S.deleteBtnDisabled]}
              onPress={confirmDelete}
              disabled={deleteInput !== 'DELETE' || deleting}
              activeOpacity={0.7}
            >
              {deleting
                ? <ActivityIndicator color="#D0453A" />
                : <Text style={S.deleteBtnTxt}>PERMANENTLY DELETE ACCOUNT</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity style={{ marginTop: 12, alignItems: 'center' }} onPress={() => setDeleteStep(0)}>
              <Text style={{ color: '#505050', fontSize: 12, letterSpacing: 1 }}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080808' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 56, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1A1A1A',
  },
  backBtn: { marginRight: 16 },
  backTxt: { color: '#C0C0C0', fontSize: 13, letterSpacing: 1 },
  screenTitle: { color: '#E0E0E0', fontSize: 12, fontWeight: '800', letterSpacing: 4 },
  scroll: { flex: 1, paddingHorizontal: 20 },
  sectionLabel: {
    fontSize: 9, color: '#505050', fontWeight: '700',
    letterSpacing: 3, textTransform: 'uppercase',
    marginTop: 24, marginBottom: 8,
  },
  card: {
    backgroundColor: '#1A1A1A',
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    padding: 14, minHeight: 52,
  },
  rowLabel: { color: '#505050', fontSize: 10, letterSpacing: 2, width: 80 },
  rowValue: { color: '#C0C0C0', fontSize: 13, flex: 1 },
  rowTitle: { color: '#C0C0C0', fontSize: 13 },
  rowSub: { color: '#505050', fontSize: 11, marginTop: 2, letterSpacing: 0.5 },
  arrow: { color: '#333333', fontSize: 20, marginLeft: 8 },
  dangerTxt: { color: '#D0453A', fontSize: 13 },
  deleteBox: {
    backgroundColor: '#120808',
    borderWidth: 1, borderColor: '#D0453A',
    padding: 16, marginTop: 12,
  },
  deleteWarning: {
    color: '#D0453A', fontSize: 9, letterSpacing: 2,
    fontWeight: '800', marginBottom: 14,
  },
  deleteInput: {
    backgroundColor: '#0A0A0A',
    borderWidth: 1, borderColor: '#3A1A1A',
    padding: 12, color: '#D0453A',
    fontSize: 16, letterSpacing: 4, textAlign: 'center',
    marginBottom: 12,
  },
  deleteError: {
    color: '#D0453A', fontSize: 11, letterSpacing: 1, marginBottom: 10,
  },
  deleteBtn: {
    borderWidth: 1, borderColor: '#D0453A',
    padding: 14, alignItems: 'center',
  },
  deleteBtnDisabled: { opacity: 0.35 },
  deleteBtnTxt: { color: '#D0453A', fontSize: 10, fontWeight: '800', letterSpacing: 2 },
});
