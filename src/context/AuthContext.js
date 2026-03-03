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

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const savedToken = await storage.getItem('token');
        if (savedToken) {
          const res = await client.get('/auth/me', {
            headers: { Authorization: `Bearer ${savedToken}` },
          });
          setUser(res.data.user);
          setToken(savedToken);
        }
      } catch (err) {
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
      setUser(res.data.user);
      setToken(res.data.token);
      await storage.setItem('token', res.data.token);
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
      setUser(res.data.user);
      setToken(res.data.token);
      await storage.setItem('token', res.data.token);
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setUser(null);
    setToken(null);
    await storage.deleteItem('token');
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, error, appReady, register, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);