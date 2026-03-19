import { useState, useEffect, useRef } from 'react';
import useBLEManager from './useBLEManager';
import { SENSOR_KEYS } from '../utils/sensorThresholds';

const useSensorStream = ({ enabled = false } = {}) => {
  const [sensorData, setSensorData] = useState({});
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState(null);
  const intervalRef = useRef(null);

  const { connectedDevice, readSensorData, isConnected } = useBLEManager({ enabled });

  useEffect(() => {
    if (!isConnected || !connectedDevice) {
      setIsStreaming(false);
      setSensorData({});
      return;
    }

    setIsStreaming(true);
    setStreamError(null);

    const pollSensors = async () => {
      try {
        const data = await readSensorData(SENSOR_KEYS);
        if (data) {
          setSensorData(prev => ({
            ...prev,
            ...data,
            timestamp: Date.now(),
          }));
        }
      } catch (err) {
        setStreamError(err.message || 'Sensor read error');
      }
    };

    pollSensors();
    intervalRef.current = setInterval(pollSensors, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setIsStreaming(false);
    };
  }, [isConnected, connectedDevice]);

  return {
    sensorData,
    isStreaming,
    streamError,
  };
};

export default useSensorStream;
