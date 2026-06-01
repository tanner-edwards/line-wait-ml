import AsyncStorage from '@react-native-async-storage/async-storage';
import { _resetForTests, getOrCreateDeviceId } from './deviceStorage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

beforeEach(async () => {
  await _resetForTests();
});

describe('getOrCreateDeviceId', () => {
  it('returns a UUID-shaped string on first call', async () => {
    const id = await getOrCreateDeviceId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('persists the id across calls', async () => {
    const a = await getOrCreateDeviceId();
    const b = await getOrCreateDeviceId();
    expect(b).toBe(a);
  });

  it('writes the id into AsyncStorage', async () => {
    const id = await getOrCreateDeviceId();
    const stored = await AsyncStorage.getItem('club32:deviceId');
    expect(stored).toBe(id);
  });

  it('regenerates if AsyncStorage holds a malformed value', async () => {
    await AsyncStorage.setItem('club32:deviceId', 'not-a-uuid');
    const id = await getOrCreateDeviceId();
    expect(id).not.toBe('not-a-uuid');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});
