// Three-segment pill for switching the day's park scope (DLR / DCA / Both).
// Lives in the Home and Recommendations headers. Tapping a segment writes
// through to DailyContext, which the screens consume to filter their data.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DailyParks } from '../types';
import { useDailyContext } from '../context/DailyContextContext';

const SEGMENTS: { value: DailyParks; label: string }[] = [
  { value: 'disneyland', label: 'DLR' },
  { value: 'california-adventure', label: 'DCA' },
  { value: 'both', label: 'Both' },
];

export function ParkTogglePill(): React.ReactElement | null {
  const { context, setDailyParks } = useDailyContext();
  // No context yet → don't render (RootNavigator hasn't seeded daily context).
  if (!context) return null;

  return (
    <View style={styles.row}>
      {SEGMENTS.map(seg => {
        const active = context.parks === seg.value;
        return (
          <Pressable
            key={seg.value}
            onPress={() => void setDailyParks(seg.value)}
            style={[styles.segment, active && styles.segmentActive]}
            testID={`park-toggle-${seg.value}`}
          >
            <Text style={[styles.text, active && styles.textActive]}>{seg.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: '#f1f1f4',
    borderRadius: 999,
    padding: 3,
    alignSelf: 'flex-start',
  },
  segment: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  segmentActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  text: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
  },
  textActive: {
    color: '#6b6bf5',
  },
});
