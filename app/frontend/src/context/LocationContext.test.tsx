// Guards App Store guideline 5.1.1(iv). Build 1(6) was rejected because every
// non-granted permission result collapsed into "denied", so a user who had
// never seen the OS dialog was sent to Settings instead. These tests pin the
// distinction between "not asked yet", "declined for good", and "GPS failed".

import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { LocationProvider, useLocation } from './LocationContext';

jest.mock('expo-location', () => ({
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  Accuracy: { High: 4 },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
}));

jest.mock('./DebugModeContext', () => ({
  useDebugMode: () => ({ debugMode: false, loading: false, setDebugMode: jest.fn() }),
}));

const mockGet = Location.getForegroundPermissionsAsync as jest.Mock;
const mockRequest = Location.requestForegroundPermissionsAsync as jest.Mock;
const mockWatch = Location.watchPositionAsync as jest.Mock;

function permission(status: string, canAskAgain: boolean) {
  return { status, canAskAgain, granted: status === 'granted', expires: 'never' };
}

const DISNEYLAND = { latitude: 33.8121, longitude: -117.919 };

function Probe(): React.ReactElement {
  const { status, requestPermission } = useLocation();
  return (
    <>
      <Text>{status}</Text>
      <Text testID="ask" onPress={requestPermission}>
        ask
      </Text>
    </>
  );
}

function renderProvider() {
  return render(
    <LocationProvider>
      <Probe />
    </LocationProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWatch.mockResolvedValue({ remove: jest.fn() });
});

describe('permission state on mount', () => {
  it('maps "never asked" to needs-permission, not denied', async () => {
    mockGet.mockResolvedValue(permission('undetermined', true));
    renderProvider();
    expect(await screen.findByText('needs-permission')).toBeTruthy();
  });

  it('never triggers the OS dialog on mount', async () => {
    mockGet.mockResolvedValue(permission('undetermined', true));
    renderProvider();
    await screen.findByText('needs-permission');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('maps a permanent decline to denied', async () => {
    mockGet.mockResolvedValue(permission('denied', false));
    renderProvider();
    expect(await screen.findByText('denied')).toBeTruthy();
  });

  it('maps a re-askable decline to needs-permission', async () => {
    mockGet.mockResolvedValue(permission('denied', true));
    renderProvider();
    expect(await screen.findByText('needs-permission')).toBeTruthy();
  });
});

describe('requestPermission', () => {
  it('shows the OS dialog and starts locating once granted', async () => {
    mockGet.mockResolvedValue(permission('undetermined', true));
    mockRequest.mockResolvedValue(permission('granted', false));
    renderProvider();
    await screen.findByText('needs-permission');

    fireEvent.press(screen.getByTestId('ask'));

    expect(await screen.findByText('locating')).toBeTruthy();
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('stays on needs-permission when the dialog is dropped by iOS', async () => {
    mockGet.mockResolvedValue(permission('undetermined', true));
    mockRequest.mockResolvedValue(permission('undetermined', true));
    renderProvider();
    await screen.findByText('needs-permission');

    fireEvent.press(screen.getByTestId('ask'));

    await screen.findByText('needs-permission');
    expect(screen.queryByText('denied')).toBeNull();
  });

  it('routes to denied only once iOS refuses to prompt again', async () => {
    mockGet.mockResolvedValue(permission('undetermined', true));
    mockRequest.mockResolvedValue(permission('denied', false));
    renderProvider();
    await screen.findByText('needs-permission');

    fireEvent.press(screen.getByTestId('ask'));

    expect(await screen.findByText('denied')).toBeTruthy();
  });
});

describe('GPS outcome once permission is granted', () => {
  it('reports ready on an in-park fix', async () => {
    mockGet.mockResolvedValue(permission('granted', false));
    mockWatch.mockImplementation(async (_opts, cb) => {
      cb({ coords: DISNEYLAND });
      return { remove: jest.fn() };
    });
    renderProvider();
    expect(await screen.findByText('ready')).toBeTruthy();
  });

  it('reports gps-error, not denied, when the watch fails', async () => {
    mockGet.mockResolvedValue(permission('granted', false));
    mockWatch.mockRejectedValue(new Error('no fix'));
    renderProvider();
    expect(await screen.findByText('gps-error')).toBeTruthy();
  });
});
