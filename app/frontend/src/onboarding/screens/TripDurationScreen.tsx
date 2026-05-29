import React from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { TripDuration } from '../../types';
import { useOnboardingDraft } from '../OnboardingDraftContext';
import { OnboardingScreenShell } from './OnboardingScreenShell';
import { RowButton } from '../../components/RowButton';
import { OnboardingStackParamList } from '../OnboardingNavigator';

const OPTIONS: { value: TripDuration; title: string; subtitle?: string }[] = [
  { value: '1-day',       title: '1 day',     subtitle: 'Make every minute count' },
  { value: '2-days',      title: '2 days',    subtitle: 'Spread out the must-dos' },
  { value: '3-4-days',    title: '3–4 days',  subtitle: 'Relaxed pace, plenty of time' },
  { value: '5-plus-days', title: '5+ days',   subtitle: 'A full Disney week' },
];

export function TripDurationScreen(): React.ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<OnboardingStackParamList, 'TripDuration'>>();
  const { draft, setTripDuration } = useOnboardingDraft();

  const advance = () => nav.navigate('YoungestAge');

  const pick = (value: TripDuration) => {
    setTripDuration(value);
    advance();
  };

  const skip = () => {
    setTripDuration(null);
    advance();
  };

  return (
    <OnboardingScreenShell
      step={0}
      total={5}
      title="How long is your visit?"
      subtitle="Helps us calibrate the pace of our recommendations."
      bottomLabel="Skip"
      onBottomPress={skip}
    >
      {OPTIONS.map(opt => (
        <RowButton
          key={opt.value}
          title={opt.title}
          subtitle={opt.subtitle}
          selected={draft.persona.tripDuration === opt.value}
          onPress={() => pick(opt.value)}
          testID={`trip-duration-${opt.value}`}
        />
      ))}
    </OnboardingScreenShell>
  );
}
