import React from 'react';
import { StyleSheet, View } from 'react-native';

interface Props {
  total: number;
  current: number;  // 0-indexed
}

export function ProgressDots({ total, current }: Props): React.ReactElement {
  return (
    <View style={styles.row}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            i === current && styles.dotActive,
            i < current && styles.dotPast,
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#e0e0e0',
  },
  dotActive: {
    backgroundColor: '#6b6bf5',
    width: 24,
  },
  dotPast: {
    backgroundColor: '#b0b0e5',
  },
});
