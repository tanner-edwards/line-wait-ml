import React from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RideCategory } from '../../types';
import { useOnboardingDraft } from '../OnboardingDraftContext';
import { OnboardingScreenShell } from './OnboardingScreenShell';
import { RowButton } from '../../components/RowButton';
import { OnboardingStackParamList } from '../OnboardingNavigator';

export const RIDE_CATEGORY_OPTIONS: {
  value: RideCategory;
  title: string;
  subtitle: string;
}[] = [
  {
    value: 'thrills',
    title: '🎢 Thrills',
    subtitle: 'Space Mountain, Big Thunder, Matterhorn, Guardians',
  },
  {
    value: 'classics',
    title: '🏰 Classics',
    subtitle: 'Pirates, Haunted Mansion, Jungle Cruise, Indiana Jones',
  },
  {
    value: 'immersive',
    title: '🌌 Immersive',
    subtitle: 'Rise of the Resistance, Web Slingers, Smugglers Run',
  },
  {
    value: 'kid-favorites',
    title: '👶 Kid favorites',
    subtitle: 'Dumbo, Casey Jr., Little Mermaid, King Arthur Carousel',
  },
  {
    value: 'shows-characters',
    title: '💃 Shows & characters',
    subtitle: 'Fantasmic!, parades, World of Color, character meets',
  },
  {
    value: 'first-time',
    title: '✨ First time',
    subtitle: 'Show me everything iconic',
  },
];

export function RidePreferencesScreen(): React.ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<OnboardingStackParamList, 'RidePreferences'>>();
  const { draft, setRidePreferences } = useOnboardingDraft();
  const selected = draft.persona.ridePreferences;

  const toggle = (value: RideCategory) => {
    const set = new Set(selected);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    setRidePreferences(Array.from(set));
  };

  const advance = () => nav.navigate('MustDoRides');

  return (
    <OnboardingScreenShell
      step={2}
      total={5}
      title="What kind of rides do you love?"
      subtitle="Pick as many as fit. We'll weight rankings accordingly."
      bottomLabel={selected.length === 0 ? 'Skip' : 'Continue'}
      onBottomPress={advance}
    >
      {RIDE_CATEGORY_OPTIONS.map(opt => (
        <RowButton
          key={opt.value}
          title={opt.title}
          subtitle={opt.subtitle}
          selected={selected.includes(opt.value)}
          onPress={() => toggle(opt.value)}
          testID={`ride-pref-${opt.value}`}
        />
      ))}
    </OnboardingScreenShell>
  );
}
