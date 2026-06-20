// Jest mock for src/firebase.ts — returns a stub Auth object so tests that
// import from contexts backed by Firebase don't need a real Firebase config.

import type { Auth } from 'firebase/auth';

export const auth = { currentUser: null } as unknown as Auth;
export default {};
