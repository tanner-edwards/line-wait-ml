// AI recommendation reason tile — shown in the ride detail sheet when the
// user arrived from the Recommendations tab. Renders nothing when oneLiner
// is null (navigated from list/map instead).

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { colors } from '../../theme/tokens';
import { Tile } from './Tile';

interface Props {
  oneLiner: string | null;
}

export function ReasonCard({ oneLiner }: Props): React.ReactElement | null {
  if (!oneLiner) return null;

  return (
    <Tile>
      <View style={styles.row}>
        <View style={styles.iconContainer}>
          <Sparkles size={16} color={colors.brand} />
        </View>
        <Text style={styles.text}>{oneLiner}</Text>
      </View>
    </Tile>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(10,107,90,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  text: {
    flex: 1,
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 19,
  },
});
