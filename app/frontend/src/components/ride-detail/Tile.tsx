// Shared section wrapper used inside RideDetailModal. Most content blocks
// on the detail page sit inside one of these — soft-bordered card with a
// small uppercase label and arbitrary children below.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme/tokens';

export function Tile({ children }: { children: React.ReactNode }): React.ReactElement {
  return <View style={styles.tile}>{children}</View>;
}

export function TileLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Text style={styles.tileLabel}>{children}</Text>;
}

const styles = StyleSheet.create({
  tile: {
    backgroundColor: colors.bg,
    borderRadius: 12,
    padding: 10,
    marginTop: 10,
    borderColor: '#eef', // TODO: tokenize
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
