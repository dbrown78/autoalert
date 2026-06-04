import React, { createContext, useContext } from 'react';
import useBLEManager from '../hooks/useBLEManager';

const BLEContext = createContext(null);

export function BLEProvider({ children }) {
  const ble = useBLEManager();
  return <BLEContext.Provider value={ble}>{children}</BLEContext.Provider>;
}

export function useBLE() {
  const ctx = useContext(BLEContext);
  if (!ctx) throw new Error('useBLE must be used inside BLEProvider');
  return ctx;
}
