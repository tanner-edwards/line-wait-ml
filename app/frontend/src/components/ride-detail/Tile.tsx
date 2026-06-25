// Shared section wrapper used inside RideDetailModal. Most content blocks
// on the detail page sit inside one of these — soft-bordered card with a
// small uppercase label and arbitrary children below.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../../theme/tokens';

export function Tile({ children }: { children: React.ReactNode }): React.ReactElement {
  return <View style={styles.tile}>{children}</View>;
}

export function TileLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Text style={styles.tileLabel}>{children}</Text>;
}

const styles = StyleSheet.create({
  tile: {
    // White card on top of the cream sheet — inverse of the prior treatment.
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 14,
    marginTop: 10,
    borderColor: colors.border,
    borderWidth: 1,
  },
  tileLabel: {
    fontSize: 11,
    color: '#666', // TODO: tokenize
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    fontWeight: '600',
  },
});
