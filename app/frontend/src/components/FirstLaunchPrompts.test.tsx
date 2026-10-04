// The two first-launch prompts each end in a native OS permission dialog, and
// iOS only shows one system alert at a time. These tests pin the ordering so a
// location request can never be raised while the notification alert is up —
// that collision returns UNDETERMINED, which is the failure mode behind the
// guideline 5.1.1(iv) rejection.

import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { FirstLaunchPrompts } from './FirstLaunchPrompts';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const mockEnableNotifications = jest.fn();
const mockRequestPermission = jest.fn();
let mockNotificationsEnabled = false;
let mockLocationStatus = 'needs-permission';

jest.mock('../context/PersonaContext', () => ({
  usePersona: () => ({ persona: 'coaster-commando' }),
}));

jest.mock('../context/DeviceContext', () => ({
  useDevice: () => ({
    notificationsEnabled: mockNotificationsEnabled,
    enableNotifications: mockEnableNotifications,
  }),
}));

jest.mock('../context/LocationContext', () => ({
  useLocation: () => ({
    status: mockLocationStatus,
    requestPermission: mockRequestPermission,
  }),
}));

const NOTIF_TITLE = 'Stay ahead of the crowds';
const LOCATION_TITLE = 'Find rides near you';

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockNotificationsEnabled = false;
  mockLocationStatus = 'needs-permission';
  mockEnableNotifications.mockResolvedValue(undefined);
});

it('shows the notification prompt first and holds location back', async () => {
  render(<FirstLaunchPrompts />);

  expect(await screen.findByText(NOTIF_TITLE)).toBeTruthy();
  expect(screen.queryByText(LOCATION_TITLE)).toBeNull();
});

it('shows location once notifications are dismissed', async () => {
  render(<FirstLaunchPrompts />);
  await screen.findByText(NOTIF_TITLE);

  fireEvent.press(screen.getByTestId('notif-prompt-dismiss'));

  expect(await screen.findByText(LOCATION_TITLE)).toBeTruthy();
});

it('waits for the notification OS dialog to close before showing location', async () => {
  let finishEnable!: () => void;
  mockEnableNotifications.mockImplementation(
    () =>
      new Promise<void>(resolve => {
        finishEnable = resolve;
      })
  );

  render(<FirstLaunchPrompts />);
  await screen.findByText(NOTIF_TITLE);

  fireEvent.press(screen.getByTestId('notif-prompt-enable'));

  // OS notification dialog still up — location must not raise a second alert.
  await waitFor(() => expect(mockEnableNotifications).toHaveBeenCalled());
  expect(screen.queryByText(LOCATION_TITLE)).toBeNull();

  await act(async () => {
    finishEnable();
  });

  expect(await screen.findByText(LOCATION_TITLE)).toBeTruthy();
});

it('skips straight to location when notifications are already on', async () => {
  mockNotificationsEnabled = true;
  render(<FirstLaunchPrompts />);

  expect(await screen.findByText(LOCATION_TITLE)).toBeTruthy();
  expect(screen.queryByText(NOTIF_TITLE)).toBeNull();
});

it('raises the OS dialog rather than deep-linking to Settings', async () => {
  mockNotificationsEnabled = true;
  render(<FirstLaunchPrompts />);
  await screen.findByText(LOCATION_TITLE);

  fireEvent.press(screen.getByTestId('location-prompt-continue'));

  expect(mockRequestPermission).toHaveBeenCalledTimes(1);
});

// Apple rejected build 1(7) for both of these: a button that reads as granting
// access, and an opt-out that skips the permission request entirely.
it('labels the button "Continue" and offers no way to skip the request', async () => {
  mockNotificationsEnabled = true;
  render(<FirstLaunchPrompts />);
  await screen.findByText(LOCATION_TITLE);

  expect(screen.getByText('Continue')).toBeTruthy();
  expect(screen.queryByText('Enable location')).toBeNull();
  expect(screen.queryByText('Not now')).toBeNull();
});

it('does not prompt when iOS will no longer ask', async () => {
  mockNotificationsEnabled = true;
  mockLocationStatus = 'denied';
  render(<FirstLaunchPrompts />);

  await waitFor(() => expect(screen.queryByText(NOTIF_TITLE)).toBeNull());
  expect(screen.queryByText(LOCATION_TITLE)).toBeNull();
});

it('only shows the location prompt once per install', async () => {
  mockNotificationsEnabled = true;
  const first = render(<FirstLaunchPrompts />);
  await screen.findByText(LOCATION_TITLE);
  fireEvent.press(screen.getByTestId('location-prompt-continue'));
  first.unmount();

  render(<FirstLaunchPrompts />);

  await waitFor(() => expect(screen.queryByText(LOCATION_TITLE)).toBeNull());
});
