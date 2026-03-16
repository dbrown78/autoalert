import { createContext, useState, useContext, useEffect } from 'react';
import { Platform } from 'react-native';
import client from '../api/client';

const storage = {
  getItem: async (key) => {
    if (Platform.OS === 'web') return localStorage.getItem(key);
    const SecureStore = await import('expo-secure-store');
    return SecureStore.getItemAsync(key);
  },
  setItem: async (key, value) => {
    if (Platform.OS === 'web') return localStorage.setItem(key, value);
    const SecureStore = await import('expo-secure-store');
    return SecureStore.setItemAsync(key, value);
  },
  deleteItem: async (key) => {
    if (Platform.OS === 'web') return localStorage.removeItem(key);
    const SecureStore = await import('expo-secure-store');
    return SecureStore.deleteItemAsync(key);
  },
};

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [appReady, setAppReady] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState(null);

  const setAuth = (tok) => {
    if (tok) {
      client.defaults.headers.common['Authorization'] = `Bearer ${tok}`;
    } else {
      delete client.defaults.headers.common['Authorization'];
    }
  };

  const loadSelectedVehicle = async () => {
    try {
      const res = await client.get('/vehicles');
      const list = res.data?.vehicles ?? [];
      if (list.length > 0) setSelectedVehicle(list[0]);
    } catch {
      // Non-fatal — DTC screen works without a vehicle
    }
  };

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const savedToken = await storage.getItem('token');
        if (savedToken) {
          setAuth(savedToken);
          const res = await client.get('/auth/me');
          setUser(res.data.user);
          setToken(savedToken);
          await loadSelectedVehicle();
        }
      } catch {
        setAuth(null);
        await storage.deleteItem('token');
      } finally {
        setAppReady(true);
      }
    };
    restoreSession();
  }, []);

  const register = async (name, email, password) => {
    setLoading(true);
    setError(null);
    try {
      const res = await client.post('/auth/register', { name, email, password });
      setAuth(res.data.token);
      setUser(res.data.user);
      setToken(res.data.token);
      await storage.setItem('token', res.data.token);
      if (res.data.refreshToken) {
        await storage.setItem('refresh_token', res.data.refreshToken);
      }
      await loadSelectedVehicle();
    } catch (err) {
      setError(err.response?.data?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    setLoading(true);
    setError(null);
    try {
      const res = await client.post('/auth/login', { email, password });
      setAuth(res.data.token);
      setUser(res.data.user);
      setToken(res.data.token);
      await storage.setItem('token', res.data.token);
      if (res.data.refreshToken) {
        await storage.setItem('refresh_token', res.data.refreshToken);
      }
      await loadSelectedVehicle();
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      const refreshToken = await storage.getItem('refresh_token');
      await client.post('/auth/logout', { refreshToken }).catch(() => {});
    } catch {}
    setAuth(null);
    setUser(null);
    setToken(null);
    setSelectedVehicle(null);
    await storage.deleteItem('token');
    await storage.deleteItem('refresh_token');
  };

  return (
    <AuthContext.Provider value={{
      user, token, loading, error, appReady,
      selectedVehicle, setSelectedVehicle,
      register, login, logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
