// Top-level decision tree for which navigator to render:
//   • Auth OR persona/daily context still loading → splash
//   • No Firebase user → SignInScreen
//   • User authenticated + persona null → onboarding
//   • User authenticated + persona set → main 3-tab app

import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { colors } from '../theme/tokens';
import { useAuth } from '../context/AuthContext';
import { usePersona } from '../context/PersonaContext';
import { useDailyContext } from '../context/DailyContextContext';
import { useTrip } from '../context/TripContext';
import { ClaimFreeTripScreen } from '../screens/ClaimFreeTripScreen';
import { SignInScreen } from '../screens/SignInScreen';
import { OnboardingNavigator } from '../onboarding/OnboardingNavigator';
import { DailyParkSheet } from '../components/DailyParkSheet';
import { FirstLaunchPrompts } from '../components/FirstLaunchPrompts';
import { AppNavigator } from './AppNavigator';

export function RootNavigator(): React.ReactElement {
  const [skippedFreeTrip, setSkippedFreeTrip] = useState(false);
  const { user, userRecord, loading: authLoading } = useAuth();
  const { persona, loading: personaLoading } = usePersona();
  const { isStale: dailyIsStale, loading: dailyLoading } = useDailyContext();
  const { hasActiveTrip, loading: tripLoading } = useTrip();

  if (authLoading || personaLoading || dailyLoading || tripLoading) {
    return (
      <View style={styles.splash} testID="root-splash">
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  if (user === null) {
    return <SignInScreen />;
  }

  // Anonymous users always need onboarding too (e.g. beta testers using the
  // PWA with no account) — persona has to come from somewhere. The only
  // exception is local dev builds, where skipping it again on every fresh
  // anonymous web session is a testing convenience; __DEV__ is statically
  // false in production bundles, so this never applies to real users.
  if (!(__DEV__ && user?.isAnonymous) && persona === null) {
    return <OnboardingNavigator />;
  }

  // Free trip gate: shown once after onboarding for users who haven't claimed
  // their free trip yet. Skip if they already have an active trip (e.g. paid IAP).
  if (!user?.isAnonymous && userRecord && !userRecord.freeTripClaimed && !userRecord.bypass && !hasActiveTrip && !skippedFreeTrip) {
    return <ClaimFreeTripScreen onSkip={() => setSkippedFreeTrip(true)} />;
  }

  // First-launch prompts live here rather than at the app root so they can't
  // fire over sign-in, onboarding, or the free-trip gate. The location one
  // ends in an unskippable OS dialog, which has no business interrupting a
  // screen that isn't about location.
  return (
    <>
      <AppNavigator />
      <DailyParkSheet visible={dailyIsStale} />
      <FirstLaunchPrompts />
    </>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
});
