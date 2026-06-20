// Firebase client-side initialization for Club 32.
//
// Config values come from EXPO_PUBLIC_FIREBASE_* env vars — add them to
// .env.local from Firebase Console → Project Settings → Your apps → Web app.
//
// Firebase v12 with Metro (Expo) resolves firebase/auth to the react-native
// bundle at runtime, which uses AsyncStorage for token persistence automatically.
// No explicit persistence setup is needed.

import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';

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
} else {
  app = getApps()[0]!;
}
auth = getAuth(app);

export { auth };
export default app;
