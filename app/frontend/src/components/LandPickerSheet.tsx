// Bottom sheet behind Discover's "By Land" chip — pick one land to filter to.
// Row styling mirrors DailyParkSheet. Fixed-height Sheets render children
// raw, so the list must be a gorhom scroll primitive to scroll (see Sheet.tsx).

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Check } from 'lucide-react-native';
import { colors } from '../theme/tokens';
import { Sheet } from './Sheet';

export interface LandOption {
  land: string;
  /** Park display name — shown only when lands from both parks are listed. */
  park: string;
}

interface Props {
  visible: boolean;
  lands: LandOption[];
  selected: string | null;
  showPark: boolean;
  onSelect: (land: string) => void;
  onClose: () => void;
}

export function LandPickerSheet({ visible, lands, selected, showPark, onSelect, onClose }: Props): React.ReactElement {
  return (
    <Sheet isOpen={visible} onClose={onClose} title="Pick a land" size="tall" testID="land-picker">
      <BottomSheetScrollView contentContainerStyle={styles.listContent}>
        {lands.map(opt => {
          const isSelected = opt.land === selected;
          return (
            <Pressable
              key={`${opt.park}:${opt.land}`}
              onPress={() => onSelect(opt.land)}
              style={({ pressed }) => [styles.row, (pressed || isSelected) && styles.rowSelected]}
              testID={`land-option-${opt.land}`}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{opt.land}</Text>
                {showPark ? <Text style={styles.rowSubtitle}>{opt.park}</Text> : null}
              </View>
              {isSelected ? <Check size={18} color={colors.brand} strokeWidth={2.5} /> : null}
            </Pressable>
          );
        })}
      </BottomSheetScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowSelected: {
    backgroundColor: colors.goBg,
    borderColor: colors.brand,
  },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  rowSubtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
});
