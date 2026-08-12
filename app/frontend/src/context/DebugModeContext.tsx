import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getDebugMode, setDebugMode as writeDebugMode } from '../utils/debugModeStorage';
import { useAuth } from './AuthContext';

interface DebugModeContextValue {
  debugMode: boolean;
  loading: boolean;
  setDebugMode: (on: boolean) => Promise<void>;
}

const DebugModeContext = createContext<DebugModeContextValue | null>(null);

export function DebugModeProvider({ children }: { children: React.ReactNode }) {
  const { userRecord } = useAuth();
  const [localDebugMode, setLocalDebugMode] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await getDebugMode();
      if (!cancelled) {
        setLocalDebugMode(stored);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const setDebugMode = useCallback(async (on: boolean) => {
    setLocalDebugMode(on);
    await writeDebugMode(on);
  }, []);

  // Server-controlled: a stale local toggle from before this account lost
  // (or never had) debugMode access can't re-enable debug features on its own —
  // both the Firestore flag AND the local switch have to be on.
  const debugMode = (userRecord?.debugMode ?? false) && localDebugMode;

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
