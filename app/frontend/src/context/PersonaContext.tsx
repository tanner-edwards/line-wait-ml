// Persona state — loaded from AsyncStorage on mount, written through on every
// update. Components consume via usePersona(). The Recommendations screen pulls
// the current persona on each request to the LLM; Profile edits flow through
// the same setter so the next recommendation reflects the change.

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Persona } from '../types';
import {
  clearPersona as clearPersonaStorage,
  getPersona,
  setPersona as writePersona,
} from '../utils/personaStorage';

interface PersonaContextValue {
  persona: Persona | null;
  loading: boolean;
  setPersona: (next: Persona) => Promise<void>;
  clearPersona: () => Promise<void>;
}

const PersonaContext = createContext<PersonaContextValue | null>(null);

export function PersonaProvider({ children }: { children: React.ReactNode }) {
  const [persona, setPersonaState] = useState<Persona | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await getPersona();
      if (!cancelled) {
        setPersonaState(stored);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setPersona = useCallback(async (next: Persona) => {
    setPersonaState(next);
    await writePersona(next);
  }, []);

  const clearPersona = useCallback(async () => {
    setPersonaState(null);
    await clearPersonaStorage();
  }, []);

  return (
    <PersonaContext.Provider value={{ persona, loading, setPersona, clearPersona }}>
      {children}
    </PersonaContext.Provider>
  );
}

export function usePersona(): PersonaContextValue {
  const ctx = useContext(PersonaContext);
  if (!ctx) throw new Error('usePersona must be used inside <PersonaProvider>');
  return ctx;
}
