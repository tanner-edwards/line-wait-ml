import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SortBy } from '../grouping';
import { colors } from '../theme/tokens';

interface SortMenuProps {
  visible: boolean;
  current: SortBy | null;
  distanceAvailable: boolean;
  onSelect: (sort: SortBy | null) => void;
  onClose: () => void;
}

const OPTIONS: { label: string; value: SortBy | null; hint?: string }[] = [
  { label: 'Opportunity',          value: 'opportunity' },
  { label: 'A–Z by land',          value: null },
  { label: 'Badge only',           value: 'badge' },
  { label: 'Shortest wait',        value: 'wait' },
  { label: 'Most popular',         value: 'demand' },
  { label: 'Distance from here',   value: 'distance' },
];

export function SortMenu({ visible, current, distanceAvailable, onSelect, onClose }: SortMenuProps) {
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.menu} onPress={() => { /* swallow taps inside menu */ }}>
          {OPTIONS.map(opt => {
            const isDistance = opt.value === 'distance';
            const disabled = isDistance && !distanceAvailable;
            const active = current === opt.value;
            return (
              <Pressable
                key={opt.value ?? 'default'}
                style={({ pressed }) => [
                  styles.option,
                  pressed && !disabled && styles.optionPressed,
                ]}
                onPress={() => {
                  if (!disabled) {
                    onSelect(opt.value);
                    onClose();
                  }
                }}
              >
                <View style={styles.optionRow}>
                  <Text style={[styles.optionText, disabled && styles.optionTextDisabled]}>
                    {opt.label}
                  </Text>
                  {active && <Text style={styles.checkmark}>✓</Text>}
                </View>
                {isDistance && !distanceAvailable && (
                  <Text style={styles.hint}>pick a location in Recommendations first</Text>
                )}
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.2)', // TODO: tokenize
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
  },
  menu: {
    marginTop: 56,
    marginRight: 12,
    backgroundColor: '#fff', // TODO: tokenize
    borderRadius: 10,
    shadowColor: '#000', // TODO: tokenize
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
    minWidth: 220,
    overflow: 'hidden',
  },
  option: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee', // TODO: tokenize
  },
  optionPressed: {
    backgroundColor: '#f5f5f5', // TODO: tokenize
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionText: {
    fontSize: 15,
    color: '#222', // TODO: tokenize
  },
  optionTextDisabled: {
    color: '#bbb', // TODO: tokenize
  },
  checkmark: {
    fontSize: 15,
    color: colors.brand,
    fontWeight: '700',
  },
  hint: {
    fontSize: 11,
    color: '#bbb', // TODO: tokenize
    marginTop: 2,
  },
});
