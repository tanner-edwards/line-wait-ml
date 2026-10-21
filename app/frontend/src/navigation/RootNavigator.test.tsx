// The free-trip claim screen is gated by the server-side freeTrip flag.

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { RootNavigator } from './RootNavigator';

let mockFreeTrip = false;

jest.mock('../context/FeatureFlagsContext', () => ({
  useFeatureFlags: () => ({ freeTrip: mockFreeTrip }),
}));
jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { isAnonymous: false },
    userRecord: { freeTripClaimed: false, bypass: false },
    loading: false,
  }),
}));
jest.mock('../context/PersonaContext', () => ({
  usePersona: () => ({ persona: 'coaster-commando', loading: false }),
}));
jest.mock('../context/DailyContextContext', () => ({
  useDailyContext: () => ({ isStale: false, loading: false }),
}));
jest.mock('../context/TripContext', () => ({
  useTrip: () => ({ hasActiveTrip: false, loading: false }),
}));
jest.mock('../screens/ClaimFreeTripScreen', () => {
  const { Text: MockText } = require('react-native');
  return { ClaimFreeTripScreen: () => <MockText>claim-screen</MockText> };
});
jest.mock('./AppNavigator', () => {
  const { Text: MockText } = require('react-native');
  return { AppNavigator: () => <MockText>main-app</MockText> };
});
jest.mock('../components/DailyParkSheet', () => ({ DailyParkSheet: () => null }));
jest.mock('../components/FirstLaunchPrompts', () => ({ FirstLaunchPrompts: () => null }));
jest.mock('../screens/SignInScreen', () => ({ SignInScreen: () => null }));
jest.mock('../onboarding/OnboardingNavigator', () => ({ OnboardingNavigator: () => null }));

it('shows the claim screen when freeTrip is on', () => {
  mockFreeTrip = true;
  render(<RootNavigator />);
  expect(screen.getByText('claim-screen')).toBeTruthy();
});

it('skips straight to the app when freeTrip is off', () => {
  mockFreeTrip = false;
  render(<RootNavigator />);
  expect(screen.queryByText('claim-screen')).toBeNull();
  expect(screen.getByText('main-app')).toBeTruthy();
});
