// Per-day "Which parks today?" state. Loaded from AsyncStorage on mount,
// considered stale when the stored date is older than today's local date.
// The RootNavigator uses `isStale` to decide whether to show the daily-park
// prompt before the main app. Mid-day toggles call setDailyParks() and the
// new value persists for the rest of the day.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DailyContext, DailyParks } from '../types';
import {
  clearDailyContext as clearDailyContextStorage,
  getDailyContext,
  isStale as isStaleFor,
  setDailyContext as writeDailyContext,
} from '../utils/dailyContextStorage';

interface DailyContextValue {
  context: DailyContext | null;
  loading: boolean;
  isStale: boolean;
  setDailyParks: (parks: DailyParks) => Promise<void>;
  clearDailyContext: () => Promise<void>;
}

const Ctx = createContext<DailyContextValue | null>(null);

export function DailyContextProvider({ children }: { children: React.ReactNode }) {
  const [context, setContextState] = useState<DailyContext | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await getDailyContext();
      if (!cancelled) {
        setContextState(stored);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setDailyParks = useCallback(async (parks: DailyParks) => {
    const written = await writeDailyContext(parks);
    setContextState(written);
  }, []);

  const clearDailyContext = useCallback(async () => {
    setContextState(null);
    await clearDailyContextStorage();
  }, []);

  const isStale = useMemo(() => isStaleFor(context), [context]);

  return (
    <Ctx.Provider value={{ context, loading, isStale, setDailyParks, clearDailyContext }}>
      {children}
    </Ctx.Provider>
  );
}

export function useDailyContext(): DailyContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDailyContext must be used inside <DailyContextProvider>');
  return ctx;
}
