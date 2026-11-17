// Walking time: walker icon + "N min", plain text (no pill — the wait beside
// it gets the pill). Used wherever we show "N min walk" — list rows, the ride
// detail header, recommendation cards. `pilled` puts it back in the light
// gray pill (ride detail header, where no wait pill sits beside it).
// Two visual modes:
//
//   - default:          textPrimary, same as the wait — lighter grays
//                       washed out in direct sun.
//   - emphasized:       brand color, semibold.
//                       For cards where the walk distance is a primary
//                       piece of info, not just metadata.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, typography } from '../theme/tokens';
import { WalkIcon } from './icons/WalkIcon';

interface WalkPillProps {
  minutes: number;
  emphasized?: boolean;
  /** Light gray pill background. */
  pilled?: boolean;
  testID?: string;
}

export function WalkPill({
  minutes,
  emphasized = false,
  pilled = false,
  testID,
}: WalkPillProps): React.ReactElement {
  const label = `${minutes} min`;
  const iconColor = emphasized ? colors.brand : colors.textPrimary;
  return (
    <View style={[styles.pill, emphasized && styles.pillEmphasized, pilled && styles.pilled]} testID={testID}>
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
    alignSelf: 'flex-start',
  },
  pillEmphasized: {
    gap: 4,
  },
  pilled: {
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  label: {
    ...typography.caption,
    color: colors.textPrimary,
  },
  labelEmphasized: {
    color: colors.brand,
    fontWeight: '600',
  },
});
