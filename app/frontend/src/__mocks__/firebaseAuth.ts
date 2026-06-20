export const getAuth = jest.fn(() => ({ currentUser: null }));
export const onAuthStateChanged = jest.fn((_auth: unknown, cb: (user: null) => void) => {
  cb(null);
  return jest.fn(); // unsubscribe
});
export const signOut = jest.fn(() => Promise.resolve());
export const signInWithCredential = jest.fn(() => Promise.resolve({ user: null }));
export const OAuthProvider = jest.fn().mockImplementation(() => ({
  credential: jest.fn(() => ({})),
}));
