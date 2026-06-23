import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Modal, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import client from '../api/client';

const CURRENT_YEAR = new Date().getFullYear();

export default function VehicleScreen({ navigation }) {
  const { token } = useAuth();
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);

  // Add form state
  const [year, setYear] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [trim, setTrim] = useState('');
  const [mileage, setMileage] = useState('');

  // Edit modal state
  const [editingVehicle, setEditingVehicle] = useState(null); // original vehicle object
  const [editFields, setEditFields] = useState({});
  const [editSaving, setEditSaving] = useState(false);

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    fetchVehicles();
  }, []);

  const fetchVehicles = async () => {
    try {
      const res = await client.get('/vehicles', { headers });
      setVehicles(res.data.vehicles ?? []);
    } catch (err) {
      setError('Failed to load vehicles');
    } finally {
      setLoading(false);
    }
  };

  const saveVehicle = async () => {
    if (!year || !make || !model) {
      setError('Year, make, and model are required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await client.post('/vehicles', { year: parseInt(year, 10), make, model, trim, mileage: mileage ? parseInt(mileage) : null }, { headers });
      setVehicles([res.data.vehicle, ...vehicles]);
      setShowForm(false);
      setYear(''); setMake(''); setModel(''); setTrim(''); setMileage('');
    } catch (err) {
      setError('Failed to save vehicle');
    } finally {
      setSaving(false);
    }
  };

  const deleteVehicle = async (id) => {
    try {
      await client.delete(`/vehicles/${id}`, { headers });
      setVehicles(vehicles.filter(v => v.id !== id));
    } catch (err) {
      setError('Failed to delete vehicle');
    }
  };

  // ── Edit flow ────────────────────────────────────────────────────────────────

  const openEdit = (vehicle) => {
    setEditingVehicle(vehicle);
    setEditFields({
      nickname: vehicle.nickname ?? '',
      mileage:  vehicle.mileage != null ? String(vehicle.mileage) : '',
      year:     vehicle.year    != null ? String(vehicle.year)    : '',
      make:     vehicle.make    ?? '',
      model:    vehicle.model   ?? '',
      vin:      vehicle.vin     ?? '',
    });
  };

  const closeEdit = () => {
    setEditingVehicle(null);
    setEditFields({});
  };

  const setField = (key, val) =>
    setEditFields(prev => ({ ...prev, [key]: val }));

  const saveEdit = async () => {
    // Validate
    const mileageNum = editFields.mileage !== '' ? parseInt(editFields.mileage, 10) : undefined;
    const yearNum    = editFields.year    !== '' ? parseInt(editFields.year,    10) : undefined;
    const vin        = editFields.vin.trim()     !== '' ? editFields.vin.trim()     : undefined;

    if (mileageNum !== undefined && (isNaN(mileageNum) || mileageNum < 0)) {
      Alert.alert('Validation', 'Mileage must be a non-negative number.');
      return;
    }
    if (yearNum !== undefined && (isNaN(yearNum) || yearNum < 1900 || yearNum > CURRENT_YEAR + 1)) {
      Alert.alert('Validation', `Year must be between 1900 and ${CURRENT_YEAR + 1}.`);
      return;
    }
    if (vin !== undefined && vin.length !== 17) {
      Alert.alert('Validation', 'VIN must be exactly 17 characters.');
      return;
    }

    // Diff — only send changed fields
    const orig = editingVehicle;
    const payload = {};

    const trimmed = (v) => (v ?? '').trim();

    if (trimmed(editFields.nickname) !== trimmed(orig.nickname ?? ''))
      payload.nickname = editFields.nickname.trim();
    if (mileageNum !== undefined && mileageNum !== orig.mileage)
      payload.mileage = mileageNum;
    if (yearNum !== undefined && yearNum !== orig.year)
      payload.year = yearNum;
    if (trimmed(editFields.make) !== trimmed(orig.make ?? ''))
      payload.make = editFields.make.trim();
    if (trimmed(editFields.model) !== trimmed(orig.model ?? ''))
      payload.model = editFields.model.trim();
    if ((vin ?? '') !== (orig.vin ?? ''))
      payload.vin = vin ?? null;

    if (Object.keys(payload).length === 0) {
      closeEdit();
      return;
    }

    setEditSaving(true);
    try {
      const res = await client.put(`/vehicles/${orig.id}`, payload, { headers });
      const updated = res.data.vehicle;
      setVehicles(prev => prev.map(v => v.id === updated.id ? updated : v));
      closeEdit();
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to save changes.';
      Alert.alert('Error', msg);
    } finally {
      setEditSaving(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <View style={S.container}>
      <View style={S.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn}>
          <Text style={S.backTxt}>← Back</Text>
        </TouchableOpacity>
        <Text style={S.headerTitle}>My Vehicles</Text>
        <TouchableOpacity onPress={() => setShowForm(!showForm)}>
          <Text style={S.addBtn}>{showForm ? 'Cancel' : '+ Add'}</Text>
        </TouchableOpacity>
      </View>

      {error && <Text style={S.error}>{error}</Text>}

      {showForm && (
        <View style={S.form}>
          <TextInput style={S.input} placeholder="Year (e.g. 2020)" placeholderTextColor="rgba(255,255,255,0.3)"
            value={year} onChangeText={setYear} keyboardType="numeric" maxLength={4} />
          <TextInput style={S.input} placeholder="Make (e.g. Toyota)" placeholderTextColor="rgba(255,255,255,0.3)"
            value={make} onChangeText={setMake} />
          <TextInput style={S.input} placeholder="Model (e.g. Camry)" placeholderTextColor="rgba(255,255,255,0.3)"
            value={model} onChangeText={setModel} />
          <TextInput style={S.input} placeholder="Trim (optional, e.g. LE)" placeholderTextColor="rgba(255,255,255,0.3)"
            value={trim} onChangeText={setTrim} />
          <TextInput style={S.input} placeholder="Mileage (optional)" placeholderTextColor="rgba(255,255,255,0.3)"
            value={mileage} onChangeText={setMileage} keyboardType="numeric" />
          <TouchableOpacity style={[S.saveBtn, saving && { opacity: 0.6 }]} onPress={saveVehicle} disabled={saving}>
            {saving ? <ActivityIndicator color="#C0C0C0" /> : <Text style={S.saveBtnTxt}>Save Vehicle</Text>}
          </TouchableOpacity>
        </View>
      )}

      <ScrollView style={S.scroll}>
        {loading ? (
          <ActivityIndicator color="#C0C0C0" style={{ marginTop: 40 }} />
        ) : vehicles.length === 0 ? (
          <View style={S.emptyState}>
            <Text style={S.emptyIcon}>🚗</Text>
            <Text style={S.emptyText}>No vehicles added yet</Text>
            <Text style={S.emptySubText}>Tap "+ Add" to add your first vehicle</Text>
          </View>
        ) : (
          vehicles.map(v => (
            <View key={v.id} style={S.card}>
              <View style={{ flex: 1 }}>
                <Text style={S.vehicleName}>{v.year} {v.make} {v.model}</Text>
                {v.nickname  && <Text style={S.vehicleSub}>{v.nickname}</Text>}
                {v.trim      && <Text style={S.vehicleSub}>Trim: {v.trim}</Text>}
                {v.mileage   && <Text style={S.vehicleSub}>Mileage: {v.mileage.toLocaleString()} mi</Text>}
                {v.vin       && <Text style={S.vehicleSub}>VIN: {v.vin}</Text>}
              </View>
              <TouchableOpacity onPress={() => openEdit(v)} style={S.editBtn}>
                <Text style={S.editTxt}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => deleteVehicle(v.id)} style={S.deleteBtn}>
                <Text style={S.deleteTxt}>Remove</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>

      {/* ── Edit modal ── */}
      <Modal
        visible={!!editingVehicle}
        transparent
        animationType="slide"
        onRequestClose={closeEdit}
      >
        <KeyboardAvoidingView
          style={S.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={S.modalSheet}>
            <View style={S.modalHeader}>
              <Text style={S.modalTitle}>EDIT VEHICLE</Text>
              <TouchableOpacity onPress={closeEdit} disabled={editSaving}>
                <Text style={S.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={S.fieldLabel}>NICKNAME</Text>
              <TextInput
                style={S.input}
                placeholder="e.g. Daily Driver"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={editFields.nickname ?? ''}
                onChangeText={t => setField('nickname', t)}
              />

              <Text style={S.fieldLabel}>YEAR</Text>
              <TextInput
                style={S.input}
                placeholder="e.g. 2020"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={editFields.year ?? ''}
                onChangeText={t => setField('year', t)}
                keyboardType="numeric"
                maxLength={4}
              />

              <Text style={S.fieldLabel}>MAKE</Text>
              <TextInput
                style={S.input}
                placeholder="e.g. Toyota"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={editFields.make ?? ''}
                onChangeText={t => setField('make', t)}
              />

              <Text style={S.fieldLabel}>MODEL</Text>
              <TextInput
                style={S.input}
                placeholder="e.g. Camry"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={editFields.model ?? ''}
                onChangeText={t => setField('model', t)}
              />

              <Text style={S.fieldLabel}>MILEAGE</Text>
              <TextInput
                style={S.input}
                placeholder="e.g. 45000"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={editFields.mileage ?? ''}
                onChangeText={t => setField('mileage', t)}
                keyboardType="numeric"
              />

              <Text style={S.fieldLabel}>VIN</Text>
              <TextInput
                style={S.input}
                placeholder="17-character VIN (optional)"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={editFields.vin ?? ''}
                onChangeText={t => setField('vin', t.toUpperCase())}
                autoCapitalize="characters"
                maxLength={17}
              />

              <TouchableOpacity
                style={[S.saveBtn, editSaving && { opacity: 0.6 }]}
                onPress={saveEdit}
                disabled={editSaving}
              >
                {editSaving
                  ? <ActivityIndicator color="#C0C0C0" />
                  : <Text style={S.saveBtnTxt}>SAVE CHANGES</Text>}
              </TouchableOpacity>

              <TouchableOpacity style={S.cancelBtn} onPress={closeEdit} disabled={editSaving}>
                <Text style={S.cancelTxt}>CANCEL</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080808' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 52, paddingHorizontal: 20, paddingBottom: 12 },
  backBtn: { width: 60 },
  backTxt: { color: '#C0C0C0', fontSize: 16 },
  headerTitle: { color: '#E0E0E0', fontSize: 13, fontWeight: 'bold', letterSpacing: 2, textTransform: 'uppercase' },
  addBtn: { color: '#C0C0C0', fontSize: 13, letterSpacing: 1, width: 60, textAlign: 'right' },
  error: { color: '#D0453A', textAlign: 'center', marginHorizontal: 20, marginBottom: 8, fontSize: 12, letterSpacing: 1 },
  form: { backgroundColor: '#1A1A1A', margin: 20, borderRadius: 0, padding: 16, borderWidth: 1, borderColor: '#2A2A2A' },
  input: { backgroundColor: '#0A0A0A', borderRadius: 0, padding: 12, color: '#C0C0C0', fontSize: 14, marginBottom: 10, borderWidth: 1, borderColor: '#2A2A2A' },
  saveBtn: { backgroundColor: 'transparent', padding: 14, borderRadius: 0, alignItems: 'center', marginTop: 4, borderWidth: 1, borderColor: '#C0C0C0' },
  saveBtnTxt: { color: '#C0C0C0', fontSize: 11, fontWeight: 'bold', letterSpacing: 3, textTransform: 'uppercase' },
  scroll: { flex: 1, paddingHorizontal: 20 },
  emptyState: { alignItems: 'center', marginTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { color: '#E0E0E0', fontSize: 16, fontWeight: 'bold', letterSpacing: 1 },
  emptySubText: { color: '#777777', fontSize: 13, marginTop: 6 },
  card: { backgroundColor: '#1A1A1A', borderRadius: 0, padding: 16, marginBottom: 8, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#2A2A2A' },
  vehicleName: { color: '#E0E0E0', fontSize: 15, fontWeight: 'bold', letterSpacing: 0.5 },
  vehicleSub: { color: '#777777', fontSize: 13, marginTop: 3 },
  editBtn: { backgroundColor: 'transparent', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 0, borderWidth: 1, borderColor: '#C0C0C0', marginRight: 8 },
  editTxt: { color: '#C0C0C0', fontSize: 12, fontWeight: 'bold', letterSpacing: 1 },
  deleteBtn: { backgroundColor: 'transparent', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 0, borderWidth: 1, borderColor: '#D0453A' },
  deleteTxt: { color: '#D0453A', fontSize: 12, fontWeight: 'bold', letterSpacing: 1 },

  // Edit modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.7)' },
  modalSheet: { backgroundColor: '#111111', borderTopWidth: 1, borderTopColor: '#2A2A2A', padding: 20, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  modalTitle: { color: '#C0C0C0', fontSize: 11, fontWeight: '800', letterSpacing: 3 },
  modalClose: { color: '#777777', fontSize: 18, paddingLeft: 16 },
  fieldLabel: { color: '#505050', fontSize: 9, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 },
  cancelBtn: { padding: 14, alignItems: 'center', marginTop: 8 },
  cancelTxt: { color: '#555555', fontSize: 11, fontWeight: '600', letterSpacing: 2 },
});
