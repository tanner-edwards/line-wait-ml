// Full-width row button used across onboarding screens. Tap target is the
// entire row. Title + optional subtitle stack vertically; selected state
// flips the colors and shows a checkmark.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface Props {
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}

export function RowButton({ title, subtitle, selected, onPress, testID }: Props): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        selected && styles.rowSelected,
        pressed && styles.rowPressed,
      ]}
      testID={testID}
    >
      <View style={styles.text}>
        <Text style={[styles.title, selected && styles.titleSelected]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.subtitle, selected && styles.subtitleSelected]}>{subtitle}</Text>
        ) : null}
      </View>
      <Text style={[styles.check, selected && styles.checkSelected]}>{selected ? '✓' : ''}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#e0e0e0',
    backgroundColor: '#fff',
    minHeight: 56,
  },
  rowSelected: {
    borderColor: '#6b6bf5',
    backgroundColor: '#f4f4ff',
  },
  rowPressed: {
    opacity: 0.7,
  },
  text: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#222',
  },
  titleSelected: {
    color: '#3a3ad6',
  },
  subtitle: {
    fontSize: 13,
    color: '#777',
    marginTop: 4,
    lineHeight: 18,
  },
  subtitleSelected: {
    color: '#6b6bf5',
  },
  check: {
    width: 24,
    textAlign: 'right',
    fontSize: 20,
    color: 'transparent',
    fontWeight: '700',
  },
  checkSelected: {
    color: '#6b6bf5',
  },
});
