import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getDebugMode, setDebugMode as writeDebugMode } from '../utils/debugModeStorage';

interface DebugModeContextValue {
  debugMode: boolean;
  loading: boolean;
  setDebugMode: (on: boolean) => Promise<void>;
}

const DebugModeContext = createContext<DebugModeContextValue | null>(null);

export function DebugModeProvider({ children }: { children: React.ReactNode }) {
  const [debugMode, setDebugModeState] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await getDebugMode();
      if (!cancelled) {
        setDebugModeState(stored);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const setDebugMode = useCallback(async (on: boolean) => {
    setDebugModeState(on);
    await writeDebugMode(on);
  }, []);

  return (
    <DebugModeContext.Provider value={{ debugMode, loading, setDebugMode }}>
      {children}
    </DebugModeContext.Provider>
  );
}

export function useDebugMode(): DebugModeContextValue {
  const ctx = useContext(DebugModeContext);
  if (!ctx) throw new Error('useDebugMode must be used inside <DebugModeProvider>');
  return ctx;
}
