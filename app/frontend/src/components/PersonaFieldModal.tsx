// Bottom-sheet modal for editing a single persona field. Reuses the same
// RowButton widgets the onboarding screens use so the editing experience is
// consistent with intake. Save commits to PersonaContext; Cancel discards
// and dismisses.

import React, { useEffect, useState } from 'react';
import {
  Modal,
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

export function PersonaFieldModal({ field, onClose }: Props): React.ReactElement | null {
  const { persona, setPersona } = usePersona();
  const visible = field !== null && persona !== null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Tap the gray area above the card to dismiss. The card itself
            stops the touch so taps inside don't propagate to this. */}
        <Pressable style={styles.dismissArea} onPress={onClose} testID="persona-modal-backdrop" />
        <View style={styles.card}>
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
        </View>
      </View>
    </Modal>
  );
}

interface EditorProps {
  field: PersonaField;
  persona: Persona;
  onSave: (next: Persona) => Promise<void>;
  onCancel: () => void;
}

const TITLES: Record<PersonaField, string> = {
  tripDuration: 'How long is your visit?',
  youngestAge: 'Youngest in your group?',
  ridePreferences: 'What rides do you love?',
  mustDoRideIds: 'Must-do rides',
  accessibilityNeeds: 'Accessibility needs',
};

function FieldEditor({ field, persona, onSave, onCancel }: EditorProps) {
  const [draft, setDraft] = useState<Persona>(persona);
  useEffect(() => { setDraft(persona); }, [field, persona]);

  return (
    <>
      <View style={styles.headerRow}>
        <View style={styles.grabber} />
        <Pressable onPress={onCancel} style={styles.closeButton} testID="persona-modal-close">
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{TITLES[field]}</Text>
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
          <Text style={styles.modalSectionHeader}>Your picks ({pickedRides.length})</Text>
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
      <Text style={styles.modalSectionHeader}>
        {q ? 'Matches' : pickedRides.length > 0 ? 'More to add' : 'All rides'}
      </Text>
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
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)', // TODO: tokenize
    justifyContent: 'flex-end',
  },
  dismissArea: {
    flex: 1,
  },
  card: {
    backgroundColor: '#fff', // TODO: tokenize
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    maxHeight: '90%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ddd', // TODO: tokenize
    marginLeft: 'auto',
    marginRight: 'auto',
  },
  closeButton: {
    position: 'absolute',
    right: 0,
    top: -4,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 20,
    color: colors.textTertiary,
    fontWeight: '500',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
    color: '#111', // TODO: tokenize
  },
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
    borderTopColor: '#eee', // TODO: tokenize
  },
  cancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cancelText: {
    color: '#666', // TODO: tokenize
    fontSize: 15,
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: '#6b6bf5', // TODO: tokenize
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  saveText: {
    color: '#fff', // TODO: tokenize
    fontSize: 15,
    fontWeight: '600',
  },
  searchWrap: {
    marginBottom: 12,
  },
  modalSectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 4,
  },
  modalDivider: {
    height: 1,
    backgroundColor: '#eee', // TODO: tokenize
    marginVertical: 12,
  },
});
