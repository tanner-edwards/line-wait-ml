// Per-ride illustration slot. Placeholder until real ride icons exist — every
// ride gets the same generic glyph, so swapping in art later is a change to
// this file only (rideId is already plumbed through for that).

import React from 'react';
import { View } from 'react-native';
import { FerrisWheel } from 'lucide-react-native';
import { colors } from '../../theme/tokens';

interface Props {
  rideId: string;
  size?: number;
}

export function RideIcon({ rideId, size = 40 }: Props): React.ReactElement {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} testID={`ride-icon-${rideId}`}>
      <FerrisWheel size={size * 0.8} color={colors.go} strokeWidth={1.75} />
    </View>
  );
}
