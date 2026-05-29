// In-memory draft persona that the 5 onboarding screens write into. Lives
// only for the duration of the onboarding flow; on the final screen
// (AccessibilityNeeds) the draft is committed to AsyncStorage via
// PersonaContext.setPersona().

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  AccessibilityNeed,
  emptyPersona,
  Persona,
  RideCategory,
  TripDuration,
} from '../types';

interface OnboardingDraft {
  persona: Persona;
}

interface OnboardingDraftValue {
  draft: OnboardingDraft;
  setTripDuration: (v: TripDuration | null) => void;
  setYoungestAge: (v: number | null) => void;
  setRidePreferences: (v: RideCategory[]) => void;
  setMustDoRideIds: (v: string[]) => void;
  setAccessibilityNeeds: (v: AccessibilityNeed[]) => void;
}

const Ctx = createContext<OnboardingDraftValue | null>(null);

export function OnboardingDraftProvider({ children }: { children: React.ReactNode }) {
  const [draft, setDraft] = useState<OnboardingDraft>({
    persona: emptyPersona(),
  });

  const setTripDuration = useCallback((tripDuration: TripDuration | null) => {
    setDraft(d => ({ ...d, persona: { ...d.persona, tripDuration } }));
  }, []);
  const setYoungestAge = useCallback((youngestAge: number | null) => {
    setDraft(d => ({ ...d, persona: { ...d.persona, youngestAge } }));
  }, []);
  const setRidePreferences = useCallback((ridePreferences: RideCategory[]) => {
    setDraft(d => ({ ...d, persona: { ...d.persona, ridePreferences } }));
  }, []);
  const setMustDoRideIds = useCallback((mustDoRideIds: string[]) => {
    setDraft(d => ({ ...d, persona: { ...d.persona, mustDoRideIds } }));
  }, []);
  const setAccessibilityNeeds = useCallback((accessibilityNeeds: AccessibilityNeed[]) => {
    setDraft(d => ({ ...d, persona: { ...d.persona, accessibilityNeeds } }));
  }, []);

  const value = useMemo<OnboardingDraftValue>(() => ({
    draft,
    setTripDuration,
    setYoungestAge,
    setRidePreferences,
    setMustDoRideIds,
    setAccessibilityNeeds,
  }), [draft, setTripDuration, setYoungestAge, setRidePreferences, setMustDoRideIds, setAccessibilityNeeds]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOnboardingDraft(): OnboardingDraftValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useOnboardingDraft must be used inside <OnboardingDraftProvider>');
  return ctx;
}
