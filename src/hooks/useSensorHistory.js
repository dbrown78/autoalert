import { useState, useCallback } from 'react';
import client from '../api/client';

export const WINDOW_OPTIONS = ['1h', '6h', '24h', '7d'];

/**
 * Fetches sensor history from GET /api/sensors/:vehicleId/history?window=...
 *
 * Backend returns normalized rows: { sensor_type, value, recorded_at }
 * We pivot them into a map keyed by sensor_type for chart consumption:
 *   { rpm: [{ x: 0, y: 1234, t: '...' }, ...], speed: [...], ... }
 */
export function useSensorHistory(vehicleId) {
  const [seriesMap, setSeriesMap] = useState({});   // { [sensor_type]: [{x,y,t}] }
  const [window, setWindow]       = useState('1h');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);

  const fetchHistory = useCallback(async (win = window) => {
    if (!vehicleId) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await client.get(`/sensors/${vehicleId}/history`, {
        params: { window: win },
      });

      // data.readings = [{ sensor_type, value, recorded_at }, ...]
      const raw = data.readings ?? [];

      // Group by sensor_type, sorted oldest→newest
      const grouped = {};
      for (const row of raw) {
        if (!grouped[row.sensor_type]) grouped[row.sensor_type] = [];
        grouped[row.sensor_type].push(row);
      }

      // Sort each series oldest→newest and assign sequential x index
      const pivoted = {};
      for (const [key, rows] of Object.entries(grouped)) {
        rows.sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));
        pivoted[key] = rows.map((r, i) => ({ x: i, y: Number(r.value), t: r.recorded_at }));
      }

      setSeriesMap(pivoted);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [vehicleId, window]);

  const changeWindow = useCallback((win) => {
    setWindow(win);
    fetchHistory(win);
  }, [fetchHistory]);

  return { seriesMap, window, loading, error, fetchHistory, changeWindow };
}
