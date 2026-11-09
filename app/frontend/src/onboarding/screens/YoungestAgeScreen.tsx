import React from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useOnboardingDraft } from '../OnboardingDraftContext';
import { OnboardingScreenShell } from './OnboardingScreenShell';
import { RowButton } from '../../components/RowButton';
import { OnboardingStackParamList } from '../OnboardingNavigator';

// Each bracket maps to a representative age. The backend personaToText
// re-categorizes by the same brackets (toddler/young kid/older kid/teen/adult)
// when it builds the LLM persona block.
interface AgeBracket {
  value: number;
  title: string;
  subtitle: string;
}

const BRACKETS: AgeBracket[] = [
  { value: 2,  title: 'Toddler (under 3)',  subtitle: 'Gentle pace, plenty of breaks; rider swap for the big rides' },
  { value: 5,  title: 'Young kid (3–6)',    subtitle: 'Dark rides and shows together; thrills via rider swap' },
  { value: 10, title: 'Older kid (7–12)',   subtitle: 'Nearly everything is open to the whole group' },
  { value: 15, title: 'Teen (13–17)',       subtitle: 'Everything is in play' },
  { value: 18, title: 'All adults (18+)',   subtitle: 'Nothing to plan around' },
];

export function YoungestAgeScreen(): React.ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<OnboardingStackParamList, 'YoungestAge'>>();
  const { draft, setYoungestAge } = useOnboardingDraft();

  const advance = () => nav.navigate('RidePreferences');

  const pick = (value: number) => {
    setYoungestAge(value);
    advance();
  };

  const skip = () => {
    setYoungestAge(null);
    advance();
  };

  return (
    <OnboardingScreenShell
      step={1}
      total={5}
      title="Youngest in your group?"
      subtitle="We plan the pace around them. Everyone else still gets their thrills."
      bottomLabel="Skip"
      onBottomPress={skip}
    >
      {BRACKETS.map(b => (
        <RowButton
          key={b.value}
          title={b.title}
          subtitle={b.subtitle}
          selected={draft.persona.youngestAge === b.value}
          onPress={() => pick(b.value)}
          testID={`youngest-age-${b.value}`}
        />
      ))}
    </OnboardingScreenShell>
  );
}
