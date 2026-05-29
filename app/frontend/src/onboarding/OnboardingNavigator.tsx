// First-launch onboarding flow. 5 screens in a native stack; headers hidden
// (each screen renders its own back arrow + progress dots + bottom button).
// The final screen (AccessibilityNeeds) commits persona to AsyncStorage —
// RootNavigator then re-renders into the main TabNavigator with the
// DailyParkSheet on top (since daily context is still stale).

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { OnboardingDraftProvider } from './OnboardingDraftContext';
import { TripDurationScreen } from './screens/TripDurationScreen';
import { YoungestAgeScreen } from './screens/YoungestAgeScreen';
import { RidePreferencesScreen } from './screens/RidePreferencesScreen';
import { MustDoRidesScreen } from './screens/MustDoRidesScreen';
import { AccessibilityNeedsScreen } from './screens/AccessibilityNeedsScreen';

export type OnboardingStackParamList = {
  TripDuration: undefined;
  YoungestAge: undefined;
  RidePreferences: undefined;
  MustDoRides: undefined;
  AccessibilityNeeds: undefined;
};

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

export function OnboardingNavigator(): React.ReactElement {
  return (
    <OnboardingDraftProvider>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="TripDuration" component={TripDurationScreen} />
        <Stack.Screen name="YoungestAge" component={YoungestAgeScreen} />
        <Stack.Screen name="RidePreferences" component={RidePreferencesScreen} />
        <Stack.Screen name="MustDoRides" component={MustDoRidesScreen} />
        <Stack.Screen name="AccessibilityNeeds" component={AccessibilityNeedsScreen} />
      </Stack.Navigator>
    </OnboardingDraftProvider>
  );
}
