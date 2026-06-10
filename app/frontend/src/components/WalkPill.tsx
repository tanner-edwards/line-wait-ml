import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Navigation2 } from 'lucide-react-native';
import { colors, radius, typography } from '../theme/tokens';

interface WalkPillProps {
  minutes: number;
}

export function WalkPill({ minutes }: WalkPillProps): React.ReactElement {
  return (
    <View style={styles.pill}>
      <Navigation2 size={10} color={colors.textTertiary} />
      <Text style={styles.label}>~{minutes} min</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  label: {
    ...typography.caption,
    color: colors.textTertiary,
  },
});
