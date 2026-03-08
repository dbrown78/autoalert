import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useAuth } from '../context/AuthContext';
import client from '../api/client';

export default function VehicleScreen({ navigation }) {
  const { token } = useAuth();
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);

  const [year, setYear] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [trim, setTrim] = useState('');
  const [mileage, setMileage] = useState('');

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
      const res = await client.post('/vehicles', { year, make, model, trim, mileage: mileage ? parseInt(mileage) : null }, { headers });
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
            {saving ? <ActivityIndicator color="#1a1a2e" /> : <Text style={S.saveBtnTxt}>Save Vehicle</Text>}
          </TouchableOpacity>
        </View>
      )}

      <ScrollView style={S.scroll}>
        {loading ? (
          <ActivityIndicator color="#00d4ff" style={{ marginTop: 40 }} />
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
                {v.trim && <Text style={S.vehicleSub}>Trim: {v.trim}</Text>}
                {v.mileage && <Text style={S.vehicleSub}>Mileage: {v.mileage.toLocaleString()} mi</Text>}
              </View>
              <TouchableOpacity onPress={() => deleteVehicle(v.id)} style={S.deleteBtn}>
                <Text style={S.deleteTxt}>Remove</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>
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
  deleteBtn: { backgroundColor: 'transparent', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 0, borderWidth: 1, borderColor: '#D0453A' },
  deleteTxt: { color: '#D0453A', fontSize: 12, fontWeight: 'bold', letterSpacing: 1 },
});