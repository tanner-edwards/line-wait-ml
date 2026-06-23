// Firebase client-side initialization for Club 32.
//
// Config values come from EXPO_PUBLIC_FIREBASE_* env vars — add them to
// .env.local from Firebase Console → Project Settings → Your apps → Web app.
//
// Metro resolves firebase/auth to the React Native bundle at runtime, which
// exports getReactNativePersistence. TypeScript uses the browser type
// definitions and can't see it, so we pull it via require() to sidestep the
// type gap while still getting the correct runtime module.

import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { initializeAuth, getAuth, Auth } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey:            process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain:        process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? 'llm-wait-times.firebaseapp.com',
  projectId:         process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? 'llm-wait-times',
  storageBucket:     process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? 'llm-wait-times.appspot.com',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId:             process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
};

let app: FirebaseApp;
let auth: Auth;

if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
  try {
    // getReactNativePersistence is exported by the RN bundle Metro resolves at
    // runtime but absent from the browser type declarations TypeScript reads.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getReactNativePersistence } = require('firebase/auth') as {
      getReactNativePersistence: (storage: typeof AsyncStorage) => unknown;
    };
    auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    // Fallback for web/test environments where getReactNativePersistence
    // isn't available — getAuth() uses in-memory persistence there.
    auth = getAuth(app);
  }
} else {
  app = getApps()[0]!;
  auth = getAuth(app);
}

export { auth };
export default app;
