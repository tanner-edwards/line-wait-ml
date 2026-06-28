// Bottom-sheet that asks "Which parks today?" — shown by RootNavigator
// whenever persona is set but daily context is stale (new calendar day).
// When onCancel is not provided the sheet is non-dismissable: there's no
// backdrop tap or close button, and the user must pick a park to proceed.

import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { DailyParks } from '../types';
import { colors } from '../theme/tokens';
import { useDailyContext } from '../context/DailyContextContext';
import { Sheet } from './Sheet';

const OPTIONS: { value: DailyParks; title: string; subtitle?: string }[] = [
  { value: 'disneyland',           title: 'Disneyland',          subtitle: 'Castle, dark rides, the originals' },
  { value: 'california-adventure', title: 'Disney California Adventure', subtitle: 'Cars Land, Pixar Pier, Avengers Campus' },
  { value: 'both',                 title: 'Both (Park Hopper)',  subtitle: 'Bouncing between parks today' },
];

interface Props {
  visible: boolean;
  onSelect?: () => void;
  onCancel?: () => void;
}

export function DailyParkSheet({ visible, onSelect, onCancel }: Props): React.ReactElement {
  const { setDailyParks } = useDailyContext();

  return (
    <Sheet
      isOpen={visible}
      onClose={onCancel ?? (() => {})}
      dismissable={!!onCancel}
      title="Which parks today?"
      testID="daily-park"
    >
      <Text style={styles.subtitle}>
        We'll filter rides and recommendations to where you're spending the day.
      </Text>
      {OPTIONS.map(opt => (
        <Pressable
          key={opt.value}
          onPress={() => { void setDailyParks(opt.value); onSelect?.(); }}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          testID={`daily-park-${opt.value}`}
        >
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{opt.title}</Text>
            {opt.subtitle ? <Text style={styles.rowSubtitle}>{opt.subtitle}</Text> : null}
          </View>
          <Text style={styles.rowChevron}>›</Text>
        </Pressable>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 20,
    lineHeight: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 64,
  },
  rowPressed: {
    backgroundColor: colors.goBg,
    borderColor: colors.brand,
  },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  rowSubtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
  rowChevron: { fontSize: 22, color: colors.textTertiary },
});
