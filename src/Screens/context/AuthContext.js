import { createContext, useState, useContext } from 'react';
import * as SecureStore from 'expo-secure-store';
import client from '../api/client';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const register = async (name, email, password) => {
    setLoading(true);
    setError(null);
    try {
      const res = await client.post('/auth/register', { name, email, password });
      setUser(res.data.user);
      setToken(res.data.token);
      await SecureStore.setItemAsync('token', res.data.token);
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
      await SecureStore.setItemAsync('token', res.data.token);
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setUser(null);
    setToken(null);
    await SecureStore.deleteItemAsync('token');
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, error, register, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);