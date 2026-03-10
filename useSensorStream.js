// hooks/useSensorStream.js
// Controls the OBD2 sensor stream for a vehicle and exposes latest readings + history

import { useState, useEffect, useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE_URL = Platform.OS === 'web'
  ? 'http://localhost:3001'
  : 'http://192.168.1.221:3001'; // Mac Mini IP

const POLL_INTERVAL_MS = 3000; // how often to fetch latest readings while streaming

/**
 * useSensorStream
 *
 * @param {number|string} vehicleId
 * @returns {{
 *   streaming: boolean,
 *   latest: Record<string, { value: number, unit: string, recorded_at: string }>,
 *   history: Array,
 *   loading: boolean,
 *   error: string|null,
 *   startStream: () => Promise<void>,
 *   stopStream: () => Promise<void>,
 *   fetchHistory: (sensor?: string, window?: string) => Promise<void>,
 * }}
 */
export function useSensorStream(vehicleId) {
  const [streaming, setStreaming]   = useState(false);
  const [latest, setLatest]         = useState({});
  const [history, setHistory]       = useState([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);

  const pollRef = useRef(null);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const getToken = async () => {
    return await AsyncStorage.getItem('token');
  };

  const authHeaders = async () => {
    const token = await getToken();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  };

  // ── Fetch latest readings (called on poll) ────────────────────────────────

  const fetchLatest = useCallback(async () => {
    if (!vehicleId) return;
    try {
      const headers = await authHeaders();
      const res = await fetch(`${BASE_URL}/api/sensors/${vehicleId}/latest`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLatest(data.sensors || {});
    } catch (err) {
      console.warn('[useSensorStream] fetchLatest error:', err.message);
    }
  }, [vehicleId]);

  // ── Start stream ──────────────────────────────────────────────────────────

  const startStream = useCallback(async () => {
    if (!vehicleId) return;
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${BASE_URL}/api/sensors/stream/start`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ vehicle_id: vehicleId, interval_ms: 2000 }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setStreaming(true);

      // Start polling latest readings
      pollRef.current = setInterval(fetchLatest, POLL_INTERVAL_MS);
      await fetchLatest(); // immediate first fetch
    } catch (err) {
      setError(err.message);
      console.error('[useSensorStream] startStream error:', err.message);
    } finally {
      setLoading(false);
    }
  }, [vehicleId, fetchLatest]);

  // ── Stop stream ───────────────────────────────────────────────────────────

  const stopStream = useCallback(async () => {
    if (!vehicleId) return;
    setLoading(true);
    try {
      const headers = await authHeaders();
      await fetch(`${BASE_URL}/api/sensors/stream/stop`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ vehicle_id: vehicleId }),
      });
      setStreaming(false);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  // ── Fetch history ─────────────────────────────────────────────────────────

  const fetchHistory = useCallback(async (sensor = null, window = '24h') => {
    if (!vehicleId) return;
    setLoading(true);
    try {
      const headers = await authHeaders();
      const params = new URLSearchParams({ window });
      if (sensor) params.set('sensor', sensor);
      const res = await fetch(
        `${BASE_URL}/api/sensors/${vehicleId}/history?${params.toString()}`,
        { headers }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHistory(data.readings || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  return {
    streaming,
    latest,
    history,
    loading,
    error,
    startStream,
    stopStream,
    fetchHistory,
  };
}
