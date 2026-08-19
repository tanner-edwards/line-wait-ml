import React from 'react';
import { Accessibility, Baby, Brain, HeartPulse, LucideIcon } from 'lucide-react-native';
import { AccessibilityNeed } from '../../types';
import { useOnboardingDraft } from '../OnboardingDraftContext';
import { usePersona } from '../../context/PersonaContext';
import { OnboardingScreenShell } from './OnboardingScreenShell';
import { RowButton } from '../../components/RowButton';

export const ACCESSIBILITY_OPTIONS: {
  value: AccessibilityNeed;
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
}[] = [
  { value: 'stroller',    title: 'Stroller',                icon: Baby,          subtitle: "We'll flag rides that need a transfer" },
  { value: 'wheelchair',  title: 'Wheelchair or scooter',    icon: Accessibility, subtitle: 'Mobility-friendly attractions surface first' },
  { value: 'pregnant',    title: 'Pregnant',                 icon: HeartPulse,    subtitle: "We'll avoid hard drops, big spins, and rough thrills" },
  { value: 'sensory',     title: 'Sensory / DAS',            icon: Brain,         subtitle: 'Flag strobes, loud audio, sudden drops' },
  { value: 'none',        title: "Nope, we're all good" },
];

export function AccessibilityNeedsScreen(): React.ReactElement {
  const { draft, setAccessibilityNeeds } = useOnboardingDraft();
  const { setPersona } = usePersona();
  const selected = draft.persona.accessibilityNeeds;

  const toggle = (value: AccessibilityNeed) => {
    const prev = selected;
    const has = prev.includes(value);
    let next: AccessibilityNeed[];

    if (value === 'none') {
      next = has ? [] : ['none'];
    } else if (has) {
      next = prev.filter(v => v !== value);
    } else {
      next = [...prev.filter(v => v !== 'none'), value];
    }

    setAccessibilityNeeds(next);
  };

  // Last screen of onboarding — committing persona is what flips the root
  // navigator over to the main app (then the DailyParkSheet pops up on top).
  const finish = async () => {
    await setPersona(draft.persona);
  };

  return (
    <OnboardingScreenShell
      step={4}
      total={5}
      title="Any accessibility needs?"
      subtitle="Lets us avoid recommendations that won't work for your party."
      bottomLabel={selected.length === 0 ? 'Skip' : 'Continue'}
      onBottomPress={finish}
    >
      {ACCESSIBILITY_OPTIONS.map(opt => (
        <RowButton
          key={opt.value}
          title={opt.title}
          subtitle={opt.subtitle}
          icon={opt.icon}
          selected={selected.includes(opt.value)}
          onPress={() => toggle(opt.value)}
          testID={`accessibility-${opt.value}`}
        />
      ))}
    </OnboardingScreenShell>
  );
}
