// Bottom-sheet for editing a single persona field. Reuses the same RowButton
// widgets the onboarding screens use so the editing experience is consistent
// with intake. Save commits to PersonaContext; Cancel discards and dismisses.

import React, { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  AccessibilityNeed,
  Persona,
  Ride,
  RideCategory,
  TripDuration,
} from '../types';
import { colors } from '../theme/tokens';
import { usePersona } from '../context/PersonaContext';
import { useRides } from '../context/RideContext';
import { RowButton } from './RowButton';
import { SearchField } from './SearchField';
import { RIDE_CATEGORY_OPTIONS } from '../onboarding/screens/RidePreferencesScreen';
import { ACCESSIBILITY_OPTIONS } from '../onboarding/screens/AccessibilityNeedsScreen';
import { Sheet } from './Sheet';
import { SectionHeader } from './SectionHeader';

const TRIP_DURATION_OPTIONS: { value: TripDuration; title: string; subtitle?: string }[] = [
  { value: '1-day',       title: '1 day' },
  { value: '2-days',      title: '2 days' },
  { value: '3-4-days',    title: '3–4 days' },
  { value: '5-plus-days', title: '5+ days' },
];

const AGE_OPTIONS: { value: number; title: string; subtitle: string }[] = [
  { value: 2,  title: 'Toddler (under 3)',  subtitle: 'Lots of breaks, height limits on most thrills' },
  { value: 5,  title: 'Young kid (3–6)',    subtitle: 'Many thrills off-limits, classic dark rides shine' },
  { value: 10, title: 'Older kid (7–12)',   subtitle: 'Most attractions open up' },
  { value: 15, title: 'Teen (13–17)',       subtitle: 'Everything is in play' },
  { value: 18, title: 'All adults (18+)',   subtitle: 'No height restrictions to worry about' },
];

export type PersonaField =
  | 'tripDuration'
  | 'youngestAge'
  | 'ridePreferences'
  | 'mustDoRideIds'
  | 'accessibilityNeeds';

interface Props {
  field: PersonaField | null;
  onClose: () => void;
}

const TITLES: Record<PersonaField, string> = {
  tripDuration: 'How long is your visit?',
  youngestAge: 'Youngest in your group?',
  ridePreferences: 'What rides do you love?',
  mustDoRideIds: 'Must-do rides',
  accessibilityNeeds: 'Accessibility needs',
};

export function PersonaFieldModal({ field, onClose }: Props): React.ReactElement | null {
  const { persona, setPersona } = usePersona();
  const visible = field !== null && persona !== null;

  return (
    <Sheet
      isOpen={visible}
      onClose={onClose}
      title={field ? TITLES[field] : ''}
      testID="persona-modal"
    >
      {field && persona && (
        <FieldEditor
          field={field}
          persona={persona}
          onSave={async next => {
            await setPersona(next);
            onClose();
          }}
          onCancel={onClose}
        />
      )}
    </Sheet>
  );
}

interface EditorProps {
  field: PersonaField;
  persona: Persona;
  onSave: (next: Persona) => Promise<void>;
  onCancel: () => void;
}

function FieldEditor({ field, persona, onSave, onCancel }: EditorProps) {
  const [draft, setDraft] = useState<Persona>(persona);
  useEffect(() => { setDraft(persona); }, [field, persona]);

  return (
    <>
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {renderField(field, draft, setDraft)}
      </ScrollView>
      <View style={styles.footer}>
        <Pressable onPress={onCancel} style={styles.cancelButton} testID="persona-modal-cancel">
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() => void onSave(draft)}
          style={styles.saveButton}
          testID="persona-modal-save"
        >
          <Text style={styles.saveText}>Save</Text>
        </Pressable>
      </View>
    </>
  );
}

function renderField(
  field: PersonaField,
  draft: Persona,
  setDraft: React.Dispatch<React.SetStateAction<Persona>>
): React.ReactElement {
  switch (field) {
    case 'tripDuration':
      return (
        <>
          {TRIP_DURATION_OPTIONS.map(opt => (
            <RowButton
              key={opt.value}
              title={opt.title}
              subtitle={opt.subtitle}
              selected={draft.tripDuration === opt.value}
              onPress={() => setDraft(d => ({ ...d, tripDuration: opt.value }))}
            />
          ))}
        </>
      );
    case 'youngestAge':
      return (
        <>
          {AGE_OPTIONS.map(opt => (
            <RowButton
              key={opt.value}
              title={opt.title}
              subtitle={opt.subtitle}
              selected={draft.youngestAge === opt.value}
              onPress={() => setDraft(d => ({ ...d, youngestAge: opt.value }))}
            />
          ))}
        </>
      );
    case 'ridePreferences':
      return (
        <>
          {RIDE_CATEGORY_OPTIONS.map(opt => {
            const selected = draft.ridePreferences.includes(opt.value);
            return (
              <RowButton
                key={opt.value}
                title={opt.title}
                subtitle={opt.subtitle}
                selected={selected}
                onPress={() =>
                  setDraft(d => {
                    const set = new Set(d.ridePreferences);
                    if (set.has(opt.value)) set.delete(opt.value);
                    else set.add(opt.value);
                    return { ...d, ridePreferences: Array.from(set) as RideCategory[] };
                  })
                }
              />
            );
          })}
        </>
      );
    case 'mustDoRideIds':
      return <MustDoField draft={draft} setDraft={setDraft} />;
    case 'accessibilityNeeds':
      return (
        <>
          {ACCESSIBILITY_OPTIONS.map(opt => {
            const prev = draft.accessibilityNeeds;
            const has = prev.includes(opt.value);
            const handle = () => {
              setDraft(d => {
                const cur = d.accessibilityNeeds;
                const hasCur = cur.includes(opt.value);
                let next: AccessibilityNeed[];
                if (opt.value === 'none') {
                  next = hasCur ? [] : ['none'];
                } else if (hasCur) {
                  next = cur.filter(v => v !== opt.value);
                } else {
                  next = [...cur.filter(v => v !== 'none'), opt.value];
                }
                return { ...d, accessibilityNeeds: next };
              });
            };
            return (
              <RowButton
                key={opt.value}
                title={opt.title}
                subtitle={opt.subtitle}
                selected={has}
                onPress={handle}
              />
            );
          })}
        </>
      );
  }
}

function MustDoField({
  draft,
  setDraft,
}: {
  draft: Persona;
  setDraft: React.Dispatch<React.SetStateAction<Persona>>;
}): React.ReactElement {
  const { data } = useRides();
  const [query, setQuery] = useState('');
  const rides: Ride[] = data ? data.parks.flatMap(p => ('rides' in p ? p.rides : [])) : [];
  const selectedIds = draft.mustDoRideIds;

  const pickedRides = selectedIds
    .map(id => rides.find(r => r.id === id))
    .filter((r): r is Ride => r !== undefined);

  const q = query.trim().toLowerCase();
  const candidatePool = rides.filter(r => !selectedIds.includes(r.id));
  const suggested = q
    ? candidatePool
        .filter(r => r.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [...candidatePool].sort((a, b) => a.name.localeCompare(b.name));

  const toggle = (id: string) => {
    setDraft(d => {
      const set = new Set(d.mustDoRideIds);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...d, mustDoRideIds: Array.from(set) };
    });
  };

  return (
    <>
      <View style={styles.searchWrap}>
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder="🔍  Search rides…"
        />
      </View>
      {pickedRides.length > 0 && (
        <>
          <SectionHeader title={`Your picks (${pickedRides.length})`} />
          {pickedRides.map(ride => (
            <RowButton
              key={ride.id}
              title={ride.name}
              selected
              onPress={() => toggle(ride.id)}
            />
          ))}
          <View style={styles.modalDivider} />
        </>
      )}
      <SectionHeader title={q ? 'Matches' : pickedRides.length > 0 ? 'More to add' : 'All rides'} />
      {suggested.map(ride => (
        <RowButton
          key={ride.id}
          title={ride.name}
          selected={false}
          onPress={() => toggle(ride.id)}
        />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  body: {
    maxHeight: '70%',
  },
  bodyContent: {
    paddingBottom: 12,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cancelText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: colors.brand,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  saveText: {
    color: colors.textInverse,
    fontSize: 15,
    fontWeight: '600',
  },
  searchWrap: {
    marginBottom: 12,
  },
  modalDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 12,
  },
});
