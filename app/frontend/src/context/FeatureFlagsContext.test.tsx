// Flags fail closed: everything is off until the backend says otherwise, and
// stays off if the fetch fails.

import React from 'react';
import { Text } from 'react-native';
import { render, screen, waitFor } from '@testing-library/react-native';
import { fetchFeatureFlags } from '../api';
import { FeatureFlagsProvider, useFeatureFlags } from './FeatureFlagsContext';

jest.mock('../api', () => ({ fetchFeatureFlags: jest.fn() }));
const mockFetch = fetchFeatureFlags as jest.Mock;

function Probe(): React.ReactElement {
  const { freeTrip } = useFeatureFlags();
  return <Text>{freeTrip ? 'on' : 'off'}</Text>;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

it('starts off, then reflects the server value', async () => {
  let resolve: (v: { freeTrip: boolean }) => void = () => undefined;
  mockFetch.mockReturnValue(new Promise(r => { resolve = r; }));
  render(<FeatureFlagsProvider><Probe /></FeatureFlagsProvider>);
  expect(screen.getByText('off')).toBeTruthy();

  resolve({ freeTrip: true });
  await waitFor(() => expect(screen.getByText('on')).toBeTruthy());
});

it('stays off when the fetch fails', async () => {
  mockFetch.mockRejectedValue(new Error('404'));
  render(<FeatureFlagsProvider><Probe /></FeatureFlagsProvider>);
  await waitFor(() => expect(mockFetch).toHaveBeenCalled());
  expect(screen.getByText('off')).toBeTruthy();
});
