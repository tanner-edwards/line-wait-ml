// FeatureFlagsContext — server-evaluated feature flags (GET /v1/flags).
//
// The backend decides each flag for this build's x-app-version and returns
// plain booleans, so there's no version logic here. Non-blocking: every flag
// starts false and stays false if the fetch fails (fail closed). Refetched
// when the app returns to the foreground so a console toggle reaches a
// long-open session.

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { FeatureFlags } from '../types';
import { fetchFeatureFlags } from '../api';

export const ALL_FLAGS_OFF: FeatureFlags = { freeTrip: false };

const FeatureFlagsContext = createContext<FeatureFlags>(ALL_FLAGS_OFF);

export function FeatureFlagsProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [flags, setFlags] = useState<FeatureFlags>(ALL_FLAGS_OFF);

  const loadFlags = useCallback(async () => {
    try {
      const result = await fetchFeatureFlags();
      setFlags({ ...ALL_FLAGS_OFF, ...result });
    } catch (err) {
      console.warn('[FeatureFlagsContext] fetchFeatureFlags failed:', err);
      setFlags(ALL_FLAGS_OFF);
    }
  }, []);

  useEffect(() => {
    void loadFlags();
  }, [loadFlags]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void loadFlags();
    });
    return () => sub.remove();
  }, [loadFlags]);

  return <FeatureFlagsContext.Provider value={flags}>{children}</FeatureFlagsContext.Provider>;
}

export function useFeatureFlags(): FeatureFlags {
  return useContext(FeatureFlagsContext);
}
