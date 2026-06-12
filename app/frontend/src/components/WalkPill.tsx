// Walking-distance pill. Used wherever we show "~N min walk" — list rows,
// the ride detail header, recommendation cards. Two visual modes:
//
//   - default (subtle): muted gray text, light bg. For list-row noise.
//   - emphasized:       brand color, semibold, slightly bigger padding.
//                       For cards where the walk distance is a primary
//                       piece of info, not just metadata.
//
// `yards` is shown appended when present — typically only in debug mode
// at the call site (so the component itself doesn't need debug context).

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, typography } from '../theme/tokens';
import { WalkIcon } from './icons/WalkIcon';

interface WalkPillProps {
  minutes: number;
  yards?: number | null;
  emphasized?: boolean;
  testID?: string;
}

export function WalkPill({
  minutes,
  yards = null,
  emphasized = false,
  testID,
}: WalkPillProps): React.ReactElement {
  const label = yards != null ? `~${minutes} min · ${yards} yds` : `~${minutes} min`;
  const iconColor = emphasized ? colors.brand : colors.textTertiary;
  return (
    <View style={[styles.pill, emphasized && styles.pillEmphasized]} testID={testID}>
      <WalkIcon size={emphasized ? 13 : 12} color={iconColor} />
      <Text style={[styles.label, emphasized && styles.labelEmphasized]}>{label}</Text>
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
    alignSelf: 'flex-start',
  },
  pillEmphasized: {
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  label: {
    ...typography.caption,
    color: colors.textTertiary,
  },
  labelEmphasized: {
    color: colors.brand,
    fontWeight: '600',
  },
});
