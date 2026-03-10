import { useState, useEffect, useRef, useCallback } from 'react';
import client from '../src/api/client';

const POLL_INTERVAL_MS = 3000;

/**
 * useSensorStream — manages a live OBD2 sensor stream for a vehicle.
 *
 * @param {number|null} vehicleId
 * @returns {{ sensors, streaming, error, startStream, stopStream }}
 *
 * sensors: { [sensorType]: { value: number, recorded_at: string } }
 * streaming: boolean
 * error: string | null
 * startStream: () => Promise<void>
 * stopStream:  () => Promise<void>
 */
export default function useSensorStream(vehicleId) {
  const [sensors, setSensors]   = useState({});
  const [streaming, setStreaming] = useState(false);
  const [error, setError]        = useState(null);
  const pollRef = useRef(null);

  const fetchLatest = useCallback(async () => {
    if (!vehicleId) return;
    try {
      const { data } = await client.get(`/sensors/${vehicleId}/latest`);
      setSensors(data.sensors || {});
    } catch (err) {
      console.warn('[useSensorStream] poll error:', err.message);
    }
  }, [vehicleId]);

  const startStream = useCallback(async () => {
    if (!vehicleId || streaming) return;
    try {
      await client.post('/sensors/stream/start', { vehicle_id: vehicleId });
      setStreaming(true);
      setError(null);
      pollRef.current = setInterval(fetchLatest, POLL_INTERVAL_MS);
    } catch (err) {
      setError(err.message);
    }
  }, [vehicleId, streaming, fetchLatest]);

  const stopStream = useCallback(async () => {
    if (!vehicleId || !streaming) return;
    clearInterval(pollRef.current);
    pollRef.current = null;
    setStreaming(false);
    try {
      await client.post('/sensors/stream/stop', { vehicle_id: vehicleId });
    } catch (err) {
      console.warn('[useSensorStream] stop error:', err.message);
    }
  }, [vehicleId, streaming]);

  // Cleanup on unmount — stop polling (does not stop backend stream)
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  return { sensors, streaming, error, startStream, stopStream };
}
