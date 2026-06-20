import axios from 'axios';
import { Platform } from 'react-native';

export const API_URL = __DEV__
  ? 'http://localhost:3001'
  : 'https://odin-backend-production-3220.up.railway.app';

const client = axios.create({ baseURL: `${API_URL}/api` });

// ── Storage helpers (mirrors AuthContext — needed without circular dep) ────────

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

// ── Silent refresh interceptor ────────────────────────────────────────────────
//
// On any 401 response (except auth routes, to avoid loops):
//   1. Attempt POST /auth/refresh with the stored refresh token
//   2. On success: persist new tokens, update client header, retry original request
//   3. On failure: clear both tokens (user will be redirected to login by AuthContext /me check)
//
// A queue prevents multiple simultaneous refresh races when parallel requests all 401.

let isRefreshing = false;
let failedQueue  = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach(p => error ? p.reject(error) : p.resolve(token));
  failedQueue = [];
};

client.interceptors.response.use(
  response => response,
  async error => {
    const original = error.config;

    // Only intercept 401s that aren't already retried or from auth endpoints
    if (
      error.response?.status !== 401 ||
      original._retry ||
      original.url?.includes('/auth/')
    ) {
      return Promise.reject(error);
    }

    // Queue concurrent requests while a refresh is in progress
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then(token => {
        original.headers['Authorization'] = `Bearer ${token}`;
        return client(original);
      }).catch(err => Promise.reject(err));
    }

    original._retry  = true;
    isRefreshing     = true;

    try {
      const refreshToken = await storage.getItem('refresh_token');
      if (!refreshToken) throw new Error('No refresh token stored');

      const res = await client.post('/auth/refresh', { refreshToken });
      const { token: newAccessToken, refreshToken: newRefreshToken } = res.data;

      // Persist new tokens
      await storage.setItem('token', newAccessToken);
      await storage.setItem('refresh_token', newRefreshToken);

      // Update default header for future requests
      client.defaults.headers.common['Authorization'] = `Bearer ${newAccessToken}`;

      processQueue(null, newAccessToken);
      original.headers['Authorization'] = `Bearer ${newAccessToken}`;
      return client(original);
    } catch (refreshError) {
      processQueue(refreshError, null);
      // Clear stored credentials — AuthContext's /auth/me will detect logged-out state
      await storage.deleteItem('token');
      await storage.deleteItem('refresh_token');
      delete client.defaults.headers.common['Authorization'];
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

export default client;
