// Top-level decision tree for which navigator to render:
//   • Persona OR daily-context still loading → tiny splash
//   • Persona is null (first launch) → full onboarding flow
//   • Persona set → main 3-tab app, with DailyParkSheet overlaid if daily
//     context is stale (new calendar day)

import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { usePersona } from '../context/PersonaContext';
import { useDailyContext } from '../context/DailyContextContext';
import { OnboardingNavigator } from '../onboarding/OnboardingNavigator';
import { DailyParkSheet } from '../components/DailyParkSheet';
import { AppNavigator } from './AppNavigator';

export function RootNavigator(): React.ReactElement {
  const { persona, loading: personaLoading } = usePersona();
  const { isStale: dailyIsStale, loading: dailyLoading } = useDailyContext();

  if (personaLoading || dailyLoading) {
    return (
      <View style={styles.splash} testID="root-splash">
        <ActivityIndicator size="large" color="#6b6bf5" />
      </View>
    );
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
