import { _resetForTests, getFirestore, initFirebase } from './firestoreClient';

jest.mock('firebase-admin', () => {
  const initializeApp = jest.fn();
  const cert = jest.fn().mockReturnValue('mock-credential');
  const firestore = jest.fn().mockReturnValue({ collection: jest.fn() });
  const fakeApp = {
    firestore,
    delete: jest.fn().mockResolvedValue(undefined),
  };
  initializeApp.mockReturnValue(fakeApp);
  return {
    initializeApp,
    credential: { cert },
    firestore,
  };
});

const adminMock = jest.requireMock('firebase-admin') as {
  initializeApp: jest.Mock;
  credential: { cert: jest.Mock };
};

const validJson = JSON.stringify({
  project_id: 'fake-project',
  client_email: 'fake@example.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n',
});

beforeEach(() => {
  _resetForTests();
  jest.clearAllMocks();
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
});

describe('initFirebase', () => {
  it('throws a helpful error when FIREBASE_SERVICE_ACCOUNT_JSON is missing', () => {
    expect(() => initFirebase()).toThrow(/FIREBASE_SERVICE_ACCOUNT_JSON env var is not set/);
  });

  it('throws when FIREBASE_SERVICE_ACCOUNT_JSON is neither JSON nor base64-encoded JSON', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = 'definitely-not-anything-meaningful-!!@#$%';
    expect(() => initFirebase()).toThrow(/neither valid JSON nor valid base64-encoded JSON/);
  });

  it('accepts a base64-encoded service account JSON', () => {
    const b64 = Buffer.from(validJson, 'utf-8').toString('base64');
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = b64;

    initFirebase();

    expect(adminMock.credential.cert).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: 'fake-project' })
    );
  });

  it('initializes firebase-admin exactly once across multiple calls (singleton)', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = validJson;

    initFirebase();
    initFirebase();
    initFirebase();

    expect(adminMock.initializeApp).toHaveBeenCalledTimes(1);
    expect(adminMock.credential.cert).toHaveBeenCalledTimes(1);
  });

  it('passes the parsed service account into credential.cert', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = validJson;

    initFirebase();

    expect(adminMock.credential.cert).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: 'fake-project' })
    );
  });
});

describe('getFirestore', () => {
  it('returns a Firestore instance from the singleton app', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = validJson;
    const fs = getFirestore();
    expect(fs).toBeDefined();
    expect(adminMock.initializeApp).toHaveBeenCalledTimes(1);
  });
});
