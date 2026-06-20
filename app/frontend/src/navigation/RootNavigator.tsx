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
import { SignInScreen } from '../screens/SignInScreen';
import { OnboardingNavigator } from '../onboarding/OnboardingNavigator';
import { DailyParkSheet } from '../components/DailyParkSheet';
import { AppNavigator } from './AppNavigator';

export function RootNavigator(): React.ReactElement {
  const { user, loading: authLoading } = useAuth();
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

  if (persona === null) {
    return <OnboardingNavigator />;
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
