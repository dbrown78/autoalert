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
      setVehicles(res.data.vehicles);
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
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 52, paddingHorizontal: 20, paddingBottom: 12 },
  backBtn: { width: 60 },
  backTxt: { color: '#00d4ff', fontSize: 16 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  addBtn: { color: '#00d4ff', fontSize: 16, fontWeight: 'bold', width: 60, textAlign: 'right' },
  error: { color: '#e74c3c', textAlign: 'center', marginHorizontal: 20, marginBottom: 8 },
  form: { backgroundColor: '#16213e', margin: 20, borderRadius: 14, padding: 16 },
  input: { backgroundColor: '#0f3460', borderRadius: 10, padding: 12, color: '#fff', fontSize: 14, marginBottom: 10 },
  saveBtn: { backgroundColor: '#00d4ff', padding: 14, borderRadius: 30, alignItems: 'center', marginTop: 4 },
  saveBtnTxt: { color: '#1a1a2e', fontSize: 15, fontWeight: 'bold' },
  scroll: { flex: 1, paddingHorizontal: 20 },
  emptyState: { alignItems: 'center', marginTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  emptySubText: { color: '#fff', opacity: 0.5, fontSize: 14, marginTop: 6 },
  card: { backgroundColor: '#16213e', borderRadius: 12, padding: 16, marginBottom: 12, flexDirection: 'row', alignItems: 'center' },
  vehicleName: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  vehicleSub: { color: '#fff', opacity: 0.6, fontSize: 13, marginTop: 3 },
  deleteBtn: { backgroundColor: 'rgba(231,76,60,0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  deleteTxt: { color: '#e74c3c', fontSize: 13, fontWeight: 'bold' },
});