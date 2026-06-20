// AuthContext — wraps Firebase onAuthStateChanged and exposes the current user,
// a getIdToken() helper for auth headers, and sign-out.
//
// After a successful sign-in the context calls POST /v1/users to create/sync
// the Firestore user record and caches the response so TripContext can read
// bypass + freeTripClaimed without an extra fetch.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { User, onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth';
import { auth } from '../firebase';
import { createOrFetchUser } from '../api';
import { UserResponse } from '../types';

interface AuthContextValue {
  user: User | null;
  userRecord: UserResponse | null;
  loading: boolean;
  getIdToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
  refetchUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  userRecord: null,
  loading: true,
  getIdToken: async () => null,
  signOut: async () => undefined,
  refetchUser: async () => undefined,
});

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [user, setUser] = useState<User | null>(null);
  const [userRecord, setUserRecord] = useState<UserResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const getIdToken = useCallback(async (): Promise<string | null> => {
    if (!user) return null;
    try {
      return await user.getIdToken();
    } catch {
      return null;
    }
  }, [user]);

  const syncUserRecord = useCallback(async (firebaseUser: User) => {
    try {
      const token = await firebaseUser.getIdToken();
      const record = await createOrFetchUser(token, {
        appleId: firebaseUser.uid,
        email: firebaseUser.email ?? null,
      });
      setUserRecord(record);
    } catch (err) {
      console.warn('[AuthContext] user sync failed:', err);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        await syncUserRecord(firebaseUser);
      } else {
        setUserRecord(null);
      }
      setLoading(false);
    });
    return unsub;
  }, [syncUserRecord]);

  const signOut = useCallback(async () => {
    await fbSignOut(auth);
    setUserRecord(null);
  }, []);

  const refetchUser = useCallback(async () => {
    if (!user) return;
    await syncUserRecord(user);
  }, [user, syncUserRecord]);

  return (
    <AuthContext.Provider value={{ user, userRecord, loading, getIdToken, signOut, refetchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
