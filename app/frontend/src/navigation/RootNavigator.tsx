// Top-level decision tree for which navigator to render:
//   • Auth OR persona/daily context still loading → splash
//   • No Firebase user → SignInScreen
//   • User authenticated + persona null → onboarding
//   • User authenticated + persona set → main 3-tab app

import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { usePersona } from '../context/PersonaContext';
import { useDailyContext } from '../context/DailyContextContext';
import { ClaimFreeTripScreen } from '../screens/ClaimFreeTripScreen';
import { SignInScreen } from '../screens/SignInScreen';
import { OnboardingNavigator } from '../onboarding/OnboardingNavigator';
import { DailyParkSheet } from '../components/DailyParkSheet';
import { AppNavigator } from './AppNavigator';

export function RootNavigator(): React.ReactElement {
  const { user, userRecord, loading: authLoading } = useAuth();
  const { persona, loading: personaLoading } = usePersona();
  const { isStale: dailyIsStale, loading: dailyLoading } = useDailyContext();

  if (authLoading || personaLoading || dailyLoading) {
    return (
      <View style={styles.splash} testID="root-splash">
        <ActivityIndicator size="large" color="#6b6bf5" />
      </View>
    );
  }

  if (user === null) {
    return <SignInScreen />;
  }

  // Anonymous users (web dev bypass) skip onboarding and the free trip gate.
  if (!user?.isAnonymous && persona === null) {
    return <OnboardingNavigator />;
  }

  // Free trip gate: shown once after onboarding for users who haven't claimed
  // their free trip yet. Bypass users and anonymous users skip this.
  if (!user?.isAnonymous && userRecord && !userRecord.freeTripClaimed && !userRecord.bypass) {
    return <ClaimFreeTripScreen />;
  }

  return (
    <>
      <AppNavigator />
      <DailyParkSheet visible={dailyIsStale} />
    </>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
});
